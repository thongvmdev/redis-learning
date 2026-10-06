/**
 * Thông báo trong thực tế: DB là NGUỒN SỰ THẬT, Redis chỉ để tăng tốc
 *
 *   Postgres : lưu bền, catch-up khi reconnect, trạng thái đọc từng thông báo, retention dài hạn
 *   Pub/Sub  : đẩy real-time cho ai đang online (không lưu gì)
 *   Redis key: chỉ cache số "chưa đọc" (có TTL, tự lành nếu lệch)
 *
 * Phần SSE giữ nguyên handler ở ví dụ trước (đăng ký kết nối -> replay -> buffer -> live),
 * chỉ thay:  readAfter()  ->  listAfter()   và   compareIds()  ->  so sánh số nguyên (BigInt/Number)
 *
 * Cài đặt: npm install pg redis
 *
 * SCHEMA
 *   CREATE TABLE notifications (
 *     id         BIGSERIAL PRIMARY KEY,           -- dùng luôn làm SSE id / Last-Event-ID
 *     user_id    BIGINT NOT NULL,
 *     type       TEXT NOT NULL,
 *     payload    JSONB NOT NULL,
 *     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 *     read_at    TIMESTAMPTZ                      -- NULL = chưa đọc (thay cho con trỏ lastread)
 *   );
 *   CREATE INDEX ON notifications (user_id, id);                       -- catch-up
 *   CREATE INDEX ON notifications (user_id, id) WHERE read_at IS NULL; -- danh sách/đếm chưa đọc
 *   CREATE INDEX ON notifications (created_at);                        -- job dọn dẹp
 */

const { Pool } = require('pg')
const { createClient } = require('redis')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: 'redis://localhost:6379' })

const UNREAD_COUNT_TTL_SECONDS = 60 * 60 // cache đếm sống 1 giờ, lệch cũng tự lành sau đó
const channelOf = (userId) => `user:${userId}:notify`
const unreadCountKey = (userId) => `notif:${userId}:unread_count`

// INCRBY chỉ khi key đang tồn tại (atomic) -> không tạo key đếm sai khi chưa có cache
const ADJUST_IF_EXISTS_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('INCRBY', KEYS[1], ARGV[1])
end
return nil
`

async function adjustUnreadCount(userId, delta) {
  await redis.eval(ADJUST_IF_EXISTS_LUA, {
    keys: [unreadCountKey(userId)],
    arguments: [String(delta)],
  })
}

const toDto = (r) => ({
  id: String(r.id),
  type: r.type,
  payload: r.payload,
  createdAt: r.created_at,
})

// ============================================================
// GHI: DB trước (bền), Redis sau (best-effort)
// ============================================================
async function createNotification(userId, type, payload) {
  // 1) Ghi bền. Lỗi ở đây -> throw, KHÔNG publish gì cả.
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, type, payload)
     VALUES ($1, $2, $3) RETURNING id, created_at`,
    [userId, type, JSON.stringify(payload)],
  )
  const notification = toDto({
    id: rows[0].id,
    type,
    payload,
    created_at: rows[0].created_at,
  })

  // 2) Các bước sau commit là best-effort: lỗi cũng không mất thông báo (đã nằm trong DB).
  //    - INCR hỏng  -> số đếm lệch tối đa 1 giờ rồi tự lành nhờ TTL
  //    - PUBLISH hỏng -> client nhận khi reconnect/refresh (catch-up từ DB)
  try {
    await adjustUnreadCount(userId, +1)
    await redis.publish(channelOf(userId), JSON.stringify(notification))
  } catch (err) {
    console.warn('Post-commit step failed (non-fatal):', err.message)
  }
  return notification
}

// ============================================================
// ĐỌC
// ============================================================

// Catch-up khi reconnect: mọi thông báo có id > Last-Event-ID
async function listAfter(userId, afterId, limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, type, payload, created_at FROM notifications
     WHERE user_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
    [userId, afterId ?? 0, limit],
  )
  return rows.map(toDto)
}

// Danh sách chưa đọc cho chuông (mới nhất trước) + lastId để mở SSE không hở khoảng
async function listUnread(userId, limit = 50) {
  const [{ rows }, { rows: maxRows }] = await Promise.all([
    pool.query(
      `SELECT id, type, payload, created_at FROM notifications
       WHERE user_id = $1 AND read_at IS NULL ORDER BY id DESC LIMIT $2`,
      [userId, limit],
    ),
    pool.query(
      `SELECT COALESCE(max(id), 0) AS last_id FROM notifications WHERE user_id = $1`,
      [userId],
    ),
  ])
  return { notifications: rows.map(toDto), lastId: String(maxRows[0].last_id) }
}

// Số chưa đọc: cache-aside (giống pattern likes ở bài Sets)
async function getUnreadCount(userId) {
  const cached = await redis.get(unreadCountKey(userId))
  if (cached !== null) return Number(cached)

  const { rows } = await pool.query(
    `SELECT count(*)::int AS c FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
    [userId],
  )
  await redis.set(unreadCountKey(userId), rows[0].c, {
    EX: UNREAD_COUNT_TTL_SECONDS,
  })
  return rows[0].c
}

// ============================================================
// ĐÁNH DẤU ĐÃ ĐỌC (từng cái hoặc tất cả) — giải quyết câu hỏi "đọc cái ở giữa"
// ============================================================
async function markRead(userId, notificationId) {
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = now()
     WHERE id = $1 AND user_id = $2 AND read_at IS NULL`, // idempotent: bấm 2 lần không trừ 2 lần
    [notificationId, userId],
  )
  if (rowCount > 0) await adjustUnreadCount(userId, -1)
}

async function markAllReadUpTo(userId, upToId) {
  await pool.query(
    `UPDATE notifications SET read_at = now()
     WHERE user_id = $1 AND id <= $2 AND read_at IS NULL`,
    [userId, upToId],
  )
  await redis.del(unreadCountKey(userId)) // đơn giản: xóa cache, lần sau tự đếm lại từ DB
}

// ============================================================
// RETENTION: chạy định kỳ (cron / BullMQ repeatable job), xóa theo lô nhỏ để không khóa bảng lâu
// ============================================================
async function purgeOldNotifications() {
  const BATCH = 1000
  let deleted
  do {
    const res = await pool.query(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications
         WHERE (read_at IS NOT NULL AND read_at < now() - interval '30 days') -- đã đọc: giữ 30 ngày
            OR created_at < now() - interval '90 days'                        -- chưa đọc: giữ 90 ngày
         LIMIT ${BATCH})`,
    )
    deleted = res.rowCount
  } while (deleted === BATCH)
}

module.exports = {
  redis,
  createNotification,
  listAfter,
  listUnread,
  getUnreadCount,
  markRead,
  markAllReadUpTo,
  purgeOldNotifications,
}

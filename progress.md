# Redis Learning — Progress Tracking

> Giáo án gốc: [redis.md](./redis.md)
> Học qua use case thật: [LangGraph-Runtime-UseCases.md](./lessons/LangGraph-Runtime-UseCases.md) (10 bài + capstone, map vào Chương 2–6)
> Cách dùng: tick `[x]` khi xong, điền ngày vào cột **Ngày xong**, ghi chú lại chỗ nào chưa vững để ôn phỏng vấn.

**Bắt đầu:** 2026-09-10 - 1 Month
**Mục tiêu:** ứng dụng vào Family Finance (cache pipeline Weaviate, rate limit insight-chat, session/JWT) + đủ chiều sâu cho phỏng vấn senior/fullstack.

# Note progress: Chương 2: Cấu trúc Dữ liệu cơ bản & Nâng cao

##**0930**

- [] Redis Streams
  > [x] Foundation
  > `Use case in langgraph`

**QA**

- [x] BLPOP / Stream, Consumer Group diff > self explain.
- [x] Self write full flow example

## PSY Note

- Just read AI output > depress

---

## [x] Chương 1: Giới thiệu & Tổng quan

Trạng thái: ⬜ · Ngày bắt đầu: \_**\_ · Ngày xong: \_\_**

- [x] Redis là gì? Tại sao chọn Redis?
- [x] So sánh In-Memory DB vs Relational DB (liên hệ MySQL của Family Finance)
- [x] Cài đặt Redis qua Docker / Docker Compose
- [x] Làm quen Redis CLI + RedisInsight (GUI)

**Checkpoint:** dựng được Redis local, `SET`/`GET` qua CLI, xem key trong RedisInsight.

## **Ghi chú / câu hỏi còn thắc mắc:**

---

## Chương 2: Cấu trúc Dữ liệu cơ bản & Nâng cao

Trạng thái: ⬜ · Ngày bắt đầu: \_**\_ · Ngày xong: \_\_**

- [x] Strings: `SET`, `GET`, `INCR`, Expiration/TTL
- [x] Lists: Queue & Stack (`LPUSH`, `RPOP`, `LRANGE`)
- [x] Hashes: lưu Object / User profile (`HSET`, `HGETALL`)
- [x] Sets: dữ liệu không trùng lặp (`SADD`, `SINTER`)
- [x] Sorted Sets (ZSet): leaderboard, sliding-window (`ZADD`, `ZRANGEBYSCORE`)

**Checkpoint:** cho 1 bài toán thực tế (user profile, giỏ hàng, cache category, bảng xếp hạng) → chọn đúng kiểu dữ liệu và giải thích được lý do.

## **Ghi chú / câu hỏi còn thắc mắc:**

---

## Chương 3: Lưu trữ Bền vững & Bộ nhớ

Trạng thái: ⬜ · Ngày bắt đầu: \_**\_ · Ngày xong: \_\_**

- [ ] RDB (Snapshots): nguyên lý, ưu/nhược điểm
- [ ] AOF: chính sách fsync (`always`, `everysec`, `no`) + AOF rewrite
- [ ] Memory Eviction Policies: LRU, LFU, volatile-TTL, `maxmemory`

**Checkpoint:** giải thích được trade-off RDB vs AOF, và chọn eviction policy phù hợp cho cache layer.

## **Ghi chú / câu hỏi còn thắc mắc:**

---

## Chương 4: Tính năng Nâng cao

Trạng thái: ⬜ · Ngày bắt đầu: \_**\_ · Ngày xong: \_\_**

- [ ] Transactions: `MULTI`, `EXEC`, `WATCH` (optimistic locking)
- [ ] Pub/Sub: real-time messaging / chat
      --> Improve noti feature for ff: stream or pub/sub

- [x] Redis Streams: event-driven, consumer group (so sánh nhanh với Kafka)
- [x] Lua Scripting: logic phức tạp nguyên khối (atomic ops)
- [ ] Geospatial, Bitmaps, HyperLogLog: tọa độ, điểm danh, đếm unique dữ liệu lớn
- [] BullMQ: Queue/Worker > How bullMQ work behind the sense

**Checkpoint:** viết được 1 Lua script atomic (ví dụ: rate limiter check-and-increment) và 1 demo Pub/Sub hoặc Stream.

## **Ghi chú / câu hỏi còn thắc mắc:**

---

## Chương 5: High Availability & Scaling

Trạng thái: ⬜ · Ngày bắt đầu: \_**\_ · Ngày xong: \_\_**

- [ ] Replication: Master–Replica, read scaling
- [ ] Redis Sentinel: failover tự động
- [ ] Redis Cluster: sharding qua Hash Slots, hash tag `{}`
- [ ] Node event loop and single thread > Redis related?

**Checkpoint:** vẽ được sơ đồ HA và trả lời được câu hỏi phỏng vấn "Sentinel vs Cluster khác gì nhau, khi nào dùng cái nào?".

## **Ghi chú / câu hỏi còn thắc mắc:**

---

## Chương 6: Tích hợp & Dự án Thực tế (Node.js / Next.js)

Trạng thái: ⬜ · Ngày bắt đầu: \_**\_ · Ngày xong: \_\_**

- [x] Tích hợp Redis vào Node.js/Next.js bằng `ioredis` (connection, singleton, error handling)
- [x] **Thực hành 1:** Cache-aside layer cho REST API — cache category list / kết quả search Weaviate (trước bước LLM judge trong retry-loop pipeline)
  - [x] Đo latency trước/sau khi cache
  - [x] Xử lý cache invalidation
- [x] **Thực hành 2:** Rate Limiter cho insight-chat router (giới hạn query semantic/SQL mỗi user/phút)
  - [x] Chọn thuật toán (fixed window / sliding window ZSet / token bucket)
  - [x] Trả `429` + header `Retry-After`
- [] **Thực hành 4:** Vector search > User pref ff

**Checkpoint:** Redis chạy thật trong Family Finance: latency pipeline search giảm, router có rate limit, session quản lý qua Redis.

## **Ghi chú / câu hỏi còn thắc mắc:**

## Câu hỏi phỏng vấn cần trả lời trôi chảy

- [ ] Redis single-threaded nhưng sao vẫn nhanh?
- [ ] Cache-aside vs write-through vs write-behind?
- [ ] Cache stampede / thundering herd xử lý thế nào?
- [ ] RDB vs AOF: mất dữ liệu tối đa bao nhiêu trong từng cấu hình?
- [ ] Eviction policy nào cho cache, nào cho data store?
- [ ] `WATCH`/`MULTI` khác lock phân tán (Redlock) ra sao?
- [ ] Pub/Sub vs Streams: khi nào chọn cái nào?
- [ ] Sentinel vs Cluster?
- [ ] Vì sao multi-key command bị hạn chế trong Cluster? Hash tag giải quyết gì?
- [ ] Rate limiter: fixed window có vấn đề gì, sliding window fix ra sao?

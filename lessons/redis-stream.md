Chuyển sang **Redis Streams** — cấu trúc dữ liệu mới nhất và phức tạp nhất trong nhóm collection của Redis (từ bản 5.0), được thiết kế riêng cho **event streaming / message queue** có khả năng replay và xử lý theo nhóm (consumer group) — thứ mà List (`LPUSH`/`BRPOP`) học ở bài trước **không làm được**.

## Stream là gì?

Một log các sự kiện (event log), mỗi entry có 1 **ID duy nhất tăng dần theo thời gian**, không bao giờ bị ghi đè — giống mô hình của Kafka nhưng gọn nhẹ hơn, chạy ngay trong Redis.

### Vì sao gọi là "Stream"?

Vì nó mô hình hoá dữ liệu như một **dòng sự kiện liên tục, chỉ thêm vào cuối, có thứ tự theo thời gian**, chứ không phải tập dữ liệu tĩnh.

- **Append-only, có thứ tự**: mỗi `XADD` thêm entry vào cuối, ID dạng `<timestamp-ms>-<seq>` luôn tăng dần → một log chảy theo một hướng (thời gian).
- **Lưu sự kiện, không lưu trạng thái**: `String/Hash/Set` lưu _giá trị hiện tại_; Stream lưu _chuỗi những gì đã xảy ra_.
- **Producer đẩy vào, consumer đọc theo dòng**: consumer đứng "hạ lưu", đọc tiếp từ vị trí đã đọc; với `BLOCK` thì chờ cho tới khi có dữ liệu mới chảy đến.
- **Đọc nhiều lần, nhiều hướng**: entry vẫn còn sau khi đọc, mỗi consumer group có con trỏ vị trí riêng (như nhiều người đứng ở các điểm khác nhau bên bờ sông).

Ý tưởng lấy cảm hứng từ commit log của Kafka.

| | List | Pub/Sub | Stream |
|---|---|---|---|
| Còn lại sau khi đọc | Không (pop là mất) | Không (fire-and-forget) | **Có** |
| Đọc lại từ vị trí cũ | Không | Không | **Có** (theo ID) |
| Consumer group, ack | Không | Không | **Có** |

## XADD — thêm entry vào stream

```
XADD mystream * field1 "value1" field2 "value2"
# -> "1732500000000-0"   (ID tự sinh: timestamp-sequence)
```

Dấu `*` bảo Redis tự sinh ID (timestamp-ms + số thứ tự nếu trùng ms). Có thể tự đặt ID thủ công nhưng hiếm khi cần.

```
XADD orders:stream * order_id "5023" status "created"
XADD orders:stream * order_id "5024" status "created"
```

## XRANGE / XLEN — đọc dữ liệu

```
XRANGE orders:stream - +          # đọc toàn bộ, từ đầu (-) tới cuối (+)
XLEN orders:stream                 # đếm tổng số entry
XREVRANGE orders:stream + - COUNT 5   # 5 entry mới nhất
```

## Điểm khác biệt lớn nhất so với List: XREAD hỗ trợ blocking + vị trí đọc

```
XREAD COUNT 10 STREAMS orders:stream 0        # đọc từ đầu
XREAD BLOCK 0 STREAMS orders:stream $          # chờ entry MỚI (sau thời điểm hiện tại)
```

`$` nghĩa là "chỉ lấy entry đến sau thời điểm gọi lệnh" — khác hẳn `BRPOP` ở List (chỉ lấy được 1 lần, ai lấy trước thì mất luôn). Với Stream, **nhiều consumer độc lập có thể đọc cùng 1 stream mà không đụng nhau**, mỗi consumer tự track vị trí đọc riêng.

## Consumer Group — tính năng mạnh nhất, giải quyết đúng vấn đề của List/Queue

Nhớ lại bài Task Queue dùng List (`BRPOP`) — nếu 1 worker crash giữa chừng khi đang xử lý task, task đó **mất luôn** (đã bị `RPOP` ra khỏi list). Stream giải quyết vấn đề này bằng cơ chế **acknowledge (ACK)**.

```
XGROUP CREATE orders:stream workers 0    # tạo consumer group tên "workers"

XREADGROUP GROUP workers worker1 COUNT 1 STREAMS orders:stream >
# -> lấy 1 entry mới, đánh dấu "đang được worker1 xử lý" (pending)

XACK orders:stream workers 1732500000000-0
# -> xác nhận đã xử lý xong -> xóa khỏi danh sách pending
```

Nếu `worker1` crash **trước khi gọi `XACK`**, entry đó vẫn nằm trong **Pending Entries List (PEL)** — không mất, có thể dùng `XPENDING` để xem, và `XCLAIM` để chuyển giao cho worker khác xử lý tiếp.

```
XPENDING orders:stream workers              # xem entry nào đang pending, ai đang giữ
XCLAIM orders:stream workers worker2 60000 1732500000000-0   # worker2 "giành" lại entry bị bỏ dở
```

## So sánh nhanh: List vs Stream cho Queue

| Tiêu chí                              | List (`BRPOP`)                                       | Stream (Consumer Group)                                |
| ------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------ |
| Nhiều worker chia tải                 | Được, nhưng mỗi entry chỉ 1 worker lấy được (đúng ý) | Được, và còn track ai đang xử lý gì                    |
| Worker crash giữa chừng               | **Mất task** (đã bị POP)                             | **Không mất** — nằm trong PEL, `XCLAIM` lại được       |
| Replay lại lịch sử                    | Không thể (POP là xóa luôn)                          | Có thể — `XRANGE` đọc lại từ đầu bất kỳ lúc nào        |
| Nhiều consumer group độc lập cùng đọc | Không (1 entry chỉ 1 nơi lấy được)                   | Có — 2 group khác nhau đọc riêng, không ảnh hưởng nhau |

## Ví dụ thực tế: Order Processing với độ tin cậy cao (không mất event)

```js
const STREAM_KEY = 'orders:stream'
const GROUP_NAME = 'order-workers'
const CLAIM_IDLE_MS = 30_000 // pending longer than this = the worker holding it is presumed dead

const db = {
  async insertOrder(orderId, amount) {
    console.log(
      `[DB] INSERT INTO processed_orders (order_id, amount) VALUES (${orderId}, ${amount}) ` +
        `ON CONFLICT (order_id) DO NOTHING`, // idempotent — safe if an entry gets processed twice
    )
  },
}

// --- API: push orders onto the stream ---
app.post('/orders', async (req, res) => {
  const { orderId, amount } = req.body
  const entryId = await redisClient.xAdd(STREAM_KEY, '*', {
    order_id: String(orderId),
    amount: String(amount),
    status: 'created',
  })
  res.status(202).json({ message: 'Order queued', entryId })
})

app.get('/orders/stream/status', async (req, res) => {
  const length = await redisClient.xLen(STREAM_KEY)
  const pending = await redisClient.xPending(STREAM_KEY, GROUP_NAME)
  res.json({ totalEntries: length, pendingCount: pending.pending })
})

// --- Worker: one or many instances running in parallel ---
async function startWorker() {
  const consumerName = `worker-${process.pid}`
  let running = true
  process.on('SIGTERM', () => {
    running = false
  }) // graceful shutdown

  while (running) {
    const results = await redisClient.xReadGroup(
      GROUP_NAME,
      consumerName,
      [{ key: STREAM_KEY, id: '>' }],
      { COUNT: 1, BLOCK: 5000 },
    )
    if (!results) continue

    for (const stream of results) {
      for (const entry of stream.messages) {
        await handleEntry(redisClient, entry)
      }
    }
  }
}

async function handleEntry(redisClient, entry) {
  const { order_id, amount } = entry.message
  try {
    await db.insertOrder(order_id, amount)
    await redisClient.xAck(STREAM_KEY, GROUP_NAME, entry.id) // only ACK after success
  } catch (err) {
    console.error(
      `Entry ${entry.id} failed, left un-acked for retry/claim`,
      err,
    )
  }
}

// --- Recovery job: periodically reclaims stale pending entries ---
async function startRecoveryJob() {
  setInterval(async () => {
    const result = await redisClient.xAutoClaim(
      STREAM_KEY,
      GROUP_NAME,
      'recovery-job',
      CLAIM_IDLE_MS,
      '0',
    )
    for (const entry of result.messages) {
      await handleEntry(redisClient, entry) // reprocess and ACK
    }
  }, 10_000)
}
```

### Giải thích `xReadGroup` trong worker

```js
redisClient.xReadGroup(
  GROUP_NAME, // consumer group (đã tạo bằng XGROUP CREATE)
  consumerName, // định danh worker; các worker cùng group chia nhau message
  [{ key: STREAM_KEY, id: '>' }],
  { COUNT: 1, BLOCK: 5000 },
)
```

| Tham số | Ý nghĩa |
| --- | --- |
| `id: '>'` | Chỉ lấy message **mới, chưa giao cho consumer nào** trong group |
| `COUNT: 1` | Mỗi lần lấy tối đa 1 message |
| `BLOCK: 5000` | Chưa có message thì chờ tối đa 5s; hết giờ trả về `null` (nên có `if (!results) continue`) |

Khi nhận message: Redis đưa nó vào **PEL** của consumer và tăng `last-delivered-id` của group. Message chỉ rời PEL khi `XACK`.

Lưu ý:

- `id: '0'` thay vì `'>'` → đọc lại các message **đã giao nhưng chưa ACK** của chính consumer này (hữu ích khi restart).
- `BLOCK` chiếm connection trong lúc chờ → nên dùng client riêng (`redisClient.duplicate()`) cho worker.
- `BLOCK: 0` = chờ vô hạn.

**Vì sao dùng Stream thay vì List ở đây:** nếu worker crash giữa lúc xử lý order (vd mất điện, container bị kill), order đó **không biến mất** — vẫn nằm trong Pending Entries List của group `order-workers`, một worker khác (hoặc chính worker đó sau khi restart) có thể dùng `XCLAIM`/`XAUTOCLAIM` để lấy lại và xử lý tiếp, đảm bảo **at-least-once delivery** — điều List không đảm bảo được.

---

Thử trên `redis-cli`:

```
XADD orders:stream * order_id "1" status "created"
XGROUP CREATE orders:stream workers 0
XREADGROUP GROUP workers w1 COUNT 1 STREAMS orders:stream >
XPENDING orders:stream workers
XACK orders:stream workers <id-vừa-lấy-được>
XPENDING orders:stream workers
```

Bạn thử gõ và quan sát `XPENDING` trước và sau khi `XACK` — sẽ thấy rõ entry biến mất khỏi danh sách pending. Có thắc mắc gì trước khi qua ví dụ tiếp theo không?

- Add orders: 3
- Consumer GR: mgmt woker processing order / recover if fail
-

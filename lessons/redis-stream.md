Chuyển sang **Redis Streams** — cấu trúc dữ liệu mới nhất và phức tạp nhất trong nhóm collection của Redis (từ bản 5.0), được thiết kế riêng cho **event streaming / message queue** có khả năng replay và xử lý theo nhóm (consumer group) — thứ mà List (`LPUSH`/`BRPOP`) học ở bài trước **không làm được**.

## Stream là gì?

Một log các sự kiện (event log), mỗi entry có 1 **ID duy nhất tăng dần theo thời gian**, không bao giờ bị ghi đè — giống mô hình của Kafka nhưng gọn nhẹ hơn, chạy ngay trong Redis.

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
const express = require('express')
const { createClient } = require('redis')

const app = express()
app.use(express.json())

const redisClient = createClient({ url: 'redis://localhost:6379' })
redisClient.on('error', (err) => console.error('Redis Client Error', err))
;(async () => {
  await redisClient.connect()
  try {
    await redisClient.xGroupCreate('orders:stream', 'order-workers', '0', {
      MKSTREAM: true,
    })
  } catch (e) {
    // group đã tồn tại từ trước -> bỏ qua lỗi "BUSYGROUP"
  }
})()

// API nhận order, đẩy vào stream
app.post('/orders', async (req, res) => {
  const { orderId, amount } = req.body

  const entryId = await redisClient.xAdd('orders:stream', '*', {
    order_id: orderId,
    amount: String(amount),
    status: 'created',
  })

  res.status(202).json({ message: 'Order queued', entryId })
})

app.listen(3000, () => console.log('API running on port 3000'))
```

```js
// worker.js
const { createClient } = require('redis')

const redisClient = createClient({ url: 'redis://localhost:6379' })
redisClient.on('error', (err) => console.error('Redis Client Error', err))

const CONSUMER_NAME = `worker-${process.pid}`

async function processOrder(entry) {
  console.log(`Processing order ${entry.message.order_id}...`)
  // TODO: logic xử lý đơn hàng thật (trừ kho, gọi payment...)
}

async function startWorker() {
  await redisClient.connect()

  while (true) {
    const results = await redisClient.xReadGroup(
      'order-workers',
      CONSUMER_NAME,
      [{ key: 'orders:stream', id: '>' }],
      { COUNT: 1, BLOCK: 5000 },
    )

    if (!results) continue // timeout, không có entry mới, lặp lại chờ tiếp

    for (const stream of results) {
      for (const entry of stream.messages) {
        try {
          await processOrder(entry)
          await redisClient.xAck('orders:stream', 'order-workers', entry.id)
        } catch (err) {
          console.error(
            `Xử lý entry ${entry.id} thất bại, sẽ nằm trong PEL để retry`,
            err,
          )
          // Không ACK -> entry vẫn pending, có thể XCLAIM lại sau
        }
      }
    }
  }
}

startWorker()
```

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

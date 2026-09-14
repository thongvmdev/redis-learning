Redis List là cấu trúc dữ liệu linh hoạt, có thể dùng làm cả **Queue (FIFO)** lẫn **Stack (LIFO)** tùy vào cách bạn push/pop.

## Các lệnh cơ bản

```
LPUSH key value    # thêm vào đầu (trái)
RPUSH key value    # thêm vào cuối (phải)
LPOP key           # lấy ra từ đầu
RPOP key           # lấy ra từ cuối
LRANGE key 0 -1    # xem toàn bộ list
LLEN key           # đếm số phần tử
BLPOP/BRPOP là phiên bản blocking: nếu list rỗng, lệnh sẽ "treo" và chờ tới khi có phần tử mới, thay vì phải tự viết vòng lặp polling tốn tài nguyên.
```

## [x] 1. Dùng làm Queue (FIFO — vào trước ra trước)

Push vào một đầu, pop ra đầu kia:

```
RPUSH tasks "task1"
RPUSH tasks "task2"
RPUSH tasks "task3"

LPOP tasks   # → "task1" (ra trước vì vào trước)
LPOP tasks   # → "task2"
```

Đây là pattern chuẩn cho **job queue / task queue** — worker xử lý theo đúng thứ tự được thêm vào.

## [x] 2. Dùng làm Stack (LIFO — vào sau ra trước)

Push và pop cùng một đầu:

```
LPUSH history "page1"
LPUSH history "page2"
LPUSH history "page3"

LPOP history   # → "page3" (ra trước vì vào sau cùng)
LPOP history   # → "page2"
```

Hợp cho **undo history**, **browser back button**, **call stack** giả lập.

## [x] 3. Blocking operations (rất hay dùng cho queue thực tế)

```
BLPOP tasks 0     # chờ vô hạn cho tới khi có phần tử, rồi pop ra
BRPOP tasks 5     # chờ tối đa 5 giây
```

Đây là cách để làm **worker consumer** — thay vì polling liên tục (`LPOP` rồi check null), worker sẽ "ngủ" và được đánh thức ngay khi có task mới. Rất phổ biến trong hệ thống job queue (kiểu như Bull/BullMQ trong Node.js thực chất build trên nền này).

## 4. Một số lệnh khác đáng chú ý

```
LINSERT key BEFORE|AFTER pivot value   # chèn vào giữa
LREM key count value                    # xóa phần tử theo value
LTRIM key start stop                    # cắt list, giữ lại 1 khoảng — hay dùng để giới hạn size (ví dụ log gần nhất 100 dòng)
LSET key index value                    # sửa phần tử tại vị trí index
```

## Lưu ý về hiệu năng

- List trong Redis là **linked list**, nên `LPUSH`/`RPUSH`/`LPOP`/`RPOP` ở hai đầu là O(1) — rất nhanh.
- Nhưng truy cập giữa list (`LINDEX`, `LINSERT`) là O(N) — tránh dùng nếu list lớn.
- Nếu cần queue với độ tin cậy cao hơn (retry, dead-letter, ack), nên xem thêm **Redis Streams** (`XADD`, `XREAD`, consumer groups) — mạnh hơn List nhiều cho use case queue thực sự production-grade.

Anh học phần này cho project cụ thể nào không, hay đang học theo lộ trình tổng quát về Redis?

===

# Note

- [x] FIFO
- [x] Diff LPOP/BLPOP and socker connection
- [x] Socket:

```
const redis = createClient({
socket: { host: process.env.REDIS_HOST, port: 6379 } // host = "redis"
});
```

- [x] Redis instance and multiple worker

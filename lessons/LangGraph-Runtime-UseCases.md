# Học Redis qua LangGraph Runtime (use case thật trong `ff` prod)

> Nguồn: soi image `langchain/langgraphjs-api:24` (langgraph-api 0.12.3), binary Go `core-api-grpc` + `langgraph_runtime_postgres/redis.py`.
> ✅ = tên key/lệnh đọc thẳng từ binary. 🔍 = ý nghĩa mình suy từ tên hàm / mảnh Lua (runtime đóng mã).
> Mọi lab dưới đây **đã chạy thử** trên `redis-learn` (Redis 7.4) ngày 2026-09-30.

> **🔧 Đính chính sau khi chạy runtime thật + `MONITOR` (2026-10-01)**, chi tiết ở [langgraph-01](./langgraph-01-run-stream.md) và [langgraph-02](./langgraph-02-thread-stream-cache.md):
>
> - **Bài 7:** `thread:<t>:run:<r>:stream` là **channel Pub/Sub**, không phải Stream. Stream thật là **`thread:<t>:cache`** (1 Stream cho mỗi thread, chứa mọi run). Các lệnh trong lab Bài 7 vẫn đúng, chỉ có tên key là sai.
> - **Bài 3 & 10:** ở Redis standalone, key thật là `run:queue` và `run:queue:threads`, **không có ngoặc**. Hash tag `{queue}` chỉ có ý nghĩa khi chạy cluster mode (🔍).
> - **Bài 6:** phần "đoán" là **đúng**. Bên gửi chạy Lua `SET control <action>` + `EXPIRE 60` + `PUBLISH`. Worker `SUBSCRIBE` rồi `GET` key control ngay sau đó.
> - **Bài 2:** script thật **không xoá** key khi về 0. Nó kẹp giá trị ở 0 (`SET 0`) rồi `PEXPIRE` lại TTL cũ, và trả về 0 khi key không tồn tại.

**Cách học:** mỗi bài ~20 phút. Đọc 3 dòng "LangGraph làm gì" → gõ Lab → tự làm bài "Tự làm" **trước khi** mở đáp án. Không cần đọc hết file một lượt.

---

## 0. Setup (đọc cái này trước)

⚠️ `redis-learn` (:6379) **chính là Redis mà `ff` dev đang dùng** (`REDIS_URL=redis://localhost:6379`, key `ff:v1:*` ở DB 0). Vậy nên:

- Mọi lab chạy ở **DB 15**: `redis-cli -n 15`
- Chỉ dọn bằng `FLUSHDB` **sau khi** đã `-n 15`. Không bao giờ `FLUSHALL`.

```bash
docker exec -it redis-learn redis-cli -n 15
```

Bài nào cần 2 terminal thì mở 2 tab, cả hai cùng chạy lệnh trên. RedisInsight: http://localhost:5540 → chọn DB 15.

---

## Bản đồ: bài nào ↔ chương nào trong `progress.md`

| Bài | Use case LangGraph             | Key thật                             | Khái niệm                                           | Chương                     |
| --- | ------------------------------ | ------------------------------------ | --------------------------------------------------- | -------------------------- | --- |
| 1   | Worker còn sống không?         | `run:<id>:running`                   | String + TTL, `SET NX/XX PX`                        | 2 (ôn)                     |
| 2   | Đếm retry                      | `run:<id>:attempt`                   | Lua atomic, bẫy `DECR` trên key không tồn tại       | 4 (ôn Lua)                 |
| 3   | Hàng đợi run                   | `run:{queue}`, `run:{queue}:threads` | `BLPOP` làm chuông báo, ZSET lên lịch, claim atomic | 2 (BullMQ)                 |
| 4   | Chỉ 1 replica chạy migration   | `migration:{lock}`                   | Distributed lock + release an toàn                  | 4                          |     |
| 6   | Bấm Stop → cancel run          | `thread:<t>:run:<r>:control`         | Pub/Sub, fire-and-forget                            | 4                          |
| 7   | Chat reconnect không mất token | `thread:<t>:run:<r>:stream`          | Redis Streams, `XRANGE` resume                      | 4                          |
| 8   | Chống 1 run spam event         | `rate_limit_key`                     | GCRA vs sliding window ZSET (phase 6)               | 4 + "Compare > Chat Agent" |
| 9   | Vì sao prod tách 2 Redis       | `ff-redis` vs `ff-redis-cache`       | AOF, `noeviction` vs `allkeys-lru`                  | 3                          |
| 10  | Vì sao key có `{...}`          | `run:{queue}`, `{sweep}`             | Hash slot, hash tag                                 | 5                          |
| ★   | Nhìn tận mắt trên prod         | tất cả                               | `SCAN`, `TYPE`, `MONITOR`                           | 6                          |

**Ý lớn nhất, nhớ trước khi vào bài:** với LangGraph, **Postgres là nguồn sự thật** (thread, run, checkpoint, Store). **Redis chỉ lo điều phối** (đánh thức worker, lock, heartbeat) và **giữ dữ liệu tạm** (event stream). Mất Redis thì run có thể treo, nhưng lịch sử chat không mất.

---

## Bài 1: Heartbeat bằng TTL (`run:<id>:running`) ✅

**LangGraph làm gì:** worker đang chạy run thì giữ key `run:<id>:running` có TTL và gia hạn định kỳ (`heartbeat`). Worker crash thì key tự hết hạn, sweeper thấy vậy (`CheckAlive`) và đưa run vào hàng đợi lại. Env liên quan: `BG_JOB_HEARTBEAT`, `HEARTBEAT_TIMEOUT_SECONDS`.

**Lab:**

```
SET run:r1:running worker-a NX PX 5000   # OK      → worker-a nhận run
SET run:r1:running worker-b NX PX 5000   # (nil)   → worker-b không cướp được
PTTL run:r1:running                      # ~4900
SET run:r1:running worker-a XX PX 5000   # OK      → heartbeat: chỉ gia hạn nếu key còn
# chờ 6 giây, không gia hạn nữa
EXISTS run:r1:running                    # 0       → "worker chết"
```

**Tự làm:** vì sao heartbeat dùng `XX` mà không dùng `SET` thường?

<details><summary>Đáp án</summary>

`SET` thường sẽ **tạo lại** key kể cả khi nó đã hết hạn và sweeper đã giao run cho worker khác. Khi đó có 2 worker cùng tin là mình đang giữ run. `XX` nghĩa là "chỉ ghi nếu key còn tồn tại": key đã chết thì worker cũ biết mình mất quyền. (Bản chặt hơn còn kiểm tra value = tên mình, xem bài 4.)

</details>

---

## Bài 2: Đếm retry bằng Lua (`run:<id>:attempt`) ✅ lệnh · 🔍 logic

**LangGraph làm gì:** có `IncrRunAttempts` / `DecrRunAttempts`. Mảnh Lua trong binary là `PTTL KEYS[1]` rồi `DECRBY KEYS[1] 1`. Run vượt `BG_JOB_MAX_RETRIES` thì bị đánh fail.

**Lab 1: cái bẫy.**

```
DECR run:r9:attempt     # -1   ← key chưa có, Redis TỰ TẠO với giá trị -1
TTL  run:r9:attempt     # -1   ← và KHÔNG có TTL → key rác sống mãi
DEL  run:r9:attempt
```

**Lab 2: bản Lua mình dựng lại** (logic 🔍, nhưng đúng các lệnh có trong binary):
| 5 | Cùng bài 4, làm bằng cách khác | `migration:{lock}` | `WATCH` / `MULTI` / `EXEC` vs Lua | 4 ← **Next của bạn**

```
EVAL "local ttl = redis.call('PTTL', KEYS[1]) if ttl == -2 then return false end local v = redis.call('DECRBY', KEYS[1], 1) if v <= 0 then redis.call('DEL', KEYS[1]) end return v" 1 run:r9:attempt
# (nil) → key không có thì không tạo

SET run:r1:attempt 2 EX 60
EVAL "...như trên..." 1 run:r1:attempt   # 1
TTL run:r1:attempt                        # 60 → DECRBY không xoá TTL
EVAL "...như trên..." 1 run:r1:attempt   # 0 → tự xoá
```

**Tự làm:** viết bằng ioredis mà không dùng Lua: `if (await redis.exists(k)) await redis.decr(k)`. Tìm race condition.

<details><summary>Đáp án</summary>

Giữa `EXISTS` và `DECR` là một round-trip mạng. Nếu key hết hạn đúng lúc đó thì `DECR` lại tạo key `-1` không có TTL. Lua chạy **nguyên khối** trên server, không lệnh nào khác chen vào được, nên kiểm tra và ghi là một thao tác atomic.

</details>

---

## Bài 3: Hàng đợi run (`run:{queue}` + `run:{queue}:threads`) ✅ lệnh · 🔍 luồng

**LangGraph làm gì:**

- Python `queue.py` gọi `LPUSH run:{queue}`, test của runtime gọi `BLPOP run:{queue}` → LIST dùng để **đánh thức worker** (`redisSignalQueue.Send/Receive`).
- Mảnh Lua `ZRANGEBYSCORE KEYS[1] '-inf' ARGV[1] 'LIMIT' ...` trên ZSET `run:{queue}:threads`, trong hàm `claimNextPendingRunPerThread` → mỗi thread chỉ được chạy **1 run tại một thời điểm**.
- Payload thật của run nằm ở **Postgres**. Redis chỉ báo "có việc".
- Trong `ff`: chat dùng `multitaskStrategy: "enqueue"`, gửi tin mới khi run cũ chưa xong thì run mới được xếp hàng ở đây.

**Lab A: `BLPOP` làm chuông báo (2 terminal):**

```
# Terminal A (worker ngủ, không polling):
BLPOP run:{queue} 0

# Terminal B (API vừa tạo run):
LPUSH run:{queue} wake
# → Terminal A tỉnh ngay: 1) "run:{queue}"  2) "wake"
```

**Lab B: ZSET lên lịch.** Score là thời điểm thread được phép chạy (ms):

```
TIME   # lấy giây hiện tại → nhân 1000 thành NOW
ZADD run:{queue}:threads <NOW-2000> thread-A <NOW-1000> thread-B <NOW+60000> thread-C
ZRANGEBYSCORE run:{queue}:threads -inf <NOW> LIMIT 0 1   # thread-A (sẵn sàng sớm nhất)
```

**Tự làm:** 2 worker cùng chạy `ZRANGEBYSCORE ... LIMIT 0 1` thì cả hai cùng thấy `thread-A`. Viết 1 Lua script "lấy và xoá" atomic. Gọi 3 lần phải ra `thread-A`, `thread-B`, `(nil)`, và `thread-C` còn nằm lại.

<details><summary>Đáp án (đã chạy thử)</summary>

```
EVAL "local m = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 1) if #m == 0 then return false end redis.call('ZREM', KEYS[1], m[1]) return m[1]" 1 run:{queue}:threads <NOW>
```

Redis 5+ có `ZPOPMIN`, nhưng nó lấy **bất kể score**, tức là lấy luôn cả `thread-C` chưa tới giờ. Muốn "chỉ lấy cái đã tới hạn" thì phải dùng Lua.

</details>

**So với BullMQ** (mục còn mở ở Chương 2): BullMQ để **cả job payload** trong Redis (Hash + List + ZSET delayed). LangGraph để payload ở Postgres và chỉ dùng Redis làm tín hiệu. Hãy tự trả lời: mỗi cách được gì, mất gì khi Redis restart?

---

## Bài 4: Distributed lock (`migration:{lock}`, `run:{sweep}`, …) ✅

**LangGraph làm gì:** có `redisLockManager.AcquireMigrationLock / AcquireRunSweepLock / AcquireThreadSweepLock / AcquireStoreSweepLock` + `lockReleaseLua` + marker `last_sweep` (`ThreadSweepRecentlyDone`). Mục đích: 3 replica boot cùng lúc thì chỉ 1 con chạy migration Postgres; sweeper không chạy chồng lên nhau.

**Lab:**

```
SET migration:{lock} tok-A NX PX 30000   # OK    → replica A giữ lock
SET migration:{lock} tok-B NX PX 30000   # (nil) → B phải chờ
```

**Tự làm:** kể ra kịch bản mà `DEL migration:{lock}` đơn thuần xoá nhầm lock của người khác. Sau đó viết Lua release an toàn.

<details><summary>Đáp án (đã chạy thử)</summary>

Kịch bản: A giữ lock, bị GC pause 35 giây → lock hết hạn → B lấy lock → A tỉnh dậy, `DEL` → **xoá lock của B** → C vào được, giờ B và C chạy song song.

```
EVAL "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0" 1 migration:{lock} tok-B   # 0 (không phải của mình)
EVAL "...như trên..." 1 migration:{lock} tok-A                                                                                    # 1
```

Value phải là **token duy nhất** (uuid), không phải `"1"`.

</details>

---

## Bài 5: `WATCH` / `MULTI` / `EXEC` (Next trong progress của bạn)

**Câu hỏi thật:** LangGraph dùng Lua ở **mọi** chỗ cần atomic, không chỗ nào dùng `WATCH`. Làm lại bài 4 bằng `WATCH` để hiểu vì sao.

**Lab (2 terminal):**

```
# chuẩn bị
SET migration:{lock} tok-A PX 60000

# Terminal A:
WATCH migration:{lock}
GET migration:{lock}          # "tok-A" → là của mình
# ... DỪNG Ở ĐÂY, sang Terminal B ...

# Terminal B:
SET migration:{lock} tok-B PX 60000

# Terminal A:
MULTI
DEL migration:{lock}          # QUEUED
EXEC                          # (nil) → key bị đổi sau WATCH, transaction bị huỷ
GET migration:{lock}          # "tok-B" → lock của B được giữ nguyên ✅
```

Chạy lại mà **không** có bước ở Terminal B thì `EXEC` trả `1) (integer) 1`.

**Tự làm:** điền bảng này rồi mới mở đáp án.

|                                          | `WATCH/MULTI/EXEC` | Lua (`EVAL`) |
| ---------------------------------------- | ------------------ | ------------ |
| Số round-trip                            | ?                  | ?            |
| Khi có xung đột                          | ?                  | ?            |
| Đọc giá trị rồi rẽ nhánh `if` giữa chừng | ?                  | ?            |
| Trong Redis Cluster                      | ?                  | ?            |

<details><summary>Đáp án</summary>

|            | `WATCH/MULTI/EXEC`                                | Lua                                               |
| ---------- | ------------------------------------------------- | ------------------------------------------------- |
| Round-trip | ≥ 3 (WATCH, GET, MULTI…EXEC)                      | 1                                                 |
| Xung đột   | `EXEC` trả nil → **client tự retry** (optimistic) | không bao giờ xung đột, script chặn mọi lệnh khác |
| Rẽ nhánh   | phải đọc về client rồi quyết định                 | `if` ngay trên server                             |
| Cluster    | mọi key phải cùng slot                            | mọi key phải cùng slot (bài 10)                   |

Khi nào vẫn chọn `WATCH`: logic cần dữ liệu **ngoài Redis** (gọi DB hay API ở giữa), hoặc môi trường cấm/hạn chế `EVAL`. Lưu ý là Lua chạy lâu sẽ block cả server vì Redis single-thread (câu phỏng vấn "Redis single-threaded sao vẫn nhanh?").

</details>

---

## Bài 6: Pub/Sub cho cancel/interrupt (`thread:<t>:run:<r>:control`) ✅

**LangGraph làm gì:** `SignalCancel` publish lên channel `thread:{thread_id}:run:{run_id}:control`. Worker đang chạy run thì `listenForCancellation` (subscribe channel đó) nhận được và dừng graph. Trong `ff`: nút Stop trong chat, hoặc gọi `runs.cancel`.

**Lab (2 terminal):**

```
# Terminal A (worker):
SUBSCRIBE thread:t1:run:r1:control

# Terminal B (API):
PUBLISH thread:t1:run:r1:control interrupt   # (integer) 1 → 1 người nhận

# Ctrl+C Terminal A, rồi ở B:
PUBLISH thread:t1:run:r1:control interrupt   # (integer) 0 → KHÔNG AI NHẬN, message mất luôn
```

Thử thêm pattern (LangGraph có `PatternRunStreamByThread`):

```
# Terminal A:
PSUBSCRIBE thread:t1:run:*:stream
# Terminal B:
PUBLISH thread:t1:run:r1:stream hello
PUBLISH thread:t1:run:r2:stream hello   # A nhận cả hai
```

**Tự làm:** user bấm Stop đúng lúc worker **chưa kịp subscribe** (run vừa được claim). Pub/Sub trả về 0, tín hiệu mất. Binary có hàm `controlSignalLua`. Đoán xem ngoài `PUBLISH` nó cần làm thêm gì?

<details><summary>Gợi ý (🔍 đoán, chưa xác nhận)</summary>

Ghi thêm 1 key có TTL (kiểu `SET ...:control interrupt PX ...`) rồi mới `PUBLISH`, cả hai trong 1 Lua cho atomic. Worker lúc bắt đầu chạy sẽ `GET` key đó trước, rồi mới `SUBSCRIBE`. Đây là pattern chung: **Pub/Sub để báo nhanh, key để không bỏ sót**.

</details>

---

## Bài 7: Redis Streams cho resumable stream (`thread:<t>:cache`) ✅

> 🔧 Đã đính chính: Stream thật là `thread:<t>:cache`. `thread:<t>:run:<r>:stream` là channel Pub/Sub đi song song. Bài đầy đủ: [langgraph-01-run-stream.md](./langgraph-01-run-stream.md). Lab dưới đây vẫn đúng về lệnh; muốn khớp với runtime thì thay tên key bằng `thread:t1:cache`.

**LangGraph làm gì:** client gửi `streamResumable: true` (web và mobile của `ff` đều bật) thì worker **`XADD`** từng event vào Stream, **đồng thời** vẫn `PUBLISH` lên Pub/Sub. Mảnh Lua lấy nguyên văn từ binary:

```lua
redis.call('XADD', stream_key, '*', 'run_id', run_id, 'event', event, 'message', raw_msg)
```

Client rớt mạng rồi reconnect với header `Last-Event-ID` (proxy mobile của `ff` đã cho header này đi qua) thì server **`XRANGE`** từ ID đó để phát lại phần bị lỡ. Stream có TTL `RESUMABLE_STREAM_TTL_SECONDS`.

**Lab:**

```
XADD thread:t1:run:r1:stream * run_id r1 event metadata message '{"run_id":"r1"}'
# → "1790737728580-0"   ← ID = <ms>-<seq>, chính là Last-Event-ID
XADD thread:t1:run:r1:stream * run_id r1 event values message '{"messages":[]}'
XADD thread:t1:run:r1:stream * run_id r1 event end message '{}'

XLEN   thread:t1:run:r1:stream                   # 3
XRANGE thread:t1:run:r1:stream - +               # toàn bộ
XRANGE thread:t1:run:r1:stream (1790737728580-0 +   # "(" = LOẠI TRỪ ID đó → chỉ values + end
EXPIRE thread:t1:run:r1:stream 120               # dọn sau khi run xong
```

Nghe live (2 terminal):

```
# A:
XREAD BLOCK 0 STREAMS thread:t1:run:r1:stream $
# B:
XADD thread:t1:run:r1:stream * run_id r1 event values message '{}'
```

**Tự làm:**

1. Vì sao LangGraph **không** dùng consumer group (`XREADGROUP`) ở đây?
2. Điền bảng Pub/Sub vs Streams (câu phỏng vấn trong progress).

<details><summary>Đáp án</summary>

1. Consumer group dùng để **chia việc**: mỗi message chỉ giao cho 1 consumer. Ở đây mỗi tab hay thiết bị của user cần **toàn bộ** event, tức là fan-out + replay, nên `XRANGE` / `XREAD` là đủ. Consumer group hợp với chuyện như "gửi push notification, mỗi noti chỉ 1 worker gửi" (ý "Improve noti feature for ff" trong progress của bạn).

2.

|          | Pub/Sub                     | Streams                           |
| -------- | --------------------------- | --------------------------------- |
| Lưu lại? | Không, ai không nghe là mất | Có, tới khi `XTRIM` / TTL         |
| Replay   | Không                       | `XRANGE` từ ID bất kỳ             |
| Tốn RAM  | ~0                          | Tỉ lệ với số event                |
| Dùng khi | tín hiệu tức thời (cancel)  | dữ liệu phải tới nơi (token chat) |

LangGraph dùng **cả hai**, chọn theo cờ `resumable`.

</details>

---

## Bài 8: GCRA rate limit vs sliding window của bạn ✅ lệnh · 🔍 công thức

**LangGraph làm gì:** có `rateLimitStreamPublish`, thư viện `go-redis/redis_rate`. Mảnh Lua trong binary: `local now = redis.call("TIME")` + `local tat = redis.call("GET", rate_limit_key)`. `tat` = _theoretical arrival time_, đây là thuật toán **GCRA**.

Phase 6 của bạn dùng **sliding window ZSET** (mỗi request là 1 member). GCRA chỉ cần **1 String**.

**Lab** (5 request / 10 giây, đã chạy thử):

```
EVAL "local limit, period = tonumber(ARGV[1]), tonumber(ARGV[2]) local interval = period / limit local t = redis.call('TIME') local now = t[1] * 1000 + math.floor(t[2] / 1000) local tat = tonumber(redis.call('GET', KEYS[1])) or now if tat < now then tat = now end local new_tat = tat + interval if new_tat - now > period then return {0, math.ceil(new_tat - now - period)} end redis.call('SET', KEYS[1], new_tat, 'PX', math.ceil(new_tat - now)) return {1, 0}" 1 rl:gcra:u1 5 10000
```

Gọi nhanh 7 lần: 5 lần đầu ra `1 0` (cho qua), lần 6 và 7 ra `0 ~1800` (chặn, retry sau ~1.8 giây).

```
TYPE rl:gcra:u1   # string   ← chỉ 1 số, bất kể limit lớn cỡ nào
```

**Tự làm (mục "Compare: when to choose which > Chat Agent"):**

|                                                      | Sliding window ZSET (phase 6) | GCRA |
| ---------------------------------------------------- | ----------------------------- | ---- |
| RAM mỗi user                                         | ?                             | ?    |
| Trả `Retry-After` chính xác                          | ?                             | ?    |
| Đếm "user đã dùng bao nhiêu trong 1 phút" để hiện UI | ?                             | ?    |
| Chat agent của `ff` nên giữ cái nào?                 | ?                             | ?    |

<details><summary>Đáp án</summary>

|                        | Sliding window ZSET                                                                                  | GCRA                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| RAM                    | O(limit), mỗi request 1 member                                                                       | O(1), 1 số                                                                    |
| `Retry-After`          | tính được (score member cũ nhất + window)                                                            | có sẵn (`new_tat - now - period`)                                             |
| Hiện "đã dùng X/limit" | dễ: `ZCARD`                                                                                          | khó, phải suy ngược từ `tat`                                                  |
| `ff` chat              | **giữ ZSET**: limit nhỏ (vài chục/phút), RAM không đáng kể, lại cần audit từng request và hiện quota | hợp cho limit lớn hoặc tần suất cao, như LangGraph chặn **từng event stream** |

Cả hai đều dùng `TIME` của Redis làm đồng hồ chung, đúng như bạn đã làm ở phase 6.

</details>

---

## Bài 9: Persistence & eviction, vì sao prod tách 2 Redis (Chương 3)

**Thực tế ở `vps-compose`:**

|             | `ff-redis` (LangGraph, `REDIS_URI`) | `ff-redis-cache` (API + agent RL, `REDIS_URL`) |
| ----------- | ----------------------------------- | ---------------------------------------------- |
| Persistence | `--appendonly yes`                  | `--save "" --appendonly no`                    |
| Eviction    | mặc định `noeviction`               | `allkeys-lru`, `maxmemory 256mb`               |
| Vì sao      | key điều phối **không được mất**    | mọi key dựng lại được từ MySQL                 |

**Lab (container tạm, không đụng `redis-learn`):**

```bash
docker run -d --rm --name lab-evict redis:7-alpine redis-server --maxmemory 2mb --maxmemory-policy noeviction
docker exec lab-evict redis-cli SET run:r1:running worker-a
```

Nhồi 300 key × 20KB (≈ 6MB, gấp 3 lần `maxmemory`) rồi đếm kết quả:

```bash
for i in $(seq 1 300); do echo "SET cache:$i $(head -c 20000 /dev/zero | tr '\0' x)"; done | docker exec -i lab-evict redis-cli | sort | uniq -c
```

→ khoảng `51 OK` + `249 OOM command not allowed when used memory > 'maxmemory'.`

```bash
docker exec lab-evict redis-cli EXISTS run:r1:running
```

→ `1`: với noeviction, lệnh **ghi** bị từ chối, còn dữ liệu cũ vẫn an toàn.

Đổi sang LRU rồi nhồi thêm (lần này tên key là `more:*`):

```bash
docker exec lab-evict redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

```bash
for i in $(seq 1 300); do echo "SET more:$i $(head -c 20000 /dev/zero | tr '\0' x)"; done | docker exec -i lab-evict redis-cli | sort | uniq -c
```

→ `300 OK`, ghi được hết.

```bash
docker exec lab-evict redis-cli EXISTS run:r1:running
```

→ `0`: **bị LRU đá ra!** Chạy `docker exec lab-evict redis-cli INFO stats | grep evicted_keys` sẽ thấy khoảng 300.

> Đừng dùng `DEBUG POPULATE` cho lab này: Redis 7 chặn `DEBUG` theo mặc định, và kể cả khi bật lên thì lệnh này **bỏ qua** giới hạn OOM (đã thử: nhồi đủ 300 key dưới `noeviction`), nên cho kết quả sai.

```bash
docker rm -f lab-evict
```

**Tự làm:** nếu gộp LangGraph vào `ff-redis-cache` (LRU) và `run:r1:running` bị đá ra giữa chừng, chuyện gì xảy ra với run đó? Nối lại với bài 1.

<details><summary>Đáp án</summary>

Sweeper thấy heartbeat mất, tưởng worker chết, đưa run vào hàng đợi lại. Kết quả là **1 run chạy 2 lần**: LLM bị gọi 2 lần, statement import có thể tạo trùng transaction. Worker thật thì vẫn đang sống. Ngược lại, nếu đặt cache vào instance `noeviction` thì khi đầy RAM, **mọi lệnh ghi cache đều lỗi**. `maxmemory-policy` là cấu hình cho cả server, nên hai workload có yêu cầu ngược nhau thì phải tách instance.

Thêm cho câu phỏng vấn RDB vs AOF: `appendonly yes` + `appendfsync everysec` (mặc định) thì tối đa mất ~1 giây dữ liệu khi crash.

</details>

---

## Bài 10: Hash tag `{...}` (Chương 5)

**LangGraph làm gì:** nhiều key có ngoặc nhọn: `run:{queue}`, `run:{queue}:threads`, `migration:{lock}`, `thread:{sweep}`, `store:{sweep}`. Runtime hỗ trợ `REDIS_CLUSTER=true`, và test của nó có case "pubsub khác slot thì raise error".

Redis Cluster chia key vào 16384 slot bằng `CRC16(key) mod 16384`. Nếu key có `{...}` thì **chỉ phần trong ngoặc** được đem băm.

**Lab** (`CLUSTER KEYSLOT` chỉ chạy khi bật cluster mode, nên dùng container tạm):

```bash
docker run -d --rm --name lab-cluster redis:7-alpine redis-server --cluster-enabled yes
docker exec -it lab-cluster redis-cli
```

```
CLUSTER KEYSLOT run:{queue}            # 13011
CLUSTER KEYSLOT run:{queue}:threads    # 13011  ← cùng slot
CLUSTER KEYSLOT run:queue              # 4033
CLUSTER KEYSLOT run:queue:threads      # 14568  ← khác slot
```

```bash
docker rm -f lab-cluster
```

**Tự làm:** bài 3 có một Lua script đụng cả LIST `run:{queue}` lẫn ZSET `run:{queue}:threads`. Nếu bỏ ngoặc nhọn thì chạy trên Cluster sẽ bị gì?

<details><summary>Đáp án</summary>

`CROSSSLOT Keys in request don't hash to the same slot`. Lua, `MULTI` và lệnh multi-key đều chỉ chạy được khi mọi key nằm cùng 1 node. Hash tag ép chúng về cùng slot. Cái giá phải trả: mọi key `{queue}` dồn vào **1 node** (hot spot). LangGraph chấp nhận vì hàng đợi nhỏ; còn key theo từng thread (`thread:<t>:run:<r>:stream`) thì **không** gắn tag, để trải đều ra các node.

</details>

---

## ★ Capstone: xem LangGraph thật trên prod (chỉ đọc)

Local `pnpm dev:agent` chạy in-memory, **không** dùng Redis. Muốn thấy các key trên thì phải xem `ff-redis` trên VPS:

```bash
docker exec ff-redis redis-cli --scan --count 100 | head -50
```

```bash
docker exec ff-redis redis-cli MONITOR
```

`MONITOR` chỉ bật **vài giây** trong lúc bạn gửi 1 tin chat trên app, rồi Ctrl+C (nó rất nặng). Với mỗi key thấy được, gõ `TYPE`, `TTL`, và `XLEN` nếu là stream.

**Checklist tự kiểm:**

- [ ] Thấy `LPUSH run:queue` ngay sau khi gửi tin (bài 3; ở standalone không có ngoặc)
- [ ] Thấy `XADD thread:...:cache` + `PUBLISH thread:...:run:...:stream` liên tục khi token chạy (bài 7)
- [ ] Thấy key `run:<id>:running` được gia hạn định kỳ (bài 1)
- [ ] Bấm Stop → thấy `PUBLISH ...:control` (bài 6)
- [ ] Sau khi run xong vài phút, stream key có TTL rồi biến mất (bài 7)
- [ ] Ghi vào `progress.md` những gì **khác** với dự đoán trong bài (phần 🔍)

---

## Câu phỏng vấn trong `progress.md` mà file này trả lời

| Câu hỏi                                                               | Bài  |
| --------------------------------------------------------------------- | ---- |
| `WATCH`/`MULTI` khác lock phân tán ra sao?                            | 4, 5 |
| Pub/Sub vs Streams: khi nào chọn cái nào?                             | 6, 7 |
| Eviction policy nào cho cache, nào cho data store?                    | 9    |
| RDB vs AOF mất tối đa bao nhiêu?                                      | 9    |
| Vì sao multi-key bị hạn chế trong Cluster? Hash tag giải quyết gì?    | 10   |
| Rate limiter: fixed vs sliding, và thuật toán khác?                   | 8    |
| Redis single-threaded sao vẫn nhanh? (và vì sao Lua dài là nguy hiểm) | 5    |

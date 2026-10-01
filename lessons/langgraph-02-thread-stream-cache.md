# LangGraph #2: Stream theo thread & cache replay (`thread:<t>:cache`, `thread:<t>:run_offsets`)

> **Nguồn:** chạy thật `langchain/langgraphjs-api:24` với Redis và Postgres tạm, cùng graph demo như [file #1](./langgraph-01-run-stream.md). Có thêm một lượt khởi động lại với `FF_OPTIMIZED_STREAMING=true` để so sánh. Ngày 2026-10-01.
> ✅ = thấy tận mắt trong `MONITOR` / SSE · 🔍 = suy luận
> **Đọc file #1 trước.** File này nối tiếp ở chỗ file #1 dừng: Stream `thread:<t>:cache`.

## TL;DR

1. **Mỗi thread có đúng 1 Redis Stream** `thread:<t>:cache`, chứa event của **mọi run resumable** trên thread đó, theo đúng thứ tự xảy ra. ✅ (Lab: 2 run nối tiếp nhau cho ra 11 entry trong cùng một key.)
2. Có 3 cách đọc Stream này:
   - **Join 1 run:** Lua quét cả Stream rồi lọc theo `run_id`.
   - **Join cả thread** (`GET /threads/<T>/stream`): `PSUBSCRIBE thread:<T>:run:*:stream` cộng `XRANGE` thẳng, không lọc.
   - **Chế độ optimized** (`FF_OPTIMIZED_STREAMING`): bỏ Pub/Sub, dùng `XREAD BLOCK`, và thêm Hash `run_offsets` để nhảy thẳng tới đầu run.
3. Cache chỉ là **cửa sổ 120 giây**. Reload trang sau khi run xong quá 2 phút thì không còn gì để replay. Nguồn sự thật là checkpoint Postgres.

---

## 1. Vì sao 1 Stream cho mỗi thread, mà không phải 1 Stream cho mỗi run?

| | 1 Stream / thread (LangGraph chọn) | 1 Stream / run |
|---|---|---|
| Join cả thread qua nhiều run (chat `multitaskStrategy: "enqueue"`) | 1 lệnh `XRANGE`, thứ tự toàn cục có sẵn nhờ ID | phải merge N Stream theo ID |
| Join 1 run | phải lọc → **O(số event của cả thread)** | `XRANGE` thẳng |
| Số key | 1 key / thread | 1 key / run |
| Cluster | mọi thứ của 1 thread nằm trên 1 slot (`thread:<t>:…`) | rải ra nhiều slot |

Cái giá phải trả là cột "join 1 run". Chế độ optimized (mục 4) sinh ra là để vá đúng chỗ này.

---

## 2. Join Thread Stream: `GET /threads/<T>/stream`

Đọc từ `openapi.json` của runtime ✅:

- Header `Last-Event-ID`: `-` nghĩa là replay từ đầu cache.
- Query `stream_modes`: `lifecycle` | `run_modes` (mặc định) | `state_update`.
- Stream "mở mãi mãi". Client tự đóng khi không cần nữa.

**Trace live** (2 run nối tiếp nhau, mở thread stream *trước* khi tạo run):

```text
psubscribe  thread:<T>:run:*:stream            ← nghe theo PATTERN: chưa biết run_id của các run tương lai
evalsha …   run:queue:threads run:queue …       ← run R1 vào hàng đợi
publish     thread:<T>:run:<R1>:stream "…metadata…"
publish     thread:<T>:run:<R1>:stream "…values…"  (×4)
evalsha …   run:queue:threads … <T>              ← R1 xong → đánh thức worker cho R2 cùng thread (Bài 3)
PUBLISH     thread:<T>:run:<R1>:control done
publish     thread:<T>:run:<R2>:stream "…metadata…"
publish     thread:<T>:run:<R2>:stream "…updates…" (×3)
```

SSE client nhận được: event của R1, rồi `metadata {"run_id":"<R1>","status":"run_done"}`, rồi event của R2, rồi `run_done` của R2. Event `run_done` **không được worker publish**. Server tự **tổng hợp** nó từ frame `control/done` (cùng ID trong cache) ✅.

**Trace replay** (cùng 2 run, nhưng lần này đều `stream_resumable: true`):

```text
psubscribe  thread:<T>:run:*:stream
xrange      thread:<T>:cache - +                       ← Last-Event-ID: -   → 11 event
psubscribe  thread:<T>:run:*:stream
xrange      thread:<T>:cache 1790826903037-0 +         ← Last-Event-ID: <control/done của R1>
                                                         → SSE bắt đầu từ metadata của R2 (đã bỏ entry trùng ID)
```

Thứ tự **subscribe trước, replay sau** giống hệt file #1, chỉ là đổi sang `PSUBSCRIBE`.

**Bẫy:** nếu các run **không** resumable thì thread stream live vẫn chạy (vì đi qua Pub/Sub), nhưng `Last-Event-ID: -` trả về **0 event**. Lý do là chẳng có gì được `XADD` vào cache ✅.

---

## 3. Join 1 run bên trong Stream của thread

`GET /threads/<T>/runs/<R2>/stream` với `Last-Event-ID: -`:

```text
subscribe  thread:<T>:run:<R2>:stream
evalsha    <filter> 1 thread:<T>:cache <R2> -
XRANGE     thread:<T>:cache - +          ← đọc CẢ 11 entry của R1 + R2, rồi Lua chỉ giữ lại 5 entry của R2
```

Logic của script lọc nằm ở [langgraph-lab/filter-by-run.lua](./langgraph-lab/filter-by-run.lua) (mình viết lại). Nó dựa vào một quy ước: **field đầu tiên của mọi entry luôn là `run_id`**, nên chỉ cần so `fields[2]` mà không phải duyệt cả bảng.

---

## 4. Chế độ optimized: `FF_OPTIMIZED_STREAMING=true`

Cờ này là env của binary Go (`yaml:"optimizedStreaming" env:"FF_OPTIMIZED_STREAMING"`) ✅. Prod `ff` **không bật** nó. Mình bật thử trong lab để so sánh.

**Bên ghi** (mỗi event):

```text
EVALSHA <optimized> 2 thread:<T>:cache thread:<T>:run_offsets <msg> values 120 <R>
  XADD   thread:<T>:cache * run_id <R> event values message …
  HSETNX thread:<T>:run_offsets <R> <id>         ← chỉ ghi lần ĐẦU: id của entry đầu tiên của run
  TIME / XTRIM … MINID / EXPIRE cache 120 / EXPIRE run_offsets 120
                                                  ← KHÔNG có PUBLISH
```

**Bên đọc:**

```text
xrevrange thread:<T>:cache + - count 1           ← lấy ID cuối ("tail") để bắt đầu từ "bây giờ"
xread count 100 block 1000 streams thread:<T>:cache <tail>
xread count 100 block 1000 streams thread:<T>:cache <id mới nhất>   ← lặp, mỗi lần chờ tối đa 1 giây
```

Join run từ đầu (`Last-Event-ID: -`):

```text
hget   thread:<T>:run_offsets <R2>               ← "1790826973374-0"
XRANGE thread:<T>:cache 1790826973374-0 +        ← nhảy thẳng tới đầu R2, không quét phần của R1
```

**Một khác biệt thấy được trong SSE:** ở chế độ này **mọi run đều được `XADD`**, kể cả run không resumable. Vì vậy SSE luôn có `id:` ✅.

### So sánh hai chế độ

| | Mặc định (Pub/Sub + Stream) | Optimized (chỉ Stream) |
|---|---|---|
| Đường đi của event live | `PUBLISH`, đẩy tới ngay | `XREAD BLOCK`, client tự kéo |
| Kết nối Redis | mỗi subscription chiếm 1 connection riêng (thấy `hello 3` mới mỗi lần subscribe) | dùng connection thường, lấy từ pool |
| Lúc không có event | im lặng | cứ ~1 giây lại gửi một `XREAD` mới (thấy trong `MONITOR`) |
| Có ghi Stream cho run non-resumable? | không | có |
| Join 1 run từ đầu | lọc cả thread, O(N) | `HGET run_offsets` rồi `XRANGE` từ đúng chỗ |
| Số key / thread | 1 Stream | 1 Stream + 1 Hash |
| Cửa sổ hở khi reconnect | cần thứ tự subscribe → replay | không có: đọc tiếp từ ID là liền mạch |

Điểm cuối cùng là lý do lớn nhất khiến người ta thích `XREAD` hơn Pub/Sub. Khi có một ID để đọc tiếp, cả loại bug "hở giữa replay và live" **biến mất**. Bù lại thì tốn polling và tốn RAM cho cả những run không cần resume.

---

## 5. `reconnectOnMount`: client nhớ run qua lần reload

SDK 1.10.0 (`dist/react/stream.lgp.js`, `dist/ui/orchestrator.js`) ✅:

1. Khi tạo run, SDK ghi `sessionStorage["lg:stream:<threadId>"] = runId`.
2. Lúc mount, nếu key đó còn thì gọi `joinStream(runId, lastEventId ?? "-1")`.
3. Server hiểu `Last-Event-ID: -1` giống `-` → `XRANGE thread:<T>:cache - +` rồi lọc theo run → **phát lại toàn bộ run** ✅ (đã thử: nhận đủ `metadata` + 4 `values`).
4. Khi bấm Stop, SDK gọi `runs.cancel(threadId, runId)` rồi xoá key. Khi run xong thì cũng xoá key.

**Trong `ff`:**

- **PDF import** (`usePdfImportStream.ts`) bật `reconnectOnMount: true`, `streamSubgraphs: true`, `streamResumable: true`. User F5 giữa chừng thì UI tự nối lại và phát lại tiến trình.
- **Chat** (`useChatStream.ts`) để `reconnectOnMount: false`. Comment trong code giải thích: React Native không có `Storage` đồng bộ. Vậy nên reload hoặc kill app giữa lúc đang chat thì không tự join lại, chỉ thấy kết quả khi load lại thread state.
- **F5 sau hơn 120 giây, hoặc sau khi run đã xong lâu:** cache đã `EXPIRE`, replay rỗng. Đó là lúc `onFinish` hydrate từ `ThreadState.values` (Postgres) để màn hình vẫn đủ dữ liệu.

---

## 6. Lab: thread cache, `run_offsets`, `XREAD BLOCK` (`redis-learn`, DB 15)

Chạy từ thư mục `lessons/`:

```bash
cat langgraph-lab/resumable-publish.lua | docker exec -i redis-learn redis-cli -n 15 -x SCRIPT LOAD
```

```bash
cat langgraph-lab/optimized-publish.lua | docker exec -i redis-learn redis-cli -n 15 -x SCRIPT LOAD
```

Gọi 2 SHA này là `<PUB>` và `<OPT>`.

### 6a. Một Stream, hai run, nghe theo pattern

**Terminal A** (đóng vai "join thread"):

```bash
docker exec -it redis-learn redis-cli -n 15 PSUBSCRIBE 'thread:t1:run:*:stream'
```

**Terminal B**, mở `redis-cli -n 15`:

```
EVALSHA <PUB> 2 thread:t1:cache thread:t1:run:r1:stream '{"n":1}' values 120 r1
EVALSHA <PUB> 2 thread:t1:cache thread:t1:run:r1:stream 'done' control 120 r1
EVALSHA <PUB> 2 thread:t1:cache thread:t1:run:r2:stream '{"n":100}' updates 120 r2
XLEN thread:t1:cache                                   # 3 → cả hai run chung 1 key
XRANGE thread:t1:cache - +
PUBSUB NUMPAT                                          # 1 → A đang nghe theo pattern
```

### 6b. Chế độ optimized: offsets + tail + `XREAD BLOCK`

Ở B:

```
EVALSHA <OPT> 2 thread:t2:cache thread:t2:run_offsets '{"a":1}' metadata 120 r9
EVALSHA <OPT> 2 thread:t2:cache thread:t2:run_offsets '{"a":2}' values 120 r9
HGETALL thread:t2:run_offsets                          # r9 → ID của entry ĐẦU TIÊN, không đổi
XREVRANGE thread:t2:cache + - COUNT 1                  # "tail"
```

**Terminal A** (Ctrl+C cái cũ), đóng vai subscriber kiểu optimized:

```bash
docker exec -it redis-learn redis-cli -n 15 XREAD COUNT 100 BLOCK 0 STREAMS thread:t2:cache '$'
```

Ở B:

```
EVALSHA <OPT> 2 thread:t2:cache thread:t2:run_offsets '{"a":3}' values 120 r9
```

A tỉnh dậy và nhận được `{"a":3}`.

**Tự làm:**

1. Ở 6b, vì sao subscriber phải `XREVRANGE … COUNT 1` trước, mà không `XREAD … STREAMS key 0`?
2. LangGraph dùng `BLOCK 1000` (1 giây) chứ không `BLOCK 0`. Đoán xem tại sao.
3. `HSETNX` thay bằng `HSET` thì `run_offsets` hỏng thế nào?
4. Viết một Lua "join run từ đầu" cho chế độ optimized: `HGET` offsets rồi `XRANGE` từ đó và lọc theo `run_id`. So số entry bị quét với `filter-by-run.lua`.

<details><summary>Đáp án</summary>

1. `0` nghĩa là đọc từ đầu Stream, tức là kéo về cả event của các run cũ trên thread. `XREVRANGE + - COUNT 1` lấy ID mới nhất, rồi `XREAD` từ ID đó nghĩa là "chỉ lấy cái mới". Ở lần đầu, khi Stream còn rỗng, lab thấy runtime dùng `0-0` ✅. Còn `$` dùng được trong redis-cli, nhưng ở vòng lặp thứ 2 trở đi bạn phải truyền ID cụ thể, nếu không sẽ lỡ mất event tới giữa 2 lần `XREAD`.
2. 🔍 Để vòng lặp Go định kỳ được "thả ra": kiểm tra client đã ngắt SSE chưa, context bị huỷ chưa, run đã `done` chưa. `BLOCK 0` sẽ giữ connection vô hạn. Cái giá là mỗi giây có thêm một lệnh khi rảnh (thấy rõ trong `MONITOR`).
3. Field bị ghi đè bằng ID của entry **mới nhất**. Join "từ đầu run" khi đó lại bắt đầu từ cuối, mất hết phần đầu của run.
4. Gợi ý: `local start = redis.call('HGET', KEYS[2], ARGV[1]) or '-'`, rồi tái dùng vòng lặp lọc của `filter-by-run.lua`. Với 2 run như lab mục 3: bản cũ quét 11 entry, bản offsets quét 5.

</details>

Dọn dẹp:

```bash
docker exec redis-learn redis-cli -n 15 FLUSHDB
```

---

## 7. Câu hỏi tự kiểm (kiểu phỏng vấn)

1. Thiết kế "1 Stream / thread" có vấn đề gì khi 1 thread chat có 500 run trong 2 phút? `XTRIM MINID` giúp tới đâu?
2. Vì sao thread stream dùng `PSUBSCRIBE` mà join run thì dùng `SUBSCRIBE`? `PSUBSCRIBE` tốn hơn ở chỗ nào?
3. Bạn xây tính năng "Improve noti" cho `ff`. Event noti nên đi theo mô hình nào: Pub/Sub + Stream, Stream + `XREAD`, hay Stream + consumer group?
4. Muốn hiện "đang xử lý trang 3/10" cho PDF import qua cả lần F5 sau 5 phút. Dựa vào `thread:<t>:cache` có đủ không?

<details><summary>Đáp án</summary>

1. Cửa sổ 120 giây nghĩa là Stream giữ tối đa 2 phút event của **cả thread**, nên 500 run thì key phình theo. `XTRIM MINID` giới hạn theo *thời gian*, không giới hạn theo *số lượng*. Thêm `MAXLEN ~ N` sẽ chặn được cả số lượng, đổi lại có thể cắt mất event còn trong 2 phút. Ngoài ra lọc theo run sẽ O(N) trên đúng cái Stream to đó, nên chế độ optimized có `run_offsets`.
2. Join run biết trước tên channel cụ thể. Join thread phải nhận cả các run **chưa tồn tại**, nên buộc dùng pattern. Với `PSUBSCRIBE`, mỗi lệnh `PUBLISH` đều phải đem channel ra so với **mọi pattern** đang được đăng ký, nên chi phí tăng theo số pattern.
3. Noti cần "mỗi noti gửi push đúng 1 lần, worker chết thì có worker khác nhận lại" → **Stream + consumer group** (`XREADGROUP`/`XACK`/`XAUTOCLAIM`), đúng bài `redis-stream.md` của bạn. Còn "mọi tab đang mở thấy noti realtime" là fan-out → Pub/Sub hoặc `XREAD`. Thực tế thường dùng cả hai.
4. Không đủ: cache hết hạn sau 120 giây. Phải ghi tiến độ vào state của graph (checkpoint Postgres) rồi đọc lại bằng `threads.getState()`. Đúng như `usePdfImportStream` đang làm trong `onFinish`.

</details>

---

## Nguồn & độ tin cậy

- Trace: tự chạy image `:24`, cả ở chế độ mặc định lẫn `FF_OPTIMIZED_STREAMING=true`, với các endpoint `GET /threads/{id}/stream`, `GET /threads/{id}/runs/{id}/stream`, và header `Last-Event-ID` (`-`, `-1`, ID cụ thể). ✅
- Tên key `thread:%s:cache`, `thread:%s:run_offsets`, tên cờ, tên hàm (`SubscribeThread`, `replayThreadCachedEvents`, `captureTailID`, `CompareStreamIDs`): đọc trong binary `core-api-grpc`. ✅
- Script Lua: **viết lại** theo logic quan sát được (bản gốc độc quyền), nằm trong [langgraph-lab/](./langgraph-lab/), đã chạy thử trên Redis 7.4.
- SDK `@langchain/langgraph-sdk` 1.10.0: `reconnectOnMount` dùng `sessionStorage` key `lg:stream:<threadId>`, và rejoin mặc định với `Last-Event-ID: -1`. ✅

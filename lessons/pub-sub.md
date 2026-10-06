Chuyển sang **Pub/Sub** (Publish/Subscribe): cơ chế **phát tin nhắn theo kênh (channel)** trong Redis. Bên publish gửi tin vào 1 channel, mọi bên đang subscribe channel đó nhận được tin ngay lập tức.

## Khác Stream/List ở điểm cốt lõi: không lưu gì cả

Pub/Sub là **fire-and-forget**. Redis không lưu message ở đâu hết, chỉ chuyển tiếp tới các subscriber **đang online ở đúng thời điểm publish**.

|                                | Pub/Sub        | List (`BRPOP`)                 | Stream                      |
| ------------------------------ | -------------- | ------------------------------ | --------------------------- |
| Lưu message                    | Không          | Có, tới khi bị POP             | Có, tới khi bị xóa/trim     |
| Subscriber offline lúc publish | **Mất tin**    | Không mất (tin nằm trong list) | Không mất (đọc lại bằng ID) |
| Nhiều bên cùng nhận 1 tin      | Có (broadcast) | Không (1 người lấy)            | Có (nhiều group)            |
| ACK / retry                    | Không          | Không                          | Có                          |

Ẩn dụ: Stream là bảng thông báo dán trên tường (đến sau vẫn đọc được). Pub/Sub là **loa phát thanh**: ai đang đứng nghe thì nghe được, đến trễ là lỡ luôn.

## Các lệnh cơ bản

```
SUBSCRIBE news                 # đăng ký nhận tin từ channel "news"
PUBLISH news "hello"           # gửi tin -> trả về số subscriber đã nhận (vd: 1)
UNSUBSCRIBE news

PSUBSCRIBE user:*:notify       # đăng ký theo pattern, khớp user:1:notify, user:2:notify...
```

`PUBLISH` trả về **số subscriber nhận được tin**. Nếu trả về `0` nghĩa là không ai đang nghe và tin đã biến mất.

## Thử trên `redis-cli` (cần 2 terminal)

**Terminal 1** (subscriber):

```
redis-cli
SUBSCRIBE news
# 1) "subscribe"
# 2) "news"
# 3) (integer) 1       <- đang subscribe 1 channel, terminal này giờ "treo" chờ tin
```

**Terminal 2** (publisher):

```
redis-cli
PUBLISH news "hello"
# (integer) 1          <- 1 subscriber nhận được
```

Terminal 1 sẽ hiện:

```
1) "message"
2) "news"
3) "hello"
```

Thử thêm: tắt Terminal 1 rồi `PUBLISH news "hello again"` ở Terminal 2 → trả về `(integer) 0`, tin mất vĩnh viễn. Bật lại Terminal 1 subscribe cũng không nhận lại được.

Với pattern, ở Terminal 1 thử:

```
PSUBSCRIBE user:*:notify
```

rồi ở Terminal 2: `PUBLISH user:42:notify "bạn có tin nhắn mới"`.

## Ví dụ thực tế: thông báo real-time khi chạy nhiều API server

Bài toán: hệ thống chạy 3 instance API phía sau load balancer. User A kết nối SSE/WebSocket vào instance 1, nhưng sự kiện "có tin nhắn mới cho A" lại phát sinh ở instance 3. Làm sao instance 3 báo được cho instance 1? Pub/Sub giải quyết đúng chỗ này: instance nào cũng subscribe, ai publish thì tất cả đều nhận, instance nào đang giữ kết nối của user đó sẽ đẩy xuống client.## Điểm cần nhớ trong code

- **Tách 2 client**: connection đã `SUBSCRIBE` bị "khóa" ở chế độ nhận tin, không gửi được lệnh thường (`GET`, `SET`...). Vì vậy `subscriber = publisher.duplicate()`.
- **`PSUBSCRIBE` theo pattern** `user:*:notify`: mỗi instance chỉ subscribe 1 lần cho mọi user, thay vì subscribe/unsubscribe từng channel mỗi khi có user kết nối hay ngắt.
- **Broadcast tới mọi instance**: `PUBLISH` trả về số instance nhận được, instance nào không giữ kết nối của user thì bỏ qua (`if (!connections) return`).

## Giới hạn cần biết (quan trọng hơn cả cú pháp)

1. **At-most-once, không có ACK/retry**: subscriber chậm, mất kết nối hoặc đang restart đều **mất tin**. Redis không lưu lại gì để gửi bù.
2. **Subscriber chậm có thể bị Redis ngắt**: Redis giữ message chờ gửi trong output buffer của mỗi subscriber, vượt ngưỡng `client-output-buffer-limit pubsub` thì Redis đóng connection đó.
3. **Không có consumer group**: nếu bạn muốn "chia việc" (mỗi tin chỉ 1 worker xử lý) thì Pub/Sub không làm được, vì mọi subscriber đều nhận **bản sao** của tin. Chia việc là việc của List/Stream.
4. **Dùng đúng chỗ**: thông báo real-time, invalidate cache giữa các instance, chat/presence, tín hiệu "có cập nhật, hãy tải lại". Đây là các trường hợp mất 1 tin không gây hậu quả lớn (hoặc client tự đồng bộ lại khi kết nối lại).

Với dữ liệu quan trọng (đơn hàng, thanh toán), dùng Stream như bài trước. Một pattern phổ biến là kết hợp: **lưu thông báo vào DB/Stream (bền)** + **Pub/Sub chỉ để đẩy real-time** cho ai đang online.

## Thử ngay

Chạy 2 instance (`PORT=3000` và `PORT=3001`), mở SSE ở instance 3000 rồi publish từ instance 3001 để thấy tin vẫn tới nơi. Sau đó tắt kết nối SSE và publish lại, bạn sẽ thấy `delivered` vẫn là `true` (vì các instance vẫn subscribe) nhưng không ai nhận được tin trên màn hình, đúng bản chất fire-and-forget.

Có thắc mắc gì không, hay mình viết blog cho bài Pub/Sub luôn?

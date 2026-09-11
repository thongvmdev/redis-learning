# Học Redis ngày hôm nay: Strings, INCR, TTL và Key Design

Hôm nay mình dành thời gian học phần **Strings** trong series Redis curriculum của mình — cụ thể là `SET`, `GET`, `INCR`, và cơ chế Expiration/TTL. Đây là bài viết tổng hợp lại những gì mình đã học, kèm theo phần best practice về thiết kế key mà mình tìm hiểu thêm.

## 1. SET / GET — nền tảng của Redis String

Redis String là kiểu dữ liệu đơn giản nhất: một key ứng với một value.

```
SET user:1:name "James"
GET user:1:name          # -> "James"
```

Một điều thú vị mình học được là quy ước đặt tên key dùng dấu `:` để phân cấp, kiểu như namespace: `user:1:name` nghĩa là field `name` của user có id = 1.

Vài biến thể hữu ích của `SET`:

```
SET key value NX     # chỉ set nếu key CHƯA tồn tại — dùng cho lock, tránh ghi đè
SET key value XX     # chỉ set nếu key ĐÃ tồn tại
SET key value GET    # set giá trị mới, đồng thời trả về giá trị cũ
```

## 2. INCR — tăng giá trị nguyên tử

Nếu value là số, Redis cho phép tăng/giảm một cách **atomic** — cực kỳ quan trọng khi nhiều client cùng ghi vào một key.

```
SET user:1:login_count 0
INCR user:1:login_count      # -> 1
INCR user:1:login_count      # -> 2
```

Các lệnh anh em:

```
DECR key            # giảm 1
INCRBY key 5         # tăng thêm 5
DECRBY key 3         # giảm đi 3
INCRBYFLOAT key 2.5  # tăng số thập phân
```

Điểm hay: nếu key chưa tồn tại, `INCR` sẽ tự tạo key với giá trị 0 rồi tăng lên 1. Ứng dụng thực tế mình nghĩ ngay tới: đếm view bài viết, rate-limiting, đếm like.

## 3. Expiration / TTL — key tự hết hạn

Đây là tính năng mình thấy "đúng chất Redis" nhất — rất hợp cho cache, session, OTP.

```
SET session:abc123 "user_data" EX 3600   # tự xóa sau 1 giờ
EXPIRE session:abc123 3600                # đặt TTL cho key đã có sẵn
TTL session:abc123                        # xem còn bao nhiêu giây
PERSIST session:abc123                    # hủy TTL, key trở thành vĩnh viễn
```

Key hết hạn thì `GET` sẽ trả về `nil`, coi như không tồn tại.

## 4. Best Practice thiết kế Key

Sau phần Strings, mình tìm hiểu thêm cách thiết kế key sao cho hợp lý ở quy mô lớn:

- **Namespace phân cấp** bằng dấu `:` — `object-type:id:field`
- **Ngắn gọn nhưng rõ nghĩa** — key dài tốn RAM khi nhân với hàng triệu bản ghi
- **Nhất quán convention** trong toàn bộ dự án (case, số ít/nhiều...)
- **Tránh ký tự đặc biệt** (`*`, `?`, `[`, `]`, khoảng trắng) vì chúng có ý nghĩa riêng với pattern matching
- **Dùng Hash thay vì nhiều String key** khi entity có nhiều field — tiết kiệm bộ nhớ hơn hẳn
- **Thêm prefix version/environment** khi cần: `prod:v2:user:1000:profile`
- **Luôn đặt TTL** cho key có tính chất tạm thời như cache, session
- **Document lại key schema** vì Redis không có schema như SQL

Một vài ví dụ áp dụng thực tế:

```
session:{sessionId}                    # Hash, TTL theo phiên đăng nhập
ratelimit:{ip}:{endpoint}              # String + INCR, TTL 60s
cache:api:{endpoint}:{paramsHash}      # String (JSON), TTL vài phút
lock:order:{orderId}                   # String + NX, TTL ngắn (distributed lock)
```

## Tổng kết

Buổi học hôm nay giúp mình nắm được nhóm lệnh cơ bản nhất của Redis String, cách tận dụng tính atomic của `INCR` cho các bài toán đếm, và cách dùng TTL để quản lý vòng đời của cache/session. Phần key design cũng mở ra cho mình cách tư duy đặt tên có tổ chức ngay từ đầu, tránh việc convention bị "loạn" khi dự án lớn dần.

Bước tiếp theo trong curriculum: các cấu trúc dữ liệu khác của Redis (Hash, List, Set, Sorted Set) — sẽ viết tiếp khi học xong.

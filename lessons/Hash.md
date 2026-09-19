Chuyển sang phần **Hashes** — cấu trúc hợp lý hơn nhiều so với việc tách String key như hôm trước, đặc biệt khi lưu object/user profile.

## Vì sao dùng Hash thay vì nhiều String key?

Nhớ lại ví dụ hôm qua:

```
SET user:1000:name "James"
SET user:1000:email "james@x.com"
SET user:1000:age 28
```

→ 3 key riêng biệt, tốn overhead bộ nhớ cho mỗi key.

Với Hash, cả object nằm gọn trong **1 key**, các field bên trong giống như 1 dict/map:

```
user:1000 -> { name: "James", email: "james@x.com", age: "28" }
```

## HSET — ghi field vào Hash

```
HSET user:1000 name "James" email "james@x.com" age 28
```

Có thể set nhiều field cùng lúc trong 1 lệnh (atomic). Nếu key `user:1000` chưa tồn tại, Redis tự tạo Hash mới.

Set từng field riêng lẻ:

```
HSET user:1000 name "James"
HSET user:1000 email "james@x.com"
```

## HGETALL — lấy toàn bộ Hash

```
HGETALL user:1000
# -> name "James"
#    email "james@x.com"
#    age "28"
```

Trả về tất cả field-value dưới dạng danh sách xen kẽ (flat array trong RESP, nhưng client thường parse thành object/dict).

## Các lệnh Hash quan trọng khác

```
HGET user:1000 name          # lấy 1 field cụ thể -> "James"
HMGET user:1000 name email   # lấy nhiều field cùng lúc
HDEL user:1000 age           # xóa 1 field khỏi hash
HEXISTS user:1000 email      # kiểm tra field có tồn tại -> 1 hoặc 0
HKEYS user:1000              # lấy tất cả tên field -> name, email
HVALS user:1000              # lấy tất cả value -> James, james@x.com
HLEN user:1000               # đếm số field trong hash
HINCRBY user:1000 age 1      # tăng giá trị field số nguyên (giống INCR nhưng cho field trong hash)
```

## So sánh nhanh: String vs Hash cho User Profile

| Tiêu chí           | Nhiều String key                       | 1 Hash key                                                      |
| ------------------ | -------------------------------------- | --------------------------------------------------------------- |
| Số lượng key       | Nhiều (1 field = 1 key)                | Ít (1 object = 1 key)                                           |
| Bộ nhớ             | Tốn hơn (overhead mỗi key)             | Tiết kiệm hơn (đặc biệt hash nhỏ dùng `listpack` encoding)      |
| Lấy toàn bộ object | Phải gọi nhiều `GET`, hoặc dùng `MGET` | 1 lệnh `HGETALL`                                                |
| Cập nhật 1 field   | `SET` riêng lẻ, dễ                     | `HSET` field riêng, cũng dễ                                     |
| TTL                | Set TTL riêng từng key                 | TTL áp dụng cho cả object (không set được TTL riêng từng field) |

**Lưu ý quan trọng:** TTL trong Redis chỉ set được ở cấp key, không set được cho từng field bên trong Hash. Nếu bạn cần field nào đó tự hết hạn riêng, Hash không phải lựa chọn phù hợp.

---

**Thử ngay:**

```
HSET user:2000 name "Linh" email "linh@x.com" role "admin"
HGETALL user:2000
HGET user:2000 role
HINCRBY user:2000 login_count 1
HGETALL user:2000
```

Bạn thử chạy xem `login_count` xuất hiện thế nào nhé — vì field đó chưa từng được `HSET` trước đó. Xong phần này rồi thì mình học tiếp Lists hay Sets?

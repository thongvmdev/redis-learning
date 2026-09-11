# Redis CLI — Cheatsheet

> Bộ lệnh Redis CLI thường dùng, tổng hợp theo nhóm chức năng.

---

## Server / Connection

```
PING                        # test kết nối
ECHO "message"               # test, trả lại chuỗi
SELECT n                     # chuyển DB (0-15)
DBSIZE                       # số lượng key trong DB hiện tại
FLUSHDB                      # xóa hết key DB hiện tại
FLUSHALL                     # xóa hết key TẤT CẢ DB
INFO                         # thông tin server (memory, clients, replication...)
INFO memory                  # chỉ phần memory
CONFIG GET maxmemory          # xem 1 config
CONFIG SET maxmemory 100mb    # set config runtime (không lưu vĩnh viễn)
MONITOR                      # xem real-time mọi lệnh server nhận (debug only, đừng chạy production)
CLIENT LIST                   # danh sách connection đang mở
```

## Key management (áp dụng mọi loại dữ liệu)

```
KEYS pattern*                # liệt kê key khớp pattern — CHỈ DÙNG DEV, block server ở production
SCAN cursor [MATCH pattern] [COUNT n]   # duyệt key an toàn, không block — dùng thay KEYS ở production
EXISTS key                    # có tồn tại không → 1/0
DEL key [key2 ...]            # xóa 1 hoặc nhiều key
TYPE key                      # xem kiểu (string/list/hash/set/zset/stream)
EXPIRE key seconds             # đặt TTL
PEXPIRE key ms                 # TTL theo mili-giây
TTL key                        # xem TTL còn lại (giây), -1 = không hết hạn, -2 = không tồn tại
PERSIST key                    # bỏ TTL
RENAME key newkey               # đổi tên
RANDOMKEY                       # lấy ngẫu nhiên 1 key
```

## String

```
SET key value                  # gán giá trị
SET key value EX 60             # gán kèm TTL 60s
SET key value NX                 # chỉ set nếu key CHƯA tồn tại (dùng cho lock)
SET key value XX                 # chỉ set nếu key ĐÃ tồn tại
GET key                         # lấy giá trị
MSET k1 v1 k2 v2                 # set nhiều key cùng lúc
MGET k1 k2                       # lấy nhiều key cùng lúc
INCR key                         # tăng 1 (atomic, dùng cho counter)
INCRBY key n                     # tăng n
DECR key / DECRBY key n           # giảm
APPEND key "text"                 # nối chuỗi vào cuối
STRLEN key                        # độ dài chuỗi
```

## Hash — lưu object

```
HSET key field value [field2 value2...]
HGET key field
HGETALL key
HMGET key field1 field2
HDEL key field
HEXISTS key field
HINCRBY key field n
HKEYS key / HVALS key
HLEN key
```

## List — queue/stack

```
LPUSH key v1 v2                 # đẩy vào đầu
RPUSH key v1 v2                 # đẩy vào cuối
LPOP key [count]                 # lấy ra từ đầu
RPOP key [count]                 # lấy ra từ cuối
LRANGE key start stop             # xem range (0 -1 = tất cả)
LLEN key                          # độ dài list
LREM key count value               # xóa value khỏi list
BLPOP key timeout                  # pop blocking (chờ có data), dùng cho queue
```

## Set — không trùng lặp

```
SADD key m1 m2
SREM key m1
SMEMBERS key
SISMEMBER key m1
SCARD key                          # đếm số phần tử
SINTER key1 key2                    # giao
SUNION key1 key2                    # hợp
SDIFF key1 key2                     # hiệu
```

## Sorted Set — leaderboard, sliding window

```
ZADD key score1 member1 score2 member2
ZRANGE key start stop [WITHSCORES]
ZRANGEBYSCORE key min max
ZREVRANGE key 0 -1 WITHSCORES        # sắp giảm dần (leaderboard cao→thấp)
ZSCORE key member
ZRANK key member                      # thứ hạng (tăng dần)
ZINCRBY key increment member
ZCARD key
ZREM key member
ZREMRANGEBYSCORE key min max          # dùng cho sliding-window rate limiter
```

## Transaction

```
MULTI
SET k1 v1
INCR counter
EXEC                                   # thực thi tất cả lệnh trong queue
DISCARD                                 # hủy transaction đang queue
WATCH key                               # optimistic lock — nếu key đổi trước EXEC thì EXEC fail
```

## Pub/Sub

```
SUBSCRIBE channel                       # (chạy ở 1 connection riêng, blocking)
PUBLISH channel "message"
```

## Pattern hay dùng cho cache (liên hệ Family Finance)

```
SET cache:category:list "..." EX 300 NX     # cache-aside: chỉ set nếu chưa có, TTL 5 phút
GETEX key EX 60                              # lấy value + refresh TTL cùng lúc (sliding expiration)
```

# Sets trong Redis

**Set** là kiểu dữ liệu lưu một **tập hợp các string không trùng lặp**, không có thứ tự.

## Các lệnh cơ bản

```
SADD myset "a" "b" "c"      # thêm phần tử (tự bỏ trùng)
SADD myset "a"              # thêm "a" lần nữa → không có gì xảy ra, vẫn chỉ 1 phần tử
SMEMBERS myset              # lấy toàn bộ phần tử → "a" "b" "c" (không đảm bảo thứ tự)
SISMEMBER myset "a"         # kiểm tra "a" có trong set? → 1 (có) / 0 (không)
SCARD myset                 # số lượng phần tử → 3
SREM myset "b"              # xóa "b"
SRANDMEMBER myset           # lấy random 1 phần tử (không xóa)
SPOP myset                  # lấy random 1 phần tử VÀ xóa luôn
```

## Điểm mạnh nhất: các phép toán tập hợp (set operations)

Đây là lý do chính người ta dùng Set thay vì Hash hay tự làm bằng array trong app:

```
SADD set1 "a" "b" "c"
SADD set2 "b" "c" "d"

SINTER set1 set2            # giao (intersection) → "b" "c"
SUNION set1 set2             # hợp (union) → "a" "b" "c" "d"
SDIFF set1 set2              # hiệu (set1 - set2) → "a"

# Có bản "STORE" để lưu kết quả thành 1 key mới luôn, không cần đọc về app rồi tính
SINTERSTORE result set1 set2
```

Redis tính các phép này ở **server-side**, cực nhanh (thuật toán tối ưu theo kích thước set), thay vì bạn phải kéo cả 2 set về app rồi tự loop so sánh trong JS — vừa chậm vừa tốn băng thông network.

## Ví dụ thực tế

**Tag / follower / permission:**

```
SADD article:100:tags "redis" "database" "backend"
SADD user:1:following "user:2" "user:3" "user:5"
SADD user:2:following "user:3" "user:6"

SINTER user:1:following user:2:following   # bạn chung → "user:3"
```

**Kiểm tra đã xử lý chưa (dedup), rate-limit theo unique visitor:**

```
SADD page:home:visitors:2026-09-21 "user:1000"
SCARD page:home:visitors:2026-09-21   # đếm unique visitor trong ngày
```

## So với Hash và List

|           | Set                                                                 | Hash                                                   | List                           |
| --------- | ------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------ |
| Trùng lặp | Không cho phép                                                      | Field không trùng (nhưng đây là key, không phải value) | Cho phép trùng                 |
| Thứ tự    | Không đảm bảo                                                       | Không đảm bảo                                          | Có thứ tự (theo index)         |
| Value     | Chỉ 1 string mỗi phần tử                                            | field-value pairs                                      | List các string                |
| Dùng khi  | Cần unique + set operations (giao/hợp/hiệu), kiểm tra tồn tại nhanh | Lưu object dạng field                                  | Queue, stack, feed theo thứ tự |

## Về mặt lưu trữ nội bộ

Giống hash, Set cũng có 2 encoding tùy kích thước:

- **intset** — khi toàn bộ phần tử là số nguyên, kích thước nhỏ → nén cực gọn
- **listpack** — khi ít phần tử, không toàn số
- **hashtable** — khi nhiều phần tử → tra `SISMEMBER` với O(1) thay vì quét tuyến tính

Cùng cơ chế listpack/hashtable như hash mà bạn hỏi ở câu trước — Redis áp dụng logic này cho khá nhiều kiểu dữ liệu để tối ưu bộ nhớ khi tập dữ liệu nhỏ.

---

Nếu bạn muốn học tiếp, kiểu dữ liệu thường học sau Set là **Sorted Set (ZSET)** — giống Set nhưng mỗi phần tử có thêm 1 điểm số (score) để sắp xếp, dùng cho leaderboard, ranking. Bạn muốn học tiếp ZSET không?

Chuyển sang **Sorted Set (ZSet)** — cấu trúc mạnh nhất trong nhóm collection của Redis, kết hợp cả tính chất của Set (không trùng lặp) và có thêm **score** để sắp xếp.

## ZSet là gì?

Giống Set (mỗi phần tử là duy nhất), nhưng mỗi phần tử đi kèm 1 **score** (số thực) để Redis tự động sắp xếp theo thứ tự tăng dần.

```
ZADD leaderboard 100 "james"
ZADD leaderboard 85 "anna"
ZADD leaderboard 120 "mike"

ZRANGE leaderboard 0 -1              # -> "anna" "james" "mike" (sắp theo score tăng dần)
ZRANGE leaderboard 0 -1 WITHSCORES   # -> "anna" 85 "james" 100 "mike" 120
```

## Các lệnh cơ bản

```
ZSCORE leaderboard "james"       # -> "100" (xem score của 1 phần tử)
ZRANK leaderboard "james"        # -> vị trí (0-indexed) theo thứ tự tăng dần -> 1
ZREVRANK leaderboard "james"     # -> vị trí theo thứ tự giảm dần -> 1
ZCARD leaderboard                 # -> đếm tổng số phần tử -> 3
```

## Tăng score — giống INCR nhưng cho ZSet

```
ZINCRBY leaderboard 10 "anna"    # cộng thêm 10 điểm cho "anna" -> 95
```

Atomic, rất hợp cho leaderboard game (mỗi lần user ghi điểm chỉ cần 1 lệnh, không cần đọc-sửa-ghi).

## Lấy top N / bottom N — điểm mạnh nhất của ZSet

```
ZREVRANGE leaderboard 0 2 WITHSCORES   # top 3 điểm cao nhất
# -> "mike" 120 "james" 100 "anna" 95

ZRANGE leaderboard 0 2 WITHSCORES       # 3 điểm thấp nhất
```

Đây chính là lý do ZSet thường dùng cho **bảng xếp hạng (leaderboard)** — Redis tự maintain thứ tự, lấy top N là O(log(N)+M), cực nhanh dù có hàng triệu người chơi.

## Lấy theo khoảng score

```
ZRANGEBYSCORE leaderboard 90 110         # ai có điểm từ 90-110
ZCOUNT leaderboard 90 110                 # đếm số người trong khoảng đó
```

## Xóa phần tử

```
ZREM leaderboard "anna"
ZREMRANGEBYRANK leaderboard 0 0          # xóa người xếp hạng thấp nhất
```

## Use case kinh điển: dùng timestamp làm score

Vì score là số thực, một kỹ thuật cực phổ biến: **dùng Unix timestamp làm score** để có 1 danh sách luôn sắp xếp theo thời gian mà không cần sort thủ công.

```
ZADD feed:global 1732500000 "post:501"
ZADD feed:global 1732500100 "post:502"

ZREVRANGE feed:global 0 9 WITHSCORES     # 10 bài mới nhất, đã sort sẵn theo thời gian
```

So với List (`LPUSH`/`LRANGE` mình học trước đó): List chỉ đúng thứ tự nếu bạn LUÔN push đúng thứ tự thời gian. ZSet thì dù bạn add lộn xộn, Redis vẫn tự sắp xếp đúng theo score.

## Ví dụ thực tế: Leaderboard game

```js
const express = require('express')
const { createClient } = require('redis')

const app = express()
app.use(express.json())

const redisClient = createClient({ url: 'redis://localhost:6379' })
redisClient.on('error', (err) => console.error('Redis Client Error', err))
;(async () => {
  await redisClient.connect()
})()

const LEADERBOARD_KEY = 'game:leaderboard'

// POST /score — user ghi điểm mới, cộng dồn vào tổng điểm hiện có
app.post('/score', async (req, res) => {
  const { userId, points } = req.body

  const newTotal = await redisClient.zIncrBy(LEADERBOARD_KEY, points, userId)
  const rank = await redisClient.zRevRank(LEADERBOARD_KEY, userId)

  res.json({ userId, totalScore: newTotal, rank: rank + 1 }) // +1 vì rank 0-indexed
})

// GET /leaderboard/top/:n — lấy top N người chơi
app.get('/leaderboard/top/:n', async (req, res) => {
  const n = parseInt(req.params.n, 10)

  const results = await redisClient.zRangeWithScores(
    LEADERBOARD_KEY,
    0,
    n - 1,
    { REV: true },
  )

  res.json({
    leaderboard: results.map((r, i) => ({
      rank: i + 1,
      userId: r.value,
      score: r.score,
    })),
  })
})

// GET /leaderboard/me/:userId — xem rank + điểm của riêng user đó
app.get('/leaderboard/me/:userId', async (req, res) => {
  const { userId } = req.params

  const score = await redisClient.zScore(LEADERBOARD_KEY, userId)
  if (score === null) {
    return res.status(404).json({ error: 'User chưa có điểm' })
  }

  const rank = await redisClient.zRevRank(LEADERBOARD_KEY, userId)
  res.json({ userId, score, rank: rank + 1 })
})

app.listen(3000, () => console.log('Server running on port 3000'))
```

**Vì sao dùng ZSet ở đây:** `ZINCRBY` cộng điểm atomic (không lo race condition khi nhiều request ghi điểm cùng lúc), `ZREVRANK`/`ZREVRANGE` lấy rank và top N cực nhanh mà không cần tự sort trong code — Redis đã maintain sẵn thứ tự bên trong cấu trúc dữ liệu (skip list).

---

**Thử ngay trên `redis-cli`:**

```
ZADD game:leaderboard 50 "user1"
ZADD game:leaderboard 80 "user2"
ZINCRBY game:leaderboard 30 "user1"
ZREVRANGE game:leaderboard 0 -1 WITHSCORES
ZREVRANK game:leaderboard "user1"
```

Sau khi cộng thêm 30 điểm, "user1" có vượt qua "user2" không? Thử xem `ZREVRANK` trả về gì nhé.

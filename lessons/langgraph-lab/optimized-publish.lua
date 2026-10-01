-- Viết lại theo logic "stream publishing (XADD only, no PUBLISH)" (không phải bản gốc).
-- KEYS[1] = thread cache stream   KEYS[2] = run offsets hash  thread:<t>:run_offsets
-- ARGV[1] = message  ARGV[2] = event  ARGV[3] = ttl giây  ARGV[4] = run_id
local id = redis.call('XADD', KEYS[1], '*', 'run_id', ARGV[4], 'event', ARGV[2], 'message', ARGV[1])
-- nhớ entry ĐẦU TIÊN của mỗi run (HSETNX: chỉ ghi nếu field chưa có)
redis.call('HSETNX', KEYS[2], ARGV[4], id)

local ttl = tonumber(ARGV[3])
if ttl and ttl > 0 then
  local t = redis.call('TIME')
  local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  redis.call('XTRIM', KEYS[1], 'MINID', math.max(now_ms - ttl * 1000, 0))
  redis.call('EXPIRE', KEYS[1], ttl)
  redis.call('EXPIRE', KEYS[2], ttl)
end
return id

-- Viết lại theo logic "resumable stream publishing" của LangGraph runtime (không phải bản gốc).
-- KEYS[1] = thread cache stream   thread:<t>:cache
-- KEYS[2] = run pubsub channel    thread:<t>:run:<r>:stream
-- ARGV[1] = message (JSON)  ARGV[2] = event  ARGV[3] = ttl giây  ARGV[4] = run_id
local id = redis.call('XADD', KEYS[1], '*', 'run_id', ARGV[4], 'event', ARGV[2], 'message', ARGV[1])

local ttl = tonumber(ARGV[3])
if ttl and ttl > 0 then
  local t = redis.call('TIME')
  local now_ms = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
  -- cửa sổ trượt: bỏ mọi entry cũ hơn ttl giây (ID stream = <ms>-<seq>)
  redis.call('XTRIM', KEYS[1], 'MINID', math.max(now_ms - ttl * 1000, 0))
  redis.call('EXPIRE', KEYS[1], ttl)
end

-- LangGraph gửi frame nhị phân [ver][len id][len event][id][event][message];
-- bản lab dùng text "id|event|message" cho dễ đọc.
redis.call('PUBLISH', KEYS[2], id .. '|' .. ARGV[2] .. '|' .. ARGV[1])
return id

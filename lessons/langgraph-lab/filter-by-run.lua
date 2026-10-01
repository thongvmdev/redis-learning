-- Viết lại theo logic "filter stream messages by run_id" (không phải bản gốc).
-- KEYS[1] = thread cache stream   ARGV[1] = run_id   ARGV[2] = start ID ("-" = từ đầu)
local out = {}
for _, entry in ipairs(redis.call('XRANGE', KEYS[1], ARGV[2], '+')) do
  local fields = entry[2]          -- { 'run_id', <id>, 'event', <ev>, 'message', <msg> }
  if fields[2] == ARGV[1] then table.insert(out, entry) end
end
return out

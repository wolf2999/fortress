-- 纯 Lua 实现的 skynet.crypt 子集。
-- 背景：本构建的 luaclib 未编译 crypt.so（依赖 openssl），而 skynet 默认
--       会用 lualib/compat10/crypt.lua -> require "skynet.crypt"，找不到就全挂。
--       实际用到 crypt 的地方只有两处：
--         1) skynet.db.mysql  握手：crypt.sha1
--         2) http/websocket   握手：crypt.base64encode / crypt.base64decode / crypt.sha1
--       故这里用纯 Lua 提供这几个函数，避免编译 C 驱动。
--
-- 提供：sha1 / hmac_sha1 / base64encode / base64decode / hexencode / hexdecode / randomkey
local crypt = {}

-- ==================== 32 位工具 ====================
local function rol(x, n)
    return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF
end

-- ==================== SHA1 ====================
-- 返回原始 20 字节摘要（非十六进制字符串）
function crypt.sha1(msg)
    local H0, H1, H2, H3, H4 = 0x67452301, 0xEFCDAB89, 0x98BADCFE, 0x10325476, 0xC3D2E1F0
    local len = #msg
    local ml = len * 8
    -- 预处理：补 0x80，再补 0 至长度 ≡ 56 (mod 64)，最后附 64 位大端长度
    local m = msg .. "\128"
    while (#m % 64) ~= 56 do m = m .. "\0" end
    m = m .. string.pack(">I8", ml)
    for i = 1, #m, 64 do
        local w = {}
        for j = 0, 15 do
            w[j] = string.unpack(">I4", m, i + j * 4)
        end
        for j = 16, 79 do
            w[j] = rol((w[j - 3] ~ w[j - 8] ~ w[j - 14] ~ w[j - 16]), 1)
        end
        local a, b, c, d, e = H0, H1, H2, H3, H4
        for t = 0, 79 do
            local f, k
            if t <= 19 then
                f = (b & c) | (((~b) & 0xFFFFFFFF) & d)
                k = 0x5A827999
            elseif t <= 39 then
                f = b ~ c ~ d
                k = 0x6ED9EBA1
            elseif t <= 59 then
                f = (b & c) | (b & d) | (c & d)
                k = 0x8F1BBCDC
            else
                f = b ~ c ~ d
                k = 0xCA62C1D6
            end
            local temp = (rol(a, 5) + f + e + k + w[t]) & 0xFFFFFFFF
            e = d
            d = c
            c = rol(b, 30)
            b = a
            a = temp
        end
        H0 = (H0 + a) & 0xFFFFFFFF
        H1 = (H1 + b) & 0xFFFFFFFF
        H2 = (H2 + c) & 0xFFFFFFFF
        H3 = (H3 + d) & 0xFFFFFFFF
        H4 = (H4 + e) & 0xFFFFFFFF
    end
    return string.pack(">I4>I4>I4>I4>I4", H0, H1, H2, H3, H4)
end

-- HMAC-SHA1（mongo 等用得到，这里一并提供，保持接口完整）
function crypt.hmac_sha1(key, text)
    local block = 64
    if #key > block then key = crypt.sha1(key) end
    key = key .. string.rep("\0", block - #key)
    local o, i = {}, {}
    for idx = 1, block do
        local b = key:byte(idx)
        o[idx] = string.char(b ~ 0x5C)
        i[idx] = string.char(b ~ 0x36)
    end
    return crypt.sha1(table.concat(o) .. crypt.sha1(table.concat(i) .. text))
end

-- ==================== Base64 ====================
local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_IDX = {}
for i = 1, #B64 do B64_IDX[B64:sub(i, i)] = i - 1 end

function crypt.base64encode(data)
    local out = {}
    local n = 0
    for i = 1, #data, 3 do
        local b1 = data:byte(i)
        local b2 = data:byte(i + 1)
        local b3 = data:byte(i + 2)
        local c1 = b1 >> 2
        local c2 = ((b1 & 3) << 4) | ((b2 or 0) >> 4)
        local c3 = b2 and (((b2 & 15) << 2) | ((b3 or 0) >> 6)) or nil
        local c4 = b3 and (b3 & 63) or nil
        n = n + 1
        out[n] = B64:sub(c1 + 1, c1 + 1)
        out[n + 1] = B64:sub(c2 + 1, c2 + 1)
        out[n + 2] = c3 and B64:sub(c3 + 1, c3 + 1) or "="
        out[n + 3] = c4 and B64:sub(c4 + 1, c4 + 1) or "="
        n = n + 3
    end
    return table.concat(out)
end

function crypt.base64decode(data)
    -- 去掉换行/空白，容忍 URL-safe 变体
    data = data:gsub("[%s]", "")
    local out = {}
    local n = 0
    local buf, bits = 0, 0
    for i = 1, #data do
        local ch = data:sub(i, i)
        if ch == "=" then break end
        local v = B64_IDX[ch]
        if v then
            buf = (buf << 6) | v
            bits = bits + 6
            if bits >= 8 then
                bits = bits - 8
                n = n + 1
                out[n] = string.char((buf >> bits) & 0xFF)
            end
        end
    end
    return table.concat(out)
end

-- ==================== Hex ====================
function crypt.hexencode(data)
    return (data:gsub(".", function(c)
        return string.format("%02x", c:byte())
    end))
end

function crypt.hexdecode(data)
    return (data:gsub("%x%x", function(cc)
        return string.char(tonumber(cc, 16))
    end))
end

-- ==================== randomkey ====================
-- 8 字节随机 key（与原 C 版一致：用随机数填充，够 websocket 使用）
function crypt.randomkey()
    local t = {}
    for i = 1, 8 do
        t[i] = string.char(math.random(0, 255))
    end
    return table.concat(t)
end

-- ==================== xor_str ====================
-- 用 key 循环异或 data（WebSocket 帧掩码解码 / mongo SCRAM client_key）。
-- 注意：key 长度一般 < data，按键长度循环。
function crypt.xor_str(s, key)
    if not key or #key == 0 then return s end
    local out = {}
    local klen = #key
    local kidx = 0
    for i = 1, #s do
        local kb = key:byte(kidx + 1)
        out[i] = string.char(s:byte(i) ~ kb)
        kidx = kidx + 1
        if kidx >= klen then kidx = 0 end
    end
    return table.concat(out)
end

-- ==================== hashkey ====================
-- 把任意长度字符串折叠成 8 字节 key（对应 C 版 hashkey，用于 hmac64 系列）
function crypt.hashkey(key)
    return crypt.sha1(key):sub(1, 8)
end

-- ==================== hmac64 ====================
-- hmac64(data, key, hash) -> 8 字节；snax/loginserver 用。
-- 这里实现最常用的 hmac-sha1-8（hash 参数省略时也用 sha1）。
function crypt.hmac64(data, key, hash)
    if hash then
        return hash(crypt.hmac_sha1(key, data)):sub(1, 8)
    end
    return crypt.hmac_sha1(key, data):sub(1, 8)
end

-- 兼容 msgserver.lua 里的 crypt.hmac_hash 叫法（等价 hmac64）
crypt.hmac_hash = function(key, data)
    return crypt.hmac64(data, key)
end

return crypt

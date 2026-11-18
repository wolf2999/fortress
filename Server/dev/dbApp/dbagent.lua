--[[
  连接方式照 F:\maplestory\server\project\dev\dbApp\dbagent.lua：
  先连 MySQL，再 CREATE DATABASE，再 USE，再建表。
  Redis 用 skynet.db.redis，默认 127.0.0.1:6379。
  MySQL 存账号和固定 uid。Redis 记这个 uid 当前有几条连接。
]]
local skynet = require("skynet")
local mysql = require("skynet.db.mysql")
local redis = require("skynet.db.redis")
local crypt = require("skynet.crypt")

local DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME
local REDIS_HOST, REDIS_PORT
local db
local cache

local function exec(sql)
	local res = db:query(sql)
	if type(res) == "table" and res.badresult then
		error("[dbagent] SQL failed: " .. tostring(res.err) .. " | " .. sql)
	end
	return res
end

local function lit(v)
	if type(v) == "number" then
		return tostring(v)
	end
	return mysql.quote_sql_str(tostring(v))
end

local function ignore_dup_column(sql)
	local res = db:query(sql)
	if type(res) == "table" and res.badresult then
		local err = tostring(res.err)
		if err:find("Duplicate column", 1, true) then
			return
		end
		error("[dbagent] SQL failed: " .. err .. " | " .. sql)
	end
end

local function ensure_schema()
	exec("CREATE DATABASE IF NOT EXISTS `" .. DB_NAME .. "` DEFAULT CHARSET utf8mb4")
	exec("USE `" .. DB_NAME .. "`")
	exec([[
		CREATE TABLE IF NOT EXISTS accounts (
			uid INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
			name VARCHAR(64) NOT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uk_name (name)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	]])
	ignore_dup_column("ALTER TABLE accounts ADD COLUMN cring INT NOT NULL DEFAULT 500000")
	ignore_dup_column("ALTER TABLE accounts ADD COLUMN pass_salt VARCHAR(32) NOT NULL DEFAULT ''")
	ignore_dup_column("ALTER TABLE accounts ADD COLUMN pass_hash VARCHAR(64) NOT NULL DEFAULT ''")
	exec([[
		CREATE TABLE IF NOT EXISTS stock (
			uid INT NOT NULL,
			item INT NOT NULL,
			qty INT NOT NULL,
			PRIMARY KEY (uid, item)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	]])
	exec([[
		CREATE TABLE IF NOT EXISTS loadout (
			uid INT NOT NULL,
			slot INT NOT NULL,
			item INT NOT NULL,
			PRIMARY KEY (uid, slot)
		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
	]])
end

local function cache_set(name, uid)
	if not cache then
		return
	end
	local ok, err = pcall(function()
		cache:set("fortress:account:" .. name, tostring(uid))
	end)
	if not ok then
		skynet.error("[dbagent] redis set failed: " .. tostring(err))
	end
end

local function char_count(s)
	local n, i = 0, 1
	while i <= #s do
		local b = s:byte(i)
		n = n + 1
		if b < 128 then
			i = i + 1
		elseif b < 224 then
			i = i + 2
		elseif b < 240 then
			i = i + 3
		else
			i = i + 4
		end
	end
	return n
end

local function pass_digest(salt, password)
	return crypt.hexencode(crypt.hmac_sha1(salt, password))
end

local function new_salt()
	return crypt.hexencode(crypt.randomkey())
end

local function mark_online(uid)
	if not cache then
		return
	end
	local ok, err = pcall(function()
		cache:incr("fortress:online:" .. uid)
	end)
	if not ok then
		skynet.error("[dbagent] redis incr failed: " .. tostring(err))
	end
end

local function deny(msg)
	return { ok = 0, uid = 0, msg = msg }
end

-- 密码用盐和 hmac-sha1 保存，不明文入库。已有账号如果还没有哈希，第一次带来的密码会定下来。
local function login_account(name, password)
	if not db then
		error("mysql not connected")
	end
	if type(name) ~= "string" or name == "" then
		return deny("请填写名字")
	end
	if type(password) ~= "string" or char_count(password) < 4 or char_count(password) > 32 then
		return deny("密码要 4 到 32 位")
	end
	local rows = exec("SELECT uid, pass_salt, pass_hash FROM accounts WHERE name=" .. lit(name) .. " LIMIT 1")
	local row = rows[1]
	local uid
	if not row then
		local salt = new_salt()
		local hash = pass_digest(salt, password)
		local inserted_ok, inserted = pcall(exec, string.format(
			"INSERT INTO accounts (name, pass_salt, pass_hash) VALUES (%s,%s,%s)",
			lit(name), lit(salt), lit(hash)
		))
		if inserted_ok then
			uid = tonumber(inserted.insert_id)
		end
		if not uid then
			rows = exec("SELECT uid, pass_salt, pass_hash FROM accounts WHERE name=" .. lit(name) .. " LIMIT 1")
			row = rows[1]
			if not row then
				return deny("登录失败")
			end
			uid = tonumber(row.uid)
			if pass_digest(row.pass_salt or "", password) ~= (row.pass_hash or "") then
				return deny("密码不对")
			end
		end
	else
		uid = tonumber(row.uid)
		local hash = row.pass_hash or ""
		if hash == "" then
			local salt = new_salt()
			local digest = pass_digest(salt, password)
			local updated = exec(string.format(
				"UPDATE accounts SET pass_salt=%s, pass_hash=%s WHERE uid=%d AND pass_hash=''",
				lit(salt), lit(digest), uid
			))
			if (tonumber(updated.affected_rows) or 0) < 1 then
				rows = exec("SELECT pass_salt, pass_hash FROM accounts WHERE uid=" .. uid .. " LIMIT 1")
				local current = rows[1]
				if not current or pass_digest(current.pass_salt or "", password) ~= (current.pass_hash or "") then
					return deny("密码不对")
				end
			end
		elseif pass_digest(row.pass_salt or "", password) ~= hash then
			return deny("密码不对")
		end
	end
	if not uid then
		return deny("登录失败")
	end
	cache_set(name, uid)
	mark_online(uid)
	return { ok = 1, uid = uid, msg = "ok" }
end

local function uid_of(uid)
	uid = math.floor(tonumber(uid) or 0)
	if uid <= 0 then
		error("uid missing")
	end
	return uid
end

local function read_bag(uid)
	uid = uid_of(uid)
	local accounts = exec("SELECT cring FROM accounts WHERE uid=" .. uid .. " LIMIT 1")
	if not accounts[1] then
		return { ok = 0, msg = "账号不存在", cring = 0, stock = {}, loadout = {} }
	end
	local stock = {}
	local qty = {}
	for _, row in ipairs(exec("SELECT item, qty FROM stock WHERE uid=" .. uid)) do
		local item = tonumber(row.item) or 0
		local n = tonumber(row.qty) or 0
		if item > 0 and n > 0 then
			qty[item] = n
			stock[#stock + 1] = { slot = 0, item = item, qty = n }
		end
	end
	local loadout = {}
	for _, row in ipairs(exec("SELECT slot, item FROM loadout WHERE uid=" .. uid .. " ORDER BY slot")) do
		local slot = tonumber(row.slot) or 0
		local item = tonumber(row.item) or 0
		if slot >= 1 and slot <= 4 and item > 0 then
			loadout[#loadout + 1] = { slot = slot, item = item, qty = qty[item] or 0 }
		end
	end
	return {
		ok = 1,
		msg = "ok",
		cring = tonumber(accounts[1].cring) or 0,
		stock = stock,
		loadout = loadout,
	}
end

local function buy_item(uid, item, price)
	uid = uid_of(uid)
	item = math.floor(tonumber(item) or 0)
	price = math.floor(tonumber(price) or 0)
	if item <= 0 or price <= 0 then
		return { ok = 0, msg = "没有这种道具", cring = 0, stock = {}, loadout = {} }
	end
	local updated = exec(string.format(
		"UPDATE accounts SET cring=cring-%d WHERE uid=%d AND cring>=%d",
		price, uid, price
	))
	if (tonumber(updated.affected_rows) or 0) < 1 then
		local bag = read_bag(uid)
		bag.ok = 0
		bag.msg = "CRING 不够"
		return bag
	end
	exec(string.format(
		"INSERT INTO stock (uid, item, qty) VALUES (%d,%d,1) ON DUPLICATE KEY UPDATE qty=qty+1",
		uid, item
	))
	local bag = read_bag(uid)
	bag.msg = "ok"
	return bag
end

local function equip_item(uid, slot, item)
	uid = uid_of(uid)
	slot = math.floor(tonumber(slot) or 0)
	item = math.floor(tonumber(item) or 0)
	if slot < 1 or slot > 4 then
		return { ok = 0, msg = "格子不对", cring = 0, stock = {}, loadout = {} }
	end
	exec("DELETE FROM loadout WHERE uid=" .. uid .. " AND slot=" .. slot)
	if item > 0 then
		local rows = exec("SELECT qty FROM stock WHERE uid=" .. uid .. " AND item=" .. item .. " LIMIT 1")
		if not rows[1] or (tonumber(rows[1].qty) or 0) < 1 then
			local bag = read_bag(uid)
			bag.ok = 0
			bag.msg = "还没有这个道具"
			return bag
		end
		exec(string.format("INSERT INTO loadout (uid, slot, item) VALUES (%d,%d,%d)", uid, slot, item))
	end
	return read_bag(uid)
end

local function spend_item(uid, item)
	uid = uid_of(uid)
	item = math.floor(tonumber(item) or 0)
	local updated = exec(string.format(
		"UPDATE stock SET qty=qty-1 WHERE uid=%d AND item=%d AND qty>0",
		uid, item
	))
	if (tonumber(updated.affected_rows) or 0) < 1 then
		local bag = read_bag(uid)
		bag.ok = 0
		bag.msg = "没有这个道具"
		return bag
	end
	return read_bag(uid)
end

local function grant_item(uid, item)
	uid = uid_of(uid)
	item = math.floor(tonumber(item) or 0)
	if item <= 0 then
		return read_bag(uid)
	end
	exec(string.format(
		"INSERT INTO stock (uid, item, qty) VALUES (%d,%d,1) ON DUPLICATE KEY UPDATE qty=qty+1",
		uid, item
	))
	return read_bag(uid)
end

local function reward_cring(uid, amount)
	uid = uid_of(uid)
	amount = math.floor(tonumber(amount) or 0)
	if amount > 0 then
		exec("UPDATE accounts SET cring=cring+" .. amount .. " WHERE uid=" .. uid)
	end
	return read_bag(uid)
end

local function logout_account(uid)
	uid = tonumber(uid)
	if not cache or not uid then
		return
	end
	local ok, err = pcall(function()
		local left = tonumber(cache:decr("fortress:online:" .. uid)) or 0
		if left <= 0 then
			cache:del("fortress:online:" .. uid)
		end
	end)
	if not ok then
		skynet.error("[dbagent] redis decr failed: " .. tostring(err))
	end
end

skynet.start(function()
	DB_HOST = skynet.getenv("db_host") or "127.0.0.1"
	DB_PORT = tonumber(skynet.getenv("db_port") or 3306)
	DB_USER = skynet.getenv("db_user") or "root"
	DB_PASS = skynet.getenv("db_password") or "123456"
	DB_NAME = skynet.getenv("db_name") or "fortress"
	REDIS_HOST = skynet.getenv("redis_host") or "127.0.0.1"
	REDIS_PORT = tonumber(skynet.getenv("redis_port") or 6379)

	local ok, err = pcall(function()
		db = mysql.connect({
			host = DB_HOST,
			port = DB_PORT,
			user = DB_USER,
			password = DB_PASS,
			charset = "utf8mb4",
		})
		ensure_schema()
	end)
	if ok then
		skynet.error("[dbagent] connected MySQL: " .. DB_HOST .. ":" .. DB_PORT .. "/" .. DB_NAME)
	else
		db = nil
		skynet.error("[dbagent] MySQL connect FAILED: " .. tostring(err))
	end

	local rok, rerr = pcall(function()
		cache = redis.connect({
			host = REDIS_HOST,
			port = REDIS_PORT,
		})
		cache:ping()
	end)
	if rok then
		skynet.error("[dbagent] connected Redis: " .. REDIS_HOST .. ":" .. REDIS_PORT)
	else
		cache = nil
		skynet.error("[dbagent] Redis connect FAILED: " .. tostring(rerr))
	end

	local function ret_bag(fn, ...)
		local done, result = pcall(fn, ...)
		if done then
			skynet.retpack(result)
		else
			skynet.error("[dbagent] " .. tostring(result))
			skynet.retpack({ ok = 0, msg = "数据库不可用", cring = 0, stock = {}, loadout = {} })
		end
	end

	skynet.dispatch("lua", function(_, _, cmd, ...)
		local a, b, c = ...
		if cmd == "login" then
			local done, result = pcall(login_account, a, b)
			if done then
				skynet.retpack(result)
			else
				skynet.error("[dbagent] login FAILED: " .. tostring(result))
				skynet.retpack({ ok = 0, uid = 0, msg = "登录失败" })
			end
		elseif cmd == "logout" then
			logout_account(a)
			skynet.retpack({ ok = 1 })
		elseif cmd == "bag" then
			ret_bag(read_bag, a)
		elseif cmd == "buy" then
			ret_bag(buy_item, a, b, c)
		elseif cmd == "equip" then
			ret_bag(equip_item, a, b, c)
		elseif cmd == "spend" then
			ret_bag(spend_item, a, b)
		elseif cmd == "grant" then
			ret_bag(grant_item, a, b)
		elseif cmd == "reward" then
			ret_bag(reward_cring, a, b)
		else
			skynet.retpack({ ok = 0, msg = "未知指令" })
		end
	end)
end)

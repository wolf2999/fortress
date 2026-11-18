-- 登录向 dbApp 核对名字和密码，通过后拿到固定 uid。
local skynet = require("skynet")
local cc = require("common.cluster")

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

local function handle(name, args)
	if name ~= "rpcAuthClient" then
		return { ok = 0, uid = 0, msg = "未知协议" }
	end
	local account = args and args.account or ""
	local password = args and args.password or ""
	if account == "" then
		return { ok = 0, uid = 0, msg = "请填写名字" }
	end
	if #account > 48 then
		account = account:sub(1, 48)
	end
	if type(password) ~= "string" or char_count(password) < 4 or char_count(password) > 32 then
		return { ok = 0, uid = 0, msg = "密码要 4 到 32 位" }
	end
	local ok, result = pcall(cc.call, "dbApp", "dbagent", "login", account, password)
	if not ok then
		skynet.error("[login] db call failed: " .. tostring(result))
		return { ok = 0, uid = 0, msg = "数据库不可用" }
	end
	if result and result.ok == 1 then
		skynet.error(string.format("[login] %s -> uid %s", account, tostring(result.uid)))
	else
		skynet.error(string.format("[login] %s 拒绝: %s", account, tostring(result and result.msg)))
	end
	return result
end

skynet.start(function()
	skynet.dispatch("lua", function(_, _, method, ...)
		if method == "logout" then
			local uid = ...
			pcall(cc.call, "dbApp", "dbagent", "logout", uid)
			return
		end
		if method ~= "handle" then
			return
		end
		local name, args = ...
		local ok, resp = pcall(handle, name, args)
		if not ok then
			skynet.error("[login] " .. tostring(resp))
			resp = { ok = 0, uid = 0, msg = "登录出错" }
		end
		skynet.ret(skynet.pack(resp))
	end)
	skynet.error("[login] started")
end)

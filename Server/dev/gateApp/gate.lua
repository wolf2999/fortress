--[[
  客户端唯一的 websocket 入口。
  rpcEcho 本地回；rpcAuthClient 转到 loginApp。
  csEnterLobby / csLeaveLobby 转到 worldApp/world，其余转到 worldApp/battle。
  下推：其他进程 cluster.send("gateApp","gate","push", fd, name, args)。
]]
local skynet = require("skynet")
local websocket = require("http.websocket")
local socket = require("skynet.socket")
local proto = require("common.proto")
local cc = require("common.cluster")

local host = proto.host
local sender = proto.sender
local PORT = tonumber(skynet.getenv("gate_port") or 8090)

local clients = {}

local function drop_client(fd, why)
	local c = clients[fd]
	if not c then
		return
	end
	clients[fd] = nil
	if c.authed then
		if c.uid then
			pcall(cc.send, "loginApp", "login", "logout", c.uid)
		end
		pcall(cc.send, "worldApp", "battle", "disconnect", fd)
		pcall(cc.send, "worldApp", "world", "disconnect", fd)
	end
	skynet.error(string.format("[gate] fd=%d %s", fd, why))
end

local function push_to(fd, name, args)
	if not clients[fd] then
		return
	end
	local ok, out = pcall(sender, name, args)
	if ok and out then
		websocket.write(fd, out, "binary")
	else
		skynet.error(string.format("[gate] push %s failed: %s", name, tostring(out)))
	end
end

local function route_service(name)
	if name == "rpcAuthClient" then
		return "loginApp", "login"
	end
	if name == "csEnterLobby" or name == "csLeaveLobby" then
		return "worldApp", "world"
	end
	return "worldApp", "battle"
end

local function reply(fd, name, response, result)
	if not (response and proto.hasResponse[name]) then
		return
	end
	local ok, out = pcall(response, result or {})
	if ok and out then
		websocket.write(fd, out, "binary")
	else
		skynet.error(string.format("[gate] resp %s encode failed: %s", name, tostring(out)))
	end
end

local function handle_request(fd, name, args, response)
	if name == "rpcEcho" then
		reply(fd, name, response, { pong = (args and args.ping) or "" })
		return
	end

	local c = clients[fd]
	if name == "rpcAuthClient" and c then
		c.account = args and args.account or ""
	end
	if name ~= "rpcAuthClient" and (not c or not c.authed) then
		reply(fd, name, response, { ok = 0, msg = "请先登录" })
		return
	end

	local node, service = route_service(name)
	local acc = c and c.account or ""
	local uid = c and c.uid or 0
	local ok, result = pcall(cc.call, node, service, "handle", name, args or {}, fd, acc, uid)
	if not ok then
		skynet.error(string.format("[gate] %s -> %s/%s failed: %s", name, node, service, result))
		result = { ok = 0, msg = "服务不可用" }
	end

	if name == "rpcAuthClient" and result and result.ok == 1 and c then
		c.uid = result.uid
		c.authed = true
	end
	reply(fd, name, response, result or {})
end

local handle = {
	message = function(fd, data, opcode)
		if opcode ~= "binary" then
			return
		end
		local ok, kind, name, args, response = pcall(host.dispatch, host, data)
		if not ok then
			skynet.error(string.format("[gate] dispatch fd=%d error: %s", fd, tostring(kind)))
			return
		end
		if kind == "REQUEST" then
			handle_request(fd, name, args, response)
		end
	end,
	close = function(fd, code)
		drop_client(fd, "closed code=" .. tostring(code))
	end,
	error = function(fd, err)
		drop_client(fd, "error: " .. tostring(err))
	end,
}

skynet.start(function()
	skynet.dispatch("lua", function(_, _, cmd, ...)
		if cmd == "push" then
			push_to(...)
		end
	end)
	local listen_id = socket.listen("0.0.0.0", PORT)
	socket.start(listen_id, function(fd, addr)
		clients[fd] = { fd = fd, uid = nil, authed = false, addr = addr, account = "" }
		-- websocket.accept 必须留在监听回调的同步栈里，不能 skynet.fork，
		-- 否则握手读事件派发不到，客户端会一直 pending。
		local ok, err = websocket.accept(fd, handle, "ws", addr)
		if not ok then
			skynet.error(string.format("[gate] fd=%d accept failed: %s", fd, tostring(err)))
		end
	end)
	skynet.error(string.format("[gate] websocket listening on ws://0.0.0.0:%d", PORT))
end)

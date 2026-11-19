--[[
  房间列表。对局仍在 battle，这里只保存每间房的摘要，并推给大厅里的人。
]]
local skynet = require("skynet")
local cc = require("common.cluster")

local watchers = {}
local briefs = {}

local function list_msg()
	local ids = {}
	for id in pairs(briefs) do
		ids[#ids + 1] = id
	end
	table.sort(ids)
	local rooms = {}
	for _, id in ipairs(ids) do
		local brief = briefs[id]
		rooms[#rooms + 1] = {
			roomId = brief.roomId,
			mapId = brief.mapId,
			phase = brief.phase,
			count = brief.count,
			red = brief.red,
			blue = brief.blue,
			host = brief.host or "",
			ready = brief.ready or 0,
			terrainKind = brief.terrainKind or 1,
		}
	end
	return { rooms = rooms }
end

local function push_list(fd)
	cc.send("gateApp", "gate", "push", fd, "scRoomList", list_msg())
end

local function broadcast()
	local msg = list_msg()
	for fd in pairs(watchers) do
		cc.send("gateApp", "gate", "push", fd, "scRoomList", msg)
	end
end

local function handle(name, _, fd)
	if name == "csEnterLobby" then
		watchers[fd] = true
		push_list(fd)
		return { ok = 1, msg = "已进入大厅" }
	end
	if name == "csLeaveLobby" then
		watchers[fd] = nil
		return { ok = 1, msg = "已离开大厅" }
	end
	return { ok = 0, msg = "未知协议" }
end

local function publish(brief)
	if not brief or not brief.roomId then
		return
	end
	if brief.gone == 1 then
		briefs[brief.roomId] = nil
	else
		briefs[brief.roomId] = brief
	end
	broadcast()
end

skynet.start(function()
	skynet.dispatch("lua", function(_, _, method, ...)
		if method == "handle" then
			local name, args, fd = ...
			local ok, resp = pcall(handle, name, args, fd)
			if not ok then
				skynet.error("[world] " .. tostring(resp))
				resp = { ok = 0, msg = "大厅出错" }
			end
			skynet.ret(skynet.pack(resp))
		elseif method == "disconnect" then
			local fd = ...
			watchers[fd] = nil
		elseif method == "publish" then
			publish(...)
		end
	end)
	skynet.error("[world] started")
end)

-- 网关进程入口。
local skynet = require("skynet")
local cc = require("common.cluster")

skynet.start(function()
	cc.open()
	local gateId = skynet.uniqueservice("gateApp/gate")
	cc.register("gate", gateId)
	skynet.error("[gateApp] main started, gate registered")
end)

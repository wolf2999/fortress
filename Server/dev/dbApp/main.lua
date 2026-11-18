local skynet = require("skynet")
local cc = require("common.cluster")

skynet.start(function()
	cc.open()
	local dbId = skynet.uniqueservice("dbApp/dbagent")
	cc.register("dbagent", dbId)
	skynet.error("[dbApp] main started, dbagent registered")
end)

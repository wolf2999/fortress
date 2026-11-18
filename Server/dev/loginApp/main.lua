local skynet = require("skynet")
local cc = require("common.cluster")

skynet.start(function()
	cc.open()
	local loginId = skynet.uniqueservice("loginApp/login")
	cc.register("login", loginId)
	skynet.error("[loginApp] main started, login registered")
end)

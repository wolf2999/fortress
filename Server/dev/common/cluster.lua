--[[ 跨进程调用。服务名补 @，与 skynet clusteragent 的查询约定一致。 ]]
local skynet = require("skynet")
local cluster = require("skynet.cluster")

local M = {}

function M.open()
	local runconf = require(skynet.getenv("runconfig"))
	cluster.reload(runconf.cluster)
	cluster.open(skynet.getenv("nodename"))
end

function M.register(name, address)
	cluster.register(name, address or skynet.self())
end

function M.call(node, name, ...)
	return cluster.call(node, "@" .. name, ...)
end

function M.send(node, name, ...)
	cluster.send(node, "@" .. name, ...)
end

return M

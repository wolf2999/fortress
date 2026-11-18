--[[ 显式加载 config/*.lua。表名等于文件名。 ]]
local skynet = require("skynet")

local NAMES = { "constants", "weapons", "tanks", "items" }
local M = {}
local loaded = {}
local inited = false

function M.load()
	if inited then
		return loaded
	end
	inited = true
	for _, name in ipairs(NAMES) do
		local ok, tbl = pcall(require, name)
		if ok and type(tbl) == "table" then
			loaded[name] = tbl
			skynet.error(("[config] loaded table '%s'"):format(name))
		else
			skynet.error(("[config] error: load table '%s' failed: %s"):format(name, tostring(tbl)))
		end
	end
	return loaded
end

function M.get(name)
	return loaded[name]
end

return M

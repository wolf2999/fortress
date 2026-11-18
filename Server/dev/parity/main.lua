-- 固定输入打一发，把结果写到 log/parity-lua.txt 后退出。
-- 用来和 Client 的同一组输入对拍，不参与正式集群。
local skynet = require("skynet")
local rules = require("worldApp.rules")

local function line(fmt, ...)
	return string.format(fmt, ...)
end

skynet.start(function()
	local terrain = rules.build_terrain(17)
	local tank = {
		seat = 0,
		name = "红",
		x = 96,
		y = 0,
		hp = 1000,
		maxHp = 1000,
		alive = 1,
		fuel = 220,
		bot = 0,
	}
	rules.place(tank, terrain, false)
	local x, y = rules.muzzle(tank, 60)
	local tr = rules.trace(terrain, x, y, 60, 550, 2, 1)
	local f = assert(io.open("log/parity-lua.txt", "w"))
	f:write(line("tankY %d\n", math.floor(tank.y + 0.5)))
	f:write(line("muzzle %d %d\n", math.floor(x + 0.5), math.floor(y + 0.5)))
	f:write(line("hit %d %d %d\n", tr.hit, tr.hitX, tr.hitY))
	f:write(line("n %d\n", #tr.xs))
	f:write(line("ends %d %d %d %d\n", tr.xs[1], tr.ys[1], tr.xs[#tr.xs], tr.ys[#tr.ys]))
	f:write(line("terrain %d %d %d\n", terrain[1], terrain[41], terrain[121]))
	f:close()
	skynet.error("[parity] wrote log/parity-lua.txt")
	os.exit(0)
end)

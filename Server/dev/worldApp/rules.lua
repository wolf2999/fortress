--[[
  炮战结算。公式与 Client/src/sim/rules.ts 对齐。
  联机时以这里的结果为准，客户端只负责预瞄和播放轨迹。

  弹道是 Atomic Cannon 线性风力模型的一个子集：
  先加重力，再加水平风力，最后用新速度推进一步。
  不含阵风、垂直风、空气阻力。
  地形两种：高度列（默认）和像素掩码（可挖空洞）。
]]
local C = require("constants")
local Weapons = require("weapons")
local Tanks = require("tanks")
local Items = require("items")

local M = {}

local COLS = math.floor(C.worldW / C.colW)
local MASK_BYTES = math.ceil((C.worldW * C.worldH) / 8)

local function pack_bytes(bytes)
	local n = #bytes
	if n == 0 then
		return ""
	end
	local parts = {}
	local step = 4096
	for i = 1, n, step do
		local j = math.min(i + step - 1, n)
		parts[#parts + 1] = string.char(table.unpack(bytes, i, j))
	end
	return table.concat(parts)
end

local function unpack_bytes(bin)
	local bytes = {}
	if not bin or bin == "" then
		return bytes
	end
	for i = 1, #bin do
		bytes[i] = string.byte(bin, i)
	end
	return bytes
end

function M.mask_byte_count()
	return MASK_BYTES
end

function M.mask_solid(mask, x, y)
	local px = math.floor(x)
	local py = math.floor(y)
	if px < 0 or py < 0 or px >= C.worldW or py >= C.worldH then
		return false
	end
	local i = py * C.worldW + px
	local bi = math.floor(i / 8) + 1
	local bit = i % 8
	local b = mask[bi] or 0
	return (b & (1 << bit)) ~= 0
end

function M.mask_set(mask, x, y, on)
	local px = math.floor(x)
	local py = math.floor(y)
	if px < 0 or py < 0 or px >= C.worldW or py >= C.worldH then
		return
	end
	local i = py * C.worldW + px
	local bi = math.floor(i / 8) + 1
	local bit = 1 << (i % 8)
	local b = mask[bi] or 0
	if on then
		mask[bi] = b | bit
	else
		mask[bi] = b & (~bit & 0xFF)
	end
end

local function surface_at_height(terrain, x)
	local i = math.floor(x / C.colW) + 1
	if i < 1 then
		i = 1
	end
	if i > #terrain then
		i = #terrain
	end
	return terrain[i]
end

local function surface_at_mask(mask, x)
	local px = math.floor(x)
	if px < 0 then
		px = 0
	end
	if px >= C.worldW then
		px = C.worldW - 1
	end
	for y = 0, C.worldH - 1 do
		if M.mask_solid(mask, px, y) then
			return y
		end
	end
	return C.worldH
end

function M.surface_at(terrain, x, mask)
	if mask and #mask > 0 then
		return surface_at_mask(mask, x)
	end
	return surface_at_height(terrain, x)
end

function M.build_terrain(seed, mapId)
	mapId = mapId or 1
	local terrain = {}
	for i = 1, COLS do
		local x = (i - 1) / (COLS - 1)
		local n = math.sin(x * math.pi * 2 + seed * 0.17)
			+ 0.55 * math.sin(x * math.pi * 5.2 + seed * 0.07)
			+ 0.28 * math.sin(x * math.pi * 11 + 1.3)
		local h
		if mapId == 2 then
			local bowl = math.sin(x * math.pi)
			h = 0.46 + bowl * 0.22 + n * 0.03
			if x < 0.16 or x > 0.84 then
				h = 0.50
			end
		else
			h = 0.58 + n * 0.07
			if x < 0.2 or x > 0.8 then
				h = 0.55
			end
		end
		local y = math.floor(h * C.worldH)
		if y < 80 then
			y = 80
		end
		if y > C.worldH - 40 then
			y = C.worldH - 40
		end
		terrain[i] = y
	end
	return terrain
end

function M.heights_to_mask(terrain)
	local mask = {}
	for i = 1, MASK_BYTES do
		mask[i] = 0
	end
	for i = 1, #terrain do
		local x0 = (i - 1) * C.colW
		local x1 = math.min(C.worldW, x0 + C.colW)
		local top = terrain[i]
		if top < 0 then
			top = 0
		end
		if top > C.worldH then
			top = C.worldH
		end
		for x = x0, x1 - 1 do
			for y = top, C.worldH - 1 do
				M.mask_set(mask, x, y, true)
			end
		end
	end
	return mask
end

function M.make_terrain(seed, mapId, terrainKind)
	mapId = mapId or 1
	terrainKind = math.floor(tonumber(terrainKind) or C.terrainHeight)
	local heights = M.build_terrain(seed, mapId)
	if terrainKind == C.terrainMask then
		return {
			terrainKind = C.terrainMask,
			terrain = {},
			mask = M.heights_to_mask(heights),
		}
	end
	return {
		terrainKind = C.terrainHeight,
		terrain = heights,
		mask = nil,
	}
end

function M.mask_pack(mask)
	if not mask or #mask == 0 then
		return ""
	end
	return pack_bytes(mask)
end

function M.mask_unpack(bin)
	if not bin or bin == "" then
		return nil
	end
	return unpack_bytes(bin)
end

function M.clone_mask(mask)
	if not mask then
		return nil
	end
	local out = {}
	for i = 1, #mask do
		out[i] = mask[i]
	end
	return out
end

function M.launch_speed(power, speedScale)
	return power * speedScale * math.sqrt(C.worldW / C.launchRef)
end

function M.muzzle(tank, angle)
	local rad = math.rad(angle)
	local x = tank.x + C.tankW / 2 + math.cos(rad) * C.muzzle
	local y = tank.y + 6 - math.sin(rad) * C.muzzle
	return x, y
end

local function sample(xs, ys)
	local n = #xs
	local stride = math.max(2, math.ceil(n / 160))
	local ox, oy = {}, {}
	for i = 1, n, stride do
		ox[#ox + 1] = math.floor(xs[i] + 0.5)
		oy[#oy + 1] = math.floor(ys[i] + 0.5)
	end
	local lx = math.floor(xs[n] + 0.5)
	local ly = math.floor(ys[n] + 0.5)
	if ox[#ox] ~= lx or oy[#oy] ~= ly then
		ox[#ox + 1] = lx
		oy[#oy + 1] = ly
	end
	return ox, oy
end

function M.trace(terrain, x0, y0, angle, power, wind, speedScale, mask)
	local rad = math.rad(angle)
	local speed = M.launch_speed(power, speedScale)
	local x, y = x0, y0
	local vx = math.cos(rad) * speed
	local vy = -math.sin(rad) * speed
	local xs, ys = { x }, { y }
	local steps = math.floor(C.maxLife / C.dt)
	local hit, hitX, hitY = 0, x, y
	local use_mask = mask and #mask > 0
	for _ = 1, steps do
		local ox, oy = x, y
		vy = vy + C.gravity * C.dt
		vx = vx + wind * C.windAccel * C.dt
		x = x + vx * C.dt
		y = y + vy * C.dt
		xs[#xs + 1] = x
		ys[#ys + 1] = y
		local dist = math.sqrt((x - x0) * (x - x0) + (y - y0) * (y - y0))
		if x < -20 or x > C.worldW + 20 then
			hit, hitX, hitY = 0, x, y
			break
		end
		if dist >= 18 and y >= C.worldH then
			hit, hitX, hitY = 1, x, C.worldH
			break
		end
		if dist < 18 then
			-- keep going
		elseif not use_mask then
			if y >= surface_at_height(terrain, x) then
				hit, hitX, hitY = 1, x, y
				break
			end
		else
			local span = math.sqrt((x - ox) * (x - ox) + (y - oy) * (y - oy))
			local parts = math.max(1, math.ceil(span))
			local struck = false
			for p = 1, parts do
				local t = p / parts
				local sx = ox + (x - ox) * t
				local sy = oy + (y - oy) * t
				if M.mask_solid(mask, sx, sy) then
					hit, hitX, hitY = 1, sx, sy
					struck = true
					break
				end
			end
			if struck then
				break
			end
		end
	end
	local ox, oy = sample(xs, ys)
	return {
		xs = ox,
		ys = oy,
		hit = hit,
		hitX = math.floor(hitX + 0.5),
		hitY = math.floor(hitY + 0.5),
	}
end

local function apply_blast_height(terrain, cx, cy, radius, kind)
	local r2 = radius * radius
	local i0 = math.floor((cx - radius) / C.colW) + 1
	local i1 = math.floor((cx + radius) / C.colW) + 1
	for i = i0, i1 do
		if i >= 1 and i <= #terrain then
			local colX = (i - 1) * C.colW + C.colW * 0.5
			local dx = colX - cx
			local rest = r2 - dx * dx
			if rest > 0 then
				local dy = math.sqrt(rest)
				if kind == "fill" then
					local top = cy - dy
					if top < terrain[i] then
						local y = math.floor(top)
						if y < 36 then
							y = 36
						end
						terrain[i] = y
					end
				else
					local bot = cy + dy
					if terrain[i] < bot and (cy - dy) <= terrain[i] + 2 then
						local y = math.floor(bot)
						if y > C.worldH then
							y = C.worldH
						end
						terrain[i] = y
					end
				end
			end
		end
	end
end

local function apply_blast_mask(mask, cx, cy, radius, kind)
	local r = math.max(1, math.floor(radius))
	local r2 = radius * radius
	local x0 = math.max(0, math.floor(cx - r))
	local x1 = math.min(C.worldW - 1, math.ceil(cx + r))
	local y0 = math.max(0, math.floor(cy - r))
	local y1 = math.min(C.worldH - 1, math.ceil(cy + r))
	local fill = kind == "fill"
	for y = y0, y1 do
		for x = x0, x1 do
			local dx = x + 0.5 - cx
			local dy = y + 0.5 - cy
			if dx * dx + dy * dy <= r2 then
				M.mask_set(mask, x, y, fill)
			end
		end
	end
end

function M.apply_blast(terrain, cx, cy, radius, kind, mask)
	if mask and #mask > 0 then
		apply_blast_mask(mask, cx, cy, radius, kind)
	else
		apply_blast_height(terrain, cx, cy, radius, kind)
	end
end

local function body_blocked(mask, x, y)
	local x0 = math.floor(x)
	local y0 = math.floor(y)
	local x1 = math.floor(x + C.tankW - 1)
	local y1 = math.floor(y + C.tankH - 1)
	for py = y0, y1 do
		for px = x0, x1 do
			if M.mask_solid(mask, px, py) then
				return true
			end
		end
	end
	return false
end

function M.place(tank, terrain, fall, mask)
	local oldY = tank.y
	local ground = M.surface_at(terrain, tank.x + C.tankW / 2, mask)
	tank.y = ground - C.tankH
	if tank.y > C.worldH - C.tankH then
		tank.hp = 0
		tank.alive = 0
		return
	end
	if fall and tank.alive == 1 then
		local drop = tank.y - oldY
		if drop > 40 then
			tank.hp = math.max(0, tank.hp - math.floor(drop * 1.2))
			if tank.hp <= 0 then
				tank.hp = 0
				tank.alive = 0
			end
		end
	end
end

local function hurt(tank, cx, cy, radius, dmg)
	if tank.alive ~= 1 then
		return
	end
	local tx = tank.x + C.tankW / 2
	local ty = tank.y + C.tankH / 2
	local d = math.sqrt((tx - cx) * (tx - cx) + (ty - cy) * (ty - cy))
	local reach = radius + C.hitPad
	if d <= reach then
		local dealt = math.max(1, math.floor(dmg * (1 - d / reach)))
		tank.hp = tank.hp - dealt
		if tank.hp <= 0 then
			tank.hp = 0
			tank.alive = 0
		end
	end
end

local function winner_text(match, winner)
	if winner == -2 then
		return "同归于尽"
	end
	local count = 0
	local name = ""
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank and (tank.team or seat) == winner then
			count = count + 1
			name = tank.name
		end
	end
	if count <= 1 then
		return name .. " 获胜"
	end
	if winner == 0 then
		return "红方 获胜"
	end
	return "蓝方 获胜"
end

local function next_living(match, from)
	local first, after, passed
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank and tank.alive == 1 then
			if not first then
				first = seat
			end
			if passed and not after then
				after = seat
			end
			if seat == from then
				passed = true
			end
		end
	end
	return after or first or from
end

local function next_actor(match, from)
	local waiting = false
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank and tank.alive == 1 and tank.opened ~= 1 then
			waiting = true
			break
		end
	end
	if waiting then
		return next_living(match, from)
	end
	local best, bestWait
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank and tank.alive == 1 then
			local wait = tank.wait or 0
			if not best or wait < bestWait or (wait == bestWait and seat < best) then
				best = seat
				bestWait = wait
			end
		end
	end
	return best or from
end

function M.judge(match)
	local alive = {}
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank and tank.alive == 1 then
			alive[tank.team or seat] = true
		end
	end
	local teams = {}
	for team in pairs(alive) do
		teams[#teams + 1] = team
	end
	if #teams == 0 then
		return -2
	end
	if #teams == 1 then
		return teams[1]
	end
	return -1
end

function M.clamp_angle(angle)
	angle = math.floor(tonumber(angle) or 0)
	if angle < 0 then
		angle = 0
	end
	if angle > 180 then
		angle = 180
	end
	return angle
end

function M.clamp_power(power)
	power = math.floor(tonumber(power) or 0)
	if power < 1 then
		power = 1
	end
	if power > C.powerMax then
		power = C.powerMax
	end
	return power
end

function M.body_of(id)
	return Tanks[math.floor(tonumber(id) or 0)]
end

function M.apply_body(tank, bodyId)
	local body = M.body_of(bodyId) or Tanks[4]
	tank.body = body.id
	tank.hp = body.hp
	tank.maxHp = body.hp
	tank.fuel = body.fuel
	tank.maxFuel = body.fuel
	tank.wait = body.delay
	tank.opened = 0
	return body
end

function M.weapon_of(id)
	id = math.floor(tonumber(id) or 0)
	if Weapons[id] then
		return Weapons[id]
	end
	for _, body in pairs(Tanks) do
		for i = 1, #body.weapons do
			if body.weapons[i].id == id then
				return body.weapons[i]
			end
		end
	end
end

function M.angle_window(tank)
	local body = tank and Tanks[tank.body or 0]
	if not body then
		return 0, 180
	end
	if (tank.team or 0) == 1 then
		return 180 - body.angleMax, 180 - body.angleMin
	end
	return body.angleMin, body.angleMax
end

local function owns_weapon(tank, weapon)
	if not weapon then
		return false
	end
	local body = tank and Tanks[tank.body or 0]
	if not body then
		return Weapons[weapon.id] ~= nil
	end
	for i = 1, #body.weapons do
		if body.weapons[i].id == weapon.id then
			return true
		end
	end
	return false
end

local function shot_angles(angle, weapon)
	local n = weapon.count
	if not n then
		n = weapon.kind == "spread" and 3 or 1
	end
	local spread = weapon.spread or 0
	if n == 2 then
		return { angle - spread, angle + spread }
	end
	if n >= 3 then
		return { angle - spread, angle, angle + spread }
	end
	return { angle }
end

local function shot_damage(tank, weapon)
	local body = Tanks[tank.body or 0]
	local dmg = weapon.damage
	if body and body.enrage == 1 and tank.maxHp > 0 and tank.hp * 2 <= tank.maxHp then
		dmg = math.floor(dmg * 1.5 + 0.5)
	end
	return dmg
end

function M.place_boxes(terrain, mask)
	local boxes = {}
	for _, x in ipairs({ 280, 680 }) do
		local ground = M.surface_at(terrain, x, mask)
		if ground < C.worldH - 8 then
			boxes[#boxes + 1] = { x = x, y = ground - 8 }
		end
	end
	return boxes
end

local function standing_on(tank, box)
	if tank.alive ~= 1 then
		return false
	end
	local feet = tank.y + C.tankH
	if math.abs(feet - (box.y + 8)) > 6 then
		return false
	end
	return tank.x < box.x + 14 and tank.x + C.tankW > box.x - 14
end

local function take_box(match, tank, box)
	if not tank or tank.alive ~= 1 or tank.hp >= tank.maxHp then
		return
	end
	box.gone = true
	local gain = math.floor((tank.maxHp or 0) * 0.25 + 0.5)
	local before = tank.hp
	tank.hp = math.min(tank.maxHp, tank.hp + gain)
	match.crate_note = (match.crate_note or "") .. string.format("，%s 捡到补给箱，能量 +%d", tank.name, tank.hp - before)
end

local function compact_boxes(match)
	local left = {}
	for _, box in ipairs(match.boxes or {}) do
		if not box.gone then
			left[#left + 1] = box
		end
	end
	match.boxes = left
end

local function collect_standing(match)
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank then
			for _, box in ipairs(match.boxes or {}) do
				if not box.gone and standing_on(tank, box) then
					take_box(match, tank, box)
				end
			end
		end
	end
	compact_boxes(match)
end

local function blast_boxes(match, tank, hitX, hitY, radius)
	local reach = radius + C.hitPad
	for _, box in ipairs(match.boxes or {}) do
		if not box.gone then
			local dx = box.x - hitX
			local dy = box.y - hitY
			if dx * dx + dy * dy <= reach * reach and tank.alive == 1 then
				take_box(match, tank, box)
			end
		end
	end
end

function M.use_item(match, seat, itemId)
	if match.phase ~= "aim" then
		return false, "对局已结束"
	end
	if match.turn ~= seat then
		return false, "还没轮到你"
	end
	local tank = match.seats[seat]
	if not tank or tank.alive ~= 1 then
		return false, "这辆坦克已经报废"
	end
	local item = Items[math.floor(tonumber(itemId) or 0)]
	if not item then
		return false, "没有这种道具"
	end
	if item.kind == "double" then
		if tank.armed == 1 then
			return false, "这回合已经双发"
		end
	elseif item.kind == "heal" then
		if tank.hp >= tank.maxHp then
			return false, "能量已满"
		end
	else
		return false, "没有这种道具"
	end

	if item.kind == "double" then
		tank.armed = 1
		tank.wait = (tank.wait or 0) + 200
		match.log = tank.name .. " 使用了双发，等待 +200"
	else
		local gain = math.floor(tank.maxHp * item.heal + 0.5)
		local before = tank.hp
		tank.hp = math.min(tank.maxHp, tank.hp + gain)
		if item.lockMove == 1 then
			tank.still = 1
		end
		tank.wait = (tank.wait or 0) + 200
		match.log = string.format("%s 使用了%s，能量 +%d，等待 +200", tank.name, item.name, tank.hp - before)
		if item.lockMove == 1 then
			match.log = match.log .. "，这回合不能再移动"
		end
	end
	match.rev = match.rev + 1
	match.spent = (match.spent or 0) + (item.price or 0)
	return true, "ok"
end

-- 公开资料只写了现象，没有每跳伤害和持续回合。
-- 毒箭：打中的人挂 3 跳，每到自己回合掉 20，敌我都算。
-- 毒气弹：落点留下半径等于表上半径的毒云，换风后每点风力平移 12 像素，云里的人到自己回合掉 20，云存在 3 个回合。
-- 紫冻水：打中的人冻住 2 个自己的回合，不能移动，还能开炮。
-- 地雷：落地不炸，谁踩上谁炸，伤害和半径用表上的 320/30。叠在同一点的两颗会各炸一次。
local POISON_DMG = 20
local POISON_LEFT = 3
local FREEZE_LEFT = 2
local CLOUD_LEFT = 3
local CLOUD_DRIFT = 12

local function join_names(marked)
	local names = {}
	for name in pairs(marked) do
		names[#names + 1] = name
	end
	table.sort(names)
	return table.concat(names, "、")
end

local function in_reach(tank, cx, cy, radius)
	if not tank or tank.alive ~= 1 then
		return false
	end
	local tx = tank.x + C.tankW / 2
	local ty = tank.y + C.tankH / 2
	local dx = tx - cx
	local dy = ty - cy
	local reach = radius + C.hitPad
	return dx * dx + dy * dy <= reach * reach
end

local function in_cloud(tank, cloud)
	if not tank or tank.alive ~= 1 then
		return false
	end
	local tx = tank.x + C.tankW / 2
	local ty = tank.y + C.tankH / 2
	local dx = tx - cloud.x
	local dy = ty - cloud.y
	local r = cloud.r or 0
	return dx * dx + dy * dy <= r * r
end

local function overlaps_mine(tank, mine)
	if not tank or tank.alive ~= 1 or mine.gone then
		return false
	end
	local feet = tank.y + C.tankH
	if math.abs(feet - (mine.y + 6)) > 10 then
		return false
	end
	return tank.x < mine.x + 12 and tank.x + C.tankW > mine.x - 12
end

local function detonate_mine(match, mine, trigger)
	mine.gone = true
	local dmg = mine.damage or 320
	local radius = mine.radius or 30
	M.apply_blast(match.terrain, mine.x, mine.y, radius, "dig", match.mask)
	for i = 0, 7 do
		if match.seats[i] then
			hurt(match.seats[i], mine.x, mine.y, radius, dmg)
		end
	end
	if trigger and trigger.alive == 1 then
		blast_boxes(match, trigger, mine.x, mine.y, radius)
	end
	local who = trigger and trigger.name or "坦克"
	match.mine_note = (match.mine_note or "") .. string.format("，%s 踩中地雷", who)
end

local function settle_ground(match)
	match.mines = match.mines or {}
	for _ = 1, 8 do
		local boom = false
		for _, mine in ipairs(match.mines) do
			if not mine.gone then
				local ground = M.surface_at(match.terrain, mine.x, match.mask)
				if ground >= C.worldH - 2 then
					mine.gone = true
				else
					mine.y = ground - 6
				end
			end
		end
		for seat = 0, 7 do
			local tank = match.seats[seat]
			if tank then
				for _, mine in ipairs(match.mines) do
					if overlaps_mine(tank, mine) then
						detonate_mine(match, mine, tank)
						boom = true
						break
					end
				end
			end
			if boom then
				break
			end
		end
		if not boom then
			break
		end
		for i = 0, 7 do
			if match.seats[i] then
				M.place(match.seats[i], match.terrain, true, match.mask)
			end
		end
		collect_standing(match)
	end
	local left = {}
	for _, mine in ipairs(match.mines) do
		if not mine.gone then
			left[#left + 1] = mine
		end
	end
	match.mines = left
end

local function drift_clouds(match)
	for _, cloud in ipairs(match.clouds or {}) do
		local x = cloud.x + (match.wind or 0) * CLOUD_DRIFT
		if x < 16 then
			x = 16
		end
		if x > C.worldW - 16 then
			x = C.worldW - 16
		end
		cloud.x = x
	end
end

local function age_clouds(match)
	local left = {}
	for _, cloud in ipairs(match.clouds or {}) do
		cloud.left = (cloud.left or 0) - 1
		if cloud.left > 0 then
			left[#left + 1] = cloud
		end
	end
	match.clouds = left
end

local function tick_actor(match)
	local tank = match.seats[match.turn]
	if not tank or tank.alive ~= 1 then
		return ""
	end
	local bits = {}
	if (tank.poison or 0) > 0 then
		tank.hp = tank.hp - POISON_DMG
		tank.poison = tank.poison - 1
		if tank.hp <= 0 then
			tank.hp = 0
			tank.alive = 0
			tank.poison = 0
			bits[#bits + 1] = tank.name .. " 中毒身亡"
		else
			local text = string.format("%s 中毒 -%d", tank.name, POISON_DMG)
			if tank.poison <= 0 then
				text = text .. "，毒消了"
			end
			bits[#bits + 1] = text
		end
	end
	if tank.alive == 1 then
		for _, cloud in ipairs(match.clouds or {}) do
			if in_cloud(tank, cloud) then
				tank.hp = tank.hp - POISON_DMG
				if tank.hp <= 0 then
					tank.hp = 0
					tank.alive = 0
					bits[#bits + 1] = tank.name .. " 被毒气毒倒"
				else
					bits[#bits + 1] = tank.name .. " 吸入毒气 -" .. POISON_DMG
				end
				break
			end
		end
	end
	return table.concat(bits, "，")
end

local function refill(match, seat)
	local tank = match.seats[seat]
	if tank then
		tank.fuel = tank.maxFuel or C.moveFuel
	end
end

local function open_turn(match)
	drift_clouds(match)
	local notes = {}
	for _ = 1, 8 do
		local text = tick_actor(match)
		if text ~= "" then
			notes[#notes + 1] = text
		end
		local actor = match.seats[match.turn]
		if actor and actor.alive == 1 then
			break
		end
		local winner = M.judge(match)
		match.winner = winner
		if winner ~= -1 then
			match.phase = "over"
			break
		end
		match.turn = next_actor(match, match.turn)
		refill(match, match.turn)
	end
	local text = table.concat(notes, "，")
	if text ~= "" then
		return "，" .. text
	end
	return ""
end

local function finish_if_dead(match, actor)
	local winner = M.judge(match)
	match.winner = winner
	if winner ~= -1 then
		match.phase = "over"
		match.log = winner_text(match, winner) .. (match.crate_note or "") .. (match.mine_note or "")
		return true
	end
	if actor and actor.alive ~= 1 then
		match.turn = next_actor(match, actor.seat)
		refill(match, match.turn)
		local extra = open_turn(match)
		if match.phase == "over" then
			match.log = winner_text(match, match.winner) .. (match.crate_note or "") .. (match.mine_note or "") .. extra
		else
			match.log = (match.log or "") .. extra
		end
	end
	return match.phase == "over"
end

-- 成功时改写 match，并返回 shots 数组。失败不改状态。
function M.fire(match, seat, angle, power, weaponId, nextWind, thinkSec)
	if match.phase ~= "aim" then
		return false, "对局已结束", nil
	end
	if match.turn ~= seat then
		return false, "还没轮到你", nil
	end
	local tank = match.seats[seat]
	if not tank or tank.alive ~= 1 then
		return false, "这辆坦克已经报废", nil
	end
	local weapon = M.weapon_of(weaponId)
	if not owns_weapon(tank, weapon) then
		return false, "没有这种炮弹", nil
	end
	angle = M.clamp_angle(angle)
	power = M.clamp_power(power)
	local lo, hi = M.angle_window(tank)
	if angle < lo or angle > hi then
		return false, string.format("射界是 %d° 到 %d°", lo, hi), nil
	end

	local damage = shot_damage(tank, weapon)
	local passes = tank.armed == 1 and 2 or 1
	local was_frozen = (tank.frozen or 0) > 0
	match.crate_note = nil

	match.mines = match.mines or {}
	match.clouds = match.clouds or {}
	match.mine_note = nil
	age_clouds(match)
	local shots = {}
	local planted = {}
	local poisoned, frozen = {}, {}
	local gas_made = false
	local kind = weapon.kind == "fill" and "fill" or "dig"
	local effect = weapon.effect
	for _ = 1, passes do
		local traces = {}
		for _, ang in ipairs(shot_angles(angle, weapon)) do
			local a = M.clamp_angle(ang)
			local x0, y0 = M.muzzle(tank, a)
			local tr = M.trace(match.terrain, x0, y0, a, power, match.wind, weapon.speed, match.mask)
			tr.radius = effect == "mine" and 0 or weapon.radius
			tr.weapon = weapon.id
			traces[#traces + 1] = tr
			shots[#shots + 1] = {
				xs = tr.xs,
				ys = tr.ys,
				hitX = tr.hitX,
				hitY = tr.hitY,
				radius = tr.radius,
				hit = tr.hit,
				weapon = weapon.id,
			}
		end
		for n, tr in ipairs(traces) do
			if tr.hit == 1 then
				if effect == "mine" then
					local mine = {
						x = tr.hitX,
						y = M.surface_at(match.terrain, tr.hitX, match.mask) - 6,
						damage = damage,
						radius = weapon.radius,
					}
					match.mines[#match.mines + 1] = mine
					planted[#planted + 1] = { mine = mine, shot = shots[#shots - #traces + n] }
				else
					M.apply_blast(match.terrain, tr.hitX, tr.hitY, weapon.radius, kind, match.mask)
					for i = 0, 7 do
						local other = match.seats[i]
						if other then
							hurt(other, tr.hitX, tr.hitY, weapon.radius, damage)
							if other.alive == 1 and in_reach(other, tr.hitX, tr.hitY, weapon.radius) then
								if effect == "poison" then
									other.poison = POISON_LEFT
									poisoned[other.name] = true
								elseif effect == "freeze" then
									other.frozen = FREEZE_LEFT
									frozen[other.name] = true
								end
							end
						end
					end
					if effect == "gas" then
						gas_made = true
						match.clouds[#match.clouds + 1] = {
							x = tr.hitX,
							y = tr.hitY,
							r = weapon.radius,
							left = CLOUD_LEFT,
						}
					end
					blast_boxes(match, tank, tr.hitX, tr.hitY, weapon.radius)
				end
			end
		end
	end
	for i = 0, 7 do
		if match.seats[i] then
			M.place(match.seats[i], match.terrain, true, match.mask)
		end
	end
	collect_standing(match)
	settle_ground(match)
	for _, item in ipairs(planted) do
		if item.mine.gone then
			item.shot.radius = item.mine.radius
		end
	end
	tank.armed = 0
	tank.still = 0
	if was_frozen then
		tank.frozen = tank.frozen - 1
	end

	local function effect_note()
		local bits = {}
		local poisoned_names = join_names(poisoned)
		if poisoned_names ~= "" then
			bits[#bits + 1] = poisoned_names .. " 中毒"
		end
		local frozen_names = join_names(frozen)
		if frozen_names ~= "" then
			bits[#bits + 1] = frozen_names .. " 被冻住"
		end
		if gas_made then
			bits[#bits + 1] = "放出毒气"
		end
		local stayed = false
		for _, item in ipairs(planted) do
			if not item.mine.gone then
				stayed = true
			end
		end
		if stayed then
			bits[#bits + 1] = "埋下地雷"
		end
		local text = table.concat(bits, "，")
		if text ~= "" then
			text = "，" .. text
		end
		return text .. (match.crate_note or "") .. (match.mine_note or "")
	end

	local winner = M.judge(match)
	match.winner = winner
	match.rev = match.rev + 1
	local think = math.floor(tonumber(thinkSec) or 0)
	if think < 0 then
		think = 0
	end
	if think > C.turnSec then
		think = C.turnSec
	end
	local time_wait = think * C.turnWait
	local time_note = think > 0 and string.format("，出手 %d 秒，等待 +%d", think, time_wait) or ""
	local rage = damage ~= weapon.damage and "（半血加力）" or ""
	local twin = passes == 2 and "（双发）" or ""
	local shot_log = tank.name .. " 发射了" .. weapon.name .. twin .. rage .. effect_note() .. time_note
	if winner ~= -1 then
		match.phase = "over"
		match.log = winner_text(match, winner) .. effect_note() .. time_note
	else
		match.wind = nextWind
		tank.opened = 1
		tank.wait = (tank.wait or 0) + (weapon.slot == 2 and 200 or 100) + time_wait
		local nxt = next_actor(match, seat)
		match.turn = nxt
		refill(match, nxt)
		local extra = open_turn(match)
		if match.phase == "over" then
			match.log = winner_text(match, match.winner) .. effect_note() .. extra
		else
			match.log = shot_log .. extra
		end
	end
	return true, "发射", shots
end

function M.move(match, seat, dir)
	if match.phase ~= "aim" then
		return false, "对局已结束"
	end
	if match.turn ~= seat then
		return false, "还没轮到你"
	end
	dir = tonumber(dir) or 0
	if dir ~= -1 and dir ~= 1 then
		return false, "方向不对"
	end
	local tank = match.seats[seat]
	if tank.alive ~= 1 then
		return false, "这辆坦克已经报废"
	end
	if tank.still == 1 then
		return false, "用了大补，这回合不能再移动"
	end
	if (tank.frozen or 0) > 0 then
		return false, "冻住了，不能移动"
	end
	if tank.fuel < C.moveCost then
		return false, "燃料用完了，请开炮"
	end
	local nx = tank.x + dir * C.moveStep
	if nx < 16 or nx + C.tankW > C.worldW - 16 then
		return false, "到头了，换个方向或开炮"
	end
	local ground = M.surface_at(match.terrain, nx + C.tankW / 2, match.mask)
	if ground >= C.worldH - 2 then
		return false, "前面是坑"
	end
	if match.mask and #match.mask > 0 and body_blocked(match.mask, nx, ground - C.tankH) then
		return false, "前面有土挡着"
	end
	tank.x = nx
	tank.fuel = tank.fuel - C.moveCost
	tank.wait = (tank.wait or 0) + 10
	M.place(tank, match.terrain, true, match.mask)
	match.crate_note = nil
	match.mine_note = nil
	collect_standing(match)
	settle_ground(match)
	match.rev = match.rev + 1
	match.log = tank.name .. " 移动了" .. (match.crate_note or "") .. (match.mine_note or "")
	finish_if_dead(match, tank)
	return true, "ok"
end

function M.expire(match)
	if match.phase ~= "aim" then
		return false
	end
	local seat = match.turn
	local tank = match.seats[seat]
	if not tank or tank.alive ~= 1 then
		return false
	end
	tank.opened = 1
	tank.armed = 0
	tank.still = 0
	tank.wait = (tank.wait or 0) + C.turnSec * C.turnWait
	match.rev = match.rev + 1
	local winner = M.judge(match)
	match.winner = winner
	local note = tank.name .. " 时间到，等待 +" .. (C.turnSec * C.turnWait)
	if winner ~= -1 then
		match.phase = "over"
		match.log = winner_text(match, winner)
		return true
	end
	match.turn = next_actor(match, seat)
	refill(match, match.turn)
	local extra = open_turn(match)
	if match.phase == "over" then
		match.log = winner_text(match, match.winner) .. extra
	else
		match.log = note .. extra
	end
	return true
end

return M

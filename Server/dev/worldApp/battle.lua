--[[
  对局服务。
  房间：建房、选坦克、选地图、准备、房主开始。地图 1 丘陵、2 峡谷。
  人机测试仍走 csJoinBattle：一人时座位 1 是机器人，第二个人进来会换掉机器人。
]]
local skynet = require("skynet")
local cc = require("common.cluster")
local config = require("common.config")
local rules = require("worldApp.rules")
local C = require("constants")
local Items = require("items")

config.load()

local matches = {}
local by_fd = {}
local rooms = {}
local next_id = 1
local next_room = 1001
local MAP_NAME = { [1] = "丘陵", [2] = "峡谷" }

local function push(fd, name, args)
	cc.send("gateApp", "gate", "push", fd, name, args)
end

local function tank_msg(s)
	return {
		seat = s.seat,
		name = s.name,
		x = math.floor(s.x),
		y = math.floor(s.y),
		hp = s.hp,
		maxHp = s.maxHp,
		alive = s.alive,
		fuel = s.fuel,
		bot = s.bot,
		team = s.team or 0,
		body = s.body or 0,
		wait = s.wait or 0,
		armed = s.armed or 0,
		still = s.still or 0,
		poison = s.poison or 0,
		frozen = s.frozen or 0,
	}
end

local function tanks_msg(match)
	local tanks = {}
	for seat = 0, 7 do
		if match.seats[seat] then
			tanks[#tanks + 1] = tank_msg(match.seats[seat])
		end
	end
	return tanks
end

local function crates_msg(match)
	local crates = {}
	for _, box in ipairs(match.boxes or {}) do
		crates[#crates + 1] = { x = math.floor(box.x), y = math.floor(box.y) }
	end
	return crates
end

local function mines_msg(match)
	local mines = {}
	for _, mine in ipairs(match.mines or {}) do
		mines[#mines + 1] = { x = math.floor(mine.x), y = math.floor(mine.y) }
	end
	return mines
end

local function clouds_msg(match)
	local clouds = {}
	for _, cloud in ipairs(match.clouds or {}) do
		clouds[#clouds + 1] = {
			x = math.floor(cloud.x + 0.5),
			y = math.floor(cloud.y + 0.5),
			r = cloud.r or 0,
		}
	end
	return clouds
end

local function clock_left(match)
	if match.phase ~= "aim" or not match.turn_at then
		return 0
	end
	local elapsed = skynet.now() - match.turn_at
	if elapsed < 0 then
		return C.turnSec
	end
	local sec = math.floor(elapsed / 100)
	if sec > C.turnSec then
		sec = C.turnSec
	end
	return C.turnSec - sec
end

local function turn_think(match)
	return C.turnSec - clock_left(match)
end

local function state_msg(match, you)
	return {
		rev = match.rev,
		matchId = match.id,
		you = you,
		wind = match.wind,
		turn = match.turn,
		winner = match.winner,
		phase = match.phase,
		log = match.log,
		terrain = match.terrain,
		tanks = tanks_msg(match),
		crates = crates_msg(match),
		mines = mines_msg(match),
		clouds = clouds_msg(match),
		clock = clock_left(match),
	}
end

local function broadcast_state(match)
	if match.room then
		for seat = 0, 7 do
			local m = match.room.members[seat]
			if m and m.fd then
				push(m.fd, "scState", state_msg(match, seat))
			end
		end
		return
	end
	for seat = 0, 1 do
		local s = match.seats[seat]
		if s and s.fd then
			push(s.fd, "scState", state_msg(match, seat))
		end
	end
end

local function broadcast_resolve(match, shots)
	if match.room then
		for seat = 0, 7 do
			local m = match.room.members[seat]
			if m and m.fd then
				push(m.fd, "scResolve", { shots = shots, state = state_msg(match, seat) })
			end
		end
		return
	end
	for seat = 0, 1 do
		local s = match.seats[seat]
		if s and s.fd then
			push(s.fd, "scResolve", { shots = shots, state = state_msg(match, seat) })
		end
	end
end

local function human_count(match)
	local n = 0
	for seat = 0, 7 do
		local s = match.seats[seat]
		if s and s.fd then
			n = n + 1
		end
	end
	return n
end

local function roll_wind()
	return math.random(-C.windMax, C.windMax)
end

local function find_open()
	for _, match in pairs(matches) do
		if match.phase == "aim" and match.seats[1] and match.seats[1].bot == 1 then
			return match
		end
	end
	return nil
end

local function spawn_tank(seat, fd, uid, name, bot, terrain, team, x, bodyId)
	if team == nil then
		team = seat == 0 and 0 or 1
	end
	if not x then
		x = team == 0 and 96 or (C.worldW - 96 - C.tankW)
	end
	local tank = {
		seat = seat,
		fd = fd,
		uid = uid or 0,
		name = name,
		bot = bot,
		team = team,
		x = x,
		y = 0,
		alive = 1,
	}
	rules.apply_body(tank, bodyId)
	rules.place(tank, terrain, false)
	if bot == 1 then
		-- 与本地双人的随身数量相同，不花 CRING，也不计入胜场花费。
		tank.kit = { [1] = 3, [2] = 2, [3] = 1 }
	end
	return tank
end

local schedule_bot
local payout
local bot_act
local arm_bot
local note_turn
local TURN_CS = C.turnSec * 100

-- 中心距小于这个值就后退，大于那个值就靠近。中间只在落点明显偏了时换一侧。
local BOT_CLOSE = 260
local BOT_FAR = 460
local BOT_POWERS = { 350, 550, 750, 950 }

local function bot_turn(match)
	if match.phase ~= "aim" then
		return nil
	end
	local me = match.seats[match.turn]
	if me and me.bot == 1 and me.alive == 1 then
		return me
	end
	return nil
end

local function living_foe(match, me)
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank and tank.alive == 1 and tank.seat ~= me.seat then
			return tank
		end
	end
	return nil
end

local function aim_angles(angle, weapon)
	local n = weapon.count or 1
	local spread = weapon.spread or 0
	if n == 2 then
		return { angle - spread, angle + spread }
	end
	if n >= 3 then
		return { angle - spread, angle, angle + spread }
	end
	return { angle }
end

local function best_shot(match, tank, weapon, wind)
	local lo, hi = rules.angle_window(tank)
	local foe = living_foe(match, tank)
	if not foe or not weapon then
		return math.floor((lo + hi) / 2), 650, 1e9
	end
	local fx = foe.x + C.tankW / 2
	local fy = foe.y + C.tankH / 2
	local bestAng, bestPow, bestDist = nil, nil, 1e9
	for ang = lo, hi, 5 do
		for _, pow in ipairs(BOT_POWERS) do
			local miss = 1e9
			for _, aim in ipairs(aim_angles(ang, weapon)) do
				local a = rules.clamp_angle(aim)
				local x0, y0 = rules.muzzle(tank, a)
				local tr = rules.trace(match.terrain, x0, y0, a, pow, wind, weapon.speed or 1)
				if tr.hit == 1 then
					local dx = tr.hitX - fx
					local dy = tr.hitY - fy
					local d = math.sqrt(dx * dx + dy * dy)
					if d < miss then
						miss = d
					end
				end
			end
			if miss < bestDist then
				bestDist = miss
				bestAng = ang
				bestPow = pow
			end
		end
	end
	if not bestAng then
		return math.floor((lo + hi) / 2), 650, bestDist
	end
	return bestAng, bestPow, bestDist
end

local function shot_reaches(weapon, dist)
	return weapon and dist and dist <= (weapon.radius or 0) + C.hitPad
end

-- 这一步能不能落地。返回落地后的 y；坑、悬崖、地雷、没油、冻住都拒绝。
local function step_lands(match, tank, nx, y, fuel)
	if fuel < C.moveCost or tank.still == 1 or (tank.frozen or 0) > 0 then
		return nil
	end
	if nx < 16 or nx + C.tankW > C.worldW - 16 then
		return nil
	end
	local ground = rules.surface_at(match.terrain, nx + C.tankW / 2)
	if ground >= C.worldH - 2 then
		return nil
	end
	local ny = ground - C.tankH
	if ny - y > 36 then
		return nil
	end
	for _, mine in ipairs(match.mines or {}) do
		if not mine.gone then
			local feet = ny + C.tankH
			if math.abs(feet - (mine.y + 6)) <= 10 and nx < mine.x + 12 and nx + C.tankW > mine.x - 12 then
				return nil
			end
		end
	end
	return ny
end

local function walk(match, me, dir, limit, allow)
	local dirs = {}
	local x, y, fuel = me.x, me.y, me.fuel
	for _ = 1, limit do
		local nx = x + dir * C.moveStep
		local ny = step_lands(match, me, nx, y, fuel)
		if not ny then
			break
		end
		if allow and not allow(nx, ny) then
			break
		end
		dirs[#dirs + 1] = dir
		x, y, fuel = nx, ny, fuel - C.moveCost
	end
	return dirs
end

local function bot_plan(match, me)
	local foe = living_foe(match, me)
	local body = rules.body_of(me.body)
	local weapon = body and body.weapons[1]
	if not foe or not weapon then
		return {}
	end
	if me.still == 1 or (me.frozen or 0) > 0 or me.fuel < C.moveCost then
		return {}
	end
	local foe_c = foe.x + C.tankW / 2
	local function gap(x)
		return math.abs(foe_c - (x + C.tankW / 2))
	end
	local dist = gap(me.x)
	local toward = foe_c >= me.x + C.tankW / 2 and 1 or -1

	if dist < BOT_CLOSE then
		return walk(match, me, -toward, 4, function(nx)
			return gap(nx) < BOT_CLOSE + C.moveStep
		end)
	end
	if dist > BOT_FAR then
		return walk(match, me, toward, 3, function(nx)
			return gap(nx) >= BOT_CLOSE
		end)
	end
	local _, _, here = best_shot(match, me, weapon, match.wind)
	local function miss_at(x, y)
		local ghost = { x = x, y = y, body = me.body, team = me.team, seat = me.seat }
		local _, _, d = best_shot(match, ghost, weapon, match.wind)
		return d
	end
	if here <= 70 then
		return {}
	end
	local function peek(dir)
		local nx = me.x + dir * C.moveStep
		local ny = step_lands(match, me, nx, me.y, me.fuel)
		if not ny then
			return 1e9
		end
		return miss_at(nx, ny)
	end
	local left, right = peek(-1), peek(1)
	local dir = left <= right and -1 or 1
	local miss = dir == -1 and left or right
	if miss >= here - 20 then
		return {}
	end
	return walk(match, me, dir, 2, function(nx)
		return gap(nx) >= BOT_CLOSE - C.moveStep and gap(nx) <= BOT_FAR + C.moveStep
	end)
end

local function bot_weapon(match, me, body)
	local w1 = body.weapons[1]
	local w2 = body.weapons[2]
	local a1, p1, d1
	if w1 then
		a1, p1, d1 = best_shot(match, me, w1, match.wind)
		if shot_reaches(w1, d1) then
			return { weapon = w1, ang = a1, pow = p1, reached = true }
		end
	end
	local a2, p2, d2
	if w2 then
		a2, p2, d2 = best_shot(match, me, w2, match.wind)
		if shot_reaches(w2, d2) then
			return { weapon = w2, ang = a2, pow = p2, reached = true }
		end
	end
	local options = {}
	if w1 then
		options[#options + 1] = { weapon = w1, ang = a1, pow = p1, reached = false }
	end
	if w2 then
		options[#options + 1] = { weapon = w2, ang = a2, pow = p2, reached = false }
	end
	if #options == 0 then
		return nil
	end
	return options[math.random(#options)]
end

local function jitter_aim(me, ang, pow)
	local lo, hi = rules.angle_window(me)
	ang = ang + math.random(-4, 4)
	if ang < lo then
		ang = lo
	end
	if ang > hi then
		ang = hi
	end
	pow = pow + math.random(-50, 50)
	return rules.clamp_angle(ang), rules.clamp_power(pow)
end

-- 机器人的道具不走数据库。用完把胜场花费改回去，避免免费道具抬高奖金。
local function bot_use(match, me, itemId)
	local kit = me.kit
	if not kit or (kit[itemId] or 0) < 1 then
		return false
	end
	kit[itemId] = kit[itemId] - 1
	local spent = match.spent
	local ok = rules.use_item(match, me.seat, itemId)
	if not ok then
		kit[itemId] = kit[itemId] + 1
		return false
	end
	match.spent = spent
	return true
end

local function bot_heal(match, me)
	if not me.kit or me.hp >= me.maxHp then
		return false
	end
	local missing = me.maxHp - me.hp
	local big = math.floor(me.maxHp * 0.4 + 0.5)
	local small = math.floor(me.maxHp * 0.2 + 0.5)
	if missing >= big and (me.kit[3] or 0) > 0 then
		return bot_use(match, me, 3)
	end
	if missing >= small and (me.kit[2] or 0) > 0 then
		return bot_use(match, me, 2)
	end
	return false
end

local function bot_fire(match)
	local me = bot_turn(match)
	if not me then
		return
	end
	local body = rules.body_of(me.body)
	if not body then
		return
	end
	local choice = match.bot_choice
	if not choice then
		choice = bot_weapon(match, me, body)
		match.bot_choice = choice
	end
	if not choice then
		return
	end
	if not match.bot_itemed then
		match.bot_itemed = true
		if choice.reached and bot_use(match, me, 1) then
			broadcast_state(match)
			if match.phase ~= "over" and bot_turn(match) then
				match.bot_firing = true
				arm_bot(match, 40, true)
			end
			return
		end
	end
	local ang, pow = jitter_aim(me, choice.ang, choice.pow)
	local ok, _msg, shots = rules.fire(match, me.seat, ang, pow, choice.weapon.id, roll_wind(), turn_think(match))
	match.bot_choice = nil
	match.bot_firing = nil
	if not ok then
		return
	end
	payout(match)
	note_turn(match)
	broadcast_resolve(match, shots)
	schedule_bot(match)
end

arm_bot = function(match, delay, keep)
	if not bot_turn(match) then
		return
	end
	if not keep then
		match.bot_plan = nil
		match.bot_opened = nil
		match.bot_itemed = nil
		match.bot_choice = nil
		match.bot_firing = nil
	end
	match.bot_token = (match.bot_token or 0) + 1
	local token = match.bot_token
	local id = match.id
	skynet.timeout(delay, function()
		local cur = matches[id]
		if not cur or cur.bot_token ~= token then
			return
		end
		bot_act(cur)
	end)
end

bot_act = function(match)
	local me = bot_turn(match)
	if not me then
		return
	end
	if match.bot_firing then
		bot_fire(match)
		return
	end
	if not match.bot_opened then
		match.bot_opened = true
		if bot_heal(match, me) then
			broadcast_state(match)
			if match.phase == "over" or not bot_turn(match) then
				return
			end
			arm_bot(match, 40, true)
			return
		end
	end
	if not match.bot_plan then
		match.bot_plan = bot_plan(match, me)
	end
	local dir = table.remove(match.bot_plan, 1)
	if dir then
		local ok = rules.move(match, me.seat, dir)
		if ok then
			payout(match)
			note_turn(match)
			broadcast_state(match)
			if match.phase == "over" or not bot_turn(match) then
				return
			end
			arm_bot(match, 40, true)
			return
		end
		match.bot_plan = {}
	end
	match.bot_plan = nil
	bot_fire(match)
end

schedule_bot = function(match)
	arm_bot(match, 150, false)
end

local function create_match(fd, uid, name, bodyId, botBody)
	local id = next_id
	next_id = next_id + 1
	local seed = os.time() + id * 17
	local terrain = rules.build_terrain(seed)
	local match = {
		id = id,
		rev = 1,
		wind = roll_wind(),
		turn = 0,
		winner = -1,
		phase = "aim",
		log = name .. " 先手",
		terrain = terrain,
		seats = {},
		bot_token = 0,
		boxes = rules.place_boxes(terrain),
		mines = {},
		clouds = {},
		spent = 0,
	}
	match.seats[0] = spawn_tank(0, fd, uid, name, 0, terrain, nil, nil, bodyId)
	match.seats[1] = spawn_tank(1, nil, 0, "BOT", 1, terrain, nil, nil, botBody)
	matches[id] = match
	by_fd[fd] = { id = id, seat = 0 }
	return match
end

local function detach(fd)
	local link = by_fd[fd]
	if not link then
		return
	end
	by_fd[fd] = nil
	local match = matches[link.id]
	if not match then
		return
	end
	local seat = match.seats[link.seat]
	if seat and seat.fd == fd then
		seat.fd = nil
	end
	if human_count(match) == 0 then
		matches[match.id] = nil
	end
end

local TEAM_NAME = { [0] = "红方", [1] = "蓝方", [2] = "观战" }
local SIDE_MAX = 4

local function room_members_msg(room)
	local members = {}
	for seat = 0, 7 do
		local m = room.members[seat]
		if m then
			members[#members + 1] = {
				seat = seat,
				name = m.name,
				ready = m.ready,
				host = m.host or 0,
				team = m.team or 0,
				body = m.body or 4,
			}
		end
	end
	return members
end

local function room_msg(room, you)
	return {
		roomId = room.id,
		mapId = room.mapId,
		phase = room.phase,
		you = you,
		log = room.log or "",
		members = room_members_msg(room),
	}
end

local publish_room
local publish_gone

local function broadcast_room(room)
	for seat = 0, 7 do
		local m = room.members[seat]
		if m and m.fd then
			push(m.fd, "scRoom", room_msg(room, seat))
		end
	end
	publish_room(room)
end

local function side_count(room, team)
	local n = 0
	for seat = 0, 7 do
		local m = room.members[seat]
		if m and m.team == team then
			n = n + 1
		end
	end
	return n
end

local function clear_ready(room)
	for seat = 0, 7 do
		local m = room.members[seat]
		if m then
			m.ready = 0
		end
	end
end

local function empty_seat(room)
	for seat = 0, 7 do
		if not room.members[seat] then
			return seat
		end
	end
	return nil
end

local function pick_team(room)
	local red = side_count(room, 0)
	local blue = side_count(room, 1)
	if red < SIDE_MAX and red <= blue then
		return 0
	end
	if blue < SIDE_MAX then
		return 1
	end
	return 2
end

local function start_block(room)
	local red = side_count(room, 0)
	local blue = side_count(room, 1)
	if red == 0 or blue == 0 then
		return "两边都要有人"
	end
	if red ~= blue then
		return "双方人数必须相同"
	end
	for seat = 0, 7 do
		local m = room.members[seat]
		if m and m.team ~= 2 and m.ready ~= 1 then
			return "还有人没准备"
		end
	end
	return nil
end

local function begin_room_match(room)
	local terrain = rules.build_terrain(room.id * 17, room.mapId)
	local match = {
		id = room.id,
		rev = 1,
		wind = roll_wind(),
		turn = 0,
		winner = -1,
		phase = "aim",
		log = "",
		terrain = terrain,
		seats = {},
		bot_token = 0,
		room = room,
		boxes = rules.place_boxes(terrain),
		mines = {},
		clouds = {},
		spent = 0,
	}
	local used = { [0] = 0, [1] = 0 }
	local first
	for seat = 0, 7 do
		local m = room.members[seat]
		if m and m.team ~= 2 then
			local index = used[m.team]
			used[m.team] = index + 1
			local x = m.team == 0 and (64 + index * 72) or (C.worldW - 64 - C.tankW - index * 72)
			match.seats[seat] = spawn_tank(seat, m.fd, m.uid, m.name, 0, terrain, m.team, x, m.body)
			if not first then
				first = seat
			end
		end
	end
	match.turn = first or 0
	match.log = match.seats[match.turn].name .. " 先手"
	room.match = match
	room.phase = "play"
	room.log = "对局开始"
	matches[room.id] = match
	note_turn(match)
	broadcast_state(match)
	broadcast_room(room)
end

local function finish_room(match)
	local room = match.room
	if not room or room.phase == "over" then
		return
	end
	if match.phase ~= "over" then
		return
	end
	room.phase = "over"
	room.log = match.log
	broadcast_room(room)
end

local function arm_clock(match)
	match.clock_token = (match.clock_token or 0) + 1
	match.clock_seat = match.turn
	match.turn_at = skynet.now()
	local token = match.clock_token
	local id = match.id
	local seat = match.turn
	skynet.timeout(TURN_CS, function()
		local cur = matches[id]
		if not cur or cur.clock_token ~= token or cur.phase ~= "aim" or cur.turn ~= seat then
			return
		end
		local actor = cur.seats[seat]
		if actor and actor.bot == 1 then
			cur.bot_token = (cur.bot_token or 0) + 1
		end
		rules.expire(cur)
		payout(cur)
		finish_room(cur)
		note_turn(cur)
		broadcast_state(cur)
		if not cur.room then
			schedule_bot(cur)
		end
	end)
end

note_turn = function(match)
	if match.phase ~= "aim" then
		match.clock_token = (match.clock_token or 0) + 1
		match.clock_seat = nil
		match.turn_at = nil
		return
	end
	if match.clock_seat == match.turn and match.turn_at then
		return
	end
	arm_clock(match)
end

local function push_bag(fd, uid)
	uid = math.floor(tonumber(uid) or 0)
	if not fd or uid <= 0 then
		return nil
	end
	local ok, bag = pcall(cc.call, "dbApp", "dbagent", "bag", uid)
	if not ok or type(bag) ~= "table" or bag.ok ~= 1 then
		return nil
	end
	push(fd, "scBag", {
		cring = bag.cring or 0,
		stock = bag.stock or {},
		loadout = bag.loadout or {},
	})
	return bag
end

function payout(match)
	if match.paid or match.phase ~= "over" then
		return
	end
	match.paid = true
	local winner = match.winner
	if winner ~= 0 and winner ~= 1 then
		return
	end
	local fighters, side = 0, 0
	local winners = {}
	for seat = 0, 7 do
		local tank = match.seats[seat]
		if tank then
			fighters = fighters + 1
			if (tank.team or seat) == winner then
				side = side + 1
				if (tank.uid or 0) > 0 then
					winners[#winners + 1] = tank
				end
			end
		end
	end
	if side == 0 or #winners == 0 then
		return
	end
	local each = math.floor(((match.spent or 0) / 2 + fighters * 10000) / side)
	if each <= 0 then
		return
	end
	local paid = 0
	for _, tank in ipairs(winners) do
		local ok, bag = pcall(cc.call, "dbApp", "dbagent", "reward", tank.uid, each)
		if ok and type(bag) == "table" and bag.ok == 1 then
			paid = paid + 1
			if tank.fd then
				push(tank.fd, "scBag", {
					cring = bag.cring or 0,
					stock = bag.stock or {},
					loadout = bag.loadout or {},
				})
			end
		end
	end
	if paid > 0 then
		match.log = (match.log or "") .. "，胜方每人 " .. each .. " CRING"
	end
end

local function create_room(fd, acc, uid)
	if by_fd[fd] and by_fd[fd].room then
		return { ok = 0, roomId = 0, msg = "已经在房间里" }
	end
	if by_fd[fd] then
		detach(fd)
	end
	local name = acc
	if not name or name == "" then
		name = "炮手"
	end
	local id = next_room
	next_room = next_room + 1
	local room = {
		id = id,
		mapId = 1,
		phase = "lobby",
		log = "等待对手进入",
		members = {},
	}
	room.members[0] = { fd = fd, uid = uid or 0, name = name, ready = 0, host = 1, team = 0, body = 4 }
	rooms[id] = room
	by_fd[fd] = { room = room, seat = 0 }
	broadcast_room(room)
	push_bag(fd, uid)
	return { ok = 1, roomId = id, msg = "房间已创建" }
end

local function count_room(room)
	local n = 0
	for seat = 0, 7 do
		if room.members[seat] then
			n = n + 1
		end
	end
	return n
end

local function room_brief(room)
	local host = ""
	local ready = 0
	for seat = 0, 7 do
		local m = room.members[seat]
		if m then
			if m.host == 1 then
				host = m.name
			end
			if m.team ~= 2 and m.ready == 1 then
				ready = ready + 1
			end
		end
	end
	return {
		roomId = room.id,
		mapId = room.mapId,
		phase = room.phase,
		count = count_room(room),
		red = side_count(room, 0),
		blue = side_count(room, 1),
		host = host,
		ready = ready,
	}
end

publish_room = function(room)
	cc.send("worldApp", "world", "publish", room_brief(room))
end

publish_gone = function(id)
	cc.send("worldApp", "world", "publish", { roomId = id, gone = 1 })
end

local function leave_room(fd)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	local seat = link.seat
	local member = room.members[seat]
	by_fd[fd] = nil
	if member and member.fd == fd then
		room.members[seat] = nil
	end
	if room.phase == "play" then
		if member and member.team == 2 then
			room.log = member.name .. " 离开观战"
			broadcast_room(room)
			return { ok = 1, msg = "已离开" }
		end
		local match = room.match
		if match and match.phase ~= "over" then
			match.phase = "over"
			match.winner = member and member.team == 0 and 1 or 0
			match.log = "对手离开"
			match.rev = match.rev + 1
			if match.seats[seat] then
				match.seats[seat].fd = nil
			end
			broadcast_state(match)
		end
		room.phase = "over"
		room.log = "对手离开"
		broadcast_room(room)
		return { ok = 1, msg = "已离开" }
	end
	if count_room(room) == 0 then
		local id = room.id
		rooms[id] = nil
		matches[id] = nil
		publish_gone(id)
		return { ok = 1, msg = "已离开" }
	end
	clear_ready(room)
	if member and member.host == 1 then
		for s = 0, 7 do
			local m = room.members[s]
			if m then
				m.host = 1
				room.log = "房主离开，" .. m.name .. " 成为房主"
				broadcast_room(room)
				return { ok = 1, msg = "已离开" }
			end
		end
	end
	room.log = (member and member.name or "对手") .. " 离开了"
	broadcast_room(room)
	return { ok = 1, msg = "已离开" }
end

local function join_room(fd, acc, roomId, uid)
	roomId = math.floor(tonumber(roomId) or 0)
	local room = rooms[roomId]
	if not room then
		return { ok = 0, roomId = 0, msg = "房间不存在" }
	end
	if room.phase ~= "lobby" then
		return { ok = 0, roomId = roomId, msg = "对局已经开始" }
	end
	for seat = 0, 7 do
		local m = room.members[seat]
		if m and m.fd == fd then
			broadcast_room(room)
			push_bag(fd, uid)
			return { ok = 1, roomId = roomId, msg = "已在房间中" }
		end
	end
	local seat = empty_seat(room)
	if not seat then
		return { ok = 0, roomId = roomId, msg = "房间已满" }
	end
	local name = acc
	if not name or name == "" then
		name = "炮手"
	end
	local link = by_fd[fd]
	if link and link.room then
		leave_room(fd)
	elseif link then
		detach(fd)
	end
	local team = pick_team(room)
	room.members[seat] = { fd = fd, uid = uid or 0, name = name, ready = 0, host = 0, team = team, body = 4 }
	by_fd[fd] = { room = room, seat = seat }
	clear_ready(room)
	room.log = name .. " 进入" .. TEAM_NAME[team]
	broadcast_room(room)
	push_bag(fd, uid)
	return { ok = 1, roomId = roomId, msg = "已加入房间" }
end

local function select_map(fd, mapId)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	local member = room.members[link.seat]
	if not member or member.host ~= 1 then
		return { ok = 0, msg = "只有房主可以换地图" }
	end
	if room.phase ~= "lobby" then
		return { ok = 0, msg = "对局中不能换地图" }
	end
	mapId = math.floor(tonumber(mapId) or 0)
	if not MAP_NAME[mapId] then
		return { ok = 0, msg = "没有这张地图" }
	end
	room.mapId = mapId
	clear_ready(room)
	room.log = "地图换成「" .. MAP_NAME[mapId] .. "」"
	broadcast_room(room)
	return { ok = 1, msg = room.log }
end

local function select_team(fd, team)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	if room.phase ~= "lobby" then
		return { ok = 0, msg = "对局中不能换队" }
	end
	team = math.floor(tonumber(team) or -1)
	if not TEAM_NAME[team] then
		return { ok = 0, msg = "没有这支队伍" }
	end
	local member = room.members[link.seat]
	if not member or member.fd ~= fd then
		return { ok = 0, msg = "不在房间" }
	end
	if member.team == team then
		return { ok = 1, msg = "已在" .. TEAM_NAME[team] }
	end
	if team ~= 2 and side_count(room, team) >= SIDE_MAX then
		return { ok = 0, msg = "这一方已经满了" }
	end
	member.team = team
	clear_ready(room)
	room.log = member.name .. " 换到" .. TEAM_NAME[team]
	broadcast_room(room)
	return { ok = 1, msg = room.log }
end

local function select_body(fd, bodyId)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	if room.phase ~= "lobby" then
		return { ok = 0, msg = "对局中不能换坦克" }
	end
	local member = room.members[link.seat]
	if not member or member.fd ~= fd then
		return { ok = 0, msg = "不在房间" }
	end
	bodyId = math.floor(tonumber(bodyId) or 0)
	local body = rules.body_of(bodyId)
	if not body then
		return { ok = 0, msg = "没有这种坦克" }
	end
	if member.body == bodyId then
		return { ok = 1, msg = "已是" .. body.name }
	end
	member.body = bodyId
	clear_ready(room)
	room.log = member.name .. " 换成" .. body.name
	broadcast_room(room)
	return { ok = 1, msg = room.log }
end

local function set_ready(fd, ready)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	if room.phase ~= "lobby" then
		return { ok = 0, msg = "现在不能准备" }
	end
	local member = room.members[link.seat]
	if not member or member.fd ~= fd then
		return { ok = 0, msg = "不在房间" }
	end
	if member.team == 2 then
		return { ok = 0, msg = "观战不用准备" }
	end
	member.ready = tonumber(ready) == 1 and 1 or 0
	room.log = member.name .. (member.ready == 1 and " 已准备" or " 取消准备")
	broadcast_room(room)
	return { ok = 1, msg = room.log }
end

local function start_game(fd)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	local member = room.members[link.seat]
	if not member or member.host ~= 1 then
		return { ok = 0, msg = "只有房主可以开始" }
	end
	if room.phase ~= "lobby" then
		return { ok = 0, msg = "对局已经开始" }
	end
	local block = start_block(room)
	if block then
		return { ok = 0, msg = block }
	end
	begin_room_match(room)
	return { ok = 1, msg = "对局开始" }
end

local function return_room(fd)
	local link = by_fd[fd]
	if not link or not link.room then
		return { ok = 0, msg = "不在房间" }
	end
	local room = link.room
	if room.phase == "lobby" then
		broadcast_room(room)
		return { ok = 1, msg = room.log }
	end
	if room.phase ~= "over" then
		return { ok = 0, msg = "对局还没结束" }
	end
	room.phase = "lobby"
	room.match = nil
	matches[room.id] = nil
	clear_ready(room)
	room.log = "回到房间，请重新准备"
	broadcast_room(room)
	return { ok = 1, msg = room.log }
end

local function shop_call(fd, uid, cmd, ...)
	uid = math.floor(tonumber(uid) or 0)
	if uid <= 0 then
		return { ok = 0, msg = "请先登录" }
	end
	local ok, bag = pcall(cc.call, "dbApp", "dbagent", cmd, uid, ...)
	if not ok or type(bag) ~= "table" then
		return { ok = 0, msg = "数据库不可用" }
	end
	if bag.ok == 1 then
		push(fd, "scBag", {
			cring = bag.cring or 0,
			stock = bag.stock or {},
			loadout = bag.loadout or {},
		})
	end
	return bag
end

local function loadout_item(bag, slot)
	for _, row in ipairs(bag.loadout or {}) do
		if row.slot == slot then
			return row.item or 0, row.qty or 0
		end
	end
	return 0, 0
end

local function buy_item(fd, uid, itemId)
	local link = by_fd[fd]
	if not link or not link.room or link.room.phase ~= "lobby" then
		return { ok = 0, msg = "只能在房间里购买" }
	end
	local item = Items[math.floor(tonumber(itemId) or 0)]
	if not item then
		return { ok = 0, msg = "没有这种道具" }
	end
	local bag = shop_call(fd, uid, "buy", item.id, item.price)
	if bag.ok ~= 1 then
		return { ok = 0, msg = bag.msg or "购买失败" }
	end
	return { ok = 1, msg = "买入 " .. item.name }
end

local function equip_item(fd, uid, slot, itemId)
	local link = by_fd[fd]
	if not link or not link.room or link.room.phase ~= "lobby" then
		return { ok = 0, msg = "只能在房间里装备" }
	end
	local bag = shop_call(fd, uid, "equip", math.floor(tonumber(slot) or 0), math.floor(tonumber(itemId) or 0))
	if bag.ok ~= 1 then
		return { ok = 0, msg = bag.msg or "装备失败" }
	end
	return { ok = 1, msg = "格子已更新" }
end

local function use_item(fd, uid, slot)
	local link = by_fd[fd]
	if not link then
		return { ok = 0, msg = "尚未加入对局" }
	end
	local match
	if link.room then
		match = link.room.match
		if not match or link.room.phase ~= "play" then
			return { ok = 0, msg = "还没开始" }
		end
	else
		match = matches[link.id]
	end
	if not match then
		return { ok = 0, msg = "对局不存在" }
	end
	slot = math.floor(tonumber(slot) or 0)
	local bag = shop_call(fd, uid, "bag")
	if bag.ok ~= 1 then
		return { ok = 0, msg = bag.msg or "背包不可用" }
	end
	local itemId, qty = loadout_item(bag, slot)
	if itemId <= 0 or qty < 1 then
		return { ok = 0, msg = "这一格是空的" }
	end
	local spent = shop_call(fd, uid, "spend", itemId)
	if spent.ok ~= 1 then
		return { ok = 0, msg = spent.msg or "没有这个道具" }
	end
	local ok, msg = rules.use_item(match, link.seat, itemId)
	if not ok then
		shop_call(fd, uid, "grant", itemId)
		return { ok = 0, msg = msg }
	end
	broadcast_state(match)
	return { ok = 1, msg = msg }
end

local function join(fd, acc, args, uid)
	local name = acc
	if not name or name == "" then
		name = "炮手"
	end
	local link = by_fd[fd]
	if link and link.room then
		leave_room(fd)
	elseif link then
		local current = matches[link.id]
		if current and current.phase == "aim" then
			return { ok = 1, matchId = current.id, you = link.seat, msg = "已在对局中" }
		end
		detach(fd)
	end

	local open = find_open()
	if open then
		local seat = open.seats[1]
		seat.fd = fd
		seat.uid = uid or 0
		seat.bot = 0
		seat.name = name
		by_fd[fd] = { id = open.id, seat = 1 }
		open.bot_token = (open.bot_token or 0) + 1
		open.rev = open.rev + 1
		open.log = name .. " 加入，替换机器人"
		broadcast_state(open)
		schedule_bot(open)
		return { ok = 1, matchId = open.id, you = 1, msg = "加入对局" }
	end

	args = args or {}
	local match = create_match(fd, uid, name, args.body, args.botBody)
	note_turn(match)
	broadcast_state(match)
	push_bag(fd, uid)
	schedule_bot(match)
	return { ok = 1, matchId = match.id, you = 0, msg = "已创建对局" }
end

local function on_disconnect(fd)
	local link = by_fd[fd]
	if not link then
		return
	end
	if link.room then
		leave_room(fd)
		return
	end
	by_fd[fd] = nil
	local match = matches[link.id]
	if not match then
		return
	end
	local seat = match.seats[link.seat]
	if not seat or seat.fd ~= fd then
		return
	end
	seat.fd = nil
	seat.bot = 1
	seat.name = "BOT"
	if human_count(match) == 0 then
		matches[match.id] = nil
		return
	end
	match.rev = match.rev + 1
	match.log = "对手离线，由机器人接手"
	broadcast_state(match)
	schedule_bot(match)
end

local function handle(name, args, fd, acc, uid)
	args = args or {}
	uid = math.floor(tonumber(uid) or 0)
	if name == "csJoinBattle" then
		return join(fd, acc, args, uid)
	end
	if name == "csCreateRoom" then
		return create_room(fd, acc, uid)
	end
	if name == "csJoinRoom" then
		return join_room(fd, acc, args.roomId, uid)
	end
	if name == "csBuy" then
		return buy_item(fd, uid, args.item)
	end
	if name == "csEquip" then
		return equip_item(fd, uid, args.slot, args.item)
	end
	if name == "csUseItem" then
		return use_item(fd, uid, args.slot)
	end
	if name == "csSelectMap" then
		return select_map(fd, args.mapId)
	end
	if name == "csSelectTeam" then
		return select_team(fd, args.team)
	end
	if name == "csSelectBody" then
		return select_body(fd, args.body)
	end
	if name == "csReady" then
		return set_ready(fd, args.ready)
	end
	if name == "csStartGame" then
		return start_game(fd)
	end
	if name == "csReturnRoom" then
		return return_room(fd)
	end
	if name == "csLeaveRoom" then
		return leave_room(fd)
	end
	local link = by_fd[fd]
	if not link then
		return { ok = 0, msg = "尚未加入对局" }
	end
	local match
	if link.room then
		match = link.room.match
		if not match or link.room.phase ~= "play" then
			return { ok = 0, msg = "还没开始" }
		end
	else
		match = matches[link.id]
	end
	if not match then
		if not link.room then
			by_fd[fd] = nil
		end
		return { ok = 0, msg = "对局不存在" }
	end
	if name == "csFire" then
		local wid = math.floor(tonumber(args.weapon) or 1)
		local ok, msg, shots = rules.fire(match, link.seat, args.angle, args.power, wid, roll_wind(), turn_think(match))
		if not ok then
			return { ok = 0, msg = msg }
		end
		payout(match)
		note_turn(match)
		broadcast_resolve(match, shots)
		finish_room(match)
		if not match.room then
			schedule_bot(match)
		end
		return { ok = 1, msg = msg }
	end
	if name == "csMove" then
		local ok, msg = rules.move(match, link.seat, args.dir)
		if not ok then
			return { ok = 0, msg = msg }
		end
		payout(match)
		note_turn(match)
		broadcast_state(match)
		if not match.room then
			schedule_bot(match)
		end
		return { ok = 1, msg = msg }
	end
	return { ok = 0, msg = "未知协议" }
end

skynet.start(function()
	skynet.dispatch("lua", function(_, _, method, ...)
		if method == "handle" then
			local name, args, fd, acc, uid = ...
			local ok, resp = pcall(handle, name, args, fd, acc, uid)
			if not ok then
				skynet.error("[battle] " .. tostring(resp))
				resp = { ok = 0, msg = "结算出错" }
			end
			skynet.ret(skynet.pack(resp))
		elseif method == "disconnect" then
			local fd = ...
			pcall(on_disconnect, fd)
		end
	end)
	skynet.error("[battle] started")
end)

--[[ 旧的四种通用炮弹，只留给弹道对拍。对局里每人用 tanks.lua 里自己的两发。 ]]
return {
	[1] = { id = 1, name = "标准弹", damage = 220, radius = 36, speed = 1, kind = "dig", spread = 0 },
	[2] = { id = 2, name = "重炮", damage = 420, radius = 62, speed = 0.72, kind = "dig", spread = 0 },
	[3] = { id = 3, name = "集束弹", damage = 90, radius = 24, speed = 0.95, kind = "spread", spread = 14 },
	[4] = { id = 4, name = "泥弹", damage = 50, radius = 44, speed = 0.88, kind = "fill", spread = 0 },
}

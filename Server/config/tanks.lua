--[[
  12 种可选手坦克。数字来自公开的《疯狂坦克2》坦克介绍：
  能量、等待、移动距离、发射角，以及武器「破坏力\半径」。
  燃料按移动距离换算，移动 60 对应原来的 220。
  暴龙公开页面没有数值，不在这张表里。
]]
return {
	[1] = {
		id = 1, era = "古代", name = "大碗",
		angleMin = 0, angleMax = 90, hp = 950, delay = 560, move = 50, fuel = 183,
		weapons = {
			{ id = 11, slot = 1, name = "巨石", damage = 350, radius = 45, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 12, slot = 2, name = "火石", damage = 150, radius = 40, speed = 1, kind = "dig", count = 1, spread = 0 },
		},
	},
	[2] = {
		id = 2, era = "古代", name = "叉叉",
		angleMin = 15, angleMax = 80, hp = 940, delay = 570, move = 57, fuel = 209,
		weapons = {
			{ id = 21, slot = 1, name = "穿心箭", damage = 330, radius = 31, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 22, slot = 2, name = "毒箭", damage = 100, radius = 28, speed = 1, kind = "dig", count = 1, spread = 0, effect = "poison" },
		},
	},
	[3] = {
		id = 3, era = "古代", name = "老土",
		angleMin = 25, angleMax = 45, hp = 920, delay = 580, move = 48, fuel = 176,
		weapons = {
			{ id = 31, slot = 1, name = "铅球", damage = 140, radius = 78, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 32, slot = 2, name = "小红豆", damage = 420, radius = 35, speed = 1, kind = "dig", count = 1, spread = 0 },
		},
	},
	[4] = {
		id = 4, era = "近代", name = "甲壳虫",
		angleMin = 0, angleMax = 40, hp = 1000, delay = 560, move = 60, fuel = 220,
		weapons = {
			{ id = 41, slot = 1, name = "骷髅弹", damage = 230, radius = 57, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 42, slot = 2, name = "趴趴弹", damage = 150, radius = 38, speed = 1, kind = "dig", count = 3, spread = 8 },
		},
	},
	[5] = {
		id = 5, era = "近代", name = "公爵",
		angleMin = 0, angleMax = 40, hp = 1000, delay = 560, move = 60, fuel = 220,
		weapons = {
			{ id = 51, slot = 1, name = "弹簧弹", damage = 240, radius = 55, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 52, slot = 2, name = "毒气弹", damage = 153, radius = 43, speed = 1, kind = "dig", count = 1, spread = 0, effect = "gas" },
		},
	},
	[6] = {
		id = 6, era = "近代", name = "雷霆",
		angleMin = 5, angleMax = 40, hp = 1150, delay = 560, move = 56, fuel = 205,
		weapons = {
			{ id = 61, slot = 1, name = "手榴弹", damage = 220, radius = 52, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 62, slot = 2, name = "地雷", damage = 320, radius = 30, speed = 1, kind = "dig", count = 1, spread = 0, effect = "mine" },
		},
	},
	[7] = {
		id = 7, era = "现代", name = "飞火",
		angleMin = 20, angleMax = 45, hp = 1100, delay = 560, move = 57, fuel = 209,
		weapons = {
			{ id = 71, slot = 1, name = "飞火弹", damage = 120, radius = 45, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 72, slot = 2, name = "追魂弹", damage = 90, radius = 32, speed = 1, kind = "dig", count = 1, spread = 0 },
		},
	},
	[8] = {
		id = 8, era = "现代", name = "流星",
		angleMin = 25, angleMax = 50, hp = 1050, delay = 570, move = 55, fuel = 202,
		weapons = {
			{ id = 81, slot = 1, name = "三叉戟", damage = 175, radius = 40, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 82, slot = 2, name = "流星雨", damage = 60, radius = 28, speed = 1, kind = "dig", count = 3, spread = 10 },
		},
	},
	[9] = {
		id = 9, era = "未来", name = "小妖",
		angleMin = 5, angleMax = 36, hp = 990, delay = 540, move = 80, fuel = 293,
		weapons = {
			{ id = 91, slot = 1, name = "单雷炮", damage = 220, radius = 70, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 92, slot = 2, name = "三雷炮", damage = 99, radius = 40, speed = 1, kind = "dig", count = 3, spread = 8 },
		},
	},
	[10] = {
		id = 10, era = "未来", name = "水鬼",
		angleMin = 15, angleMax = 50, hp = 1000, delay = 550, move = 54, fuel = 198,
		weapons = {
			{ id = 101, slot = 1, name = "水水弹", damage = 230, radius = 54, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 102, slot = 2, name = "紫冻水", damage = 190, radius = 43, speed = 1, kind = "dig", count = 1, spread = 0, effect = "freeze" },
		},
	},
	[11] = {
		id = 11, era = "未来", name = "闪灵",
		angleMin = 20, angleMax = 55, hp = 970, delay = 550, move = 70, fuel = 257,
		weapons = {
			{ id = 111, slot = 1, name = "离子弹", damage = 220, radius = 48, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 112, slot = 2, name = "离子光波", damage = 270, radius = 66, speed = 1, kind = "dig", count = 1, spread = 0 },
		},
	},
	[12] = {
		id = 12, era = "未来", name = "海怪", enrage = 1,
		angleMin = 0, angleMax = 40, hp = 985, delay = 530, move = 80, fuel = 293,
		weapons = {
			{ id = 121, slot = 1, name = "大电环", damage = 220, radius = 65, speed = 1, kind = "dig", count = 1, spread = 0 },
			{ id = 122, slot = 2, name = "双发小电环", damage = 166, radius = 42, speed = 1, kind = "dig", count = 2, spread = 6 },
		},
	},
}

--[[
  房间军火库。价格是本项目定的：公开新手指南写了起步 50 万 CRING 和胜场公式，没有货架标价。
  双发、小补、大补的用法按公开攻略：双发当回合打两发；用道具等待 +200；
  小补回得少、还能移动；大补回得多、这回合不能再移动。
  回血比例公开资料没写死，这里小补是最大能量的 20%，大补是 40%。
]]
return {
	[1] = { id = 1, name = "双发", price = 20000, kind = "double", heal = 0, lockMove = 0 },
	[2] = { id = 2, name = "小补", price = 5000, kind = "heal", heal = 0.2, lockMove = 0 },
	[3] = { id = 3, name = "大补", price = 12000, kind = "heal", heal = 0.4, lockMove = 1 },
}

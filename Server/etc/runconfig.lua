--[[
  运行时拓扑。各 App 的 main.lua 通过 require(skynet.getenv("runconfig")) 载入。
  端口避开同机其他工程（MapleStory 5801–5804 / ws 8080，starcraft 8100/8101）。
  fortress 独立端口段：gate ws 8200，cluster 8201-8204。
]]
return {
	TEST = true,
	cluster = {
		gateApp = "127.0.0.1:8201",
		loginApp = "127.0.0.1:8202",
		worldApp = "127.0.0.1:8203",
		dbApp = "127.0.0.1:8204",
	},
	service = {
		gate = { port = 8200 },
	},
}

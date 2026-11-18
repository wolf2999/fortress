--[[
  运行时拓扑。各 App 的 main.lua 通过 require(skynet.getenv("runconfig")) 载入。
  端口避开 MapleStory 工程（那边是 5801–5804 / ws 8080）。
]]
return {
	TEST = true,
	cluster = {
		gateApp = "127.0.0.1:6801",
		loginApp = "127.0.0.1:6802",
		worldApp = "127.0.0.1:6803",
		dbApp = "127.0.0.1:6804",
	},
	service = {
		gate = { port = 8090 },
	},
}

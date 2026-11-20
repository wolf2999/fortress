--[[ 集群地址，与 etc/runconfig.lua 的 cluster 字段保持一致。 ]]
return {
	__nowaiting = true,
	gateApp = "127.0.0.1:8201",
	loginApp = "127.0.0.1:8202",
	worldApp = "127.0.0.1:8203",
	dbApp = "127.0.0.1:8204",
}

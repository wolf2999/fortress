--[[ 集群地址，与 etc/runconfig.lua 的 cluster 字段保持一致。 ]]
return {
	__nowaiting = true,
	gateApp = "127.0.0.1:6801",
	loginApp = "127.0.0.1:6802",
	worldApp = "127.0.0.1:6803",
	dbApp = "127.0.0.1:6804",
}

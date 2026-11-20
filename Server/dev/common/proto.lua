--[[ 读取仓库根 Protocol/*.sproto，拼成一套 schema。
  本地开发 cwd 是 Server/（../Protocol）；远程发布 cwd 是发布根目录（Protocol/）。 ]]
local sprotoparser = require("sprotoparser")
local sproto = require("sproto")

local CANDIDATE_DIRS = { "./../Protocol/", "./Protocol/" }
local PROTO_FILES = { "gateway.sproto", "battle.sproto" }

local PROTO_DIR
for _, dir in ipairs(CANDIDATE_DIRS) do
	local f = io.open(dir .. PROTO_FILES[1], "rb")
	if f then
		f:close()
		PROTO_DIR = dir
		break
	end
end
if not PROTO_DIR then
	error("[proto] protocol dir not found (tried " .. table.concat(CANDIDATE_DIRS, " , ") .. ")")
end

local chunks = {}
for _, fname in ipairs(PROTO_FILES) do
	local f = io.open(PROTO_DIR .. fname, "rb")
	if not f then
		error("[proto] protocol file not found: " .. PROTO_DIR .. fname)
	end
	chunks[#chunks + 1] = f:read("*a")
	f:close()
end

local schemaText = table.concat(chunks, "\n")
local sp = sproto.new(sprotoparser.parse(schemaText))

local hasResponse = {}
for name, _tag, body in schemaText:gmatch("(%w+)%s+(%d+)%s*{([^}]*)}") do
	if body:match("response%s+%w+") then
		hasResponse[name] = true
	end
end

local M = {}
M.sp = sp
M.host = sp:host("package")
M.sender = M.host:attach(sp)
M.hasResponse = hasResponse
return M

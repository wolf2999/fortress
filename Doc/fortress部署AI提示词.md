# F:\fortress 部署 AI 提示词

> 用法：把下面整段提示词粘贴到 F:\fortress 项目的 AI 会话中执行。所有环境事实都已在 starcraft 项目部署时验证过，直接照做即可，不要重新踩坑。

---

## 任务

把本仓库（F:\fortress）部署到生产环境：
1. **Server/（skynet 框架，C+Lua）→ 远程 Mac mini 编译并运行**
2. **Client/ → Cloudflare Workers 静态托管**

## 一、远程环境事实（已验证，勿重复探测踩坑）

- **主机**：Mac mini `10.10.100.85`，SSH 端口 22，用户 `123`（这是别名，**真实 home 是 `/Users/a123`**），密码 `123456`
- **关键坑**：Windows 下 `ssh.exe` 非交互执行会卡死在密码输入（表现为命令超时）。**必须用 node 的 `ssh2` 库直连**——参考 `F:\starcraft\server\deploy.mjs` 里的 `run()`（远程执行）/`uploadDir()`（SFTP 上传）/`mkdirp()` 封装和 `deploy.config.json` 的结构，可直接复制改造
- **远程已有设施**（不要动）：
  - MySQL 8.0.37：`/Users/a123/mysql8`，监听 `127.0.0.1:3306`，root/123456；已配 LaunchDaemon（`/Library/LaunchDaemons/com.starcraft.mysql.plist`）开机自启+崩溃自动拉起
  - starcraft-server：占用 **8100/8101** 端口，目录 `/Users/a123/apps/starcraft-server`——fortress 必须用**独立端口段（建议 8200 起）**、独立目录、独立数据库，互不干扰
  - cloudflared 2026.11.1 已安装
- **多项目目录约定**：统一放 `/Users/a123/apps/<project>/`，每个项目独立目录、独立 MySQL database。**新建发布目录前要先询问我确认**
- **远程 shell 是 zsh**；brew 已装但版本旧（formula API 不兼容），**不要依赖 brew 装新东西**；编译用系统 clang/make
- 远程执行 `lsof` 要用全路径 `/usr/sbin/lsof`

## 二、Server（skynet）部署要求

1. **编译在 Mac 上做**（skynet 无 macos 预编译包）：
   - 先探针检查远程工具链：`clang --version`、`make --version`、`xcode-select -p`；缺 Command Line Tools 先解决（`xcode-select --install` 会弹 GUI 确认，让用户操作；或官方 CLT dmg 直装，参照 starcraft 装 MySQL 的 tarball 模式写 ssh2 脚本）
   - skynet 编译：`make PLAT=macos`（按本仓库 Makefile 约定调整）；若缺 readline/openssl 等依赖，优先源码/官方包直装而非 brew
2. **写 deploy 脚本**：在 `Server/` 下新建 `deploy.mjs` + `deploy.config.json`（结构照抄 F:\starcraft\server\ 的，字段按 skynet 调整）：
   - 流程：本地打包上传源码（排除 .git/编译产物）→ 远程 `make`（支持增量）→ `pkill -f '<精确的 skynet 进程匹配串>'` → `nohup ./skynet <配置> > server.log 2>&1 &` → 校验端口监听
   - `pkill -f` 匹配串必须能唯一命中 fortress 的 skynet（**不能误杀 starcraft-server 的 node 进程**）
   - 支持 `--auto` 无人值守模式；新建目录前询问
3. **数据库**：为 fortress 建独立库（如 `CREATE DATABASE fortress;`，root 账号复用），skynet 的 mysql 服务连 `127.0.0.1:3306`；**先检查本仓库服务端配置里数据库名/账号的定义位置再改**
4. **日志与运维 IDE 任务**（参照 `F:\starcraft\.vscode\tasks.json` 与 `F:\starcraft\server\test\remote_status.mjs`/`remote_log.mjs` 的 node 脚本模式，不要用 ssh.exe 命令行）：加「远程服务器状态」「远程服务器日志(实时)」「数据库隧道」任务
5. 可选（做完基础部署后问我）：skynet 进程的 LaunchDaemon 开机自启（参照 com.starcraft.mysql.plist 的 KeepAlive 模式）

## 三、Client → Cloudflare Workers 要求

1. 参照 `F:\starcraft` 根目录的 `wrangler.jsonc`：**纯静态 assets 模式**（`assets.directory` + SPA 回退 `not_found_handling: "single-page-application"`，无 Worker 脚本）
2. 确认 Client 构建产物目录与构建命令；`wrangler deploy` 前先本地跑通 `npm run build`
3. **仓库外依赖必须内联**：若 package.json 有 `file:../xxx` 指向仓库外的依赖，复制进 `vendor/` 并改依赖路径（否则 Cloudflare 构建必失败；且 vendor 里的子包要删掉 `prepare` 等会触发构建的脚本）
4. `.gitignore` 检查：`dist` 写法要锚定根目录（`/dist`），别误伤子目录里的构建产物
5. Cloudflare 控制台由我操作的部分，提前告诉我清单：
   - 新建 Workers 项目（名字建议 fortress）
   - Build command = 项目构建命令；Deploy command = `npx wrangler deploy`；**Preview command 清空**（wrangler v4 已废弃）
   - 纯静态 Worker 的 Settings→Runtime variables 是灰的（"Variables cannot be added to a Worker that only has static assets"）——**这是正常的**，后端地址要配在 **Builds→Variables and secrets（构建期变量）**，等 server 有公网入口后再配
6. 注意：Mac 上之前的 cloudflared 快速隧道（trycloudflare.com）地址不固定；fortress 若需要公网入口，正式方案是接入我自己的域名走命名 Tunnel，届时先问我

## 四、验收清单（全部打勾才算完成）

- [ ] ssh2 探针连上 10.10.100.85（node 脚本，非 ssh.exe）
- [ ] `/Users/a123/apps/` 下 fortress 发布目录建立（建前询问过我确认目录名/端口/库名）
- [ ] 远程 skynet 编译成功，进程运行，端口监听（独立端口段）
- [ ] fortress 独立 MySQL 库存在且服务端能连
- [ ] `deploy.mjs` 一条命令可重复发布（重复跑不残留旧进程/旧文件）
- [ ] IDE 运维任务可用：远程状态、实时日志
- [ ] Cloudflare Workers 构建成功，`*.workers.dev` 页面可访问
- [ ] starcraft 的设施零影响（8100/8101 仍监听、starcraft 库未动）

## 五、提交纪律

- `deploy.config.json` 含密码，**必须加入 .gitignore**，另提交 `deploy.config.example.json` 模板
- 一次性探针/安装脚本用完删除，不要留在仓库里

---

*此提示词由 starcraft 项目部署经验整理（2026-11-20），环境事实均经实测。*

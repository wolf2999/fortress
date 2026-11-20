/**
 * fortress-server 远程发布脚本（ssh2 直连，无额外依赖）。
 *
 * 与 node 版工程不同，本工程服务端是 skynet（C+Lua），流程为：
 *   本地上传 skynet 源码 → 远程 make macosx（clang，增量编译）
 *   → 安装编译产物（skynet 二进制 + cservice/ + luaclib/）到发布根目录
 *   → 上传 fortress 服务端 Lua（dev/ etc/ config/ service/ lualib/）
 *   → 保障 MySQL → 重启 4 个 App → 端口与日志校验
 *
 * 目录约定（多项目统一管理，见 Doc/fortress部署AI提示词.md）：
 *   /Users/<user>/apps/fortress-server/
 *     ├─ skynet/            skynet 源码（fork 版，make macosx 在此编译）
 *     ├─ dev/ etc/ config/ service/ lualib/   fortress 服务端
 *     ├─ cservice/ luaclib/ skynet             远程编译产物（安装到根目录）
 *     └─ log/               各 App stdout/stderr 重定向日志
 * 数据隔离：独立 MySQL database fortress（dbagent 也会自动建库建表）。
 *
 * 运行：npm run deploy（在 Server/ 目录）；--auto 无人值守；--skip-build 跳过远程编译。
 */
import { Client } from "ssh2";
import { createInterface } from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(HERE, "deploy.config.json"), "utf8"));
const SKYNET_SRC = path.resolve(HERE, cfg.skynetSource);
const PROJECT_DIR = `${cfg.remoteRoot}/${cfg.project}`;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const AUTO = process.argv.includes("--auto");
const SKIP_BUILD = process.argv.includes("--skip-build");
const ask = async (q) => {
  if (AUTO) { console.log(`${q}（--auto 自动应答: y）`); return true; }
  const a = (await rl.question(q)).trim().toLowerCase();
  return a === "" || a === "y" || a === "yes";
};

let conn, sftp;

/** 远程执行命令（统一注入 brew PATH），返回 {code, out} */
function run(cmd, timeoutMs = 120000) {
  return new Promise((resolve) => {
    conn.exec(`export PATH=/usr/local/bin:$PATH; ${cmd}`, { readyTimeout: 10000 }, (err, stream) => {
      if (err) return resolve({ code: -1, out: `exec 失败: ${err.message}` });
      let out = "";
      const timer = setTimeout(() => { stream.close(); }, timeoutMs);
      stream.on("close", (code) => { clearTimeout(timer); resolve({ code, out }); })
        .on("data", (d) => { process.stdout.write(d); out += d; })
        .stderr.on("data", (d) => { out += d; });
    });
  });
}

const exists = (p) => new Promise((res) => sftp.lstat(p, (e) => res(!e)));
const mkdir = (p) => new Promise((res, rej) => sftp.mkdir(p, (e) => (e ? rej(e) : res())));
/** 远程递归建目录：串行执行避免并发 worker 对同一目录竞态 mkdir；容忍"已存在"错误 */
let mkdirChain = Promise.resolve();
function mkdirp(p) {
  mkdirChain = mkdirChain.then(async () => {
    for (const seg of p.split("/").filter(Boolean).map((s, i, arr) => "/" + arr.slice(0, i + 1).join("/"))) {
      if (!(await exists(seg))) {
        try { await mkdir(seg); } catch {
          if (!(await exists(seg))) throw new Error(`mkdir 失败: ${seg}`);
        }
      }
    }
  });
  return mkdirChain;
}

/** 递归收集本地文件（相对路径列表）；skip(relPath) 命中的文件/目录整个跳过 */
function walk(dir, base = dir, acc = [], skip = () => false) {
  for (const name of fs.readdirSync(dir)) {
    if (name === ".DS_Store" || name === "Thumbs.db") continue;
    const rel = path.relative(base, path.join(dir, name)).replaceAll("\\", "/");
    if (skip(rel)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, base, acc, skip);
    else acc.push(rel);
  }
  return acc;
}

async function uploadDir(localDir, remoteDir, skip = () => false) {
  const files = walk(localDir, localDir, [], skip);
  await mkdirp(remoteDir);
  let done = 0;
  const put = (rel) => new Promise((res, rej) => {
    sftp.fastPut(path.join(localDir, rel), `${remoteDir}/${rel}`, (e) => (e ? rej(new Error(`${rel}: ${e.message}`)) : res()));
  });
  const queue = [...files];
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const rel = queue.shift();
      await mkdirp(path.posix.dirname(`${remoteDir}/${rel}`));
      await put(rel);
      if (++done % 200 === 0) console.log(`  上传中 ${done}/${files.length}`);
    }
  }));
  console.log(`  上传完成 ${files.length} 个文件 → ${remoteDir}`);
}

/** skynet 源码上传过滤：跳过 git、CI、jemalloc 子模块、本机构建产物（*.o/*.a/*.so/*.exe/*.dll/二进制） */
const skipSkynet = (rel) => {
  const p = rel.replaceAll("\\", "/");
  if (/^(\.git|\.github)(\/|$)/.test(p)) return true;
  if (p === "3rd/jemalloc" || p.startsWith("3rd/jemalloc/")) return true;
  if (/\.(o|a|so|dSYM|exe|dll|lib|log)$/i.test(p)) return true;
  if (p === "skynet" || p === "skynet.exe" || p === "libskynet.a" || p === "build.log") return true;
  if (/\.dSYM\//.test(p)) return true;
  return false;
};

/** fortress 服务端上传过滤：本机 Windows 编译产物与日志不上传（cservice/luaclib 用远程编译产物） */
const skipServer = (rel) => {
  const p = rel.replaceAll("\\", "/");
  if (/^(log)(\/|$)/.test(p)) return true;
  if (p === "cservice" || p.startsWith("cservice/")) return true;
  if (p === "luaclib" || p.startsWith("luaclib/")) return true;
  if (/\.(exe|dll|so|log)$/i.test(p)) return true;
  if (/^(shell|deploy\.|package|node_modules|test)/.test(p)) return true;
  return false;
};

/** 上传单个文件 */
async function uploadFile(localPath, remotePath) {
  await mkdirp(path.posix.dirname(remotePath));
  await new Promise((res, rej) => sftp.fastPut(localPath, remotePath, (e) => (e ? rej(e) : res())));
}

const APPS = ["dbApp", "gateApp", "loginApp", "worldApp"];

async function main() {
  // 0. 本地前置检查
  console.log("[0/6] 本地前置检查 ...");
  if (!fs.existsSync(SKYNET_SRC)) {
    console.error(`skynet 源码不存在: ${SKYNET_SRC}（deploy.config.json 的 skynetSource）`);
    process.exit(1);
  }
  for (const d of ["dev", "etc", "config", "service", "lualib"]) {
    if (!fs.existsSync(path.join(HERE, d))) { console.error(`缺少 Server/${d}`); process.exit(1); }
  }

  // 1. 连接
  console.log(`[1/6] 连接 ${cfg.user}@${cfg.host} ...`);
  await new Promise((res, rej) => {
    conn = new Client()
      .on("ready", res)
      .on("error", rej)
      .connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 10000 });
  });
  sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));

  // 2. 项目目录：存在则复用，不存在询问后创建（多项目统一根目录）
  console.log(`[2/6] 项目目录 ${PROJECT_DIR}`);
  if (await exists(PROJECT_DIR)) {
    console.log("  已存在，直接复用");
  } else if (await ask(`  不存在，是否创建 ${PROJECT_DIR}？(Y/n) `)) {
    await mkdirp(PROJECT_DIR);
    console.log("  已创建");
  } else {
    console.log("已取消发布"); conn.end(); process.exit(0);
  }

  // 3. skynet 源码上传 + 远程编译
  console.log("[3/6] skynet 源码与编译 ...");
  const toolchain = await run("clang --version 2>&1 | head -1; make --version 2>&1 | head -1; xcode-select -p", 20000);
  if (!/clang version|Apple clang/.test(toolchain.out) || !/Developer/.test(toolchain.out)) {
    console.error("  远程 clang/Command Line Tools 不完整，先解决工具链再发布：");
    console.error(toolchain.out);
    conn.end(); process.exit(1);
  }
  if (SKIP_BUILD) {
    console.log("  --skip-build：跳过源码上传与编译（增量发布 Lua 时用）");
  } else {
    await uploadDir(SKYNET_SRC, `${PROJECT_DIR}/skynet`, skipSkynet);
    console.log("  远程 make macosx（首次全量，之后增量）...");
    const make = await run(`cd ${PROJECT_DIR}/skynet && make macosx CC=clang 2>&1 | tail -5`, 600000);
    if (make.code !== 0 || !(await exists(`${PROJECT_DIR}/skynet/skynet`))) {
      console.error("  make 失败或未产出 skynet 二进制，中止"); conn.end(); process.exit(1);
    }
    console.log("  编译完成");
  }

  // 4. 安装编译产物 + 上传 fortress 服务端代码
  // 注意：根目录源码目录名就叫 skynet，根上不能再放同名二进制；启动直接用 skynet/skynet
  console.log("[4/6] 安装产物与上传服务端代码 ...");
  await run(`cd ${PROJECT_DIR} && rm -rf cservice luaclib && cp -R skynet/cservice . && cp -R skynet/luaclib .`, 30000);
  await uploadDir(HERE, PROJECT_DIR, skipServer);
  // 协议文件：dev/common/proto.lua 远程从 ./Protocol/ 读取
  await uploadDir(path.resolve(HERE, "..", "Protocol"), `${PROJECT_DIR}/Protocol`);
  await run(`cd ${PROJECT_DIR} && mkdir -p log`, 10000);

  // 5. MySQL 保障：已装的 8.0.37（LaunchDaemon 管理）确保在跑 + 独立库存在
  console.log("[5/6] 检查远程 MySQL ...");
  const isOpen = `nc -z -w 2 127.0.0.1 3306 && echo OPEN || echo CLOSED`;
  let dbUp = (await run(isOpen, 15000)).out.includes("OPEN");
  if (!dbUp) {
    console.log("  MySQL 未监听，尝试拉起 $HOME/mysql8 ...");
    await run(`nohup $HOME/mysql8/bin/mysqld --basedir=$HOME/mysql8 --datadir=$HOME/mysql8/data --port=3306 --bind-address=127.0.0.1 --socket=/tmp/mysql-sc.sock & sleep 6; true`, 60000);
    dbUp = (await run(isOpen, 15000)).out.includes("OPEN");
  }
  if (!dbUp) {
    console.error("  MySQL 不可用，中止（dbagent 连不上库无法建表）"); conn.end(); process.exit(1);
  }
  await run(`$HOME/mysql8/bin/mysql -h127.0.0.1 -P3306 -uroot -p123456 -e "CREATE DATABASE IF NOT EXISTS \\\`${cfg.dbName}\\\` DEFAULT CHARSET utf8mb4; CREATE USER IF NOT EXISTS 'fortress'@'localhost' IDENTIFIED WITH mysql_native_password BY '123456'; GRANT CREATE ON *.* TO 'fortress'@'localhost'; GRANT ALL PRIVILEGES ON \\\`${cfg.dbName}\\\`.* TO 'fortress'@'localhost'; FLUSH PRIVILEGES;" 2>&1 | grep -v 'Using a password' || true`, 30000);
  console.log(`  MySQL 就绪，独立库 ${cfg.dbName} 与专用账号 fortress（mysql_native_password）已确保存在`);

  // 6. 重启 + 校验（pkill 匹配串唯一命中 fortress 的 skynet，不误伤其他工程进程）
  console.log("[6/6] 重启与校验 ...");
  await run(`pkill -f 'fortress-serve[r]/skynet' 2>/dev/null; sleep 0.5; true`);
  const startCmds = APPS.map((app) =>
    `nohup ${PROJECT_DIR}/skynet/skynet etc/${app}Conf > log/${app}.log 2>&1 &`
  ).join(" ");
  await run(`cd ${PROJECT_DIR} && ${startCmds} sleep 2; true`, 20000);
  const portArgs = [cfg.gatePort, ...cfg.clusterPorts].map((p) => `-i :${p}`).join(" ");
  const up = await run(`/usr/sbin/lsof ${portArgs} | tail -8`, 15000);
  const gateLog = await run(`tail -5 ${PROJECT_DIR}/log/gateApp.log`, 10000);

  console.log(`\n===== 部署结果 =====`);
  console.log(`目录: ${PROJECT_DIR}`);
  console.log(`启动命令: cd ${PROJECT_DIR} && nohup ${PROJECT_DIR}/skynet/skynet etc/<App>Conf > log/<App>.log 2>&1 &`);
  console.log(`端口校验: ${up.out.includes("LISTEN") ? `${cfg.gatePort}/${cfg.clusterPorts.join("/")} 已监听 ✓` : "未监听 ✗（查看 log/*.log 排查）"}`);
  console.log(`gateApp 日志尾部:\n${gateLog.out}`);

  // 附带校验：同机其他工程零影响
  const others = await run(`/usr/sbin/lsof -i :8100 -i :8101 | tail -3`, 15000);
  console.log(`starcraft 零影响: ${others.out.includes("LISTEN") ? "8100/8101 仍监听 ✓" : "（若 starcraft 本应运行，请检查 ✗）"}`);
  conn.end();
}

main().catch((e) => { console.error("发布失败:", e.message); conn?.end(); process.exit(1); }).finally(() => rl.close());

/** 一次性查看远程 fortress-server 状态：四份 App 日志尾部 + 端口监听 + 进程（IDE 任务调用） */
import { Client } from "ssh2";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../deploy.config.json"), "utf8"));
const DIR = `${cfg.remoteRoot}/${cfg.project}`;
const portArgs = [cfg.gatePort, ...cfg.clusterPorts].map((p) => `-i :${p}`).join(" ");

const conn = new Client()
  .on("ready", () => {
    const cmd = [
      `for app in dbApp gateApp loginApp worldApp; do echo "=== $app ==="; tail -n 8 ${DIR}/log/$app.log 2>/dev/null || echo "（无日志）"; done`,
      `echo ---PORTS---`,
      `/usr/sbin/lsof ${portArgs} | tail -8`,
      `echo ---PROC---`,
      `ps aux | grep 'fortress-serve[r]/skynet' | grep -v grep || echo 进程不存在（服务器未运行）`,
    ].join("; ");
    conn.exec(cmd, { readyTimeout: 10000 }, (e, s) => {
      if (e) { console.error("exec 失败:", e.message); conn.end(); return; }
      let buf = "";
      s.on("close", () => { process.stdout.write(buf); conn.end(); })
        .on("data", (d) => { buf += d; })
        .stderr.on("data", (d) => { buf += d; });
    });
  })
  .on("error", (e) => { console.error("SSH 连接失败:", e.message); process.exit(1); })
  .connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 10000 });

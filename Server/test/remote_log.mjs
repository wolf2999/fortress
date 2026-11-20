/** 实时滚动远程 fortress-server 四份 App 日志（Ctrl+C 或关闭终端退出） */
import { Client } from "ssh2";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cfg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../deploy.config.json"), "utf8"));
const DIR = `${cfg.remoteRoot}/${cfg.project}`;

const conn = new Client()
  .on("ready", () => {
    console.log(`—— ${DIR}/log/{dbApp,gateApp,loginApp,worldApp}.log 实时日志（Ctrl+C 退出）——`);
    conn.exec(`tail -n 30 -q -f ${DIR}/log/dbApp.log ${DIR}/log/gateApp.log ${DIR}/log/loginApp.log ${DIR}/log/worldApp.log`, { readyTimeout: 10000 }, (e, s) => {
      if (e) { console.error("exec 失败:", e.message); conn.end(); return; }
      s.on("data", (d) => process.stdout.write(d.toString()))
        .stderr.on("data", (d) => process.stdout.write(d.toString()));
    });
  })
  .on("error", (e) => { console.error("SSH 连接失败:", e.message); process.exit(1); })
  .connect({ host: cfg.host, port: cfg.port, username: cfg.user, password: cfg.password, readyTimeout: 10000 });

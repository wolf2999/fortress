import { createReadStream, existsSync, statSync } from "fs";
import { resolve, sep } from "path";
import { defineConfig, type Plugin } from "vite";

/** 开发期直接读仓库根 Protocol/，避免 public 里的拷贝过期。 */
function protocolFromSource(): Plugin {
  const root = resolve(process.cwd(), "..", "Protocol");
  return {
    name: "protocol-from-source",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith("/protocol/")) return next();
        const name = decodeURIComponent(url.slice("/protocol/".length));
        if (!/^[\w.-]+$/.test(name)) return next();
        const file = resolve(root, name);
        if (file !== root && !file.startsWith(root + sep)) return next();
        if (!existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [protocolFromSource()],
  base: "./",
  resolve: {
    alias: {
      "@nansnunen/sproto-js": resolve(process.cwd(), "node_modules/@nansnunen/sproto-js/dist/sproto.js"),
    },
    dedupe: ["phaser"],
  },
  optimizeDeps: {
    include: ["@nansnunen/sproto-js"],
  },
  server: {
    host: true,
    port: 5180,
  },
  build: {
    target: "es2020",
    outDir: "dist",
  },
});

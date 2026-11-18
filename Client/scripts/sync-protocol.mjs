import { copyFileSync, mkdirSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "..", "Protocol");
const dest = resolve(here, "..", "public", "protocol");

mkdirSync(dest, { recursive: true });
for (const name of readdirSync(src)) {
  if (!name.endsWith(".sproto")) continue;
  copyFileSync(join(src, name), join(dest, name));
}
console.log(`protocol synced -> ${dest}`);

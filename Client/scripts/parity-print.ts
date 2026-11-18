// 固定输入，和 Server/dev/parity/main.lua 对拍。
// esbuild 打成 cjs 后用 node 跑，输出应与 log/parity-lua.txt 一致。
import { buildTerrain, muzzle, place, trace, type Tank } from "../src/sim/rules";

const terrain = buildTerrain(17);
const tank: Tank = {
  seat: 0,
  name: "红",
  x: 96,
  y: 0,
  hp: 1000,
  maxHp: 1000,
  alive: 1,
  fuel: 220,
  bot: 0,
};
place(tank, terrain, false);
const origin = muzzle(tank, 60);
const shot = trace(terrain, origin.x, origin.y, 60, 550, 2, 1);
const last = shot.xs.length - 1;
console.log(
  [
    `tankY ${Math.round(tank.y)}`,
    `muzzle ${Math.round(origin.x)} ${Math.round(origin.y)}`,
    `hit ${shot.hit} ${shot.hitX} ${shot.hitY}`,
    `n ${shot.xs.length}`,
    `ends ${shot.xs[0]} ${shot.ys[0]} ${shot.xs[last]} ${shot.ys[last]}`,
    `terrain ${terrain[0]} ${terrain[40]} ${terrain[120]}`,
  ].join("\n"),
);

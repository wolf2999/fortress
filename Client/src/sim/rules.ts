/**
  本地结算，逐步对应 Server/dev/worldApp/rules.lua。
  联机开火不走这里，只在预瞄和本地双人时使用。

  积分顺序与 Atomic Cannon 的线性风力模型一致：
  先把重力加进速度，再加水平风力，然后用新速度前进。
  正风力把炮弹推向画面右侧。
 */
import {
  COL_W,
  COLS,
  DT,
  GRAVITY,
  HIT_PAD,
  LAUNCH_REF,
  MAX_LIFE,
  MOVE_COST,
  MOVE_STEP,
  MUZZLE,
  TANK_H,
  TANK_W,
  TURN_SEC,
  TURN_WAIT,
  WIND_ACCEL,
  WIND_MAX,
  WORLD_H,
  WORLD_W,
  type Weapon,
} from "./constants";
import { itemById } from "./items";
import { fuelMaxOf, tankById, weaponOf, weaponsOf } from "./tanks";

export interface Tank {
  seat: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: number;
    fuel: number;
  maxFuel?: number;
  bot: number;
  team?: number;
  body?: number;
  wait?: number;
  opened?: number;
  armed?: number;
  still?: number;
  poison?: number;
  frozen?: number;
}

export interface Crate {
  x: number;
  y: number;
}

export interface Mine {
  x: number;
  y: number;
  damage?: number;
  radius?: number;
  gone?: boolean;
}

export interface Cloud {
  x: number;
  y: number;
  r: number;
  left: number;
}

export interface MatchState {
  rev: number;
  matchId: number;
  you: number;
  wind: number;
  turn: number;
  winner: number;
  phase: string;
  log: string;
  terrain: number[];
  tanks: Tank[];
  crates: Crate[];
  mines: Mine[];
  clouds: Cloud[];
  clock?: number;
}

export interface ShotPath {
  xs: number[];
  ys: number[];
  hitX: number;
  hitY: number;
  radius: number;
  hit: number;
  weapon: number;
}

function launchSpeed(power: number, speedScale: number): number {
  return power * speedScale * Math.sqrt(WORLD_W / LAUNCH_REF);
}

export function surfaceAt(terrain: number[], x: number): number {
  let i = Math.floor(x / COL_W);
  if (i < 0) i = 0;
  if (i >= terrain.length) i = terrain.length - 1;
  return terrain[i];
}

export function buildTerrain(seed: number, mapId = 1): number[] {
  const terrain: number[] = [];
  for (let i = 0; i < COLS; i++) {
    const x = i / (COLS - 1);
    const n =
      Math.sin(x * Math.PI * 2 + seed * 0.17) +
      0.55 * Math.sin(x * Math.PI * 5.2 + seed * 0.07) +
      0.28 * Math.sin(x * Math.PI * 11 + 1.3);
    let h: number;
    if (mapId === 2) {
      const bowl = Math.sin(x * Math.PI);
      h = 0.46 + bowl * 0.22 + n * 0.03;
      if (x < 0.16 || x > 0.84) h = 0.5;
    } else {
      h = 0.58 + n * 0.07;
      if (x < 0.2 || x > 0.8) h = 0.55;
    }
    let y = Math.floor(h * WORLD_H);
    if (y < 80) y = 80;
    if (y > WORLD_H - 40) y = WORLD_H - 40;
    terrain.push(y);
  }
  return terrain;
}

function sample(xs: number[], ys: number[]): { xs: number[]; ys: number[] } {
  const n = xs.length;
  const stride = Math.max(2, Math.ceil(n / 160));
  const ox: number[] = [];
  const oy: number[] = [];
  for (let i = 0; i < n; i += stride) {
    ox.push(Math.round(xs[i]));
    oy.push(Math.round(ys[i]));
  }
  const lx = Math.round(xs[n - 1]);
  const ly = Math.round(ys[n - 1]);
  if (ox[ox.length - 1] !== lx || oy[oy.length - 1] !== ly) {
    ox.push(lx);
    oy.push(ly);
  }
  return { xs: ox, ys: oy };
}

export function trace(
  terrain: number[],
  x0: number,
  y0: number,
  angle: number,
  power: number,
  wind: number,
  speedScale: number,
): ShotPath {
  const rad = (angle * Math.PI) / 180;
  const speed = launchSpeed(power, speedScale);
  let x = x0;
  let y = y0;
  let vx = Math.cos(rad) * speed;
  let vy = -Math.sin(rad) * speed;
  const xs = [x];
  const ys = [y];
  const steps = Math.floor(MAX_LIFE / DT);
  let hit = 0;
  let hitX = x;
  let hitY = y;
  for (let n = 0; n < steps; n++) {
    vy += GRAVITY * DT;
    vx += wind * WIND_ACCEL * DT;
    x += vx * DT;
    y += vy * DT;
    xs.push(x);
    ys.push(y);
    const dist = Math.hypot(x - x0, y - y0);
    if (x < -20 || x > WORLD_W + 20) {
      hit = 0;
      hitX = x;
      hitY = y;
      break;
    }
    if (dist >= 18 && y >= WORLD_H) {
      hit = 1;
      hitX = x;
      hitY = WORLD_H;
      break;
    }
    if (dist >= 18 && y >= surfaceAt(terrain, x)) {
      hit = 1;
      hitX = x;
      hitY = y;
      break;
    }
  }
  const sampled = sample(xs, ys);
  return {
    ...sampled,
    hit,
    hitX: Math.round(hitX),
    hitY: Math.round(hitY),
    radius: 0,
    weapon: 0,
  };
}

export function muzzle(tank: Tank, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: tank.x + TANK_W / 2 + Math.cos(rad) * MUZZLE,
    y: tank.y + 6 - Math.sin(rad) * MUZZLE,
  };
}

function applyBlast(terrain: number[], cx: number, cy: number, radius: number, kind: "dig" | "fill"): void {
  const r2 = radius * radius;
  const i0 = Math.floor((cx - radius) / COL_W);
  const i1 = Math.floor((cx + radius) / COL_W);
  for (let i = i0; i <= i1; i++) {
    if (i < 0 || i >= terrain.length) continue;
    const colX = i * COL_W + COL_W * 0.5;
    const dx = colX - cx;
    const rest = r2 - dx * dx;
    if (rest <= 0) continue;
    const dy = Math.sqrt(rest);
    if (kind === "fill") {
      const top = cy - dy;
      if (top < terrain[i]) terrain[i] = Math.max(36, Math.floor(top));
    } else {
      const bot = cy + dy;
      if (terrain[i] < bot && cy - dy <= terrain[i] + 2) {
        terrain[i] = Math.min(WORLD_H, Math.floor(bot));
      }
    }
  }
}

function hurt(tank: Tank, cx: number, cy: number, radius: number, dmg: number): void {
  if (tank.alive !== 1) return;
  const tx = tank.x + TANK_W / 2;
  const ty = tank.y + TANK_H / 2;
  const d = Math.hypot(tx - cx, ty - cy);
  const reach = radius + HIT_PAD;
  if (d <= reach) {
    const dealt = Math.max(1, Math.floor(dmg * (1 - d / reach)));
    tank.hp -= dealt;
    if (tank.hp <= 0) {
      tank.hp = 0;
      tank.alive = 0;
    }
  }
}

export function place(tank: Tank, terrain: number[], fall: boolean): void {
  const oldY = tank.y;
  const ground = surfaceAt(terrain, tank.x + TANK_W / 2);
  tank.y = ground - TANK_H;
  if (tank.y > WORLD_H - TANK_H) {
    tank.hp = 0;
    tank.alive = 0;
    return;
  }
  if (fall && tank.alive === 1) {
    const drop = tank.y - oldY;
    if (drop > 40) {
      tank.hp = Math.max(0, tank.hp - Math.floor(drop * 1.2));
      if (tank.hp <= 0) {
        tank.hp = 0;
        tank.alive = 0;
      }
    }
  }
}

function winnerText(tanks: Tank[], winner: number): string {
  if (winner === -2) return "同归于尽";
  const side = tanks.filter((tank) => (tank.team ?? tank.seat) === winner);
  if (side.length <= 1) return `${side[0]?.name ?? ""} 获胜`;
  return winner === 0 ? "红方 获胜" : "蓝方 获胜";
}

function nextActor(tanks: Tank[], from: number): number {
  const waiting = tanks.some((tank) => tank.alive === 1 && tank.opened !== 1);
  if (waiting) return nextLiving(tanks, from);
  let best = from;
  let bestWait = Number.POSITIVE_INFINITY;
  for (const tank of tanks) {
    if (tank.alive !== 1) continue;
    const wait = tank.wait ?? 0;
    if (wait < bestWait || (wait === bestWait && tank.seat < best)) {
      best = tank.seat;
      bestWait = wait;
    }
  }
  return best;
}

function nextLiving(tanks: Tank[], from: number): number {
  const order = tanks.map((tank) => tank.seat).sort((a, b) => a - b);
  const at = order.indexOf(from);
  for (let step = 1; step <= order.length; step++) {
    const seat = order[(at + step) % order.length];
    const tank = tanks.find((item) => item.seat === seat);
    if (tank && tank.alive === 1) return seat;
  }
  return from;
}

function tankAt(tanks: Tank[], seat: number): Tank {
  return tanks.find((tank) => tank.seat === seat) ?? tanks[seat];
}

function judge(tanks: Tank[]): number {
  const alive = new Set<number>();
  for (const tank of tanks) {
    if (tank.alive === 1) alive.add(tank.team ?? tank.seat);
  }
  if (alive.size === 0) return -2;
  if (alive.size === 1) return [...alive][0];
  return -1;
}

export function clampAngle(angle: number): number {
  return Math.max(0, Math.min(180, Math.round(angle)));
}

export function angleWindow(tank: Tank | undefined): [number, number] {
  const body = tankById(tank?.body);
  if (!body) return [0, 180];
  if ((tank?.team ?? 0) === 1) return [180 - body.angleMax, 180 - body.angleMin];
  return [body.angleMin, body.angleMax];
}

export function defaultAngle(tank: Tank | undefined): number {
  const [lo, hi] = angleWindow(tank);
  return Math.round((lo + hi) / 2);
}

function shotAngles(angle: number, weapon: Weapon): number[] {
  const n = weapon.count ?? (weapon.kind === "spread" ? 3 : 1);
  const spread = weapon.spread;
  if (n === 2) return [angle - spread, angle + spread];
  if (n >= 3) return [angle - spread, angle, angle + spread];
  return [angle];
}

function shotDamage(tank: Tank, weapon: Weapon): number {
  const body = tankById(tank.body);
  if (body?.enrage && tank.maxHp > 0 && tank.hp * 2 <= tank.maxHp) {
    return Math.floor(weapon.damage * 1.5 + 0.5);
  }
  return weapon.damage;
}

export function clampPower(power: number): number {
  return Math.max(1, Math.min(1000, Math.round(power)));
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    terrain: state.terrain.slice(),
    tanks: state.tanks.map((t) => ({ ...t })),
    crates: (state.crates ?? []).map((box) => ({ ...box })),
    mines: (state.mines ?? []).map((mine) => ({ ...mine })),
    clouds: (state.clouds ?? []).map((cloud) => ({ ...cloud })),
  };
}

export function placeCrates(terrain: number[]): Crate[] {
  const crates: Crate[] = [];
  for (const x of [280, 680]) {
    const ground = surfaceAt(terrain, x);
    if (ground < WORLD_H - 8) crates.push({ x, y: ground - 8 });
  }
  return crates;
}

function standingOn(tank: Tank, box: Crate): boolean {
  if (tank.alive !== 1) return false;
  const feet = tank.y + TANK_H;
  if (Math.abs(feet - (box.y + 8)) > 6) return false;
  return tank.x < box.x + 14 && tank.x + TANK_W > box.x - 14;
}

function takeBox(note: { text: string }, tank: Tank, box: Crate & { gone?: boolean }): void {
  if (tank.alive !== 1 || tank.hp >= tank.maxHp) return;
  box.gone = true;
  const gain = Math.floor(tank.maxHp * 0.25 + 0.5);
  const before = tank.hp;
  tank.hp = Math.min(tank.maxHp, tank.hp + gain);
  note.text += `，${tank.name} 捡到补给箱，能量 +${tank.hp - before}`;
}

function collectStanding(tanks: Tank[], crates: Array<Crate & { gone?: boolean }>, note: { text: string }): Crate[] {
  for (const tank of tanks) {
    for (const box of crates) {
      if (!box.gone && standingOn(tank, box)) takeBox(note, tank, box);
    }
  }
  return crates.filter((box) => !box.gone).map(({ x, y }) => ({ x, y }));
}

export function rollWind(): number {
  return Math.floor(Math.random() * (WIND_MAX * 2 + 1)) - WIND_MAX;
}

export function createMatch(seed: number, names: [string, string], bodies: [number, number] = [4, 4]): MatchState {
  const terrain = buildTerrain(seed);
  const tanks: Tank[] = [0, 1].map((seat) => {
    const body = tankById(bodies[seat]) ?? tankById(4)!;
    const x = seat === 0 ? 96 : WORLD_W - 96 - TANK_W;
    const tank: Tank = {
      seat,
      name: names[seat],
      x,
      y: 0,
      hp: body.hp,
      maxHp: body.hp,
      alive: 1,
      fuel: body.fuel,
      maxFuel: body.fuel,
      bot: 0,
      team: seat,
      body: body.id,
      wait: body.delay,
      opened: 0,
    };
    place(tank, terrain, false);
    return tank;
  });
  return {
    rev: 1,
    matchId: 1,
    you: 0,
    wind: rollWind(),
    turn: 0,
    winner: -1,
    phase: "aim",
    log: `${names[0]} 先手`,
    terrain,
    tanks,
    crates: placeCrates(terrain),
    mines: [],
    clouds: [],
  };
}

const POISON_DMG = 20;
const POISON_LEFT = 3;
const FREEZE_LEFT = 2;
const CLOUD_LEFT = 3;
const CLOUD_DRIFT = 12;

function joinNames(marked: Set<string>): string {
  return [...marked].sort().join("、");
}

function inReach(tank: Tank, cx: number, cy: number, radius: number): boolean {
  if (tank.alive !== 1) return false;
  const tx = tank.x + TANK_W / 2;
  const ty = tank.y + TANK_H / 2;
  return Math.hypot(tx - cx, ty - cy) <= radius + HIT_PAD;
}

function inCloud(tank: Tank, cloud: Cloud): boolean {
  if (tank.alive !== 1) return false;
  const tx = tank.x + TANK_W / 2;
  const ty = tank.y + TANK_H / 2;
  return Math.hypot(tx - cloud.x, ty - cloud.y) <= cloud.r;
}

function overlapsMine(tank: Tank, mine: Mine): boolean {
  if (tank.alive !== 1 || mine.gone) return false;
  const feet = tank.y + TANK_H;
  if (Math.abs(feet - (mine.y + 6)) > 10) return false;
  return tank.x < mine.x + 12 && tank.x + TANK_W > mine.x - 12;
}

function detonateMine(state: MatchState, mine: Mine, trigger: Tank | undefined, note: { text: string }): void {
  mine.gone = true;
  const dmg = mine.damage ?? 320;
  const radius = mine.radius ?? 30;
  applyBlast(state.terrain, mine.x, mine.y, radius, "dig");
  for (const other of state.tanks) hurt(other, mine.x, mine.y, radius, dmg);
  if (trigger && trigger.alive === 1) {
    const reach = radius + HIT_PAD;
    const boxes = state.crates as Array<Crate & { gone?: boolean }>;
    for (const box of boxes) {
      if (box.gone) continue;
      const dx = box.x - mine.x;
      const dy = box.y - mine.y;
      if (dx * dx + dy * dy <= reach * reach) takeBox(note, trigger, box);
    }
  }
  note.text += `，${trigger?.name ?? "坦克"} 踩中地雷`;
}

function settleGround(state: MatchState, note: { text: string }): void {
  const mines = state.mines;
  for (let guard = 0; guard < 8; guard += 1) {
    let boom = false;
    for (const mine of mines) {
      if (mine.gone) continue;
      const ground = surfaceAt(state.terrain, mine.x);
      if (ground >= WORLD_H - 2) mine.gone = true;
      else mine.y = ground - 6;
    }
    for (const tank of state.tanks) {
      for (const mine of mines) {
        if (overlapsMine(tank, mine)) {
          detonateMine(state, mine, tank, note);
          boom = true;
          break;
        }
      }
      if (boom) break;
    }
    if (!boom) break;
    for (const other of state.tanks) place(other, state.terrain, true);
    state.crates = collectStanding(state.tanks, state.crates as Array<Crate & { gone?: boolean }>, note);
  }
  state.mines = mines.filter((mine) => !mine.gone).map(({ x, y, damage, radius }) => ({ x, y, damage, radius }));
}

function driftClouds(state: MatchState): void {
  for (const cloud of state.clouds) {
    cloud.x = Math.max(16, Math.min(WORLD_W - 16, cloud.x + state.wind * CLOUD_DRIFT));
  }
}

function ageClouds(state: MatchState): void {
  state.clouds = state.clouds
    .map((cloud) => ({ ...cloud, left: cloud.left - 1 }))
    .filter((cloud) => cloud.left > 0);
}

function tickActor(state: MatchState): string {
  const tank = tankAt(state.tanks, state.turn);
  if (!tank || tank.alive !== 1) return "";
  const bits: string[] = [];
  if ((tank.poison ?? 0) > 0) {
    tank.hp -= POISON_DMG;
    tank.poison = (tank.poison ?? 0) - 1;
    if (tank.hp <= 0) {
      tank.hp = 0;
      tank.alive = 0;
      tank.poison = 0;
      bits.push(`${tank.name} 中毒身亡`);
    } else {
      bits.push(tank.poison <= 0 ? `${tank.name} 中毒 -${POISON_DMG}，毒消了` : `${tank.name} 中毒 -${POISON_DMG}`);
    }
  }
  if (tank.alive === 1) {
    for (const cloud of state.clouds) {
      if (!inCloud(tank, cloud)) continue;
      tank.hp -= POISON_DMG;
      if (tank.hp <= 0) {
        tank.hp = 0;
        tank.alive = 0;
        bits.push(`${tank.name} 被毒气毒倒`);
      } else {
        bits.push(`${tank.name} 吸入毒气 -${POISON_DMG}`);
      }
      break;
    }
  }
  return bits.join("，");
}

function refill(state: MatchState, seat: number): void {
  const tank = tankAt(state.tanks, seat);
  if (tank) tank.fuel = tank.maxFuel ?? fuelMaxOf(tank.body);
}

function openTurn(state: MatchState): string {
  driftClouds(state);
  const notes: string[] = [];
  for (let guard = 0; guard < 8; guard += 1) {
    const text = tickActor(state);
    if (text) notes.push(text);
    const actor = tankAt(state.tanks, state.turn);
    if (actor && actor.alive === 1) break;
    const winner = judge(state.tanks);
    state.winner = winner;
    if (winner !== -1) {
      state.phase = "over";
      break;
    }
    state.turn = nextActor(state.tanks, state.turn);
    refill(state, state.turn);
  }
  return notes.length ? `，${notes.join("，")}` : "";
}

function finishIfDead(state: MatchState, actor: Tank, note: { text: string }): void {
  const winner = judge(state.tanks);
  state.winner = winner;
  if (winner !== -1) {
    state.phase = "over";
    state.log = winnerText(state.tanks, winner) + note.text;
    return;
  }
  if (actor.alive !== 1) {
    state.turn = nextActor(state.tanks, actor.seat);
    refill(state, state.turn);
    const extra = openTurn(state);
    state.log = state.phase === "over" ? winnerText(state.tanks, state.winner) + note.text + extra : state.log + extra;
  }
}

export function resolveFire(
  state: MatchState,
  seat: number,
  angle: number,
  power: number,
  weaponId: number,
  nextWind: number,
  thinkSec = 0,
): { ok: boolean; msg: string; shots: ShotPath[]; next: MatchState } {
  if (state.phase !== "aim") return { ok: false, msg: "对局已结束", shots: [], next: state };
  if (state.turn !== seat) return { ok: false, msg: "还没轮到你", shots: [], next: state };
  const shooter = tankAt(state.tanks, seat);
  if (!shooter || shooter.alive !== 1) return { ok: false, msg: "这辆坦克已经报废", shots: [], next: state };
  const weapon = weaponOf(weaponId);
  const owned = weaponsOf(shooter.body);
  if (!weapon || !owned.some((item) => item.id === weapon.id)) {
    return { ok: false, msg: "没有这种炮弹", shots: [], next: state };
  }

  angle = clampAngle(angle);
  power = clampPower(power);
  const [lo, hi] = angleWindow(shooter);
  if (angle < lo || angle > hi) return { ok: false, msg: `射界是 ${lo}° 到 ${hi}°`, shots: [], next: state };
  const next = cloneState(state);
  const tank = tankAt(next.tanks, seat);
  const damage = shotDamage(tank, weapon);
  const passes = tank.armed === 1 ? 2 : 1;
  const wasFrozen = (tank.frozen ?? 0) > 0;
  const note = { text: "" };
  ageClouds(next);
  const shots: ShotPath[] = [];
  const planted: { mine: Mine; shot: ShotPath }[] = [];
  const poisoned = new Set<string>();
  const frozen = new Set<string>();
  let gasMade = false;
  const kind = weapon.kind === "fill" ? "fill" : "dig";
  const effect = weapon.effect;
  const boxes = next.crates as Array<Crate & { gone?: boolean }>;
  for (let pass = 0; pass < passes; pass += 1) {
    const volley: ShotPath[] = [];
    for (const ang of shotAngles(angle, weapon)) {
      const a = clampAngle(ang);
      const m = muzzle(tank, a);
      const tr = trace(next.terrain, m.x, m.y, a, power, next.wind, weapon.speed);
      tr.radius = effect === "mine" ? 0 : weapon.radius;
      tr.weapon = weapon.id;
      volley.push(tr);
      shots.push(tr);
    }
    for (const tr of volley) {
      if (tr.hit !== 1) continue;
      if (effect === "mine") {
        const mine: Mine = {
          x: tr.hitX,
          y: surfaceAt(next.terrain, tr.hitX) - 6,
          damage,
          radius: weapon.radius,
        };
        next.mines.push(mine);
        planted.push({ mine, shot: tr });
        continue;
      }
      applyBlast(next.terrain, tr.hitX, tr.hitY, weapon.radius, kind);
      for (const other of next.tanks) {
        hurt(other, tr.hitX, tr.hitY, weapon.radius, damage);
        if (other.alive === 1 && inReach(other, tr.hitX, tr.hitY, weapon.radius)) {
          if (effect === "poison") {
            other.poison = POISON_LEFT;
            poisoned.add(other.name);
          } else if (effect === "freeze") {
            other.frozen = FREEZE_LEFT;
            frozen.add(other.name);
          }
        }
      }
      if (effect === "gas") {
        gasMade = true;
        next.clouds.push({ x: tr.hitX, y: tr.hitY, r: weapon.radius, left: CLOUD_LEFT });
      }
      const reach = weapon.radius + HIT_PAD;
      for (const box of boxes) {
        if (box.gone || tank.alive !== 1) continue;
        const dx = box.x - tr.hitX;
        const dy = box.y - tr.hitY;
        if (dx * dx + dy * dy <= reach * reach) takeBox(note, tank, box);
      }
    }
  }
  for (const other of next.tanks) place(other, next.terrain, true);
  next.crates = collectStanding(next.tanks, boxes, note);
  settleGround(next, note);
  for (const item of planted) {
    if (item.mine.gone) item.shot.radius = item.mine.radius ?? 30;
  }
  tank.armed = 0;
  tank.still = 0;
  if (wasFrozen) tank.frozen = (tank.frozen ?? 0) - 1;

  const effectBits: string[] = [];
  const poisonedNames = joinNames(poisoned);
  const frozenNames = joinNames(frozen);
  if (poisonedNames) effectBits.push(`${poisonedNames} 中毒`);
  if (frozenNames) effectBits.push(`${frozenNames} 被冻住`);
  if (gasMade) effectBits.push("放出毒气");
  if (planted.some((item) => !item.mine.gone)) effectBits.push("埋下地雷");
  const effectNote = (effectBits.length ? `，${effectBits.join("，")}` : "") + note.text;

  const winner = judge(next.tanks);
  next.winner = winner;
  next.rev += 1;
  const think = Math.max(0, Math.min(TURN_SEC, Math.floor(thinkSec)));
  const timeWait = think * TURN_WAIT;
  const timeNote = think > 0 ? `，出手 ${think} 秒，等待 +${timeWait}` : "";
  const rage = damage !== weapon.damage ? "（半血加力）" : "";
  const twin = passes === 2 ? "（双发）" : "";
  const shotLog = `${tank.name} 发射了${weapon.name}${twin}${rage}${effectNote}${timeNote}`;
  if (winner !== -1) {
    next.phase = "over";
    next.log = winnerText(next.tanks, winner) + effectNote + timeNote;
  } else {
    next.wind = nextWind;
    tank.opened = 1;
    tank.wait = (tank.wait ?? 0) + (weapon.slot === 2 ? 200 : 100) + timeWait;
    const nxt = nextActor(next.tanks, seat);
    next.turn = nxt;
    refill(next, nxt);
    const extra = openTurn(next);
    next.log = next.phase === "over" ? winnerText(next.tanks, next.winner) + effectNote + extra : shotLog + extra;
  }
  return { ok: true, msg: "发射", shots, next };
}

export function resolveMove(
  state: MatchState,
  seat: number,
  dir: number,
): { ok: boolean; msg: string; next: MatchState } {
  if (state.phase !== "aim") return { ok: false, msg: "对局已结束", next: state };
  if (state.turn !== seat) return { ok: false, msg: "还没轮到你", next: state };
  if (dir !== -1 && dir !== 1) return { ok: false, msg: "方向不对", next: state };
  const next = cloneState(state);
  const tank = tankAt(next.tanks, seat);
  if (!tank || tank.alive !== 1) return { ok: false, msg: "这辆坦克已经报废", next: state };
  if (tank.still === 1) return { ok: false, msg: "用了大补，这回合不能再移动", next: state };
  if ((tank.frozen ?? 0) > 0) return { ok: false, msg: "冻住了，不能移动", next: state };
  if (tank.fuel < MOVE_COST) return { ok: false, msg: "燃料用完了，请开炮", next: state };
  const nx = tank.x + dir * MOVE_STEP;
  if (nx < 16 || nx + TANK_W > WORLD_W - 16) return { ok: false, msg: "到头了，换个方向或开炮", next: state };
  const ground = surfaceAt(next.terrain, nx + TANK_W / 2);
  if (ground >= WORLD_H - 2) return { ok: false, msg: "前面是坑", next: state };
  tank.x = nx;
  tank.fuel -= MOVE_COST;
  tank.wait = (tank.wait ?? 0) + 10;
  place(tank, next.terrain, true);
  const note = { text: "" };
  next.crates = collectStanding(next.tanks, next.crates as Array<Crate & { gone?: boolean }>, note);
  settleGround(next, note);
  next.rev += 1;
  next.log = `${tank.name} 移动了${note.text}`;
  finishIfDead(next, tank, note);
  return { ok: true, msg: "ok", next };
}

export function resolveUse(
  state: MatchState,
  seat: number,
  itemId: number,
): { ok: boolean; msg: string; next: MatchState } {
  if (state.phase !== "aim") return { ok: false, msg: "对局已结束", next: state };
  if (state.turn !== seat) return { ok: false, msg: "还没轮到你", next: state };
  const item = itemById(itemId);
  if (!item) return { ok: false, msg: "没有这种道具", next: state };
  const current = tankAt(state.tanks, seat);
  if (!current || current.alive !== 1) return { ok: false, msg: "这辆坦克已经报废", next: state };
  if (item.kind === "double" && current.armed === 1) return { ok: false, msg: "这回合已经双发", next: state };
  if (item.kind === "heal" && current.hp >= current.maxHp) return { ok: false, msg: "能量已满", next: state };
  const next = cloneState(state);
  const tank = tankAt(next.tanks, seat);
  if (item.kind === "double") {
    tank.armed = 1;
    tank.wait = (tank.wait ?? 0) + 200;
    next.log = `${tank.name} 使用了双发，等待 +200`;
  } else {
    const before = tank.hp;
    tank.hp = Math.min(tank.maxHp, tank.hp + Math.floor(tank.maxHp * item.heal + 0.5));
    if (item.lockMove === 1) tank.still = 1;
    tank.wait = (tank.wait ?? 0) + 200;
    next.log = `${tank.name} 使用了${item.name}，能量 +${tank.hp - before}，等待 +200`;
    if (item.lockMove === 1) next.log += "，这回合不能再移动";
  }
  next.rev += 1;
  return { ok: true, msg: "ok", next };
}

export function resolveExpire(state: MatchState): MatchState {
  if (state.phase !== "aim") return state;
  const next = cloneState(state);
  const seat = next.turn;
  const tank = tankAt(next.tanks, seat);
  if (!tank || tank.alive !== 1) return state;
  tank.opened = 1;
  tank.armed = 0;
  tank.still = 0;
  tank.wait = (tank.wait ?? 0) + TURN_SEC * TURN_WAIT;
  next.rev += 1;
  const winner = judge(next.tanks);
  next.winner = winner;
  const note = `${tank.name} 时间到，等待 +${TURN_SEC * TURN_WAIT}`;
  if (winner !== -1) {
    next.phase = "over";
    next.log = winnerText(next.tanks, winner);
    return next;
  }
  next.turn = nextActor(next.tanks, seat);
  refill(next, next.turn);
  const extra = openTurn(next);
  next.log = next.phase === "over" ? winnerText(next.tanks, next.winner) + extra : note + extra;
  return next;
}

export function preview(
  state: MatchState,
  seat: number,
  angle: number,
  power: number,
  weaponId: number,
): ShotPath | null {
  const weapon = weaponOf(weaponId) ?? weaponsOf(tankAt(state.tanks, seat)?.body)[0];
  const tank = tankAt(state.tanks, seat);
  if (!tank) return null;
  const a = clampAngle(angle);
  const m = muzzle(tank, a);
  const tr = trace(state.terrain, m.x, m.y, a, clampPower(power), state.wind, weapon.speed);
  tr.weapon = weapon.id;
  tr.radius = weapon.radius;
  return tr;
}

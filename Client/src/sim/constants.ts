/** 与 Server/config/constants.lua、weapons.lua 同一组数。 */
export const WORLD_W = 960;
export const WORLD_H = 540;
export const COL_W = 4;
export const COLS = WORLD_W / COL_W;
export const GRAVITY = 500;
export const WIND_ACCEL = 15;
export const LAUNCH_REF = 1000;
export const POWER_MAX = 1000;
export const WIND_MAX = 5;
export const TANK_W = 48;
export const TANK_H = 20;
export const TANK_HP = 1000;
export const MUZZLE = 30;
export const MOVE_STEP = 22;
export const MOVE_FUEL = 220;
export const MOVE_COST = 10;
export const DT = 1 / 60;
export const MAX_LIFE = 8;
export const HIT_PAD = 14;
export const TURN_SEC = 20;
export const TURN_WAIT = 10;

export const MAPS = [
  { id: 1, name: "丘陵", blurb: "缓坡，两边是平地" },
  { id: 2, name: "峡谷", blurb: "两边高，中间深" },
];

export interface Weapon {
  id: number;
  name: string;
  damage: number;
  radius: number;
  speed: number;
  kind: "dig" | "fill" | "spread";
  spread: number;
  count?: number;
  slot?: number;
  effect?: "poison" | "gas" | "freeze" | "mine";
}

export const WEAPONS: Weapon[] = [
  { id: 1, name: "标准弹", damage: 220, radius: 36, speed: 1, kind: "dig", spread: 0 },
  { id: 2, name: "重炮", damage: 420, radius: 62, speed: 0.72, kind: "dig", spread: 0 },
  { id: 3, name: "集束弹", damage: 90, radius: 24, speed: 0.95, kind: "spread", spread: 14 },
  { id: 4, name: "泥弹", damage: 50, radius: 44, speed: 0.88, kind: "fill", spread: 0 },
];

export function weaponById(id: number): Weapon | undefined {
  return WEAPONS.find((w) => w.id === id);
}

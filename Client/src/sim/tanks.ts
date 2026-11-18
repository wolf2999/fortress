/**
 * 与 Server/config/tanks.lua 同一张表。
 * 12 种坦克的能量、等待、射界、移动和两发炮弹。
 * 颜色只用来在画面上区分，不是原作贴图。
 */
import { MOVE_FUEL, WEAPONS, weaponById, type Weapon } from "./constants";

export interface TankBody {
  id: number;
  era: string;
  name: string;
  angleMin: number;
  angleMax: number;
  hp: number;
  delay: number;
  move: number;
  fuel: number;
  color: number;
  enrage?: boolean;
  weapons: Weapon[];
}

export const DEFAULT_BODY = 4;

export const ERAS = ["古代", "近代", "现代", "未来"] as const;

export const TANKS: TankBody[] = [
  {
    id: 1, era: "古代", name: "大碗", angleMin: 0, angleMax: 90, hp: 950, delay: 560, move: 50, fuel: 183, color: 0xc4a574,
    weapons: [
      { id: 11, slot: 1, name: "巨石", damage: 350, radius: 45, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 12, slot: 2, name: "火石", damage: 150, radius: 40, speed: 1, kind: "dig", count: 1, spread: 0 },
    ],
  },
  {
    id: 2, era: "古代", name: "叉叉", angleMin: 15, angleMax: 80, hp: 940, delay: 570, move: 57, fuel: 209, color: 0x8d6e63,
    weapons: [
      { id: 21, slot: 1, name: "穿心箭", damage: 330, radius: 31, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 22, slot: 2, name: "毒箭", damage: 100, radius: 28, speed: 1, kind: "dig", count: 1, spread: 0, effect: "poison" },
    ],
  },
  {
    id: 3, era: "古代", name: "老土", angleMin: 25, angleMax: 45, hp: 920, delay: 580, move: 48, fuel: 176, color: 0x6b8f71,
    weapons: [
      { id: 31, slot: 1, name: "铅球", damage: 140, radius: 78, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 32, slot: 2, name: "小红豆", damage: 420, radius: 35, speed: 1, kind: "dig", count: 1, spread: 0 },
    ],
  },
  {
    id: 4, era: "近代", name: "甲壳虫", angleMin: 0, angleMax: 40, hp: 1000, delay: 560, move: 60, fuel: 220, color: 0x3d8b5f,
    weapons: [
      { id: 41, slot: 1, name: "骷髅弹", damage: 230, radius: 57, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 42, slot: 2, name: "趴趴弹", damage: 150, radius: 38, speed: 1, kind: "dig", count: 3, spread: 8 },
    ],
  },
  {
    id: 5, era: "近代", name: "公爵", angleMin: 0, angleMax: 40, hp: 1000, delay: 560, move: 60, fuel: 220, color: 0x7a6a4f,
    weapons: [
      { id: 51, slot: 1, name: "弹簧弹", damage: 240, radius: 55, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 52, slot: 2, name: "毒气弹", damage: 153, radius: 43, speed: 1, kind: "dig", count: 1, spread: 0, effect: "gas" },
    ],
  },
  {
    id: 6, era: "近代", name: "雷霆", angleMin: 5, angleMax: 40, hp: 1150, delay: 560, move: 56, fuel: 205, color: 0x4f6f8f,
    weapons: [
      { id: 61, slot: 1, name: "手榴弹", damage: 220, radius: 52, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 62, slot: 2, name: "地雷", damage: 320, radius: 30, speed: 1, kind: "dig", count: 1, spread: 0, effect: "mine" },
    ],
  },
  {
    id: 7, era: "现代", name: "飞火", angleMin: 20, angleMax: 45, hp: 1100, delay: 560, move: 57, fuel: 209, color: 0xd4652f,
    weapons: [
      { id: 71, slot: 1, name: "飞火弹", damage: 120, radius: 45, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 72, slot: 2, name: "追魂弹", damage: 90, radius: 32, speed: 1, kind: "dig", count: 1, spread: 0 },
    ],
  },
  {
    id: 8, era: "现代", name: "流星", angleMin: 25, angleMax: 50, hp: 1050, delay: 570, move: 55, fuel: 202, color: 0x6a7fbf,
    weapons: [
      { id: 81, slot: 1, name: "三叉戟", damage: 175, radius: 40, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 82, slot: 2, name: "流星雨", damage: 60, radius: 28, speed: 1, kind: "dig", count: 3, spread: 10 },
    ],
  },
  {
    id: 9, era: "未来", name: "小妖", angleMin: 5, angleMax: 36, hp: 990, delay: 540, move: 80, fuel: 293, color: 0x7d5ea8,
    weapons: [
      { id: 91, slot: 1, name: "单雷炮", damage: 220, radius: 70, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 92, slot: 2, name: "三雷炮", damage: 99, radius: 40, speed: 1, kind: "dig", count: 3, spread: 8 },
    ],
  },
  {
    id: 10, era: "未来", name: "水鬼", angleMin: 15, angleMax: 50, hp: 1000, delay: 550, move: 54, fuel: 198, color: 0x3aa0a8,
    weapons: [
      { id: 101, slot: 1, name: "水水弹", damage: 230, radius: 54, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 102, slot: 2, name: "紫冻水", damage: 190, radius: 43, speed: 1, kind: "dig", count: 1, spread: 0, effect: "freeze" },
    ],
  },
  {
    id: 11, era: "未来", name: "闪灵", angleMin: 20, angleMax: 55, hp: 970, delay: 550, move: 70, fuel: 257, color: 0xd4c15a,
    weapons: [
      { id: 111, slot: 1, name: "离子弹", damage: 220, radius: 48, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 112, slot: 2, name: "离子光波", damage: 270, radius: 66, speed: 1, kind: "dig", count: 1, spread: 0 },
    ],
  },
  {
    id: 12, era: "未来", name: "海怪", angleMin: 0, angleMax: 40, hp: 985, delay: 530, move: 80, fuel: 293, color: 0x2f6f9f, enrage: true,
    weapons: [
      { id: 121, slot: 1, name: "大电环", damage: 220, radius: 65, speed: 1, kind: "dig", count: 1, spread: 0 },
      { id: 122, slot: 2, name: "双发小电环", damage: 166, radius: 42, speed: 1, kind: "dig", count: 2, spread: 6 },
    ],
  },
];

export function tankById(id: number | undefined): TankBody | undefined {
  return TANKS.find((body) => body.id === id);
}

export function weaponOf(id: number): Weapon | undefined {
  const legacy = weaponById(id);
  if (legacy) return legacy;
  for (const body of TANKS) {
    const found = body.weapons.find((weapon) => weapon.id === id);
    if (found) return found;
  }
  return undefined;
}

export function weaponsOf(bodyId: number | undefined): Weapon[] {
  return tankById(bodyId)?.weapons ?? WEAPONS;
}

export function fuelMaxOf(bodyId: number | undefined): number {
  return tankById(bodyId)?.fuel ?? MOVE_FUEL;
}

export function bodyBlurb(id: number | undefined): string {
  const body = tankById(id);
  if (!body) return "";
  const shots = body.weapons
    .map((weapon) => {
      const extra = weapon.count && weapon.count > 1 ? `（${weapon.count}发）` : "";
      const effect = weapon.effect === "poison" ? "（中毒）" : weapon.effect === "gas" ? "（毒气）" : weapon.effect === "freeze" ? "（冰冻）" : weapon.effect === "mine" ? "（停留）" : "";
      return `${weapon.name} ${weapon.damage}/${weapon.radius}${extra}${effect}`;
    })
    .join(" · ");
  const rage = body.enrage ? " · 能量降到一半后伤害 +50%" : "";
  return `${body.name} · ${body.era} · 能量 ${body.hp} · 燃料 ${body.fuel} · 等待 ${body.delay} · 射界 ${body.angleMin}°–${body.angleMax}° · ${shots}${rage}`;
}

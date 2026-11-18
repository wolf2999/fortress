/** 与 Server/config/items.lua 同一张表。kit 只给本地双人，不花 CRING。 */
export interface ItemDef {
  id: number;
  name: string;
  price: number;
  kind: "double" | "heal";
  heal: number;
  lockMove: number;
  kit: number;
  blurb: string;
}

export const ITEMS: ItemDef[] = [
  { id: 1, name: "双发", price: 20000, kind: "double", heal: 0, lockMove: 0, kit: 3, blurb: "这回合打出两发，等待 +200" },
  { id: 2, name: "小补", price: 5000, kind: "heal", heal: 0.2, lockMove: 0, kit: 2, blurb: "回复 20% 能量，还能移动，等待 +200" },
  { id: 3, name: "大补", price: 12000, kind: "heal", heal: 0.4, lockMove: 1, kit: 1, blurb: "回复 40% 能量，这回合不能移动，等待 +200" },
];

export function itemById(id: number | undefined): ItemDef | undefined {
  return ITEMS.find((item) => item.id === id);
}

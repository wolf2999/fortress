import * as Phaser from "phaser";
import { BattleScene } from "./game/BattleScene";
import {
  bootLocal,
  connectOnline,
  createRoom,
  currentAim,
  getNotice,
  getRoom,
  getRoomList,
  getScreen,
  joinRoom,
  leaveRoom,
  returnRoom,
  selectBody,
  selectMap,
  selectTeam,
  setAim,
  showBot,
  showGate,
  showMenu,
  startGame,
  subscribe,
  toggleReady,
  tryFire,
  tryMove,
  useItem,
  windText,
  enterLobby,
  getMode,
  getState,
  getBag,
  buyItem,
  equipItem,
} from "./game/controller";
import { angleWindow } from "./sim/rules";
import { MAPS, MOVE_COST } from "./sim/constants";
import { ITEMS, itemById } from "./sim/items";
import { ERAS, TANKS, bodyBlurb, fuelMaxOf, tankById, weaponsOf } from "./sim/tanks";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  backgroundColor: "#1b2838",
  width: 960,
  height: 540,
  banner: false,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540,
  },
  scene: [BattleScene],
});

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少节点 #${id}`);
  return node as T;
}

const angle = el<HTMLInputElement>("angle");
const power = el<HTMLInputElement>("power");
const account = el<HTMLInputElement>("account");
const password = el<HTMLInputElement>("password");
const botAccount = el<HTMLInputElement>("bot-account");
const botPassword = el<HTMLInputElement>("bot-password");
const roomId = el<HTMLInputElement>("room-id");
let canvasOn = false;

function show(id: string, on: boolean): void {
  el(id).classList.toggle("hidden", !on);
}

function fillSide(id: string, members: { name: string; host: number; ready: number; body: number }[]): void {
  const list = el<HTMLUListElement>(id);
  list.replaceChildren();
  if (members.length === 0) {
    const item = document.createElement("li");
    item.textContent = "空";
    list.append(item);
    return;
  }
  for (const member of members) {
    const item = document.createElement("li");
    const role = member.host === 1 ? "房主 " : "";
    const ready = member.ready === 1 ? "已准备" : "未准备";
    const kind = tankById(member.body)?.name ?? "";
    item.textContent = `${role}${member.name} · ${kind} · ${ready}`;
    list.append(item);
  }
}

function paintWeapons(bodyId: number | undefined, selected: number): void {
  const bar = el("weapon-bar");
  bar.replaceChildren();
  for (const weapon of weaponsOf(bodyId)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.weapon = String(weapon.id);
    btn.textContent = weapon.name;
    btn.classList.toggle("on", weapon.id === selected);
    bar.append(btn);
  }
}

function fillBodySelect(id: string): void {
  const select = el<HTMLSelectElement>(id);
  for (const era of ERAS) {
    const group = document.createElement("optgroup");
    group.label = era;
    for (const body of TANKS.filter((item) => item.era === era)) {
      const opt = document.createElement("option");
      opt.value = String(body.id);
      opt.textContent = body.name;
      if (body.id === 4) opt.selected = true;
      group.append(opt);
    }
    select.append(group);
  }
}

function picked(id: string): number {
  return Number(el<HTMLSelectElement>(id).value) || 4;
}

function paintRoomList(): void {
  const list = el("room-list");
  list.replaceChildren();
  const rooms = getRoomList();
  if (rooms.length === 0) {
    const item = document.createElement("li");
    item.textContent = "还没有房间";
    list.append(item);
    return;
  }
  for (const brief of rooms) {
    const item = document.createElement("li");
    const btn = document.createElement("button");
    const map = MAPS.find((entry) => entry.id === brief.mapId)?.name ?? "地图";
    const phase = brief.phase === "play" ? "对局中" : brief.phase === "over" ? "已结束" : "等待中";
    const fighters = brief.red + brief.blue;
    btn.dataset.room = String(brief.roomId);
    btn.disabled = brief.phase !== "lobby" || brief.count >= 8;
    btn.textContent = `${brief.roomId}  ${map}  ${phase}  红${brief.red} 蓝${brief.blue}  准备${brief.ready}/${fighters}  ${brief.count}/8  ${brief.host}`;
    item.append(btn);
    list.append(item);
  }
}

function paint(): void {
  const screen = getScreen();
  const match = getState();
  const aim = currentAim();
  const room = getRoom();
  const notice = getNotice();

  show("panel-menu", screen === "menu");
  show("panel-bot", screen === "bot");
  show("panel-gate", screen === "gate");
  show("panel-room", screen === "room");
  show("hud", screen === "battle");
  const showCanvas = screen === "room" || screen === "battle";
  show("app", showCanvas);
  if (showCanvas && !canvasOn) game.scale.refresh();
  canvasOn = showCanvas;

  el("bot-msg").textContent = screen === "bot" ? notice : "";
  el("gate-msg").textContent = screen === "gate" ? notice : "";
  if (screen === "gate") paintRoomList();

  if (room && screen === "room") {
    const mine = room.members.find((m) => m.seat === room.you);
    const host = mine?.host === 1;
    const count = (team: number) => room.members.filter((m) => m.team === team).length;
    const red = count(0);
    const blue = count(1);
    const fightersReady = room.members.filter((m) => m.team !== 2).every((m) => m.ready === 1);
    const balanced = red > 0 && red === blue;
    el("room-title").textContent = `房间 ${room.roomId} · ${room.members.length}/8`;
    const block = red === 0 || blue === 0 ? "两边都要有人" : red !== blue ? "双方人数必须相同" : !fightersReady ? "还有人没准备" : "";
    el("room-log").textContent = [notice, room.log, block].filter(Boolean).join(" · ");
    el<HTMLButtonElement>("btn-map-1").disabled = !host;
    el<HTMLButtonElement>("btn-map-2").disabled = !host;
    el<HTMLButtonElement>("btn-map-1").classList.toggle("on", room.mapId === 1);
    el<HTMLButtonElement>("btn-map-2").classList.toggle("on", room.mapId === 2);
    el("side-a-title").textContent = `红方 ${red}/4`;
    el("side-b-title").textContent = `蓝方 ${blue}/4`;
    fillSide("side-a", room.members.filter((m) => m.team === 0));
    fillSide("side-b", room.members.filter((m) => m.team === 1));
    const watchers = room.members.filter((m) => m.team === 2).map((m) => m.name);
    el("side-ob").textContent = watchers.length ? `观战：${watchers.join("、")}` : "观战：无";
    el<HTMLButtonElement>("btn-team-a").disabled = mine?.team === 0 || red >= 4;
    el<HTMLButtonElement>("btn-team-b").disabled = mine?.team === 1 || blue >= 4;
    el<HTMLButtonElement>("btn-team-ob").disabled = mine?.team === 2;
    el<HTMLButtonElement>("btn-team-a").classList.toggle("on", mine?.team === 0);
    el<HTMLButtonElement>("btn-team-b").classList.toggle("on", mine?.team === 1);
    el<HTMLButtonElement>("btn-team-ob").classList.toggle("on", mine?.team === 2);
    const readyBtn = el<HTMLButtonElement>("btn-ready");
    readyBtn.disabled = mine?.team === 2;
    readyBtn.textContent = mine?.ready === 1 ? "取消准备" : "准备";
    el<HTMLButtonElement>("btn-start").disabled = !host || !balanced || !fightersReady;
    document.querySelectorAll<HTMLButtonElement>("#body-picks button").forEach((btn) => {
      btn.classList.toggle("on", Number(btn.dataset.body) === (mine?.body ?? 4));
    });
    el("body-detail").textContent = bodyBlurb(mine?.body ?? 4);
  }

  const aimOwner = match.tanks.find((tank) => tank.seat === (getMode() === "local" ? match.turn : match.you)) ?? match.tanks.find((tank) => tank.seat === match.turn);
  const [aimLo, aimHi] = angleWindow(aimOwner);
  angle.min = String(aimLo);
  angle.max = String(aimHi);
  if (document.activeElement !== angle) angle.value = String(aim.angle);
  if (document.activeElement !== power) power.value = String(aim.power);
  el("angle-val").textContent = `${aim.angle}°`;
  el("power-val").textContent = String(aim.power);
  el("wind").textContent = windText(match.wind);
  const actor = match.tanks.find((tank) => tank.seat === match.turn);
  const who = actor ? `${actor.name}·${tankById(actor.body)?.name ?? ""}` : "";
  const fuel = actor?.fuel ?? 0;
  const fuelMax = actor ? (actor.maxFuel ?? fuelMaxOf(actor.body)) : 0;
  el("hp").textContent = match.tanks
    .map((tank) => {
      const mark = [tank.poison ? `毒${tank.poison}` : "", tank.frozen ? `冻${tank.frozen}` : ""].filter(Boolean).join("");
      return `${(tank.team ?? tank.seat) === 1 ? "蓝" : "红"} ${tank.name}·${tankById(tank.body)?.name ?? ""} ${tank.hp}/${tank.maxHp}${mark ? " " + mark : ""}`;
    })
    .join("    ");
  el("fuel").textContent = screen === "battle" && match.phase !== "preview" ? `燃料 ${fuel}/${fuelMax} · 等待 ${actor?.wait ?? 0}` : "";
  const modeLabel = getMode() === "online" ? "联机" : "本地";
  const turnLabel = match.phase === "aim" ? `轮到 ${who}` : "";
  const hint = match.phase === "aim" && fuel < MOVE_COST ? "燃料用完了，请开炮" : match.log;
  el("log").textContent = [modeLabel, turnLabel, hint].filter(Boolean).join(" · ");
  const showEnd = screen === "battle" && room?.phase === "over" && match.phase === "over";
  show("end", showEnd);
  el("end-text").textContent = match.log;
  const fire = el<HTMLButtonElement>("btn-fire");
  fire.textContent = !room && match.phase === "over" ? "再来一局" : "发射";
  fire.disabled = showEnd;
  const owner = match.tanks.find((tank) => tank.seat === (getMode() === "local" ? match.turn : match.you)) ?? actor;
  paintWeapons(owner?.body, aim.weapon);
  paintItems(match, screen === "battle");
  paintShop(screen === "room" && getMode() === "online");
}

function paintShop(on: boolean): void {
  const shop = el("shop");
  shop.classList.toggle("hidden", !on);
  if (!on) return;
  const bag = getBag();
  el("cring").textContent = `CRING ${bag.cring.toLocaleString("zh-CN")}`;
  const list = el("shop-list");
  list.innerHTML = "";
  for (const item of ITEMS) {
    const row = document.createElement("div");
    row.className = "row";
    const owned = bag.stock.find((slot) => slot.item === item.id)?.qty ?? 0;
    const label = document.createElement("span");
    label.textContent = `${item.name} ${item.price.toLocaleString("zh-CN")}  持有 ${owned}  ${item.blurb}`;
    row.append(label);
    const buy = document.createElement("button");
    buy.type = "button";
    buy.dataset.buy = String(item.id);
    buy.textContent = "买入";
    buy.disabled = bag.cring < item.price;
    row.append(buy);
    for (let slot = 1; slot <= 4; slot += 1) {
      const put = document.createElement("button");
      put.type = "button";
      put.dataset.equip = String(slot);
      put.dataset.item = String(item.id);
      put.textContent = `放${slot}`;
      put.disabled = owned < 1;
      row.append(put);
    }
    list.append(row);
  }
  const carried = [1, 2, 3, 4].map((slot) => {
    const found = bag.loadout.find((row) => row.slot === slot && row.item > 0);
    const name = found ? `${itemById(found.item)?.name ?? "道具"}×${found.qty}` : "空";
    return `${slot} ${name}`;
  });
  el("loadout").textContent = `出战格子 ${carried.join("  ")}`;
  const clear = document.createElement("div");
  clear.className = "row";
  for (let slot = 1; slot <= 4; slot += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.equip = String(slot);
    btn.dataset.item = "0";
    btn.textContent = `卸${slot}`;
    clear.append(btn);
  }
  list.append(clear);
}

function paintItems(match: ReturnType<typeof getState>, on: boolean): void {
  const bar = el("item-bar");
  bar.innerHTML = "";
  if (!on) return;
  const bag = getBag();
  const mine = match.tanks.find((tank) => tank.seat === (getMode() === "local" ? match.turn : match.you));
  for (let slot = 1; slot <= 4; slot += 1) {
    const found = bag.loadout.find((row) => row.slot === slot);
    const item = itemById(found?.item);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.use = String(slot);
    const qty = found?.qty ?? 0;
    const armed = item?.kind === "double" && mine?.armed === 1 ? " 已准备" : "";
    btn.textContent = item && qty > 0 ? `${item.name}×${qty}${armed}` : `${slot} 空`;
    btn.disabled = !item || qty < 1 || match.phase !== "aim";
    bar.append(btn);
  }
  if (mine?.still === 1) {
    const tip = document.createElement("span");
    tip.textContent = "这回合不能移动";
    bar.append(tip);
  }
}

angle.addEventListener("input", () => setAim({ angle: Number(angle.value) }));
power.addEventListener("input", () => setAim({ power: Number(power.value) }));
el("btn-fire").addEventListener("click", () => tryFire());
el("btn-left").addEventListener("click", () => tryMove(-1));
el("btn-right").addEventListener("click", () => tryMove(1));
el("btn-enter").addEventListener("click", () => {
  showGate();
  void enterLobby(account.value, password.value);
});
el("btn-bot-entry").addEventListener("click", () => showBot());
el("btn-bot-back").addEventListener("click", () => showMenu());
el("btn-gate-back").addEventListener("click", () => showMenu());
el("btn-local").addEventListener("click", () => bootLocal(picked("pick-self"), picked("pick-foe")));
el("btn-vs-bot").addEventListener("click", () => void connectOnline(botAccount.value, picked("pick-self"), picked("pick-foe"), botPassword.value));
el("btn-create").addEventListener("click", () => void createRoom(account.value, password.value));
el("room-list").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn || btn.disabled) return;
  void joinRoom(account.value, Number(btn.dataset.room), password.value);
});
el("btn-join").addEventListener("click", () => void joinRoom(account.value, Number(roomId.value), password.value));
el("btn-map-1").addEventListener("click", () => void selectMap(1));
el("btn-map-2").addEventListener("click", () => void selectMap(2));
el("btn-team-a").addEventListener("click", () => void selectTeam(0));
el("btn-team-b").addEventListener("click", () => void selectTeam(1));
el("btn-team-ob").addEventListener("click", () => void selectTeam(2));
el("btn-ready").addEventListener("click", () => void toggleReady());
el("btn-start").addEventListener("click", () => void startGame());
el("btn-leave").addEventListener("click", () => void leaveRoom());
el("btn-return").addEventListener("click", () => void returnRoom());
el("shop-list").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn) return;
  if (btn.dataset.buy) void buyItem(Number(btn.dataset.buy));
  if (btn.dataset.equip) void equipItem(Number(btn.dataset.equip), Number(btn.dataset.item));
});
el("item-bar").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn?.dataset.use) return;
  useItem(Number(btn.dataset.use));
});
el("weapon-bar").addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn?.dataset.weapon) return;
  setAim({ weapon: Number(btn.dataset.weapon) });
});
fillBodySelect("pick-self");
fillBodySelect("pick-foe");
const bodyPicks = el("body-picks");
for (const era of ERAS) {
  const box = document.createElement("div");
  box.className = "body-era";
  const title = document.createElement("h3");
  title.textContent = era;
  const row = document.createElement("div");
  row.className = "row";
  for (const body of TANKS.filter((item) => item.era === era)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.dataset.body = String(body.id);
    btn.textContent = body.name;
    row.append(btn);
  }
  box.append(title, row);
  bodyPicks.append(box);
}
bodyPicks.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest("button");
  if (!btn?.dataset.body) return;
  void selectBody(Number(btn.dataset.body));
});

subscribe(paint);
paint();

(window as unknown as { __GAME__: Phaser.Game }).__GAME__ = game;

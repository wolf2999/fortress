import { SprotoCodec } from "../net/codec";
import { NetSocket } from "../net/socket";
import { MAPS, TERRAIN_HEIGHT, TERRAIN_KINDS, TERRAIN_MASK, TURN_SEC, TURN_WAIT } from "../sim/constants";
import {
  angleWindow,
  createMatch,
  defaultAngle,
  makeTerrain,
  maskByteCount,
  preview,
  resolveExpire,
  resolveFire,
  resolveMove,
  resolveUse,
  rollWind,
  type MatchState,
  type ShotPath,
  type Tank,
  type TerrainMask,
} from "../sim/rules";
import { ITEMS } from "../sim/items";
import { DEFAULT_BODY, fuelMaxOf, weaponsOf } from "../sim/tanks";

export interface Aim {
  angle: number;
  power: number;
  weapon: number;
}

export interface Flight {
  shots: ShotPath[];
  next: MatchState;
}

type Mode = "local" | "online";
export type Screen = "menu" | "bot" | "gate" | "room" | "battle";

export interface RoomMember {
  seat: number;
  name: string;
  ready: number;
  host: number;
  team: number;
  body: number;
}

export interface RoomBrief {
  roomId: number;
  mapId: number;
  terrainKind: number;
  phase: string;
  count: number;
  red: number;
  blue: number;
  host: string;
  ready: number;
}

export interface RoomView {
  roomId: number;
  mapId: number;
  terrainKind: number;
  phase: string;
  you: number;
  log: string;
  members: RoomMember[];
}

export interface BagSlot {
  slot: number;
  item: number;
  qty: number;
}

export interface BagView {
  cring: number;
  stock: BagSlot[];
  loadout: BagSlot[];
}

type Listener = () => void;

const listeners = new Set<Listener>();
const aims: Aim[] = [
  { angle: 60, power: 550, weapon: 1 },
  { angle: 120, power: 550, weapon: 1 },
];

let mode: Mode = "local";
let screen: Screen = "menu";
let room: RoomView | null = null;
let roomList: RoomBrief[] = [];
let notice = "";
let state: MatchState = createMatch(1, ["红方", "蓝方"]);
let localBodies: [number, number] = [DEFAULT_BODY, DEFAULT_BODY];
let onlineBody = DEFAULT_BODY;
let onlineBotBody = DEFAULT_BODY;
let pickMapId = 1;
let pickTerrainKind = TERRAIN_HEIGHT;
let localMapId = 1;
let localTerrainKind = TERRAIN_HEIGHT;
let queue: Flight[] = [];
let socket: NetSocket | null = null;
let codec: SprotoCodec | null = null;
let session = 1;
let sendLock = false;
let authed = false;
let connected = false;
let ignoreClose = 0;
let onlineBag: BagView = { cring: 0, stock: [], loadout: [] };
let localBags: [BagView, BagView] = [freshKit(), freshKit()];

function freshKit(): BagView {
  const stock = ITEMS.map((item) => ({ slot: 0, item: item.id, qty: item.kit }));
  const loadout = [1, 2, 3, 0].map((item, index) => ({
    slot: index + 1,
    item,
    qty: stock.find((row) => row.item === item)?.qty ?? 0,
  }));
  return { cring: 0, stock, loadout };
}

function syncKit(bag: BagView): void {
  for (const slot of bag.loadout) {
    slot.qty = slot.item ? bag.stock.find((row) => row.item === slot.item)?.qty ?? 0 : 0;
  }
}

export function getBag(): BagView {
  if (mode === "local") return localBags[state.turn === 1 ? 1 : 0];
  return onlineBag;
}
const pending = new Map<number, { name: string; resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();

let clockLeft = TURN_SEC;
let clockAt = 0;
let clockKey = "";

function emit(): void {
  followClock();
  listeners.forEach((fn) => fn());
}

function followClock(): void {
  if (state.phase !== "aim") {
    clockAt = 0;
    clockKey = "";
    return;
  }
  if (mode === "local") {
    const key = `${state.matchId}:${state.turn}`;
    if (key === clockKey) return;
    clockKey = key;
    clockLeft = TURN_SEC;
    clockAt = Date.now();
    return;
  }
  const key = `${state.matchId}:${state.turn}:${state.rev}`;
  if (key === clockKey) return;
  clockKey = key;
  clockLeft = state.clock ?? TURN_SEC;
  clockAt = Date.now();
}

export function clockSeconds(): number {
  if (state.phase !== "aim" || clockAt <= 0) return 0;
  const left = clockLeft - Math.floor((Date.now() - clockAt) / 1000);
  return left > 0 ? left : 0;
}

export function clockText(): string {
  if (state.phase !== "aim" || clockAt <= 0) return "";
  const left = clockSeconds();
  const extra = (TURN_SEC - left) * TURN_WAIT;
  return extra > 0 ? `剩余 ${left} 秒 · 等待 +${extra}` : `剩余 ${left} 秒`;
}

function thinkSeconds(): number {
  return TURN_SEC - clockSeconds();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getState(): MatchState {
  return state;
}

export function getMode(): Mode {
  return mode;
}

export function getScreen(): Screen {
  return screen;
}

export function getRoom(): RoomView | null {
  return room;
}

export function getRoomList(): RoomBrief[] {
  return roomList;
}

export function getNotice(): string {
  return notice;
}

export function showMenu(): void {
  screen = "menu";
  emit();
  if (codec && socket && connected && authed) {
    void request("csLeaveLobby", { nonce: 1 }).catch(() => undefined);
  }
}

export function showBot(): void {
  screen = "bot";
  emit();
}

export function showGate(): void {
  screen = "gate";
  notice = "";
  emit();
}

export function peekFlight(): Flight | null {
  return queue[0] ?? null;
}

export function finishFlight(): void {
  const job = queue.shift();
  if (job) state = job.next;
  emit();
}

export function aimSeat(): number {
  return mode === "local" ? state.turn : state.you;
}

function aimTank(): Tank | undefined {
  return state.tanks.find((item) => item.seat === aimSeat());
}

function fitAim(seat: number, reset: boolean): void {
  const tank = state.tanks.find((item) => item.seat === seat);
  const owned = weaponsOf(tank?.body);
  const [lo, hi] = angleWindow(tank);
  const prev = aims[seat];
  if (!prev || reset) {
    aims[seat] = { angle: defaultAngle(tank), power: 550, weapon: owned[0].id };
    return;
  }
  if (prev.angle < lo || prev.angle > hi) prev.angle = defaultAngle(tank);
  if (!owned.some((weapon) => weapon.id === prev.weapon)) prev.weapon = owned[0].id;
}

export function currentAim(): Aim {
  const seat = aimSeat();
  fitAim(seat, false);
  return aims[seat];
}

export function setAim(patch: Partial<Aim>): void {
  const aim = currentAim();
  const tank = aimTank();
  const [lo, hi] = angleWindow(tank);
  if (patch.angle !== undefined) {
    let angle = Math.round(patch.angle);
    if (angle < lo) angle = lo;
    if (angle > hi) angle = hi;
    aim.angle = angle;
  }
  if (patch.power !== undefined) aim.power = Math.max(1, Math.min(1000, Math.round(patch.power)));
  if (patch.weapon !== undefined && weaponsOf(tank?.body).some((weapon) => weapon.id === patch.weapon)) {
    aim.weapon = patch.weapon;
  }
  emit();
}

export function canControl(): boolean {
  if (screen !== "battle") return false;
  if (state.phase !== "aim" || queue.length > 0) return false;
  if (mode === "local") return true;
  return state.turn === state.you && state.tanks.find((tank) => tank.seat === state.you)?.bot !== 1;
}

export function windText(wind = state.wind): string {
  if (wind > 0) return `风 → ${wind}`;
  if (wind < 0) return `风 ← ${-wind}`;
  return "无风";
}

export function aimLine(): ShotPath | null {
  if (!canControl()) return null;
  const aim = currentAim();
  return preview(state, aimSeat(), aim.angle, aim.power, aim.weapon);
}

function note(log: string): void {
  state = { ...state, log };
  emit();
}

export function getPickMapId(): number {
  return pickMapId;
}

export function getPickTerrainKind(): number {
  return pickTerrainKind;
}

export function setPickMap(mapId: number, terrainKind?: number): void {
  if (MAPS.some((item) => item.id === mapId)) pickMapId = mapId;
  if (terrainKind !== undefined && TERRAIN_KINDS.some((item) => item.id === terrainKind)) {
    pickTerrainKind = terrainKind;
  }
  emit();
}

export function bootLocal(red = localBodies[0], blue = localBodies[1], mapId = pickMapId, terrainKind = pickTerrainKind): void {
  closeSocket();
  pending.clear();
  queue = [];
  mode = "local";
  room = null;
  screen = "battle";
  notice = "";
  sendLock = false;
  localBodies = [red || DEFAULT_BODY, blue || DEFAULT_BODY];
  localMapId = MAPS.some((item) => item.id === mapId) ? mapId : 1;
  localTerrainKind = TERRAIN_KINDS.some((item) => item.id === terrainKind) ? terrainKind : TERRAIN_HEIGHT;
  pickMapId = localMapId;
  pickTerrainKind = localTerrainKind;
  localBags = [freshKit(), freshKit()];
  const seed = Math.floor(Date.now() % 100000) + 1;
  state = createMatch(seed, ["红方", "蓝方"], localBodies, localMapId, localTerrainKind);
  for (const tank of state.tanks) fitAim(tank.seat, true);
  emit();
}

export function useItem(slot: number): void {
  if (screen !== "battle" || !canControl()) return;
  const seat = aimSeat();
  if (mode === "local") {
    const bag = localBags[seat === 1 ? 1 : 0];
    const carried = bag.loadout.find((row) => row.slot === slot);
    const owned = bag.stock.find((row) => row.item === carried?.item);
    if (!carried?.item || !owned || owned.qty < 1) {
      note("这一格是空的");
      return;
    }
    const result = resolveUse(state, seat, carried.item);
    if (!result.ok) {
      note(result.msg);
      return;
    }
    owned.qty -= 1;
    syncKit(bag);
    state = result.next;
    emit();
    return;
  }
  if (sendLock) return;
  sendLock = true;
  void request("csUseItem", { slot })
    .then((res) => {
      if (num(res.ok) !== 1) note(String(res.msg || "道具没生效"));
    })
    .catch((err: Error) => note(err.message))
    .finally(() => {
      sendLock = false;
    });
}

export async function buyItem(item: number): Promise<void> {
  const res = await request("csBuy", { item });
  notice = num(res.ok) === 1 ? String(res.msg || "已买入") : String(res.msg || "购买失败");
  emit();
}

export async function equipItem(slot: number, item: number): Promise<void> {
  const res = await request("csEquip", { slot, item });
  notice = num(res.ok) === 1 ? String(res.msg || "格子已更新") : String(res.msg || "装备失败");
  emit();
}

export function tryMove(dir: -1 | 1): void {
  if (screen !== "battle" || !canControl()) return;
  const seat = aimSeat();
  if (mode === "local") {
    const result = resolveMove(state, seat, dir);
    if (!result.ok) {
      note(result.msg);
      return;
    }
    state = result.next;
    emit();
    return;
  }
  if (sendLock) return;
  sendLock = true;
  void request("csMove", { dir })
    .then((res) => {
      if (num(res.ok) !== 1) note(String(res.msg || "移动失败"));
    })
    .catch((err: Error) => note(err.message))
    .finally(() => {
      sendLock = false;
    });
}

export function tryFire(): void {
  if (screen !== "battle") return;
  if (state.phase === "over") {
    if (room) return;
    if (mode === "local") bootLocal();
    else void connectOnline(lastName);
    return;
  }
  if (!canControl()) return;
  const seat = aimSeat();
  const aim = currentAim();
  if (mode === "local") {
    const result = resolveFire(state, seat, aim.angle, aim.power, aim.weapon, rollWind(), thinkSeconds());
    if (!result.ok) {
      note(result.msg);
      return;
    }
    queue.push({ shots: result.shots, next: result.next });
    emit();
    return;
  }
  if (sendLock) return;
  sendLock = true;
  void request("csFire", { angle: aim.angle, power: aim.power, weapon: aim.weapon })
    .then((res) => {
      if (num(res.ok) !== 1) note(String(res.msg || "发射失败"));
    })
    .catch((err: Error) => note(err.message))
    .finally(() => {
      sendLock = false;
    });
}

let lastName = "炮手";
let lastPassword = "";
let authedName = "";

function hasTerrain(match: MatchState): boolean {
  if (match.terrainKind === TERRAIN_MASK) return !!(match.mask && match.mask.length >= maskByteCount());
  return match.terrain.length > 10;
}

function waitForMatch(ms: number): Promise<void> {
  if (state.matchId > 0 && hasTerrain(state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      off();
      reject(new Error("没有收到对局"));
    }, ms);
    const off = subscribe(() => {
      if (state.matchId > 0 && hasTerrain(state)) {
        window.clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

export async function connectOnline(name: string, body = onlineBody, botBody = onlineBotBody, password?: string): Promise<void> {
  screen = "battle";
  room = null;
  notice = "";
  state = { ...state, matchId: -1, rev: 0, log: "正在连接 ws://127.0.0.1:8090" };
  emit();
  try {
    onlineBody = body || DEFAULT_BODY;
    onlineBotBody = botBody || DEFAULT_BODY;
    await ensureOnline(name, password);
    const join = await request("csJoinBattle", {
      nonce: 1,
      body: onlineBody,
      botBody: onlineBotBody,
      mapId: pickMapId,
      terrainKind: pickTerrainKind,
    });
    if (num(join.ok) !== 1) throw new Error(String(join.msg || "加入失败"));
    await waitForMatch(3000);
    note(String(join.msg || "已连接"));
  } catch (err) {
    closeSocket();
    mode = "local";
    screen = "bot";
    notice = err instanceof Error ? err.message : "连接失败";
    emit();
  }
}

export async function enterLobby(name: string, password?: string): Promise<void> {
  try {
    await ensureOnline(name, password);
    const res = await request("csEnterLobby", { nonce: 1 });
    if (num(res.ok) !== 1) throw new Error(String(res.msg || "进不了大厅"));
  } catch (err) {
    notice = err instanceof Error ? err.message : "进不了大厅";
    emit();
  }
}

export async function createRoom(name: string, password?: string): Promise<void> {
  notice = "正在创建房间";
  emit();
  try {
    await ensureOnline(name, password);
    const res = await request("csCreateRoom", { nonce: 1 });
    if (num(res.ok) !== 1) throw new Error(String(res.msg || "创建失败"));
    notice = "";
  } catch (err) {
    notice = err instanceof Error ? err.message : "创建失败";
    emit();
  }
}

export async function joinRoom(name: string, roomId: number, password?: string): Promise<void> {
  if (!Number.isFinite(roomId) || roomId <= 0) {
    notice = "请输入房间号";
    emit();
    return;
  }
  notice = "正在加入房间";
  emit();
  try {
    await ensureOnline(name, password);
    const res = await request("csJoinRoom", { roomId });
    if (num(res.ok) !== 1) throw new Error(String(res.msg || "加入失败"));
    notice = "";
  } catch (err) {
    notice = err instanceof Error ? err.message : "加入失败";
    emit();
  }
}

export async function selectMap(mapId: number, terrainKind?: number): Promise<void> {
  const mine = room?.members.find((m) => m.seat === room?.you);
  if (!room || mine?.host !== 1 || room.phase !== "lobby") return;
  const nextMap = MAPS.some((item) => item.id === mapId) ? mapId : room.mapId;
  const nextKind =
    terrainKind !== undefined && TERRAIN_KINDS.some((item) => item.id === terrainKind)
      ? terrainKind
      : room.terrainKind || TERRAIN_HEIGHT;
  try {
    const res = await request("csSelectMap", { mapId: nextMap, terrainKind: nextKind });
    if (num(res.ok) !== 1) {
      notice = String(res.msg || "换地图失败");
      emit();
    }
  } catch (err) {
    notice = err instanceof Error ? err.message : "换地图失败";
    emit();
  }
}

export async function selectBody(body: number): Promise<void> {
  if (!room || room.phase !== "lobby") return;
  try {
    const res = await request("csSelectBody", { body });
    if (num(res.ok) !== 1) {
      notice = String(res.msg || "换坦克失败");
      emit();
    }
  } catch (err) {
    notice = err instanceof Error ? err.message : "换坦克失败";
    emit();
  }
}

export async function selectTeam(team: number): Promise<void> {
  if (!room || room.phase !== "lobby") return;
  try {
    const res = await request("csSelectTeam", { team });
    if (num(res.ok) !== 1) {
      notice = String(res.msg || "换队失败");
      emit();
    }
  } catch (err) {
    notice = err instanceof Error ? err.message : "换队失败";
    emit();
  }
}

export async function toggleReady(): Promise<void> {
  if (!room || room.phase !== "lobby") return;
  const mine = room.members.find((m) => m.seat === room!.you);
  if (!mine || mine.team === 2) {
    notice = "观战不用准备";
    emit();
    return;
  }
  const ready = mine?.ready === 1 ? 0 : 1;
  try {
    const res = await request("csReady", { ready });
    if (num(res.ok) !== 1) {
      notice = String(res.msg || "准备失败");
      emit();
    }
  } catch (err) {
    notice = err instanceof Error ? err.message : "准备失败";
    emit();
  }
}

export async function startGame(): Promise<void> {
  const mine = room?.members.find((m) => m.seat === room?.you);
  if (!room || mine?.host !== 1) return;
  try {
    const res = await request("csStartGame", { nonce: 1 });
    if (num(res.ok) !== 1) {
      notice = String(res.msg || "还不能开始");
      emit();
    } else {
      notice = "";
    }
  } catch (err) {
    notice = err instanceof Error ? err.message : "开始失败";
    emit();
  }
}

export async function returnRoom(): Promise<void> {
  try {
    const res = await request("csReturnRoom", { nonce: 1 });
    if (num(res.ok) !== 1) {
      notice = String(res.msg || "回不去房间");
      emit();
    }
  } catch (err) {
    notice = err instanceof Error ? err.message : "回不去房间";
    emit();
  }
}

export async function leaveRoom(): Promise<void> {
  try {
    await request("csLeaveRoom", { nonce: 1 });
  } catch {
    /* 离开失败也先回到大厅 */
  }
  room = null;
  screen = "gate";
  notice = "";
  emit();
  void enterLobby(lastName);
}

async function ensureOnline(name: string, password?: string): Promise<void> {
  const account = name.trim();
  if (!account) throw new Error("请填写名字");
  const pass = password !== undefined ? password : lastPassword;
  if (pass.length < 4 || pass.length > 32) throw new Error("密码要 4 到 32 位");
  lastName = account;
  lastPassword = pass;
  if (codec && socket && connected && authed && mode === "online" && authedName === account) return;
  closeSocket();
  pending.clear();
  queue = [];
  mode = "online";
  authed = false;
  authedName = "";
  connected = false;
  if (!codec) {
    codec = await SprotoCodec.load(["./protocol/gateway.sproto", "./protocol/battle.sproto"]);
  }
  await openSocket();
  const auth = await request("rpcAuthClient", { account, password: pass });
  if (num(auth.ok) !== 1) throw new Error(String(auth.msg || "登录失败"));
  authed = true;
  authedName = account;
}

function closeSocket(): void {
  if (!socket) return;
  ignoreClose += 1;
  socket.close();
  socket = null;
  connected = false;
  authed = false;
  authedName = "";
}

function openSocket(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("连接超时")), 4000);
    socket = new NetSocket(
      "ws://127.0.0.1:8090",
      onBytes,
      () => {
        connected = true;
        window.clearTimeout(timer);
        resolve();
      },
      () => {
        connected = false;
        if (ignoreClose > 0) {
          ignoreClose -= 1;
          return;
        }
        authed = false;
        socket?.close();
        if (mode !== "online") return;
        const backToGate = room !== null || screen === "room" || screen === "gate";
  room = null;
  roomList = [];
  notice = "与服务器断开";
        screen = backToGate ? "gate" : "bot";
        emit();
      },
    );
    socket.connect();
  });
}

function request(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!codec || !socket) return Promise.reject(new Error("未连接"));
  const id = session++;
  const bytes = codec.encodeRequest(name, args, id);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${name} 超时`));
    }, 5000);
    pending.set(id, {
      name,
      resolve: (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    });
    socket!.send(bytes);
  });
}

function onBytes(bytes: Uint8Array): void {
  if (!codec) return;
  let pkg;
  try {
    pkg = codec.decodePackage(bytes);
  } catch (err) {
    note(err instanceof Error ? err.message : "解码失败");
    return;
  }
  if (pkg.type) {
    const def = codec.getByTag(pkg.type);
    if (!def?.req) return;
    const body = codec.decodeStruct(def.req, pkg.body);
    if (def.name === "scState") applyState(readState(body));
    if (def.name === "scRoom") applyRoom(body);
    if (def.name === "scRoomList") applyRoomList(body);
    if (def.name === "scBag") applyBag(body);
    if (def.name === "scResolve") {
      const shots = readShots(body.shots);
      const next = readState((body.state ?? {}) as Record<string, unknown>);
      queue.push({ shots, next });
      emit();
    }
    return;
  }
  if (pkg.session) {
    const waiter = pending.get(pkg.session);
    if (!waiter) return;
    pending.delete(pkg.session);
    const def = codec.get(waiter.name);
    const body = def?.res ? codec.decodeStruct(def.res, pkg.body) : {};
    waiter.resolve(body);
  }
}

function applyState(next: MatchState): void {
  if (queue.some((job) => job.next.matchId === next.matchId && job.next.rev >= next.rev)) return;
  if (next.matchId > 0 && next.matchId === state.matchId && next.rev <= state.rev) return;
  state = next;
  for (const tank of state.tanks) fitAim(tank.seat, false);
  if (room && (next.phase === "aim" || next.phase === "over")) screen = "battle";
  emit();
}

function applyBag(raw: Record<string, unknown>): void {
  onlineBag = {
    cring: num(raw.cring),
    stock: objList(raw.stock).map((item) => ({ slot: num(item.slot), item: num(item.item), qty: num(item.qty) })),
    loadout: objList(raw.loadout).map((item) => ({ slot: num(item.slot), item: num(item.item), qty: num(item.qty) })),
  };
  emit();
}

function applyRoomList(raw: Record<string, unknown>): void {
  roomList = objList(raw.rooms)
    .map((item) => ({
      roomId: num(item.roomId),
      mapId: num(item.mapId, 1),
      terrainKind: num(item.terrainKind, TERRAIN_HEIGHT),
      phase: String(item.phase || "lobby"),
      count: num(item.count),
      red: num(item.red),
      blue: num(item.blue),
      host: String(item.host || ""),
      ready: num(item.ready),
    }))
    .sort((a, b) => a.roomId - b.roomId);
  emit();
}

function applyRoom(raw: Record<string, unknown>): void {
  const next = readRoom(raw);
  if (next.phase === "closed") {
    room = null;
    screen = "gate";
    notice = next.log || "房间已关闭";
    emit();
    return;
  }
  room = next;
  notice = "";
  if (next.phase === "lobby") {
    screen = "room";
    const map = MAPS.find((item) => item.id === next.mapId);
    const kind = TERRAIN_KINDS.find((item) => item.id === next.terrainKind);
    const made = makeTerrain(next.roomId * 17, next.mapId, next.terrainKind || TERRAIN_HEIGHT);
    state = {
      rev: 0,
      matchId: -1,
      you: next.you,
      wind: 0,
      turn: 0,
      winner: -1,
      phase: "preview",
      log: [map?.name, kind?.name, map?.blurb, kind?.blurb].filter(Boolean).join(" · "),
      terrainKind: made.terrainKind,
      terrain: made.terrain,
      mask: made.mask,
      tanks: [],
      crates: [],
      mines: [],
      clouds: [],
    };
    queue = [];
  } else if (next.phase === "play" || next.phase === "over") {
    screen = "battle";
  }
  emit();
}

function readRoom(raw: Record<string, unknown>): RoomView {
  return {
    roomId: num(raw.roomId),
    mapId: num(raw.mapId, 1),
    terrainKind: num(raw.terrainKind, TERRAIN_HEIGHT),
    phase: String(raw.phase || "lobby"),
    you: num(raw.you),
    log: String(raw.log || ""),
    members: objList(raw.members).map((item) => ({
      seat: num(item.seat),
      name: String(item.name || ""),
      ready: num(item.ready),
      host: num(item.host),
      team: num(item.team),
      body: num(item.body, DEFAULT_BODY),
    })),
  };
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function numList(v: unknown): number[] {
  if (Array.isArray(v)) return v.map((item) => num(item));
  if (v && typeof v === "object") {
    return Object.keys(v)
      .map(Number)
      .filter((k) => Number.isFinite(k))
      .sort((a, b) => a - b)
      .map((k) => num((v as Record<number, unknown>)[k]));
  }
  return [];
}

function objList(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object") {
    return Object.keys(v)
      .map(Number)
      .filter((k) => Number.isFinite(k))
      .sort((a, b) => a - b)
      .map((k) => (v as Record<number, Record<string, unknown>>)[k]);
  }
  return [];
}

function readTank(raw: Record<string, unknown>): Tank {
  return {
    seat: num(raw.seat),
    name: String(raw.name || "坦克"),
    x: num(raw.x),
    y: num(raw.y),
    hp: num(raw.hp),
    maxHp: num(raw.maxHp, 1000),
    alive: num(raw.alive),
    fuel: num(raw.fuel, fuelMaxOf(num(raw.body, DEFAULT_BODY))),
    maxFuel: fuelMaxOf(num(raw.body, DEFAULT_BODY)),
    bot: num(raw.bot),
    team: num(raw.team, num(raw.seat)),
    body: num(raw.body, DEFAULT_BODY),
    wait: num(raw.wait),
    armed: num(raw.armed),
    still: num(raw.still),
    poison: num(raw.poison),
    frozen: num(raw.frozen),
  };
}

function readMask(v: unknown): TerrainMask | undefined {
  if (v instanceof Uint8Array) return v.length > 0 ? v : undefined;
  if (typeof ArrayBuffer !== "undefined" && v instanceof ArrayBuffer) {
    return v.byteLength > 0 ? new Uint8Array(v) : undefined;
  }
  if (typeof v === "string" && v.length > 0) {
    const out = new Uint8Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 0xff;
    return out;
  }
  return undefined;
}

function readState(raw: Record<string, unknown>): MatchState {
  const tanks = objList(raw.tanks).map(readTank).sort((a, b) => a.seat - b.seat);
  const terrainKind = num(raw.terrainKind, TERRAIN_HEIGHT);
  const mask = readMask(raw.mask);
  return {
    rev: num(raw.rev),
    matchId: num(raw.matchId),
    you: num(raw.you),
    wind: num(raw.wind),
    turn: num(raw.turn),
    winner: num(raw.winner, -1),
    phase: String(raw.phase || "aim"),
    log: String(raw.log || ""),
    terrainKind,
    terrain: numList(raw.terrain),
    mask: terrainKind === TERRAIN_MASK ? mask : undefined,
    tanks,
    crates: objList(raw.crates).map((item) => ({ x: num(item.x), y: num(item.y) })),
    mines: objList(raw.mines).map((item) => ({ x: num(item.x), y: num(item.y) })),
    clouds: objList(raw.clouds).map((item) => ({ x: num(item.x), y: num(item.y), r: num(item.r), left: num(item.left) })),
    clock: num(raw.clock, TURN_SEC),
  };
}

window.setInterval(() => {
  if (mode !== "local" || state.phase !== "aim" || clockAt <= 0 || queue.length > 0) return;
  if (clockSeconds() > 0) return;
  state = resolveExpire(state);
  emit();
}, 200);

function readShots(v: unknown): ShotPath[] {
  return objList(v).map((raw) => ({
    xs: numList(raw.xs),
    ys: numList(raw.ys),
    hitX: num(raw.hitX),
    hitY: num(raw.hitY),
    radius: num(raw.radius),
    hit: num(raw.hit),
    weapon: num(raw.weapon, 1),
  }));
}


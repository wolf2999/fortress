import * as Phaser from "phaser";
import {
  aimLine,
  aimSeat,
  canControl,
  currentAim,
  finishFlight,
  getState,
  peekFlight,
  setAim,
  subscribe,
  tryFire,
  tryMove,
  useItem,
  windText,
} from "./controller";
import { TANK_H, TANK_W, WORLD_H, WORLD_W } from "../sim/constants";
import { defaultAngle } from "../sim/rules";
import { tankById } from "../sim/tanks";
import type { ShotPath, Tank } from "../sim/rules";

const SKY = 0x1b2838;
const GROUND = 0x6e4b2a;
const GRASS = 0x8da85a;
const RED = 0xd3543c;
const BLUE = 0x3d7ea6;

export class BattleScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private left!: Phaser.Input.Keyboard.Key;
  private right!: Phaser.Input.Keyboard.Key;
  private up!: Phaser.Input.Keyboard.Key;
  private down!: Phaser.Input.Keyboard.Key;
  private space!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private itemKeys!: Phaser.Input.Keyboard.Key[];
  private hold = 0;
  private shot = 0;
  private point = 0;
  private boom = 0;
  private playing = false;
  private shell: { x: number; y: number } | null = null;
  private blast: { x: number; y: number; r: number; weapon: number } | null = null;

  constructor() {
    super("battle");
  }

  create(): void {
    this.g = this.add.graphics();
    this.title = this.add.text(16, 12, "", {
      fontFamily: "Microsoft YaHei, sans-serif",
      fontSize: "16px",
      color: "#f4efe6",
    });
    this.banner = this.add.text(WORLD_W / 2, 78, "", {
      fontFamily: "Microsoft YaHei, sans-serif",
      fontSize: "28px",
      color: "#ffe08a",
    }).setOrigin(0.5, 0);

    const kb = this.input.keyboard!;
    const code = Phaser.Input.Keyboard.KeyCodes;
    this.left = kb.addKey(code.LEFT);
    this.right = kb.addKey(code.RIGHT);
    this.up = kb.addKey(code.UP);
    this.down = kb.addKey(code.DOWN);
    this.space = kb.addKey(code.SPACE);
    this.keyA = kb.addKey(code.A);
    this.keyD = kb.addKey(code.D);
    this.itemKeys = [code.F9, code.F10, code.F11, code.F12].map((key) => kb.addKey(key));
    kb.addCapture([code.LEFT, code.RIGHT, code.UP, code.DOWN, code.SPACE, code.A, code.D, code.F9, code.F10, code.F11, code.F12]);

    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      aimAt(p);
    });
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => aimAt(p));

    subscribe(() => {
      if (!this.playing) this.draw();
    });
    this.draw();
  }

  update(_time: number, delta: number): void {
    this.keys(delta / 1000);
    this.flight(delta / 1000);
    if (this.playing) this.draw();
  }

  private keys(dt: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.space)) tryFire();
    if (Phaser.Input.Keyboard.JustDown(this.keyA)) tryMove(-1);
    if (Phaser.Input.Keyboard.JustDown(this.keyD)) tryMove(1);
    this.itemKeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) useItem(index + 1);
    });

    this.hold -= dt;
    if (this.hold > 0 || !canControl()) return;
    const aim = currentAim();
    let used = false;
    if (this.left.isDown) {
      setAim({ angle: aim.angle - 1 });
      used = true;
    } else if (this.right.isDown) {
      setAim({ angle: aim.angle + 1 });
      used = true;
    } else if (this.up.isDown) {
      setAim({ power: aim.power + 10 });
      used = true;
    } else if (this.down.isDown) {
      setAim({ power: aim.power - 10 });
      used = true;
    }
    if (used) this.hold = 0.04;
  }

  private flight(dt: number): void {
    const job = peekFlight();
    if (!job) {
      this.playing = false;
      this.shell = null;
      return;
    }
    this.playing = true;
    const path = job.shots[this.shot];
    if (!path) {
      this.shot = 0;
      this.point = 0;
      this.boom = 0;
      this.blast = null;
      this.shell = null;
      finishFlight();
      return;
    }
    if (this.boom > 0) {
      this.boom -= dt;
      if (this.boom <= 0) {
        this.blast = null;
        this.shot += 1;
        this.point = 0;
      }
      return;
    }
    const speed = 12;
    this.point = Math.min(path.xs.length - 1, this.point + speed);
    this.shell = { x: path.xs[this.point], y: path.ys[this.point] };
    if (this.point >= path.xs.length - 1) {
      if (path.hit === 1) {
        this.blast = { x: path.hitX, y: path.hitY, r: path.radius, weapon: path.weapon };
        this.boom = 0.28;
        this.shell = null;
      } else {
        this.shot += 1;
        this.point = 0;
        this.shell = null;
      }
    }
    void dt;
  }

  private draw(): void {
    const state = getState();
    const g = this.g;
    g.clear();
    g.fillStyle(SKY, 1);
    g.fillRect(0, 0, WORLD_W, WORLD_H);
    g.fillStyle(0xc9854a, 0.35);
    g.fillCircle(820, 70, 28);

    if (state.terrain.length > 1) {
      g.fillStyle(GROUND, 1);
      g.beginPath();
      g.moveTo(0, WORLD_H);
      state.terrain.forEach((y, i) => {
        g.lineTo(i * 4, y);
      });
      g.lineTo(WORLD_W, WORLD_H);
      g.closePath();
      g.fillPath();
      g.lineStyle(2, GRASS, 1);
      g.beginPath();
      state.terrain.forEach((y, i) => {
        if (i === 0) g.moveTo(0, y);
        else g.lineTo(i * 4, y);
      });
      g.strokePath();
    }

    for (const cloud of state.clouds ?? []) {
      g.fillStyle(0x7d5cff, 0.28);
      g.fillCircle(cloud.x, cloud.y, cloud.r);
      g.lineStyle(2, 0xc7b6ff, 0.7);
      g.strokeCircle(cloud.x, cloud.y, cloud.r);
    }

    for (const mine of state.mines ?? []) {
      g.fillStyle(0x241814, 1);
      g.fillCircle(mine.x, mine.y, 7);
      g.lineStyle(2, 0xe23d3d, 1);
      g.strokeCircle(mine.x, mine.y, 7);
    }

    for (const box of state.crates ?? []) {
      g.fillStyle(0x8a5a2a, 1);
      g.fillRect(box.x - 12, box.y - 8, 24, 16);
      g.lineStyle(2, 0xf6d36b, 1);
      g.strokeRect(box.x - 12, box.y - 8, 24, 16);
    }

    const preview = aimLine();
    if (preview) this.dots(preview, 0xf6d36b, 0.85);

    const job = peekFlight();
    if (job) {
      for (let i = 0; i < this.shot; i++) this.dots(job.shots[i], 0xffffff, 0.35);
      const current = job.shots[this.shot];
      if (current) this.dots(current, 0xffffff, 0.9, this.point);
    }

    state.tanks.forEach((tank) => this.tank(tank, tank.seat === state.turn && state.phase === "aim"));

    if (this.shell) {
      g.fillStyle(0xfff6d8, 1);
      g.fillCircle(this.shell.x, this.shell.y, 4);
    }
    if (this.blast) {
      const color = this.blast.weapon === 4 ? 0x8a6232 : 0xffb703;
      g.lineStyle(3, color, 0.9);
      g.strokeCircle(this.blast.x, this.blast.y, this.blast.r);
      g.fillStyle(color, 0.35);
      g.fillCircle(this.blast.x, this.blast.y, this.blast.r * 0.55);
    }

    const turnName = state.tanks.find((tank) => tank.seat === state.turn)?.name ?? "";
    if (state.phase === "preview") {
      this.title.setText(state.log);
      this.banner.setText("");
      return;
    }
    this.title.setText(`${windText(state.wind)}    ${state.phase === "over" ? state.log : `回合 ${turnName}`}`);
    this.banner.setText(state.phase === "over" ? state.log : "");
  }

  private dots(path: ShotPath, color: number, alpha: number, until = path.xs.length - 1): void {
    this.g.fillStyle(color, alpha);
    const end = Math.min(until, path.xs.length - 1);
    for (let i = 0; i <= end; i += 3) {
      this.g.fillCircle(path.xs[i], path.ys[i], 2);
    }
  }

  private tank(tank: Tank, active: boolean): void {
    const body = tankById(tank.body);
    const teamColor = (tank.team ?? tank.seat) === 1 ? BLUE : RED;
    const g = this.g;
    g.fillStyle(body?.color ?? teamColor, tank.alive ? 1 : 0.35);
    g.fillRect(tank.x, tank.y, TANK_W, TANK_H);
    g.lineStyle(2, teamColor, 0.95);
    g.strokeRect(tank.x, tank.y, TANK_W, TANK_H);
    if (body?.enrage && tank.alive === 1 && tank.hp * 2 <= tank.maxHp) {
      g.lineStyle(3, 0xff6a2a, 1);
      g.strokeRect(tank.x - 3, tank.y - 3, TANK_W + 6, TANK_H + 6);
    }
    if (tank.alive === 1 && (tank.frozen ?? 0) > 0) {
      g.lineStyle(3, 0x7ecbff, 1);
      g.strokeRect(tank.x - 2, tank.y - 2, TANK_W + 4, TANK_H + 4);
    }
    if (tank.alive === 1 && (tank.poison ?? 0) > 0) {
      g.lineStyle(3, 0x6ad15a, 1);
      g.strokeRect(tank.x - 5, tank.y - 5, TANK_W + 10, TANK_H + 10);
    }
    g.fillStyle(0x1a1a1a, 0.9);
    g.fillCircle(tank.x + 14, tank.y + TANK_H, 5);
    g.fillCircle(tank.x + TANK_W - 14, tank.y + TANK_H, 5);
    const aiming = canControl() && tank.seat === aimSeat();
    const angle = aiming ? currentAim().angle : defaultAngle(tank);
    const rad = (angle * Math.PI) / 180;
    const x0 = tank.x + TANK_W / 2;
    const y0 = tank.y + 6;
    g.lineStyle(4, 0x222222, 1);
    g.lineBetween(x0, y0, x0 + Math.cos(rad) * 26, y0 - Math.sin(rad) * 26);
    const hpRatio = tank.maxHp > 0 ? Math.max(0, tank.hp / tank.maxHp) : 0;
    g.fillStyle(0x000000, 0.45);
    g.fillRect(tank.x, tank.y - 10, TANK_W, 4);
    g.fillStyle(hpRatio > 0.3 ? 0x7dce6a : 0xe05a4f, 1);
    g.fillRect(tank.x, tank.y - 10, TANK_W * hpRatio, 4);
    if (active) {
      g.fillStyle(0xffe08a, 1);
      g.fillTriangle(tank.x + TANK_W / 2, tank.y - 22, tank.x + TANK_W / 2 - 6, tank.y - 14, tank.x + TANK_W / 2 + 6, tank.y - 14);
    }
  }
}

function activeTank(): Tank | undefined {
  const seat = aimSeat();
  return getState().tanks.find((tank) => tank.seat === seat);
}

function aimAt(p: Phaser.Input.Pointer): void {
  if (!canControl()) return;
  const tank = activeTank();
  if (!tank) return;
  const dx = p.x - (tank.x + TANK_W / 2);
  const dy = p.y - (tank.y + 6);
  const deg = (Math.atan2(-dy, dx) * 180) / Math.PI;
  if (Number.isFinite(deg)) setAim({ angle: deg });
}

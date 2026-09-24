import Phaser from 'phaser';
import { COLORS, DASH, GAME_H, GAME_W, PLAYER } from '../config';
import type { SkillId } from '../systems/skills';

type Keys = Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;

// 各火力等级的弹道：dx 为横向偏移，a 为相对正上方的偏角
const PATTERNS: { dx: number; a: number }[][] = [
  [{ dx: 0, a: 0 }],
  [{ dx: -7, a: 0 }, { dx: 7, a: 0 }],
  [{ dx: 0, a: 0 }, { dx: 0, a: -0.12 }, { dx: 0, a: 0.12 }],
  [{ dx: -7, a: 0 }, { dx: 7, a: 0 }, { dx: 0, a: -0.18 }, { dx: 0, a: 0.18 }],
  [{ dx: -7, a: 0 }, { dx: 7, a: 0 }, { dx: 0, a: -0.1 }, { dx: 0, a: 0.1 }, { dx: 0, a: -0.24 }, { dx: 0, a: 0.24 }],
];
const UP = -Math.PI / 2;

function emptySkills(): Record<SkillId, number> {
  return { gun: 0, rate: 0, power: 0, pierce: 0, bounce: 0, dash: 0, missile: 0, orb: 0, wingman: 0, lightning: 0, magnet: 0, regen: 0, hull: 0, xp: 0, repair: 0 };
}

export class Player extends Phaser.Physics.Arcade.Sprite {
  hp = PLAYER.maxHp;
  shield = 0;
  weapon = 1;
  invulnUntil = 0;
  alive = true;
  skills = emptySkills();
  /** 急速射击道具的到期时间 */
  rapidUntil = 0;
  /** 无敌星道具的到期时间 */
  starUntil = 0;
  /** 冲刺结束时间 */
  dashUntil = 0;
  /** 冲刺冷却结束时间 */
  private dashReadyAt = 0;
  /** 触屏 / 鼠标拖动时的目标位置 */
  dragTarget?: Phaser.Math.Vector2;
  private lastShot = 0;
  private rainbow = false;
  private dashTint = false;
  /** 最近一次的移动方向，冲刺沿它冲出去 */
  private dirX = 0;
  private dirY = -1;
  private nextGhost = 0;
  readonly engine: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true).setDepth(5);
    // 判定点比外形小得多，方便在弹幕里穿行
    (this.body as Phaser.Physics.Arcade.Body).setCircle(7, this.width / 2 - 7, this.height / 2 - 7);

    this.engine = scene.add.particles(0, 0, 'particle', {
      follow: this,
      followOffset: { x: 0, y: 26 },
      speedX: { min: -25, max: 25 },
      speedY: { min: 160, max: 320 },
      lifespan: 260,
      scale: { start: 0.55, end: 0 },
      alpha: { start: 0.9, end: 0 },
      color: [COLORS.white, COLORS.cyan, COLORS.magenta],
      blendMode: 'ADD',
      frequency: 14,
    });
    this.engine.setDepth(4);
  }

  get maxHp(): number {
    return PLAYER.maxHp + this.skills.hull;
  }

  get invulnerable(): boolean {
    return this.dashing || this.scene.time.now < this.invulnUntil || this.starred;
  }

  get starred(): boolean {
    return this.scene.time.now < this.starUntil;
  }

  get rapid(): boolean {
    return this.scene.time.now < this.rapidUntil;
  }

  get damageMul(): number {
    return 1 + this.skills.power * 0.25;
  }

  get xpMul(): number {
    return 1 + this.skills.xp * 0.25;
  }

  // ───────── 冲刺 ─────────

  get dashing(): boolean {
    return this.alive && this.scene.time.now < this.dashUntil;
  }

  get dashReady(): boolean {
    return this.scene.time.now >= this.dashReadyAt;
  }

  get dashDamage(): number {
    return DASH.damage[this.skills.dash];
  }

  private get dashCooldownMs(): number {
    return DASH.cooldownMs[this.skills.dash];
  }

  /** 0 = 已就绪，1 = 刚进冷却 */
  get dashCharge(): number {
    const now = this.scene.time.now;
    if (now >= this.dashReadyAt) return 0;
    return Phaser.Math.Clamp((this.dashReadyAt - now) / this.dashCooldownMs, 0, 1);
  }

  /** 冲出去：短暂无敌 + 撞伤敌人，用来在关键时刻规避伤害 */
  tryDash(): boolean {
    const now = this.scene.time.now;
    if (!this.alive || now < this.dashReadyAt) return false;
    this.dashUntil = now + DASH.durationMs;
    this.dashReadyAt = this.dashUntil + this.dashCooldownMs;
    this.nextGhost = 0;
    return true;
  }

  move(keys: Keys): void {
    const now = this.scene.time.now;
    if (now < this.dashUntil) {
      this.setVelocity(this.dirX * DASH.speed, this.dirY * DASH.speed);
      this.setRotation(Math.atan2(this.dirY, this.dirX) + Math.PI / 2);
      this.engine.frequency = 3;
      this.ghost(now);
      return;
    }
    this.engine.frequency = 14;

    const kx = (keys.RIGHT.isDown || keys.D.isDown ? 1 : 0) - (keys.LEFT.isDown || keys.A.isDown ? 1 : 0);
    const ky = (keys.DOWN.isDown || keys.S.isDown ? 1 : 0) - (keys.UP.isDown || keys.W.isDown ? 1 : 0);
    let vx: number;
    let vy: number;
    if (kx || ky || !this.dragTarget) {
      const v = new Phaser.Math.Vector2(kx, ky).normalize().scale(PLAYER.speed);
      vx = v.x;
      vy = v.y;
    } else {
      // 拖动：朝目标点移动，距离近时减速，避免抖动
      const t = this.dragTarget;
      t.set(Phaser.Math.Clamp(t.x, 20, GAME_W - 20), Phaser.Math.Clamp(t.y, 30, GAME_H - 30));
      const dx = t.x - this.x;
      const dy = t.y - this.y;
      const dist = Math.hypot(dx, dy);
      const sp = Math.min(PLAYER.speed * 1.8, dist * 12);
      vx = dist > 1 ? (dx / dist) * sp : 0;
      vy = dist > 1 ? (dy / dist) * sp : 0;
    }
    if (vx || vy) {
      const len = Math.hypot(vx, vy);
      this.dirX = vx / len;
      this.dirY = vy / len;
    }
    this.setVelocity(vx, vy);
    // 左右移动时机身倾斜
    this.setRotation(Phaser.Math.Linear(this.rotation, Phaser.Math.Clamp(vx / PLAYER.speed, -1, 1) * 0.2, 0.2));
  }

  /** 自动射击：返回本次要发射的子弹参数，冷却中返回空数组 */
  tryFire(time: number): { x: number; y: number; a: number }[] {
    let delay = PLAYER.fireDelay / (1 + this.skills.rate * 0.18);
    if (this.rapid) delay /= 2;
    if (time - this.lastShot < delay) return [];
    this.lastShot = time;
    return PATTERNS[this.weapon - 1].map((p) => ({ x: this.x + p.dx, y: this.y - 30, a: UP + p.a }));
  }

  updateBlink(time: number): void {
    if (this.dashing) {
      this.setTint(COLORS.white).setAlpha(1);
      this.dashTint = true;
      return;
    }
    if (this.starred) {
      // 无敌星：彩虹闪烁
      const colors = [COLORS.yellow, COLORS.magenta, COLORS.cyan, COLORS.green];
      this.setTint(colors[Math.floor(time / 70) % colors.length]).setAlpha(1);
      this.rainbow = true;
      return;
    }
    // 只在特效结束时清一次颜色，别把受击白闪也清掉
    if (this.rainbow || this.dashTint) {
      this.rainbow = false;
      this.dashTint = false;
      this.clearTint();
    }
    this.setAlpha(time < this.invulnUntil ? (Math.floor(time / 80) % 2 ? 0.25 : 1) : 1);
  }

  /** 冲刺残影 */
  private ghost(now: number): void {
    if (now < this.nextGhost) return;
    this.nextGhost = now + 28;
    const g = this.scene.add
      .image(this.x, this.y, 'player')
      .setRotation(this.rotation)
      .setTint(COLORS.cyan)
      .setAlpha(0.55)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(4);
    this.scene.tweens.add({ targets: g, alpha: 0, scale: 0.7, duration: 240, onComplete: () => g.destroy() });
  }
}

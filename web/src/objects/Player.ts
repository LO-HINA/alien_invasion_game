import Phaser from 'phaser';
import { COLORS, DASH, GAME_H, GAME_W, PLAYER, TURRET_FWD } from '../config';
import type { SkillId } from '../systems/skills';

type Keys = Record<'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT', Phaser.Input.Keyboard.Key>;

/**
 * 每级齐射的「颗数 + 总张角（弧度）」。从 Lv1 起就是发散式的扇面：三颗朝三个方向散开，
 * 越高级扇面越宽、颗数越多，所以近处能同时招呼几个目标，远处则会散成一张网。
 */
const VOLLEY: [number, number][] = [
  [3, 0.30],
  [4, 0.42],
  [5, 0.54],
  [6, 0.68],
  [8, 0.92],
];
/** 每级各颗子弹相对机头的偏角，从最左到最右均匀铺开 */
const FAN: number[][] = VOLLEY.map(([n, spread]) => Array.from({ length: n }, (_, i) => (i / (n - 1) - 0.5) * spread));
// 机身转向的角速度（弧度/秒）。瞄准就是机头方向，所以转得要比纯装饰快一些才跟手
const TURN_SPEED = 24;
/** 低于这个速度就不改朝向，免得站定时被噪声抖得乱转 */
const TURN_MIN_SPEED = 30;
/** 排气口在机尾多远 */
const EXHAUST_BACK = 26 * PLAYER.scale;
/** 炮口离机身中心多远（炮塔位置 + 炮管长度），子弹从这儿出去 */
const MUZZLE_FWD = TURRET_FWD + 14 * PLAYER.scale;
/** 判定点半径，比外形小得多，方便在弹幕里穿行 */
const BODY_R = 5;

function emptySkills(): Record<SkillId, number> {
  return { gun: 0, rate: 0, power: 0, pierce: 0, bounce: 0, dash: 0, missile: 0, orb: 0, wingman: 0, lightning: 0, magnet: 0, regen: 0, hull: 0, leech: 0, xp: 0, repair: 0 };
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
  /** 炮塔：机身自由转向，炮口永远朝上，保证「自动向上射击」读得懂 */
  readonly turret: Phaser.GameObjects.Image;
  readonly engine: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly exhaust = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true).setDepth(5);
    (this.body as Phaser.Physics.Arcade.Body).setCircle(BODY_R, this.width / 2 - BODY_R, this.height / 2 - BODY_R);

    this.turret = scene.add.image(x, y - TURRET_FWD, 'turret').setDepth(6).setBlendMode(Phaser.BlendModes.ADD);
    this.engine = scene.add.particles(0, 0, 'particle', {
      follow: this,
      followOffset: { x: 0, y: EXHAUST_BACK },
      // 朝机尾喷；朝向变了由 faceTowards 改 angle
      speed: { min: 160, max: 320 },
      angle: 90,
      lifespan: 260,
      // 机体缩了，尾焰跟着缩，不然喷出来比机身还大
      scale: { start: 0.55 * PLAYER.scale, end: 0 },
      alpha: { start: 0.9, end: 0 },
      color: [COLORS.white, COLORS.cyan, COLORS.magenta],
      blendMode: 'ADD',
      frequency: 14,
    });
    this.engine.setDepth(4);

    // Arcade 是在 POST_UPDATE 才把 body 的坐标写回贴图的，所以要挂在这一步之后同步炮塔，
    // 否则炮塔会用上一帧的机身位置，看起来永远差半个身位。
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncTurret, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncTurret, this);
    });
  }

  /**
   * 炮塔跟着机头转，子弹从它的炮口出去。
   * 由 POST_UPDATE 驱动，保证和机身在同一帧、同一位置上。
   */
  private syncTurret(): void {
    const a = this.aim;
    this.turret
      .setPosition(this.x + Math.cos(a) * TURRET_FWD, this.y + Math.sin(a) * TURRET_FWD)
      .setRotation(this.rotation)
      .setVisible(this.visible);
  }

  get maxHp(): number {
    return PLAYER.maxHp + this.skills.hull * PLAYER.hullHp;
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

  move(keys: Keys, delta: number): void {
    const now = this.scene.time.now;
    if (now < this.dashUntil) {
      this.setVelocity(this.dirX * DASH.speed, this.dirY * DASH.speed);
      this.faceTowards(Math.atan2(this.dirY, this.dirX), delta, true);
      this.engine.frequency = 3;
      this.ghost(now);
      this.syncTurret();
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
      // 够快才改朝向，站定时保持机头方向不乱晃
      if (len > TURN_MIN_SPEED) this.faceTowards(Math.atan2(vy, vx), delta);
    }
    this.setVelocity(vx, vy);
    this.syncTurret();
  }

  /** 机头转到指定方向（贴图朝上，所以要多转 90°），尾焰也跟着挂到机尾 */
  private faceTowards(angle: number, delta: number, snap = false): void {
    const want = angle + Math.PI / 2;
    this.setRotation(snap ? want : Phaser.Math.Angle.RotateTo(this.rotation, want, TURN_SPEED * (delta / 1000)));
    // 朝上时机尾在正下方；跟着机身转，尾焰才不会从机头喷出来
    this.exhaust.set(-Math.sin(this.rotation) * EXHAUST_BACK, Math.cos(this.rotation) * EXHAUST_BACK);
    this.engine.followOffset.set(this.exhaust.x, this.exhaust.y);
    // 粒子速度方向 = 机尾方向（Phaser 角度：0 度朝右，90 度朝下）
    this.engine.angle = Phaser.Math.RadToDeg(this.rotation) + 90;
  }

  /** 自动射击：返回本次要发射的子弹参数，冷却中返回空数组 */
  tryFire(time: number): { x: number; y: number; a: number }[] {
    let delay = PLAYER.fireDelay / (1 + this.skills.rate * 0.18);
    if (this.rapid) delay /= 2;
    if (time - this.lastShot < delay) return [];
    this.lastShot = time;
    // 沿机头方向打：整轮扇面跟着朝向转，每颗各偏一个角度，都从炮口出去
    const a = this.aim;
    const mx = this.x + Math.cos(a) * MUZZLE_FWD;
    const my = this.y + Math.sin(a) * MUZZLE_FWD;
    return FAN[this.weapon - 1].map((off) => ({ x: mx, y: my, a: a + off }));
  }

  /** 机头朝向，Phaser 的角度约定（0 = 右，-90° = 上）。子弹、僚机、导弹都按它算 */
  get aim(): number {
    return this.rotation - Math.PI / 2;
  }

  /** 机身贴图自身的旋转（0 = 贴图原始朝向，也就是朝上） */
  get heading(): number {
    return this.rotation;
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

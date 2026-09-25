import Phaser from 'phaser';
import { COLORS, DASH, GAME_H, GAME_W, PLAYER } from '../config';
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
/** 每级各颗子弹相对瞄准方向的偏角，从最左到最右均匀铺开 */
const FAN: number[][] = VOLLEY.map(([n, spread]) => Array.from({ length: n }, (_, i) => (i / (n - 1) - 0.5) * spread));
// 机身转速（弧度/秒）。球形机体没有机头，这个角度只管尾焰往哪喷、冲刺往哪冲：
// 它平滑地跟着**移动方向**转，90° 约七帧、180° 掉头约十三帧 —— 看得见在转，
// 又不至于拖到下一个操作才转完。打哪是另一件事，由自动瞄准单独决定（见 aimAngle）
const HULL_TURN_SPEED = 14;
/**
 * 炮口转速（弧度/秒）。比机身快一倍多 —— 机身那个只管好看，这个是真的要打中的：
 * 转慢了，换目标的路上打出去的几轮就全歪了。
 * 但也不能没有：180° 掉头约 105ms（六帧）、90° 约三帧，看得见它是在「转」，
 * 而不是「跳」过去的。两个数分开调：嫌肉就加这个，别去碰机身的
 */
const AIM_TURN_SPEED = 30;
/** 排气口在机尾多远 */
const EXHAUST_BACK = 26 * PLAYER.scale;
/**
 * 球体的视觉半径，和 textures.ts 里画的那个球是同一个值。
 * 子弹从球面出发而不是从球心 —— 从球心出发的话，出膛的头一两帧会被机身自己盖住，
 * 连射时看着像子弹凭空从球里冒出来
 */
const SHELL_R = 22 * PLAYER.scale;
/** 判定点半径，比外形小得多，方便在弹幕里穿行 */
const BODY_R = 5;
/** 擦弹后判定点涨一圈的时长 */
const CORE_PULSE_MS = 140;

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
  /** 机身朝向：跟着移动方向走。拖着尾焰的是机身，它朝的就是「往哪儿飞」 */
  private moveAngle = -Math.PI / 2;
  /**
   * 瞄准方向（Phaser 角度：0 = 右，-90° = 上）。子弹、僚机、导弹、闪电都按它算。
   * 它**不看玩家输入**，由 GameScene 每帧喂最近的敌机进来（见 aimAt）——
   * 机身往哪飞和打哪完全是两件事，走位的时候炮口自己在找目标
   */
  private aimAngle = -Math.PI / 2;
  private nextGhost = 0;
  /**
   * 判定点：机身正中心那个亮点。跟着机身走，但不跟机身一起闪 ——
   * 无敌时整个机身会忽明忽暗，判定点要是也跟着闪，最需要看清位置的时刻反而看不见了
   */
  readonly core: Phaser.GameObjects.Image;
  readonly engine: Phaser.GameObjects.Particles.ParticleEmitter;
  private readonly exhaust = new Phaser.Math.Vector2();
  /** 擦弹时判定点涨一下，到这个时刻收回去 */
  private corePulseUntil = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'player');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true).setDepth(5);
    (this.body as Phaser.Physics.Arcade.Body).setCircle(BODY_R, this.width / 2 - BODY_R, this.height / 2 - BODY_R);

    this.core = scene.add.image(x, y, 'core').setDepth(7).setBlendMode(Phaser.BlendModes.ADD);
    this.engine = scene.add.particles(0, 0, 'particle', {
      follow: this,
      followOffset: { x: 0, y: EXHAUST_BACK },
      // 朝机尾喷；机身转了由 updateExhaust 改 angle
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

    // Arcade 是在 POST_UPDATE 才把 body 的坐标写回贴图的，所以要挂在这一步之后同步判定点，
    // 否则它会用上一帧的机身位置，看起来永远差半个身位
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncAttachments, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncAttachments, this);
    });
  }

  /**
   * 判定点钉在机身中心。由 POST_UPDATE 驱动，保证和机身在同一帧、同一位置上。
   */
  private syncAttachments(): void {
    // 擦到弹时涨一圈，让「刚才那下很险」和判定点对上号
    const pulse = Phaser.Math.Clamp((this.corePulseUntil - this.scene.time.now) / CORE_PULSE_MS, 0, 1);
    this.core
      .setPosition(this.x, this.y)
      .setVisible(this.visible)
      .setScale(1 + 0.55 * pulse)
      .setAlpha(0.8 + 0.2 * pulse);
  }

  /** 擦弹一次：判定点跳一下 */
  graze(now: number): void {
    this.corePulseUntil = now + CORE_PULSE_MS;
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
      this.snapHeading(Math.atan2(this.dirY, this.dirX));
      this.engine.frequency = 3;
      this.ghost(now);
      this.syncAttachments();
      return;
    }
    this.engine.frequency = 14;

    const kx = (keys.RIGHT.isDown || keys.D.isDown ? 1 : 0) - (keys.LEFT.isDown || keys.A.isDown ? 1 : 0);
    const ky = (keys.DOWN.isDown || keys.S.isDown ? 1 : 0) - (keys.UP.isDown || keys.W.isDown ? 1 : 0);
    let vx: number;
    let vy: number;
    if (kx || ky || !this.dragTarget) {
      // 直接算单位向量，别为了归一化每帧 new 一个 Vector2
      const len = Math.hypot(kx, ky) || 1;
      vx = (kx / len) * PLAYER.speed;
      vy = (ky / len) * PLAYER.speed;
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
    this.moveAngle = Math.atan2(this.dirY, this.dirX);
    this.turnHull(delta);
    this.setVelocity(vx, vy);
    this.syncAttachments();
  }

  /** 机身平滑地转向移动方向 —— 看得见在转，但「打哪」不等它（炮口是另一回事） */
  private turnHull(delta: number): void {
    // 用「最短路的差值」自己走一步，不用 Angle.RotateTo：机身角会一直累加
    // （转几圈之后停在 -178°，而目标角是 90°+移动方向 = 270°），RotateTo 拿两个原始角
    // 一比，差 448° 就落进它「差不到一整圈 = 干脆甩过去」那一档，机身会突然跳 88°。
    // 先 wrap 到 ±180° 再比，差值永远是真正要转的那点角度，一帧最多走一步
    const want = Phaser.Math.Angle.Wrap(this.moveAngle + Math.PI / 2);
    const step = HULL_TURN_SPEED * (delta / 1000);
    const diff = Phaser.Math.Angle.Wrap(want - this.rotation);
    this.setRotation(this.rotation + Phaser.Math.Clamp(diff, -step, step));
    this.updateExhaust();
  }

  /** 一下甩到指定方向（冲刺专用：不插值，整个人连着机身一起冲） */
  private snapHeading(angle: number): void {
    this.moveAngle = angle;
    this.setRotation(angle + Math.PI / 2);
    this.updateExhaust();
  }

  /** 尾焰挂在机尾、朝机尾方向喷；跟着机身转，才不会从机头喷出来 */
  private updateExhaust(): void {
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
    // 没有炮塔了：整轮扇面从球面上直接射出去，每颗按自己的偏角从球面那一点出发
    const a = this.aim;
    return FAN[this.weapon - 1].map((off) => {
      const ea = a + off;
      return { x: this.x + Math.cos(ea) * SHELL_R, y: this.y + Math.sin(ea) * SHELL_R, a: ea };
    });
  }

  /**
   * 自动瞄准：由 GameScene 每帧喂进「离玩家最近的敌机」，炮口在这一帧里朝那边转一点。
   *
   * 不直接赋值，是因为目标会换：打掉一架之后「最近的那架」可能整个跳到身后，
   * 炮口要是瞬间掉头，整轮扇面会毫无预兆地扫向另一边，看着像在打空气 ——
   * 转过去就不一样了，能看清它是在追新目标。
   * 场上没目标时 GameScene 不调这里，炮口就停在最后的方向上，不会乱甩
   */
  aimAt(x: number, y: number, delta: number): void {
    const dx = x - this.x;
    const dy = y - this.y;
    if (!dx && !dy) return;
    const want = Math.atan2(dy, dx);
    // 和 turnHull 同一条规矩：先 wrap 成「真正要转的那点角度」再一步步走。
    // 炮口角会一直累加（转几圈之后停在 270°，而目标角是 -90°），
    // 拿两个原始角直接比会差出好几百，一帧就整个甩过去，等于没转
    const step = AIM_TURN_SPEED * (delta / 1000);
    const diff = Phaser.Math.Angle.Wrap(want - this.aimAngle);
    this.aimAngle = Phaser.Math.Angle.Wrap(this.aimAngle + Phaser.Math.Clamp(diff, -step, step));
  }

  /** 瞄准方向，Phaser 的角度约定（0 = 右，-90° = 上）。子弹、僚机、导弹都按它算 */
  get aim(): number {
    return this.aimAngle;
  }

  /** 机身贴图自身的旋转（0 = 贴图原始朝向，也就是朝上）。只管看起来朝哪，不代表打哪 */
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

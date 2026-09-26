import Phaser from 'phaser';
import { COLORS, DIFF, ELITE, GAME_H, GAME_W, LASER, STEP } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { BulletOpts } from './Bullet';

export type EnemyKind = 'drone' | 'wave' | 'shooter' | 'charger' | 'tank' | 'sniper' | 'spinner' | 'splitter' | 'bomber' | 'rammer' | 'elite' | 'laser';

interface EnemyDef {
  hp: number;
  speed: number;
  score: number;
  xp: number;
  color: number;
  radius: number;
  dropChance: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  drone: { hp: 1, speed: 170, score: 100, xp: 1, color: COLORS.magenta, radius: 13, dropChance: 0.04 },
  wave: { hp: 2, speed: 150, score: 150, xp: 1, color: COLORS.orange, radius: 13, dropChance: 0.05 },
  shooter: { hp: 5, speed: 140, score: 300, xp: 3, color: COLORS.green, radius: 17, dropChance: 0.12 },
  // 冲锋机：冲进来蓄力、再高速撞你。它是「有前摇的威胁」，玩家看到闪烁就得决定
  // 是绕开还是打掉它 —— 3 血的话最后那半秒它就被点掉了，那个决定根本不存在。
  //
  // 血量 8 → 28：它是**唯一一个被刻意留下的普通机型**（换血阶段杂兵按比例退场，
  // 它豁免，见 GameScene 的 MIX_KEEP）。后期一屏幕杂兵被精英机替掉之后，
  // 场上还得有「数量多、逼你不停挪窝」的那一类，不然就只剩几架精英机在耗。
  // 8 血在满配火力面前是零点几秒的事，蓄力那一秒根本撑不住，那前摇就白做了；
  // 28 血（后期 2 倍封顶 56）刚好让「是先清它还是先躲弹」重新变成一道选择题。
  // 刻意比重装机（24）高一档：它快、还会冲刺，血再少一点就只是个会闪的杂兵
  charger: { hp: 28, speed: 160, score: 250, xp: 2, color: COLORS.red, radius: 15, dropChance: 0.08 },
  tank: { hp: 24, speed: 70, score: 1000, xp: 10, color: COLORS.purple, radius: 30, dropChance: 0.5 },
  // 以下四种是后期才放出来的「有脾气」的敌机，各有各的威胁方式
  sniper: { hp: 4, speed: 130, score: 420, xp: 4, color: COLORS.cyan, radius: 15, dropChance: 0.16 },
  spinner: { hp: 7, speed: 85, score: 550, xp: 5, color: COLORS.purple, radius: 20, dropChance: 0.22 },
  splitter: { hp: 3, speed: 140, score: 320, xp: 3, color: COLORS.magenta, radius: 17, dropChance: 0.12 },
  bomber: { hp: 9, speed: 95, score: 650, xp: 6, color: COLORS.orange, radius: 22, dropChance: 0.28 },
  // 自爆机：不打弹，一路追着你撞。速度不算快，麻烦的是它不按编队走 ——
  // 它和冲锋机一样是「逼你动」的机型，3 血的话一边后撤一边顺手就点掉了，
  // 那它追人的意义就没了。6 血（后期 12）刚好让「是先清它还是先躲弹」变成一道选择题
  rammer: { hp: 6, speed: 155, score: 300, xp: 2, color: COLORS.yellow, radius: 14, dropChance: 0.1 },
  // 精英机：第 5 关起、且每关过了前 5 波才开始出现（见 GameScene 的 SPECIAL_FROM_STAGE）。
  // 血不封顶（见 config 的 ELITE），打的是红色的弹 —— 那种弹无视护盾、
  // 也穿得过环绕光球，只能靠躲。判定圈跟着贴图一起收（24 → 19 → 16）：
  // 它一场能同时站好几架、一挂十几秒，块头大只是挤掉杂兵的存在感，不是难度
  elite: { hp: 26, speed: 110, score: 2500, xp: 16, color: COLORS.red, radius: 16, dropChance: 0.85 },
  // 激光机：全场最少的机型。不开弹，只按一条固定方向拉激光，起手有预警线。
  // 它存在的意义是封走位，不是打伤害，所以血给得不多 —— 能打掉就该打掉。
  // 门槛和精英机一样（第 5 关起）：第一关就横一道光束过来，玩家连躲的概念都还没有
  laser: { hp: 14, speed: 90, score: 1800, xp: 12, color: COLORS.orange, radius: 15, dropChance: 0.6 },
};

/**
 * 精英机的弹：红色，**挡不住**（无视护盾和环绕光球）。
 * 提成常量而不是每发写一个对象字面量 —— 一次扇形就是好几发，没必要每发 new 一个
 */
const ELITE_SHOT: BulletOpts = { tier: 'elite', unblockable: true };

export interface SpawnOpts {
  amp?: number;
  freq?: number;
  phase?: number;
  /** 前进方向（弧度），默认向下；四边入场时由 GameScene 给出 */
  angle?: number;
  /**
   * 第 10 关之后的阶跃档数（见 config 的 STEP.tier）。只有精英机吃这一项 ——
   * 它是阶跃唯一的着力点，别的机型该封顶的都封着
   */
  tier?: number;
}

/** 出场多远之后回收（飞进过战场的敌机） */
const MARGIN = 160;
/** 编队最多会退到入场边外这么远（最长的纵列是 14 架 × 55 像素 = 715），没进过战场的按它兜底 */
const SPAWN_BACK = 800;

/** 自爆机锁定之后的转弯率（弧度/秒）。转弯半径 = 速度 / 它 ≈ 120 像素，
 *  横向拉开能绕出去、往回跑能拉开距离，它治的是「站着不动」而不是「会不会躲」 */
const RAMMER_TURN = 1.6;
/** 自爆机的引信：锁定之后追这么久就自己炸了，不会跟到天涯海角 */
const RAMMER_FUEL_MS = 5200;
/** 锁定之后往前冲的加速倍数 */
const RAMMER_DASH = 1.25;

/** 敌机从任意一条边飞进来，穿过战场后从另一侧飞走（不惩罚玩家） */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  kind: EnemyKind = 'drone';
  hp = 1;
  /** 已经进场且处在屏幕范围内：追踪导弹、连锁闪电挑目标时用它过滤 */
  onScreen = false;
  /** 环绕球对同一敌人的伤害冷却 */
  orbHitAt = 0;
  /** 冲刺对同一敌人的伤害冷却 */
  dashHitAt = 0;
  /** 激光对同一敌人的伤害冷却 */
  laserHitAt = 0;
  /**
   * 激光方向。**在锁定那一刻定死**，之后不再跟随玩家 —— 跟着转的话
   * 就成了一根永远甩不掉的鞭子，而不是「把你现在站的地方封掉」
   */
  laserAngle = 0;
  /** 预警线结束、开始灼烧的时刻；0 = 这一轮还没起手 */
  laserWarnUntil = 0;
  /** 灼烧结束的时刻。GameScene 每帧靠这两个时间戳决定画线还是画光束 */
  laserFireUntil = 0;
  private t = 0;
  private mode = 0;
  private stateAt = 0;
  private nextFire = 0;
  private diff = 1;
  /** 第 10 关之后的阶跃档数，只有精英机的血和弹数吃它 */
  private tier = 0;
  private amp = 0;
  private freq = 0;
  private phase = 0;
  /** 旋舞机撒弹的螺旋相位，出膛角每轮转一点 */
  private spiral = 0;
  private dashAngle = Math.PI / 2;
  /** 前进方向 */
  private moveAngle = Math.PI / 2;
  /** 突破边上墙之后才允许回收，否则远端入场的敌机会被立刻判定出界 */
  private entered = false;
  private sx = 0;
  private sy = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'drone');
  }

  get def(): EnemyDef {
    return ENEMY_DEFS[this.kind];
  }

  spawn(kind: EnemyKind, x: number, y: number, diff: number, opts: SpawnOpts = {}): void {
    this.kind = kind;
    this.setTexture(kind);
    this.enableBody(true, x, y, true, true);
    this.clearTint();
    this.setAlpha(1).setScale(1);
    const def = this.def;
    this.diff = diff;
    this.tier = opts.tier ?? 0;
    // 取整往**下**取，不是往上：1 血的杂兵乘上任何大于 1 的倍率，ceil 都会把它顶成 2，
    // 第 3 关（倍率 1.15）就「两发才死」了 —— 那正是「点对技能就该一直秒杀」要避免的。
    // floor 让 1 血杂兵一直保持 1 血（到第 11 关倍率摸到 2 才变厚），
    // 硬骨头（重装机那些）按同样的倍率照常涨，24 → 48。
    //
    // 精英机不走这条：DIFF.hpMax 那个 2 倍的上限是给杂兵定的（堆厚了手感从「爽」变「磨」），
    // 而精英机要的恰恰是「一直变强」—— 玩家的伤害是乘起来的，它的血也得跟着乘上去，
    // 否则第 10 关之后它就只是个血多一点的小兵。
    // 第 10 关之后还要再叠一道阶跃（STEP.hpPerStage），两条都是乘的，不封顶
    this.hp = kind === 'elite'
      ? Math.floor(def.hp * (1 + (diff - 1) * ELITE.hpPerStage) * (1 + this.tier * STEP.hpPerStage))
      : Math.floor(def.hp * Math.min(DIFF.hpMax, 1 + (diff - 1) * DIFF.hp));
    this.t = 0;
    this.mode = 0;
    this.orbHitAt = 0;
    this.dashHitAt = 0;
    this.laserHitAt = 0;
    this.laserWarnUntil = 0;
    this.laserFireUntil = 0;
    this.amp = opts.amp ?? 120;
    this.freq = opts.freq ?? 2.2;
    this.phase = opts.phase ?? 0;
    this.spiral = this.phase;
    this.moveAngle = opts.angle ?? Math.PI / 2;
    this.sx = x;
    this.sy = y;
    this.entered = false;
    this.onScreen = false;
    this.dashAngle = this.moveAngle;
    // 敌机贴图默认朝下，转成前进方向
    this.setRotation(this.moveAngle - Math.PI / 2);
    this.nextFire = this.scene.time.now + Phaser.Math.Between(900, 1900);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setCircle(def.radius, this.width / 2 - def.radius, this.height / 2 - def.radius);
    body.setVelocity(0, 0);
  }

  update(time: number, delta: number): void {
    if (!this.active) return;
    const game = this.scene as GameScene;
    const dt = delta / 1000;
    this.t += dt;
    // 三个倍率都从同一个难度数推出来（见 config 的 DIFF）。三个都留了上限，
    // 血的上限压得特别低（2 倍）—— 见 config 里那段说明，难度主力是数量和射速
    const sp = this.def.speed * Math.min(DIFF.speedMax, 1 + (this.diff - 1) * DIFF.speed);
    const fireScale = Math.max(DIFF.fireFloor, 1 / (1 + (this.diff - 1) * DIFF.fire));

    if (!this.entered && this.x > 0 && this.x < GAME_W && this.y > 0 && this.y < GAME_H) this.entered = true;
    const onScreen = this.entered && this.x > 24 && this.x < GAME_W - 24 && this.y > 24 && this.y < GAME_H - 24;
    this.onScreen = onScreen;

    // 前进方向与它的垂线
    const ca = Math.cos(this.moveAngle);
    const sa = Math.sin(this.moveAngle);
    const px = -sa;
    const py = ca;
    /** 沿前进方向已经飞了多远 */
    const inward = (this.x - this.sx) * ca + (this.y - this.sy) * sa;

    switch (this.kind) {
      case 'drone':
        this.setVelocity(ca * sp, sa * sp);
        this.rotation += dt * 3;
        break;
      case 'wave': {
        const lat = Math.cos(this.t * this.freq + this.phase) * this.amp * this.freq * 0.5;
        this.setVelocity(ca * sp + px * lat, sa * sp + py * lat);
        break;
      }
      case 'shooter': {
        // 深入战场后悬停射击，一段时间后加速离场
        const leaving = this.t > 9;
        const station = Math.min(GAME_W, GAME_H) * 0.28;
        const fwd = leaving ? sp * 2 : inward < station ? sp * 1.5 : 16;
        const lat = Math.sin(this.t * 1.5 + this.phase) * 70;
        this.setVelocity(ca * fwd + px * lat, sa * fwd + py * lat);
        this.rotation += dt;
        if (!leaving && onScreen && time >= this.nextFire) {
          // 弹幕要密：一轮三发起步，后期再加两颗、间隔也更短
          const heavy = this.diff > 1.6;
          this.nextFire = time + (heavy ? 1300 : 1600) * fireScale;
          game.fireEnemyAimed(this.x, this.y, 220 + this.diff * 15, 'ebullet', heavy ? 5 : 3, 0.2);
        }
        break;
      }
      case 'charger':
        if (this.mode === 0) {
          this.setVelocity(ca * sp, sa * sp);
          if (this.entered && this.t > 1) {
            this.mode = 1;
            this.stateAt = time;
            this.setVelocity(0, 0);
            // 蓄力的同时甩一轮，冲刺才有掩护
            game.fireEnemyAimed(this.x, this.y, 240 + this.diff * 12, 'ebullet', 3, 0.24);
          }
        } else if (this.mode === 1) {
          // 蓄力：朝向玩家并闪烁，给玩家足够的反应时间
          this.dashAngle = Phaser.Math.Angle.Between(this.x, this.y, game.player.x, game.player.y);
          this.setRotation(this.dashAngle - Math.PI / 2);
          this.setAlpha(Math.floor(time / 60) % 2 ? 0.4 : 1);
          if (time - this.stateAt > 850) {
            this.mode = 2;
            this.setAlpha(1);
            this.scene.physics.velocityFromRotation(this.dashAngle, sp * 3.5, (this.body as Phaser.Physics.Arcade.Body).velocity);
          }
        }
        break;
      case 'tank': {
        const lat = Math.sin(this.t * 0.8) * 30;
        this.setVelocity(ca * sp * 0.6 + px * lat, sa * sp * 0.6 + py * lat);
        if (onScreen && time >= this.nextFire) {
          // 正面铺一道弧，逼玩家从侧面绕
          this.nextFire = time + 1900 * fireScale;
          for (let i = -3; i <= 3; i++) game.fireEnemy(this.x + ca * 30, this.y + sa * 30, this.moveAngle + i * 0.17, 200 + this.diff * 12, 'ebullet2');
        }
        break;
      }
      case 'sniper': {
        // 停在远处不动，蓄力时闪烁并转向玩家，然后放一发又快又直的
        const leaving = this.t > 11;
        const station = Math.min(GAME_W, GAME_H) * 0.24;
        const fwd = leaving ? sp * 2 : inward < station ? sp * 1.5 : 0;
        const lat = Math.sin(this.t * 1.1 + this.phase) * 46;
        this.setVelocity(ca * fwd + px * lat, sa * fwd + py * lat);
        if (leaving || !onScreen) {
          this.mode = 0;
          this.setAlpha(1);
          break;
        }
        if (this.mode === 0) {
          if (time >= this.nextFire) {
            this.mode = 1;
            this.stateAt = time;
          }
        } else {
          const ang = Phaser.Math.Angle.Between(this.x, this.y, game.player.x, game.player.y);
          this.setRotation(ang - Math.PI / 2);
          this.setAlpha(Math.floor(time / 70) % 2 ? 0.45 : 1);
          if (time - this.stateAt > 700) {
            this.mode = 0;
            this.setAlpha(1);
            this.nextFire = time + 1500 * fireScale;
            // 枪线先到、子弹后到，这一发才躲得掉。弹速快的用细长弹，一眼能认出该躲哪个
            game.tracer(this.x, this.y, game.player.x, game.player.y, this.def.color);
            game.fireEnemy(this.x + Math.cos(ang) * 22, this.y + Math.sin(ang) * 22, ang, 480 + this.diff * 15, 'ebullet3');
          }
        }
        break;
      }
      case 'spinner': {
        // 慢慢转着飘，一圈一圈往外撒弹
        this.setVelocity(ca * sp + px * Math.sin(this.t * 0.9) * 40, sa * sp + py * Math.cos(this.t * 0.9) * 40);
        this.rotation += dt * 2.2;
        if (onScreen && time >= this.nextFire) {
          this.nextFire = time + 480 * fireScale;
          for (let i = 0; i < 3; i++) game.fireEnemy(this.x, this.y, this.spiral + (i * Math.PI * 2) / 3, 165 + this.diff * 8, 'ebullet2');
          this.spiral += 0.55;
        }
        break;
      }
      case 'splitter': {
        // 直来直去，靠「打爆会裂成两架小机」拖住玩家
        this.setVelocity(ca * sp, sa * sp);
        this.rotation += dt * 1.2;
        break;
      }
      case 'bomber': {
        // 慢悠悠压过来，隔一阵朝四面八方铺一圈弹
        this.setVelocity(ca * sp * 0.8 + px * Math.sin(this.t * 0.7) * 26, sa * sp * 0.8 + py * Math.cos(this.t * 0.7) * 26);
        if (onScreen && time >= this.nextFire) {
          this.nextFire = time + 2100 * fireScale;
          for (let i = 0; i < 8; i++) game.fireEnemy(this.x, this.y, this.spiral + (i / 8) * Math.PI * 2, 150 + this.diff * 10, 'ebullet2');
          this.spiral += 0.39;
        }
        break;
      }
      case 'rammer': {
        // 先直着飞进场（给玩家看一眼「它来了」），进了战场才锁定
        if (this.mode === 0) {
          this.setVelocity(ca * sp, sa * sp);
          if (this.entered && this.t > 0.7) {
            this.mode = 1;
            this.stateAt = time;
          }
          break;
        }
        // 锁定之后一路朝玩家拐，但转弯率有限：横向拉开就能把它甩在身后
        // （它比玩家慢，追不上；站着不动才躲不掉 —— 要治的就是那个）
        const want = Phaser.Math.Angle.Between(this.x, this.y, game.player.x, game.player.y);
        // 包一层 Wrap：RotateTo 的返回值是不取模的累加值，转够一圈之后
        // |目标 - 当前| 会超过 2π，落进它「差不到一整圈 = 干脆甩过去」那一档直接瞬移
        this.moveAngle = Phaser.Math.Angle.Wrap(Phaser.Math.Angle.RotateTo(this.moveAngle, want, RAMMER_TURN * dt));
        this.setRotation(this.moveAngle - Math.PI / 2);
        this.setVelocity(Math.cos(this.moveAngle) * sp * RAMMER_DASH, Math.sin(this.moveAngle) * sp * RAMMER_DASH);
        // 引信闪烁，越接近自爆闪得越快
        const left = Math.max(0, 1 - (time - this.stateAt) / RAMMER_FUEL_MS);
        this.setAlpha(Math.floor(time / (40 + 130 * left)) % 2 ? 0.4 : 1);
        if (time - this.stateAt >= RAMMER_FUEL_MS) {
          this.setAlpha(1);
          game.detonate(this);
        }
        break;
      }
      case 'elite': {
        // 和射击机一样深入战场后悬停，但停得更靠前、更硬、打得更狠。
        // 弹数随难度涨，「属性不断提升」不只是血 —— 阶跃那一段再叠一道
        //
        // 停靠深度按**进场那一条边**算，不用上面那个通用的 inward（从出生点飞了多远）：
        // 换血之后精英机是从编队里顶替出来的，而编队尾巴上的成员出生点在屏幕外几百像素
        // （列队 / 蛇形 / 蜂群是 i * 35~60 一路退出去的，能退到 700 开外）——
        // 按「飞了多远」算，这一批精英机会停在屏幕外：悬停十四秒、一枪不放、白占一个名额，
        // 而且是玩家最想要压力的那几波里凭空少掉的（实测第 6 关抓到过停在场外 189 像素的一架）
        const leaving = this.t > 14;
        const station = Math.min(GAME_W, GAME_H) * 0.32;
        // 进场方向是轴对齐的（见 GameScene.entry），所以哪条边进场就看哪一个轴。
        // 不能用「离最近那条边」：贴着左边进场、往下飞的精英机会一路飞到下边缘才停
        const depth = ca > 0.5 ? this.x : ca < -0.5 ? GAME_W - this.x : sa > 0 ? this.y : GAME_H - this.y;
        const fwd = leaving ? sp * 2 : depth < station ? sp * 1.4 : 14;
        const lat = Math.sin(this.t * 1.2 + this.phase) * 84;
        this.setVelocity(ca * fwd + px * lat, sa * fwd + py * lat);
        this.rotation += dt * 0.8;
        if (!leaving && onScreen && time >= this.nextFire) {
          this.nextFire = time + ELITE.fireMs / (1 + this.diff * ELITE.firePerStage);
          // 一轮 = **正中一颗红弹 + 两侧一对普通弹**（两侧发数见 config 的 ELITE.shots）。
          //
          // 红弹只有一颗，而且是**正对瞄准点**的那一颗 —— 这一颗负责「必须动」：
          // 红弹无视护盾、穿得过光球，站着不动就只能挨它。两侧那对是偶数发，
          // 正中留出的空档（偶数发的几何，见 config 的 ELITE.shots）正好被这颗红弹占着
          //
          // 两侧的普通弹是**能挡的**：伤害轻（HIT.bullet 对 eliteBullet）、
          // 护盾和环绕光球都吃得住 —— 有了这两颗，玩家的技能才有用武之地，
          // 不然一屏幕全是挡不住的红弹，点满的技能在精英机面前等于没点。
          // 「躲正中那颗、扛两边那两颗」就是这个机型现在要玩家做的判断
          //
          // 后期那一档加在**普通弹**上（2 → 4），红弹始终一颗：
          // 加量加在能挡的那一半，红弹一多就又变成「只能一直退」了
          const extra = this.diff >= 5 || this.tier > 0 ? 2 : 0;
          game.fireEnemyAimed(this.x, this.y, ELITE.speed, 'ebullet4', 1, 0, ELITE_SHOT);
          game.fireEnemyAimed(this.x, this.y, ELITE.speed, 'ebullet', ELITE.shots + extra, ELITE.spread);
        }
        break;
      }
      case 'laser': {
        // 进来找个位置停住，然后一轮一轮地拉激光。停得比谁都靠后：
        // 它要活着才有威胁，冲太前等于送分
        const leaving = this.t > 15;
        const station = Math.min(GAME_W, GAME_H) * 0.34;
        const fwd = leaving ? sp * 2 : inward < station ? sp * 1.4 : 0;
        this.setVelocity(ca * fwd, sa * fwd);
        this.rotation += dt * 0.5;
        if (leaving || !onScreen) {
          // 走的时候把这一轮取消掉，否则光束会挂在屏幕外继续烧
          this.laserWarnUntil = 0;
          this.laserFireUntil = 0;
          break;
        }
        // 起手：朝玩家**现在**的位置锁一个方向，然后就不再改了
        if (time >= this.nextFire && time >= this.laserFireUntil) {
          this.laserAngle = Phaser.Math.Angle.Between(this.x, this.y, game.player.x, game.player.y);
          this.laserWarnUntil = time + LASER.warnMs;
          this.laserFireUntil = this.laserWarnUntil + LASER.fireMs;
          this.nextFire = this.laserFireUntil + LASER.restMs;
        }
        break;
      }
    }
    // 飞进过战场之后，从任意一边飞远就回收
    const out = this.x < -MARGIN || this.x > GAME_W + MARGIN || this.y < -MARGIN || this.y > GAME_H + MARGIN;
    // 没进过战场的另算：编队两翼要是落在入场边之外（V 字的斜边会超出屏幕宽度），
    // 那几个成员顺着入场方向径直飞走，永远够不到世界矩形，entered 永远是 false ——
    // 只看 entered 就会漏掉它们，它们会一直在场外飞，把池子占满，之后就刷不出新敌机了。
    // 所以给它们一个更大的框：出了「编队最远的退距」就再也回不来了
    const neverIn = this.x < -SPAWN_BACK || this.x > GAME_W + SPAWN_BACK || this.y < -SPAWN_BACK || this.y > GAME_H + SPAWN_BACK;
    if (this.entered ? out : neverIn) this.disableBody(true, true);
  }
}

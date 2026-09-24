import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';
import type { GameScene } from '../scenes/GameScene';

export type EnemyKind = 'drone' | 'wave' | 'shooter' | 'charger' | 'tank' | 'sniper' | 'spinner' | 'splitter' | 'bomber';

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
  charger: { hp: 3, speed: 160, score: 250, xp: 2, color: COLORS.red, radius: 15, dropChance: 0.08 },
  tank: { hp: 24, speed: 70, score: 1000, xp: 10, color: COLORS.purple, radius: 30, dropChance: 0.5 },
  // 以下四种是后期才放出来的「有脾气」的敌机，各有各的威胁方式
  sniper: { hp: 4, speed: 130, score: 420, xp: 4, color: COLORS.cyan, radius: 15, dropChance: 0.16 },
  spinner: { hp: 7, speed: 85, score: 550, xp: 5, color: COLORS.purple, radius: 20, dropChance: 0.22 },
  splitter: { hp: 3, speed: 140, score: 320, xp: 3, color: COLORS.magenta, radius: 17, dropChance: 0.12 },
  bomber: { hp: 9, speed: 95, score: 650, xp: 6, color: COLORS.orange, radius: 22, dropChance: 0.28 },
};

export interface SpawnOpts {
  amp?: number;
  freq?: number;
  phase?: number;
  /** 前进方向（弧度），默认向下；四边入场时由 GameScene 给出 */
  angle?: number;
}

/** 出场多远之后回收（飞进过战场的敌机） */
const MARGIN = 160;
/** 编队最多会退到入场边外这么远（最长的纵列是 14 架 × 55 像素 = 715），没进过战场的按它兜底 */
const SPAWN_BACK = 800;

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
  private t = 0;
  private mode = 0;
  private stateAt = 0;
  private nextFire = 0;
  private diff = 1;
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
    this.hp = Math.ceil(def.hp * (1 + (diff - 1) * 0.5));
    this.t = 0;
    this.mode = 0;
    this.orbHitAt = 0;
    this.dashHitAt = 0;
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
    const sp = this.def.speed * (1 + (this.diff - 1) * 0.2);
    const fireScale = 1 / (1 + (this.diff - 1) * 0.25);

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

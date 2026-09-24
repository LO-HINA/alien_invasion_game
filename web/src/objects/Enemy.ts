import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';
import type { GameScene } from '../scenes/GameScene';

export type EnemyKind = 'drone' | 'wave' | 'shooter' | 'charger' | 'tank';

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
};

export interface SpawnOpts {
  amp?: number;
  freq?: number;
  phase?: number;
  /** 前进方向（弧度），默认向下；四边入场时由 GameScene 给出 */
  angle?: number;
}

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
          this.nextFire = time + 2000 * fireScale;
          game.fireEnemyAimed(this.x, this.y, 220 + this.diff * 15, 'ebullet', this.diff > 2.2 ? 3 : 1, 0.22);
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
          this.nextFire = time + 2400 * fireScale;
          for (let i = -2; i <= 2; i++) game.fireEnemy(this.x + ca * 30, this.y + sa * 30, this.moveAngle + i * 0.2, 200 + this.diff * 12, 'ebullet2');
        }
        break;
      }
    }

    // 飞进过战场之后，从任意一边飞远就回收
    if (this.entered && (this.x < -160 || this.x > GAME_W + 160 || this.y < -160 || this.y > GAME_H + 160)) this.disableBody(true, true);
  }
}

import Phaser from 'phaser';
import { COLORS, MUZZLE_FWD, PLAYER } from '../config';
import type { GameScene } from '../scenes/GameScene';
import { audio } from '../systems/audio';
import { REGEN_INTERVAL_MS } from '../systems/skills';
import { ENEMY_DEFS, type Enemy } from './Enemy';

const ORB_RADIUS = 80;
const BOSS_RADIUS = 85;
/** 僚机的挂位与炮口都按机体比例缩，跟着 PLAYER.scale 一起变 */
const S = PLAYER.scale;
/** 导弹从机头前多远冒出来 */
const MUZZLE_OFFSET = MUZZLE_FWD + 4 * S;

/** 升级技能的运行时：追踪导弹、环绕光球、僚机、连锁闪电、护盾充能 */
export class Arsenal {
  private orbs: Phaser.GameObjects.Image[] = [];
  private wingmen: Phaser.GameObjects.Image[] = [];
  /** 追踪弹的候选目标，每帧复用同一个数组（见 steerMissiles） */
  private readonly targets: Enemy[] = [];
  private orbAngle = 0;
  private orbBossHitAt = 0;
  private nextMissile = 0;
  private nextZap = 0;
  private nextWing = 0;
  private nextRegen = 0;
  /** 场上还有几发追踪弹；为 0 时 steerMissiles 整段跳过 */
  private homingLive = 0;

  constructor(private game: GameScene) {}

  /** 暂停 / 升级选择结束后，把绝对时间戳整体后移 */
  shift(ms: number): void {
    this.nextMissile += ms;
    this.nextZap += ms;
    this.nextWing += ms;
    this.nextRegen += ms;
    this.orbBossHitAt += ms;
  }

  update(time: number, delta: number): void {
    const p = this.game.player;
    const s = p.skills;
    this.sync(this.orbs, s.orb ? s.orb + 1 : 0, 'orb', 7);
    this.sync(this.wingmen, Math.min(2, s.wingman), 'wingman', 5);
    // 两段循环，避免每帧拼一个新数组
    for (const o of this.orbs) o.setVisible(p.alive);
    for (const w of this.wingmen) w.setVisible(p.alive);
    if (!p.alive) return;

    this.updateOrbs(time, delta);
    this.updateWingmen(time);
    if (s.missile) {
      this.updateMissiles(time);
      // 没学导弹就不必每帧扫一遍全部子弹
      this.steerMissiles(delta);
    }
    if (s.lightning && time >= this.nextZap) this.zap(time);

    if (s.regen) {
      if (this.nextRegen === 0) this.nextRegen = time + REGEN_INTERVAL_MS[s.regen];
      if (time >= this.nextRegen) {
        this.nextRegen = time + REGEN_INTERVAL_MS[s.regen];
        if (p.shield < PLAYER.maxShield) {
          p.shield++;
          audio.shield();
        }
      }
    }
  }

  private sync(list: Phaser.GameObjects.Image[], count: number, texture: string, depth: number): void {
    while (list.length < count) list.push(this.game.add.image(this.game.player.x, this.game.player.y, texture).setDepth(depth).setBlendMode(Phaser.BlendModes.ADD));
    while (list.length > count) list.pop()!.destroy();
  }

  // ───── 环绕光球：撞伤敌人、抵消敌弹 ─────
  private updateOrbs(time: number, delta: number): void {
    const n = this.orbs.length;
    if (!n) return;
    const p = this.game.player;
    const dmg = 2 * p.damageMul;
    this.orbAngle += (delta / 1000) * 3.2;
    const boss = this.game.currentBoss;

    this.orbs.forEach((orb, i) => {
      const a = this.orbAngle + (i / n) * Math.PI * 2;
      orb.setPosition(p.x + Math.cos(a) * ORB_RADIUS, p.y + Math.sin(a) * ORB_RADIUS);
    });

    // 反着扫：外层是场上的敌人 / 敌弹，内层才是最多四个光球。
    // 原来是每个光球各扫一遍全池（满技能四个球 = 四遍敌机 + 四遍敌弹），
    // 而池子是按峰值开的、绝大多数格子空着 —— 这么换一下，池只扫一遍，内层最多四次
    this.game.eachEnemy((e) => {
      if (time < e.orbHitAt) return;
      const r = 16 + ENEMY_DEFS[e.kind].radius;
      for (const orb of this.orbs) {
        if (near(orb, e, r)) {
          // 一帧只吃一下，和原来「先碰上的那个球打中、顺手记冷却」是同一个效果
          e.orbHitAt = time + 300;
          this.game.hitEnemy(e, dmg);
          return;
        }
      }
    });
    this.game.eachEnemyBullet((b) => {
      for (const orb of this.orbs) {
        if (near(orb, b, 18)) {
          this.game.explodeAt(b.x, b.y, COLORS.cyan, 0.15);
          b.kill();
          return;
        }
      }
    });
    if (boss && time >= this.orbBossHitAt) {
      for (const orb of this.orbs) {
        if (near(orb, boss, 16 + BOSS_RADIUS)) {
          this.orbBossHitAt = time + 250;
          this.game.hitBoss(dmg);
          return;
        }
      }
    }
  }

  // ───── 僚机：挂在两翼，跟着机身摆位，但和主炮打同一个方向 ─────
  private updateWingmen(time: number): void {
    if (!this.wingmen.length) return;
    const p = this.game.player;
    // 挂位看机身（它们是挂在机身上的），朝向和开火都看瞄准 —— 和主炮同一条规矩：
    // 机身还在转的那十几帧里炮口早就对准了，僚机要是跟着机身转，
    // 就会出现「侧着身子朝反方向开火」的样子
    const h = p.heading;
    const hc = Math.cos(h);
    const hs = Math.sin(h);
    const f = p.aim;
    const c = Math.cos(f);
    const s = Math.sin(f);
    this.wingmen.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      // 两翼 = 沿机身方向的垂线左右分开，再往机尾方向退一点
      const tx = p.x - hs * side * 58 * S - hc * 24 * S;
      const ty = p.y + hc * side * 58 * S - hs * 24 * S;
      w.setPosition(Phaser.Math.Linear(w.x, tx, 0.2), Phaser.Math.Linear(w.y, ty, 0.2)).setRotation(f + Math.PI / 2);
    });
    if (time < this.nextWing) return;
    // 僚机弹不反弹，飞出场外就消失
    this.nextWing = time + (p.skills.wingman >= 3 ? 180 : 360);
    for (const w of this.wingmen) this.game.firePlayerBullet(w.x + c * 14 * S, w.y + s * 14 * S, f, 900, 'wbullet', 0.8 * p.damageMul, 0, { bounces: 0, lifeMs: 1000 });
  }

  // ───── 追踪导弹 ─────
  private updateMissiles(time: number): void {
    if (time < this.nextMissile) return;
    const p = this.game.player;
    const lv = p.skills.missile;
    const f = p.aim;
    this.nextMissile = time + 2400 - lv * 250;
    for (let i = 0; i < lv; i++) {
      const spread = (i - (lv - 1) / 2) * 0.45;
      const b = this.game.firePlayerBullet(p.x + Math.cos(f) * MUZZLE_OFFSET, p.y + Math.sin(f) * MUZZLE_OFFSET, f + spread, 380, 'missile', 3 * p.damageMul, 0, { bounces: 0, lifeMs: 3200 });
      if (b) {
        b.homing = true;
        this.homingLive++;
      }
    }
    audio.missile();
  }

  private steerMissiles(delta: number): void {
    // 没有在飞的追踪弹就直接跳过，别每帧去扫全部子弹和敌机
    if (this.homingLive <= 0) return;
    const dt = delta / 1000;
    // 候选目标复用同一个数组：这段每帧都要跑，length 归零再填不会真的分配
    this.targets.length = 0;
    this.game.eachEnemy((e) => {
      if (e.onScreen) this.targets.push(e);
    });
    const boss = this.game.currentBoss;
    let alive = 0;
    this.game.eachPlayerBullet((b) => {
      if (!b.homing) return;
      alive++;
      let target: { x: number; y: number } | undefined = boss;
      let best = boss ? Phaser.Math.Distance.Squared(b.x, b.y, boss.x, boss.y) : Infinity;
      for (const e of this.targets) {
        const d = Phaser.Math.Distance.Squared(b.x, b.y, e.x, e.y);
        if (d < best) {
          best = d;
          target = e;
        }
      }
      b.speed = Math.min(760, b.speed + 900 * dt);
      if (target) {
        const want = Phaser.Math.Angle.Between(b.x, b.y, target.x, target.y);
        b.rotation = Phaser.Math.Angle.RotateTo(b.rotation, want, 5 * dt);
      }
      this.game.physics.velocityFromRotation(b.rotation, b.speed, (b.body as Phaser.Physics.Arcade.Body).velocity);
    });
    // 打光了就归零，下一帧开头那次早退就生效了
    this.homingLive = alive;
  }

  // ───── 连锁闪电 ─────
  private zap(time: number): void {
    const p = this.game.player;
    const lv = p.skills.lightning;
    const dmg = (3 + lv) * p.damageMul;
    const candidates = this.game.activeEnemies().filter((e) => e.onScreen);
    const chain: { x: number; y: number }[] = [{ x: p.x + Math.cos(p.aim) * 20, y: p.y + Math.sin(p.aim) * 20 }];
    let from = chain[0];
    let range = 560;
    for (let n = 0; n < lv + 1; n++) {
      let pick: Enemy | undefined;
      let best = range * range;
      for (const e of candidates) {
        const d = Phaser.Math.Distance.Squared(from.x, from.y, e.x, e.y);
        if (d < best) {
          best = d;
          pick = e;
        }
      }
      if (!pick) break;
      candidates.splice(candidates.indexOf(pick), 1);
      chain.push({ x: pick.x, y: pick.y });
      this.game.hitEnemy(pick, dmg);
      from = chain[chain.length - 1];
      range = 280;
    }
    const boss = this.game.currentBoss;
    if (chain.length === 1 && boss) {
      chain.push({ x: boss.x, y: boss.y });
      this.game.hitBoss(dmg);
    }
    if (chain.length === 1) {
      // 没有目标，稍后再试
      this.nextZap = time + 300;
      return;
    }
    this.nextZap = time + 3200 - lv * 320;
    audio.zap();
    this.drawBolt(chain);
  }

  private drawBolt(points: { x: number; y: number }[]): void {
    const g = this.game.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
    for (const [w, a, color] of [[7, 0.25, COLORS.blue], [3, 0.9, COLORS.cyan], [1.2, 1, COLORS.white]] as const) {
      g.lineStyle(w, color, a);
      g.beginPath();
      g.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        const a0 = points[i - 1];
        const a1 = points[i];
        // 每段拆成几个随机抖动的折线，像闪电
        for (let k = 1; k <= 4; k++) {
          const t = k / 5;
          g.lineTo(a0.x + (a1.x - a0.x) * t + Phaser.Math.Between(-12, 12), a0.y + (a1.y - a0.y) * t + Phaser.Math.Between(-12, 12));
        }
        g.lineTo(a1.x, a1.y);
      }
      g.strokePath();
    }
    this.game.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
    for (let i = 1; i < points.length; i++) this.game.explodeAt(points[i].x, points[i].y, COLORS.blue, 0.3);
  }
}

function near(a: { x: number; y: number }, b: { x: number; y: number }, r: number): boolean {
  return Phaser.Math.Distance.Squared(a.x, a.y, b.x, b.y) < r * r;
}

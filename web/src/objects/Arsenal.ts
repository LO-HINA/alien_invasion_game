import Phaser from 'phaser';
import { COLORS, PLAYER } from '../config';
import type { GameScene } from '../scenes/GameScene';
import { audio } from '../systems/audio';
import { REGEN_INTERVAL_MS } from '../systems/skills';
import { ENEMY_DEFS, type Enemy } from './Enemy';

const UP = -Math.PI / 2;
const ORB_RADIUS = 80;
const BOSS_RADIUS = 85;

/** 升级技能的运行时：追踪导弹、环绕光球、僚机、连锁闪电、护盾充能 */
export class Arsenal {
  private orbs: Phaser.GameObjects.Image[] = [];
  private wingmen: Phaser.GameObjects.Image[] = [];
  private orbAngle = 0;
  private orbBossHitAt = 0;
  private nextMissile = 0;
  private nextZap = 0;
  private nextWing = 0;
  private nextRegen = 0;

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
    for (const o of [...this.orbs, ...this.wingmen]) o.setVisible(p.alive);
    if (!p.alive) return;

    this.updateOrbs(time, delta);
    this.updateWingmen(time);
    if (s.missile) this.updateMissiles(time);
    this.steerMissiles(delta);
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
    if (!this.orbs.length) return;
    const p = this.game.player;
    const dmg = 2 * p.damageMul;
    this.orbAngle += (delta / 1000) * 3.2;
    const enemies = this.game.activeEnemies();
    const eBullets = this.game.activeEnemyBullets();
    const boss = this.game.currentBoss;

    this.orbs.forEach((orb, i) => {
      const a = this.orbAngle + (i / this.orbs.length) * Math.PI * 2;
      orb.setPosition(p.x + Math.cos(a) * ORB_RADIUS, p.y + Math.sin(a) * ORB_RADIUS);
      for (const e of enemies) {
        if (e.active && time >= e.orbHitAt && near(orb, e, 16 + ENEMY_DEFS[e.kind].radius)) {
          e.orbHitAt = time + 300;
          this.game.hitEnemy(e, dmg);
        }
      }
      for (const b of eBullets) {
        if (b.active && near(orb, b, 18)) {
          this.game.explodeAt(b.x, b.y, COLORS.cyan, 0.15);
          b.kill();
        }
      }
      if (boss && time >= this.orbBossHitAt && near(orb, boss, 16 + BOSS_RADIUS)) {
        this.orbBossHitAt = time + 250;
        this.game.hitBoss(dmg);
      }
    });
  }

  // ───── 僚机：跟随在两翼，直线射击 ─────
  private updateWingmen(time: number): void {
    if (!this.wingmen.length) return;
    const p = this.game.player;
    this.wingmen.forEach((w, i) => {
      const side = i === 0 ? -1 : 1;
      w.setPosition(Phaser.Math.Linear(w.x, p.x + side * 58, 0.2), Phaser.Math.Linear(w.y, p.y + 24, 0.2));
    });
    if (time < this.nextWing) return;
    this.nextWing = time + (p.skills.wingman >= 3 ? 180 : 360);
    // 僚机弹不反弹，飞出场外就消失
    for (const w of this.wingmen) this.game.firePlayerBullet(w.x, w.y - 18, UP, 900, 'wbullet', 0.8 * p.damageMul, 0, { bounces: 0, lifeMs: 1400 });
  }

  // ───── 追踪导弹 ─────
  private updateMissiles(time: number): void {
    if (time < this.nextMissile) return;
    const p = this.game.player;
    const lv = p.skills.missile;
    this.nextMissile = time + 2400 - lv * 250;
    for (let i = 0; i < lv; i++) {
      const spread = (i - (lv - 1) / 2) * 0.45;
      const b = this.game.firePlayerBullet(p.x, p.y, UP + spread, 380, 'missile', 3 * p.damageMul, 0, { bounces: 0, lifeMs: 5000 });
      if (b) b.homing = true;
    }
    audio.missile();
  }

  private steerMissiles(delta: number): void {
    const dt = delta / 1000;
    const enemies = this.game.activeEnemies();
    const boss = this.game.currentBoss;
    for (const b of this.game.activePlayerBullets()) {
      if (!b.homing) continue;
      let target: { x: number; y: number } | undefined = boss;
      let best = boss ? Phaser.Math.Distance.Squared(b.x, b.y, boss.x, boss.y) : Infinity;
      for (const e of enemies) {
        if (!e.onScreen) continue;
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
    }
  }

  // ───── 连锁闪电 ─────
  private zap(time: number): void {
    const p = this.game.player;
    const lv = p.skills.lightning;
    const dmg = (3 + lv) * p.damageMul;
    const candidates = this.game.activeEnemies().filter((e) => e.onScreen);
    const chain: { x: number; y: number }[] = [{ x: p.x, y: p.y - 20 }];
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

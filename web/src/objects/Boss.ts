import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';
import type { GameScene } from '../scenes/GameScene';

type Attack = 'fan' | 'ring' | 'spiral' | 'burst' | 'minions' | 'rain';
const ATTACKS: Attack[] = ['fan', 'ring', 'burst', 'spiral', 'rain', 'fan', 'minions'];
const DOWN = Math.PI / 2;
/** 出招前的抬手时间：先亮一下、涨一圈，玩家有时间挪位，这一招才躲得掉 */
const TELEGRAPH_MS = 340;

export class Boss extends Phaser.Physics.Arcade.Sprite {
  hp: number;
  readonly maxHp: number;
  private t = 0;
  private entering = true;
  private nextAttack = 0;
  private attackIdx = 0;
  private spiralUntil = 0;
  private nextSpiral = 0;
  private spiralAngle = 0;
  /** 正在抬手，到点才真的出招 */
  private telegraphUntil = 0;

  constructor(scene: GameScene, readonly level: number) {
    super(scene, GAME_W / 2, -180, 'boss');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(6);
    this.maxHp = this.hp = 260 + level * 180;
    (this.body as Phaser.Physics.Arcade.Body).setCircle(85, this.width / 2 - 85, this.height / 2 - 85);
  }

  get enraged(): boolean {
    return this.hp < this.maxHp / 2;
  }

  /** 停靠高度：竖屏 230，扁屏按比例压低 */
  private get homeY(): number {
    return Math.min(230, GAME_H * 0.3);
  }

  /** 左右巡航幅度 */
  private get swingX(): number {
    return Math.min(GAME_W * 0.3, 300);
  }

  /** 炮口位置：飞船下沿 */
  private get muzzleY(): number {
    return this.y + 60;
  }

  tick(time: number, delta: number): void {
    if (this.hp <= 0) return;
    const game = this.scene as GameScene;
    const dt = delta / 1000;
    this.t += dt;

    if (this.entering) {
      this.y += 140 * dt;
      if (this.y >= this.homeY) {
        this.entering = false;
        this.t = 0;
        this.nextAttack = time + 1000;
      }
      return;
    }

    this.x = GAME_W / 2 + Math.sin(this.t * (this.enraged ? 0.9 : 0.6)) * this.swingX;
    this.y = this.homeY + Math.sin(this.t * 0.5) * 50;
    if (this.enraged) this.setTint(Math.floor(time / 120) % 2 ? COLORS.white : 0xffaaee);

    if (this.telegraphUntil > 0) {
      if (time >= this.telegraphUntil) {
        // 抬手结束，这一招才算真出来
        this.telegraphUntil = 0;
        this.setScale(1);
        this.setTint(Math.floor(time / 120) % 2 ? COLORS.white : 0xffaaee);
        this.attack(ATTACKS[this.attackIdx++ % ATTACKS.length], time, game);
        this.nextAttack = time + (this.enraged ? 1600 : 2300) / (1 + this.level * 0.05);
      } else {
        const k = 1 - (this.telegraphUntil - time) / TELEGRAPH_MS;
        this.setScale(1 + 0.07 * k);
        this.setTint(Math.floor(time / 60) % 2 ? COLORS.white : COLORS.red);
      }
    } else if (time >= this.nextAttack) {
      this.telegraphUntil = time + TELEGRAPH_MS;
    }

    if (this.telegraphUntil === 0 && time < this.spiralUntil && time >= this.nextSpiral) {
      this.nextSpiral = time + (this.enraged ? 70 : 95);
      const arms = this.enraged ? 3 : 2;
      for (let i = 0; i < arms; i++) game.fireEnemy(this.x, this.y + 10, this.spiralAngle + (i * Math.PI * 2) / arms, 190, 'ebullet');
      this.spiralAngle += 0.28;
    }
  }

  private attack(kind: Attack, time: number, game: GameScene): void {
    const my = this.muzzleY;
    switch (kind) {
      case 'fan':
        game.fireEnemyAimed(this.x, my, 260, 'ebullet2', this.enraged ? 9 : 7, 0.14);
        break;
      case 'ring': {
        const n = this.enraged ? 24 : 18;
        const off = Math.random();
        for (let i = 0; i < n; i++) game.fireEnemy(this.x, this.y + 10, off + (i / n) * Math.PI * 2, 180, 'ebullet');
        break;
      }
      case 'spiral':
        this.spiralUntil = time + 1600;
        break;
      case 'burst':
        for (let i = 0; i < (this.enraged ? 7 : 5); i++) {
          this.scene.time.delayedCall(i * 110, () => {
            if (this.active) game.fireEnemyAimed(this.x, this.muzzleY, 420, 'ebullet3', 1, 0);
          });
        }
        break;
      case 'rain':
        // 两翼垂直落下的弹雨，中间留出通道
        for (const side of [-1, 1]) {
          for (let i = 0; i < 4; i++) game.fireEnemy(this.x + side * (70 + i * 18), my - 20, DOWN, 240 + i * 25, 'ebullet');
        }
        break;
      case 'minions':
        for (let i = -1; i <= 1; i++) game.spawnEnemy(this.enraged ? 'charger' : 'drone', this.x + i * 80, this.y + 60);
        break;
    }
  }
}

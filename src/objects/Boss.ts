import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';
import type { GameScene } from '../scenes/GameScene';
import type { BulletOpts } from './Bullet';
import type { EnemyKind } from './Enemy';

type Attack = 'fan' | 'ring' | 'spiral' | 'burst' | 'minions' | 'rain' | 'dash';
// 冲刺排在中段和末尾各一次：它是最能改变站位的一招，但不能连着来 ——
// 连着来玩家就没有「喘一口、把位置摆回来」的窗口了
const ATTACKS: Attack[] = ['fan', 'ring', 'dash', 'burst', 'spiral', 'rain', 'fan', 'minions', 'dash'];
const DOWN = Math.PI / 2;
/** 出招前的抬手时间：先亮一下、涨一圈，玩家有时间挪位，这一招才躲得掉 */
const TELEGRAPH_MS = 340;
/**
 * Boss 打出去的每一发都是重弹：挨上一下按 Boss 那一档扣血（见 config 的 HIT.bossBullet）。
 * 提成一个常量而不是每发写一个 `{ heavy: true }` —— 环形弹一次就是三十几发，
 * 每发 new 一个只为传一个布尔值，没必要
 */
const HEAVY: BulletOpts = { heavy: true };

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
  /** 冲刺：从哪冲到哪、什么时候冲完。冲刺期间位置全由它接管 */
  private dashFromX = 0;
  private dashFromY = 0;
  private dashToX = 0;
  private dashToY = 0;
  private dashStart = 0;
  private dashEnd = 0;

  constructor(scene: GameScene, readonly level: number) {
    super(scene, GAME_W / 2, -180, 'boss');
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(6);
    this.maxHp = this.hp = 260 + level * 200;
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

    if (this.entering) {
      this.t += dt;
      this.y += 140 * dt;
      if (this.y >= this.homeY) {
        this.entering = false;
        this.t = 0;
        this.nextAttack = time + 1000;
      }
      return;
    }

    // 冲刺整段接管位置，而且 t 冻着不涨 —— 冲完正好落回出发点，
    // 巡航接着原来的相位往下走，不会「啪」地弹回停靠位
    if (this.dashEnd > time) {
      this.dashPose(time, game);
      return;
    }
    if (this.dashEnd !== 0) {
      this.dashEnd = 0;
      this.setAlpha(1);
      this.nextAttack = time + (this.enraged ? 1150 : 1700) / (1 + this.level * 0.05);
    }

    this.t += dt;
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
        this.nextAttack = time + (this.enraged ? 1150 : 1700) / (1 + this.level * 0.05);
      } else {
        const k = 1 - (this.telegraphUntil - time) / TELEGRAPH_MS;
        this.setScale(1 + 0.07 * k);
        this.setTint(Math.floor(time / 60) % 2 ? COLORS.white : COLORS.red);
      }
    } else if (time >= this.nextAttack) {
      this.telegraphUntil = time + TELEGRAPH_MS;
    }

    // 螺旋是唯一一招「一直出、不停歇」的弹幕，所以它才是压场的那一招：
    // 臂数从 3 提到 4、间隔压到 65ms，两条一起加，密度的感觉是相乘的
    if (this.telegraphUntil === 0 && time < this.spiralUntil && time >= this.nextSpiral) {
      this.nextSpiral = time + (this.enraged ? 45 : 65);
      const arms = this.enraged ? 5 : 4;
      for (let i = 0; i < arms; i++) game.fireEnemy(this.x, this.y + 10, this.spiralAngle + (i * Math.PI * 2) / arms, 190, 'ebullet', HEAVY);
      this.spiralAngle += 0.28;
    }
  }

  /**
   * 冲刺中的位置：冲出去再收回来，去程 55%、回程 45%，两段各自 easeInOut。
   * 回到出发点就交还给巡航 —— 因为 t 冻着，接上的是同一相位，位置是连着的。
   */
  private dashPose(time: number, game: GameScene): void {
    const k = Phaser.Math.Clamp((time - this.dashStart) / (this.dashEnd - this.dashStart), 0, 1);
    const out = k < 0.55;
    const u = out ? k / 0.55 : (k - 0.55) / 0.45;
    const s = u * u * (3 - 2 * u);
    this.x = Phaser.Math.Linear(out ? this.dashFromX : this.dashToX, out ? this.dashToX : this.dashFromX, s);
    this.y = Phaser.Math.Linear(out ? this.dashFromY : this.dashToY, out ? this.dashToY : this.dashFromY, s);
    if (this.enraged) this.setTint(Math.floor(time / 120) % 2 ? COLORS.white : 0xffaaee);
    // 冲的这一路一直在撒弹：这一招的威胁不只是撞到，更是逼你在躲它的同时躲弹
    if (time >= this.nextSpiral) {
      this.nextSpiral = time + (this.enraged ? 50 : 65);
      const arms = this.enraged ? 4 : 3;
      for (let i = 0; i < arms; i++) game.fireEnemy(this.x, this.y + 10, this.spiralAngle + (i * Math.PI * 2) / arms, 190, 'ebullet', HEAVY);
      this.spiralAngle += 0.28;
    }
  }

  private attack(kind: Attack, time: number, game: GameScene): void {
    const my = this.muzzleY;
    switch (kind) {
      case 'fan':
        // 扇形是追着玩家打的，弹数加上去之后不能只靠张角分摊 —— 张角跟着从 0.14 放到 0.16，
        // 否则 17 发挤在前一版的宽度里，弹和弹之间连不下一颗机身
        game.fireEnemyAimed(this.x, my, 260, 'ebullet2', this.enraged ? 17 : 11, 0.16, HEAVY);
        break;
      case 'ring': {
        // 环形是唯一「无死角」的一招，弹数就是它的全部威胁。38 发一圈，相邻间隔 9.5°，
        // 在 200 像素外是 33 像素的缝 —— 机身判定圈才 5 像素，还是钻得过去，但得挑着钻
        const n = this.enraged ? 38 : 26;
        const off = Math.random();
        for (let i = 0; i < n; i++) game.fireEnemy(this.x, this.y + 10, off + (i / n) * Math.PI * 2, 180, 'ebullet', HEAVY);
        break;
      }
      case 'spiral':
        this.spiralUntil = time + 1600;
        break;
      case 'burst':
        // 高速弹：单发威力大、又躲不及，所以加的幅度比别的招小，靠「一串 12 发」压走位
        for (let i = 0; i < (this.enraged ? 12 : 9); i++) {
          this.scene.time.delayedCall(i * 100, () => {
            if (this.active) game.fireEnemyAimed(this.x, this.muzzleY, 420, 'ebullet3', 1, 0, HEAVY);
          });
        }
        break;
      case 'dash': {
        // 冲到玩家前上方再收回来。落点压进机身判定圈里（差 70 < 半径和 90），
        // 所以「站着不动」是会被撞的 —— 但 340ms 抬手 + 近 700ms 的行程，
        // 足够挪开；这一招要的是逼你放弃现在这个位置，不是收人头
        this.dashFromX = this.x;
        this.dashFromY = this.y;
        this.dashToX = Phaser.Math.Clamp(game.player.x, 90, GAME_W - 90);
        this.dashToY = Phaser.Math.Clamp(game.player.y - 70, this.homeY + 60, GAME_H - 120);
        this.dashStart = time;
        this.dashEnd = time + (this.enraged ? 1250 : 1550);
        // 一进冲刺就开始撒弹，不是等停下来才撒
        this.nextSpiral = time;
        this.spiralAngle = Math.random() * Math.PI * 2;
        this.scene.cameras.main.shake(240, 0.012);
        break;
      }
      case 'rain':
        // 两翼垂直落下的弹雨，中间留出通道。7 发一列、列从 ±70 起算，
        // 中间那条 140 像素的通道宽度不动 —— 这一招要的是逼你进通道，不是堵死通道
        for (const side of [-1, 1]) {
          for (let i = 0; i < 7; i++) game.fireEnemy(this.x + side * (70 + i * 17), my - 20, DOWN, 240 + i * 25, 'ebullet', HEAVY);
        }
        break;
      case 'minions': {
        // 关数高了召唤得更凶：自爆机比小飞机难缠得多，一次也来得多
        const kind: EnemyKind = this.level >= 5 ? 'rammer' : this.enraged ? 'charger' : 'drone';
        const spread = 1 + Math.min(3, Math.floor(this.level / 4));
        for (let i = -spread; i <= spread; i++) game.spawnEnemy(kind, this.x + i * 70, this.y + 60);
        break;
      }
    }
  }
}

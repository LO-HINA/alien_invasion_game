import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';

export type PowerKind = 'weapon' | 'shield' | 'bomb' | 'heal' | 'rapid' | 'star' | 'xp' | 'life';

export const POWER_INFO: Record<PowerKind, { weight: number; label: string; color: number }> = {
  weapon: { weight: 3, label: '火力提升', color: COLORS.yellow },
  shield: { weight: 2, label: '护盾', color: COLORS.cyan },
  heal: { weight: 2, label: '修复', color: COLORS.green },
  bomb: { weight: 1, label: '炸弹 +1', color: COLORS.orange },
  rapid: { weight: 2, label: '急速射击', color: COLORS.orange },
  star: { weight: 0.8, label: '无敌', color: COLORS.yellow },
  // 经验晶体不再走随机掉落，它由击杀敌机单独产出
  xp: { weight: 0, label: '经验', color: COLORS.blue },
  life: { weight: 0.25, label: '1UP', color: COLORS.magenta },
};

export function randomPowerKind(): PowerKind {
  const entries = (Object.entries(POWER_INFO) as [PowerKind, { weight: number }][]).filter(([, i]) => i.weight > 0);
  const total = entries.reduce((s, [, i]) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const [k, i] of entries) {
    r -= i.weight;
    if (r <= 0) return k;
  }
  return 'weapon';
}

export interface PowerUpOpts {
  /** 原地不动、不会消失（经验晶体） */
  still?: boolean;
  /** 经验值，仅 xp 晶体使用 */
  value?: number;
}

export class PowerUp extends Phaser.Physics.Arcade.Sprite {
  kind: PowerKind = 'weapon';
  /** xp 晶体携带的经验 */
  value = 1;
  still = false;
  private t = 0;
  private baseScale = 1;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y, 'pu_weapon');
  }

  spawn(kind: PowerKind, x: number, y: number, opts: PowerUpOpts = {}): void {
    this.kind = kind;
    this.value = opts.value ?? 1;
    this.still = opts.still ?? false;
    this.t = 0;
    this.refreshScale();
    this.setTexture(`pu_${kind}`);
    this.enableBody(true, x, y, true, true);
    this.setBlendMode(Phaser.BlendModes.ADD);
    this.setScale(this.baseScale);
    (this.body as Phaser.Physics.Arcade.Body).setCircle(18, this.width / 2 - 18, this.height / 2 - 18);
    // 原地晶体不带初速，掉落的道具往下飘
    this.setVelocity(this.still ? 0 : Phaser.Math.Between(-50, 50), this.still ? 0 : 100);
  }

  /** 合并经验时调用 */
  addValue(v: number): void {
    this.value += v;
    this.refreshScale();
    this.t = 0;
  }

  /** 被磁力吸向 (x, y) */
  attract(x: number, y: number): void {
    this.scene.physics.velocityFromRotation(Phaser.Math.Angle.Between(this.x, this.y, x, y), 600, (this.body as Phaser.Physics.Arcade.Body).velocity);
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    this.t += delta / 1000;
    this.setScale(this.baseScale * (1 + Math.sin(this.t * 6) * 0.12));
    // 经验晶体原地不动，也不会掉出屏幕
    if (this.still) return;
    const body = this.body as Phaser.Physics.Arcade.Body;
    if ((this.x < 30 && body.velocity.x < 0) || (this.x > GAME_W - 30 && body.velocity.x > 0)) body.velocity.x *= -1;
    if (this.y > GAME_H + 40) this.disableBody(true, true);
  }

  /** 经验越多晶体越大，玩家一眼能看出哪颗值得捡 */
  private refreshScale(): void {
    this.baseScale = this.still ? 0.6 + Math.min(0.7, Math.log2(Math.max(1, this.value)) * 0.22) : 1;
  }
}

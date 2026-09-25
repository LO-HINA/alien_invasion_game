import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';
import { restartOnResize } from '../systems/resize';
import { loadHighScore, saveHighScore } from '../systems/storage';
import { neonText } from '../systems/ui';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }

  create(data: { score: number; stage: number; level: number; graze: number; isRecord?: boolean }): void {
    // 重建时沿用第一次算出来的结果，否则新纪录会被自己盖掉
    const isRecord = data.isRecord ?? saveHighScore(data.score);
    restartOnResize(this, () => ({ score: data.score, stage: data.stage, level: data.level, graze: data.graze, isRecord }));

    const y = (r: number) => GAME_H * r;
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05030d, 0.75).setOrigin(0);
    neonText(this, GAME_W / 2, y(0.29), 'GAME OVER', 72, COLORS.red);
    neonText(this, GAME_W / 2, y(0.38), `SCORE ${data.score}`, 34, COLORS.cyan);
    neonText(this, GAME_W / 2, y(0.425), `到达第 ${data.stage} 关  ·  等级 ${data.level}`, 22, COLORS.yellow);
    // 擦弹数单独一行：一局打了多少分是结果，敢贴多近是水平
    neonText(this, GAME_W / 2, y(0.465), `擦弹 ${data.graze} 次`, 20, COLORS.green);
    neonText(this, GAME_W / 2, y(0.505), isRecord ? '★ 新纪录 ★' : `HI-SCORE ${loadHighScore()}`, 22, COLORS.magenta);
    const prompt = neonText(this, GAME_W / 2, y(0.575), '空格 / 点击 重新开始', 24, COLORS.white);
    neonText(this, GAME_W / 2, y(0.615), 'M 返回菜单', 18, COLORS.purple);
    this.tweens.add({ targets: prompt, alpha: 0.3, duration: 600, yoyo: true, repeat: -1 });

    const restart = () => {
      this.scene.stop('Game');
      this.scene.start('Game');
    };
    // 稍作延迟，防止死亡瞬间的误操作直接跳过结算
    this.time.delayedCall(700, () => {
      const kb = this.input.keyboard!;
      kb.once('keydown-SPACE', restart);
      this.input.once('pointerdown', restart);
      kb.once('keydown-M', () => {
        this.scene.stop('Game');
        this.scene.start('Menu');
      });
    });
  }
}

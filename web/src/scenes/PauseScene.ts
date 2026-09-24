import Phaser from 'phaser';
import { CN_FONT, COLORS, GAME_H, GAME_W } from '../config';
import { restartOnResize } from '../systems/resize';
import { SKILLS, skillLevel } from '../systems/skills';
import { neonText } from '../systems/ui';
import type { GameScene } from './GameScene';

export class PauseScene extends Phaser.Scene {
  constructor() {
    super('Pause');
  }

  create(): void {
    restartOnResize(this);
    const y = (r: number) => GAME_H * r;
    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05030d, 0.75).setOrigin(0);
    neonText(this, GAME_W / 2, y(0.26), 'PAUSED', 64, COLORS.cyan);
    neonText(this, GAME_W / 2, y(0.32), 'P / ESC / 点击 继续      Q 返回菜单', 20, COLORS.magenta);

    // 已获得的技能一览
    const player = (this.scene.get('Game') as GameScene).player;
    const owned = SKILLS.filter((s) => skillLevel(player, s.id) > 0).map((s) => `${s.name}  Lv ${skillLevel(player, s.id)} / ${s.max}`);
    neonText(this, GAME_W / 2, y(0.41), '已获得技能', 22, COLORS.yellow);
    this.add
      .text(GAME_W / 2, y(0.44), owned.length ? owned.join('\n') : '暂无，击落敌机升级后可以选择', {
        fontFamily: CN_FONT, fontSize: '20px', color: '#c8d4ff', align: 'center', lineSpacing: 10,
      })
      .setOrigin(0.5, 0);

    const kb = this.input.keyboard!;
    const resume = () => {
      this.scene.resume('Game');
      this.scene.stop();
    };
    kb.once('keydown-P', resume);
    kb.once('keydown-ESC', resume);
    kb.once('keydown-SPACE', resume);
    this.time.delayedCall(250, () => this.input.once('pointerdown', resume));
    kb.once('keydown-Q', () => {
      this.scene.stop('Game');
      this.scene.start('Menu');
    });
  }
}

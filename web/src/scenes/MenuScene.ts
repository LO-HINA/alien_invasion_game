import Phaser from 'phaser';
import { CN_FONT, COLORS, GAME_H, GAME_W } from '../config';
import { audio } from '../systems/audio';
import { restartOnResize } from '../systems/resize';
import { Starfield } from '../systems/starfield';
import { loadHighScore } from '../systems/storage';
import { neonText } from '../systems/ui';

export class MenuScene extends Phaser.Scene {
  private starfield!: Starfield;
  private started = false;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.started = false;
    this.starfield = new Starfield(this);
    // 窗口比例变了直接重建，反正这一屏没有需要保留的状态
    restartOnResize(this);

    // 相对高度排版，横屏竖屏都不会跑偏
    const y = (r: number) => GAME_H * r;
    neonText(this, GAME_W / 2, y(0.195), 'NEON', 84, COLORS.cyan);
    neonText(this, GAME_W / 2, y(0.266), 'STARFIGHTER', 60, COLORS.cyan);
    neonText(this, GAME_W / 2, y(0.324), '霓 虹 星 际 战 机', 26, COLORS.magenta);

    const ship = this.add.image(GAME_W / 2, y(0.4375), 'player').setScale(1.8);
    this.tweens.add({ targets: ship, y: y(0.453), duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    const prompt = neonText(this, GAME_W / 2, y(0.547), '按 空格 / ENTER 或点击屏幕开始', 24, COLORS.yellow);
    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 600, yoyo: true, repeat: -1 });

    const help = [
      '自动射击，专心走位就好',
      '移动   WASD / 方向键 / 按住屏幕拖动',
      '冲刺   空格 / SHIFT / 右下角按钮（无敌 + 撞伤敌人）',
      '炸弹   X / K / 右下角按钮      暂停   P / ESC      音乐   M',
      '全屏   F',
      '',
      '子弹会打墙反弹，主炮越升级弹得越久',
      '敌机从四边涌来，击落后经验掉在原地，靠近了才会被吸过来',
      '升级时三选一强化，撑过敌潮就会遇到 Boss',
    ].join('\n');
    this.add
      .text(GAME_W / 2, y(0.72), help, { fontFamily: CN_FONT, fontSize: '18px', color: '#9fb4ff', align: 'center', lineSpacing: 10 })
      .setOrigin(0.5);

    neonText(this, GAME_W / 2, GAME_H - 40, `HI-SCORE ${loadHighScore()}`, 16, COLORS.magenta);

    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', () => this.start());
    kb.on('keydown-ENTER', () => this.start());
    kb.on('keydown-M', () => audio.toggleMusic());
    kb.on('keydown-F', () => this.scale.toggleFullscreen());
    this.input.on('pointerdown', () => this.start());
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    audio.unlock();
    audio.select();
    audio.startMusic();
    this.cameras.main.fadeOut(300, 5, 3, 13);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Game'));
  }

  update(_time: number, delta: number): void {
    this.starfield.update(delta);
  }
}

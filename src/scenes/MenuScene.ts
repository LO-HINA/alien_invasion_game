import Phaser from 'phaser';
import { CN_FONT, COLORS, GAME_H, GAME_W, TURRET_FWD } from '../config';
import { audio } from '../systems/audio';
import { restartOnResize } from '../systems/resize';
import { Starfield } from '../systems/starfield';
import { loadHighScore } from '../systems/storage';
import { neonText } from '../systems/ui';

/** 玩法小窗里的按键表 */
const CONTROLS: [string, string][] = [
  ['移动', 'WASD / 方向键 / 按住屏幕拖动'],
  ['射击', '自动，沿机头方向打出，子弹撞墙会反弹'],
  ['冲刺', '空格 / SHIFT / 右下角按钮（无敌 + 撞伤敌人）'],
  ['炸弹', 'X / K / 右下角按钮'],
  ['暂停', 'P / ESC / 右上角按钮'],
  ['全屏', 'F'],
  ['音乐', 'M'],
];

export class MenuScene extends Phaser.Scene {
  private starfield!: Starfield;
  private started = false;
  /** 玩法小窗；开着的时候点哪都是关窗 */
  private help?: Phaser.GameObjects.Container;

  constructor() {
    super('Menu');
  }

  create(): void {
    this.started = false;
    this.help = undefined;
    this.starfield = new Starfield(this);
    // 窗口比例变了直接重建，反正这一屏没有需要保留的状态
    restartOnResize(this);

    // 相对高度排版，横屏竖屏都不会跑偏
    const y = (r: number) => GAME_H * r;
    neonText(this, GAME_W / 2, y(0.195), 'NEON', 84, COLORS.cyan);
    neonText(this, GAME_W / 2, y(0.266), 'STARFIGHTER', 60, COLORS.cyan);
    neonText(this, GAME_W / 2, y(0.324), '霓 虹 星 际 战 机', 26, COLORS.magenta);

    // 机头和炮塔一起摆，和战斗里一个模样（整组放大 1.8 倍，炮塔离机心的距离跟着一起放）
    const ship = this.add.container(GAME_W / 2, y(0.4375), [
      this.add.image(0, 0, 'player').setScale(1.8),
      this.add.image(0, -TURRET_FWD * 1.8, 'turret').setScale(1.8).setBlendMode(Phaser.BlendModes.ADD),
    ]);
    this.tweens.add({ targets: ship, y: y(0.453), duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

    const prompt = neonText(this, GAME_W / 2, y(0.547), '按 空格 / ENTER 或点击屏幕开始', 24, COLORS.yellow);
    this.tweens.add({ targets: prompt, alpha: 0.2, duration: 600, yoyo: true, repeat: -1 });

    const helpBtn = this.helpButton(GAME_W / 2, y(0.688));

    neonText(this, GAME_W / 2, GAME_H - 40, `HI-SCORE ${loadHighScore()}`, 16, COLORS.magenta);

    const kb = this.input.keyboard!;
    kb.on('keydown-SPACE', () => this.start());
    kb.on('keydown-ENTER', () => this.start());
    kb.on('keydown-ESC', () => this.closeHelp());
    kb.on('keydown-M', () => audio.toggleMusic());
    kb.on('keydown-F', () => this.scale.toggleFullscreen());
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.help) {
        this.closeHelp();
        return;
      }
      if (over.includes(helpBtn)) {
        this.openHelp();
        return;
      }
      this.start();
    });
  }

  /** 「玩法说明」按钮，返回整颗药丸（点边缘也算） */
  private helpButton(x: number, y: number): Phaser.GameObjects.Rectangle {
    const t = neonText(this, x, y, '玩 法 说 明', 22, COLORS.cyan).setDepth(20);
    const rect = this.add.rectangle(x, y, t.width + 56, 46, COLORS.cyan, 0.07).setStrokeStyle(2, COLORS.cyan, 0.6).setDepth(19);
    rect.setInteractive({ useHandCursor: true });
    return rect;
  }

  /** 玩法小窗：居中一块面板，点任意处关掉 */
  private openHelp(): void {
    if (this.help) return;
    audio.select();
    const w = Math.min(660, GAME_W - 40);
    const rowH = 32;
    const head = 92;
    const foot = 48;
    const pad = 34;
    const h = Math.min(GAME_H - 60, head + CONTROLS.length * rowH + foot);
    const left = GAME_W / 2 - w / 2;
    const top = GAME_H / 2 - h / 2;

    const box = this.add.container(0, 0).setDepth(200);
    // 整屏压暗一层，免得标题和飞船在半透明面板后面透出来
    box.add(this.add.rectangle(GAME_W / 2, GAME_H / 2, GAME_W, GAME_H, 0x05030d, 0.78));
    const g = this.add.graphics();
    g.fillStyle(0x05030d, 0.97);
    g.fillRect(left, top, w, h);
    g.lineStyle(2, COLORS.cyan, 0.85);
    g.strokeRect(left, top, w, h);
    // 四角补几笔，像块霓虹屏
    g.lineStyle(3, COLORS.magenta, 0.9);
    for (const [cx, cy, dx, dy] of [[left, top, 1, 1], [left + w, top, -1, 1], [left, top + h, 1, -1], [left + w, top + h, -1, -1]] as const) {
      g.lineBetween(cx, cy, cx + dx * 22, cy);
      g.lineBetween(cx, cy, cx, cy + dy * 22);
    }
    box.add(g);
    box.add(neonText(this, GAME_W / 2, top + 34, '玩 法 说 明', 26, COLORS.cyan));
    box.add(this.column(left + pad, top + head - 26, w - pad * 2, CONTROLS, rowH, COLORS.yellow));
    box.add(neonText(this, GAME_W / 2, top + h - 26, '点击任意处关闭', 14, COLORS.magenta));
    this.help = box;
  }

  /** 左列词条、右列说明，两列对齐 */
  private column(x: number, y: number, w: number, rows: [string, string][], rowH: number, color: number): Phaser.GameObjects.Container {
    const c = this.add.container(0, 0);
    const labelW = 62;
    rows.forEach(([label, desc], i) => {
      const yy = y + i * rowH;
      c.add(neonText(this, x + labelW / 2, yy, label, 16, color));
      c.add(this.add.text(x + labelW + 14, yy, desc, { fontFamily: CN_FONT, fontSize: '15px', color: '#c8d4ff' }).setOrigin(0, 0.5));
      // 分隔线，读起来像表格
      const g = this.add.graphics();
      g.lineStyle(1, COLORS.cyan, 0.12);
      g.lineBetween(x, yy + rowH / 2, x + w, yy + rowH / 2);
      c.add(g);
    });
    return c;
  }

  private closeHelp(): void {
    if (!this.help) return;
    this.help.destroy(true);
    this.help = undefined;
  }

  private start(): void {
    if (this.started || this.help) return;
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

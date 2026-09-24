import Phaser from 'phaser';
import { CN_FONT, COLORS, GAME_H, GAME_W, TURRET_FWD } from '../config';
import { ENEMY_DEFS } from '../objects/Enemy';
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

const TIPS = [
  '机身跟着移动方向转，机头朝哪子弹就往哪打',
  '主炮一轮三连发，撞墙会反弹，弹道能绕到掩体后面',
  '右上角是船体血条，掉光就结束 —— 靠走位，也靠吸血装甲续航',
  '击落后经验掉在原地，靠近了才会被吸过来',
  '升级三选一强化，都不中意可以按 R 重随（一局就几次）',
];

/** 敌机图鉴：只写「长什么样 + 怎么打你」。行要短，小窗在横屏下并不宽 */
const ENEMIES = [
  '杂兵 紫菱形 · 游走 橙箭 · 点射 绿六角',
  '自爆冲锋 红镖 · 重装 紫八边 · 狙击 青矛（蓄力后一发快弹）',
  '旋舞弹幕 紫风车 · 分裂 品红球（爆开成两架） · 环形轰炸 橙宽体',
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
    // 机型数量直接从表里数，加一种敌机这里跟着变
    neonText(this, GAME_W / 2, y(0.78), `机身朝哪打哪 · ${Object.keys(ENEMY_DEFS).length} 种敌机 · 撑过敌潮遇见 Boss`, 15, COLORS.blue);

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
    const tipH = 30;
    const head = 92;
    const foot = 48;
    const pad = 34;
    /** 敌机图鉴那一块：一行小标题 + 几行短句 */
    const foeH = 20 + ENEMIES.length * 24;
    const h = Math.min(GAME_H - 60, head + CONTROLS.length * rowH + 26 + TIPS.length * tipH + 12 + foeH + foot);
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

    const tipsTop = top + head + CONTROLS.length * rowH + 4;
    box.add(this.add.text(left + pad, tipsTop, '要 点', { fontFamily: CN_FONT, fontSize: '16px', color: '#ffe94d' }));
    box.add(
      this.add.text(left + pad, tipsTop + 26, TIPS.map((s) => `· ${s}`).join('\n'), {
        fontFamily: CN_FONT, fontSize: '15px', color: '#c8d4ff', lineSpacing: tipH - 16,
      })
    );

    // 敌机图鉴：新机型越出越多，得让玩家知道谁在打他
    const foeTop = tipsTop + 26 + TIPS.length * tipH + 8;
    box.add(this.add.text(left + pad, foeTop, '敌 机', { fontFamily: CN_FONT, fontSize: '16px', color: '#ffe94d' }));
    const foe = this.add.text(left + pad, foeTop + 24, ENEMIES.join('\n'), {
      fontFamily: CN_FONT, fontSize: '13px', color: '#c8d4ff', lineSpacing: 11,
    });
    // 兜底：哪天真加了新机型把行撑长了，缩一点也比戳出面板外面强
    if (foe.width > w - pad * 2) foe.setScale((w - pad * 2) / foe.width);
    box.add(foe);
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

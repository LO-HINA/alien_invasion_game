import Phaser from 'phaser';
import { CN_FONT, COLORS, GAME_H, GAME_W, hex } from '../config';
import { restartOnResize } from '../systems/resize';
import { audio } from '../systems/audio';
import { skillLevel, type SkillDef } from '../systems/skills';
import { neonText } from '../systems/ui';
import type { GameScene } from './GameScene';

/** 升级时暂停战斗，三选一技能 */
export class LevelUpScene extends Phaser.Scene {
  private cards: Phaser.GameObjects.Rectangle[] = [];
  private choices: SkillDef[] = [];
  private selected = 0;
  private ready = false;

  constructor() {
    super('LevelUp');
  }

  create(data: { level: number; choices: SkillDef[] }): void {
    this.choices = data.choices;
    this.cards = [];
    this.selected = 0;
    this.ready = false;
    // 重建时要带上原来的选项，不然会重掷技能
    restartOnResize(this, () => ({ level: data.level, choices: this.choices }));

    const game = this.scene.get('Game') as GameScene;
    // 扁屏时压缩卡片高度，保证三张卡都塞得下
    const cardH = Math.max(78, Math.min(150, (GAME_H * 0.5) / 3 - 20));
    const cardW = Math.min(600, GAME_W - 80);
    const nameSize = Phaser.Math.Clamp(Math.round(cardH * 0.19), 17, 28);
    const descSize = Phaser.Math.Clamp(Math.round(cardH * 0.135), 13, 20);
    const iconX = cardH * 0.42;
    const textX = cardH * 0.8;
    const top = GAME_H * 0.36;

    this.add.rectangle(0, 0, GAME_W, GAME_H, 0x05030d, 0.78).setOrigin(0);
    const title = neonText(this, GAME_W / 2, GAME_H * 0.22, 'LEVEL UP!', 60, COLORS.yellow).setScale(0.5);
    this.tweens.add({ targets: title, scale: 1, duration: 350, ease: 'Back.out' });
    neonText(this, GAME_W / 2, GAME_H * 0.22 + 70, `等级 ${data.level}  ·  选择一项强化`, 22, COLORS.cyan);

    this.choices.forEach((skill, i) => {
      const y = top + i * (cardH + 24);
      const lv = skillLevel(game.player, skill.id);
      const card = this.add
        .rectangle(GAME_W / 2, y, cardW, cardH, skill.color, 0.08)
        .setStrokeStyle(2, skill.color, 0.5)
        .setInteractive({ useHandCursor: true });
      card.on('pointerover', () => this.select(i));
      card.on('pointerdown', () => this.confirm(i));
      this.cards.push(card);

      const left = GAME_W / 2 - cardW / 2;
      this.add.image(left + iconX, y, skill.icon).setScale(Math.min(1.8, cardH / 80)).setTint(skill.color).setBlendMode(Phaser.BlendModes.ADD);
      neonText(this, left + 26, y - cardH / 2 + 18, `${i + 1}`, 16, COLORS.white).setAlpha(0.6);
      const text = (x: number, ty: number, s: string, size: number, color: string) =>
        this.add.text(x, ty, s, { fontFamily: CN_FONT, fontSize: `${size}px`, color, wordWrap: { width: cardW - textX - 40 } }).setOrigin(0, 0.5);
      text(left + textX, y - cardH * 0.24, skill.name, nameSize, hex(skill.color)).setShadow(0, 0, hex(skill.color), 10, true, true);
      const lvLabel = skill.id === 'repair' ? '' : lv === 0 ? '新技能' : `Lv ${lv} → ${lv + 1}`;
      text(left + cardW - 20, y - cardH * 0.24, lvLabel, nameSize * 0.64, lv === 0 ? '#ffe94d' : '#9fb4ff').setOrigin(1, 0.5);
      text(left + textX, y + cardH * 0.13, skill.desc(lv + 1), descSize, '#e8ecff');
    });

    neonText(this, GAME_W / 2, top + 3 * (cardH + 24) - 6, '1 / 2 / 3 或 方向键 + 回车，也可以直接点击', 16, COLORS.purple);
    this.select(0);

    // 稍等片刻再接受输入，防止误触
    this.time.delayedCall(350, () => (this.ready = true));
    const kb = this.input.keyboard!;
    kb.on('keydown-ONE', () => this.confirm(0));
    kb.on('keydown-TWO', () => this.confirm(1));
    kb.on('keydown-THREE', () => this.confirm(2));
    kb.on('keydown-UP', () => this.select((this.selected + 2) % 3));
    kb.on('keydown-W', () => this.select((this.selected + 2) % 3));
    kb.on('keydown-DOWN', () => this.select((this.selected + 1) % 3));
    kb.on('keydown-S', () => this.select((this.selected + 1) % 3));
    kb.on('keydown-ENTER', () => this.confirm(this.selected));
    kb.on('keydown-SPACE', () => this.confirm(this.selected));
  }

  private select(i: number): void {
    if (i >= this.cards.length) return;
    this.selected = i;
    this.cards.forEach((c, n) => {
      const color = this.choices[n].color;
      c.setFillStyle(color, n === i ? 0.2 : 0.06).setStrokeStyle(n === i ? 3 : 2, color, n === i ? 1 : 0.4);
    });
  }

  private confirm(i: number): void {
    if (!this.ready || i >= this.choices.length) return;
    this.ready = false;
    audio.select();
    (this.scene.get('Game') as GameScene).chooseSkill(this.choices[i].id);
    this.scene.resume('Game');
    this.scene.stop();
  }
}

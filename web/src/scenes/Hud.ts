import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W, PLAYER } from '../config';
import type { Boss } from '../objects/Boss';
import type { Player } from '../objects/Player';
import { neonText } from '../systems/ui';

export interface HudState {
  score: number;
  high: number;
  stage: number;
  lives: number;
  bombs: number;
  multiplier: number;
  level: number;
  xp: number;
  xpNeed: number;
  player: Player;
  boss?: Boss;
}

const PAD = 20;
const BOMB_R = 32;
const DASH_R = 38;
const HP_CELL = 30;

export class Hud {
  /** 触屏按钮，GameScene 用它判断点击落点 */
  readonly bombButton: Phaser.GameObjects.Arc;
  readonly dashButton: Phaser.GameObjects.Arc;
  private g: Phaser.GameObjects.Graphics;
  private score: Phaser.GameObjects.Text;
  private high: Phaser.GameObjects.Text;
  private stage: Phaser.GameObjects.Text;
  private combo: Phaser.GameObjects.Text;
  private weapon: Phaser.GameObjects.Text;
  private buffs: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private xpText: Phaser.GameObjects.Text;
  private bombCount: Phaser.GameObjects.Text;
  private bossLabel: Phaser.GameObjects.Text;
  private icons: Phaser.GameObjects.Image[] = [];
  private bombIcon: Phaser.GameObjects.Image;
  private dashIcon: Phaser.GameObjects.Image;
  private shownLevel = 1;
  private xpY = 0;
  private hpY = 0;

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics().setDepth(100);
    const left = (t: Phaser.GameObjects.Text) => t.setOrigin(0, 0.5).setDepth(100);
    this.score = left(neonText(scene, 0, 0, '', 22, COLORS.cyan));
    this.high = left(neonText(scene, 0, 0, '', 13, COLORS.magenta));
    this.stage = neonText(scene, 0, 0, '', 18, COLORS.yellow).setDepth(100);
    this.combo = neonText(scene, 0, 0, '', 16, COLORS.orange).setDepth(100);
    this.buffs = left(neonText(scene, 0, 0, '', 14, COLORS.orange));
    this.weapon = left(neonText(scene, 0, 0, '', 13, COLORS.yellow));
    this.levelText = left(neonText(scene, 0, 0, '', 14, COLORS.blue));
    this.xpText = neonText(scene, 0, 0, '', 12, COLORS.blue).setOrigin(1, 0.5).setDepth(100);
    this.bossLabel = neonText(scene, 0, 0, 'MOTHERSHIP', 12, COLORS.magenta).setDepth(100).setVisible(false);
    for (let i = 0; i < 9; i++) this.icons.push(scene.add.image(0, 0, 'player').setScale(0.4).setDepth(100).setVisible(false));

    this.bombButton = scene.add.circle(0, 0, BOMB_R, COLORS.orange, 0.08).setStrokeStyle(2, COLORS.orange, 0.7).setDepth(100).setInteractive();
    this.bombIcon = scene.add.image(0, 0, 'pu_bomb').setDepth(100);
    this.bombCount = neonText(scene, 0, 0, '', 14, COLORS.white).setDepth(100);

    this.dashButton = scene.add.circle(0, 0, DASH_R, COLORS.cyan, 0.08).setStrokeStyle(2, COLORS.cyan, 0.7).setDepth(100).setInteractive();
    this.dashIcon = scene.add.image(0, 0, 'pu_dash').setDepth(100);

    this.layout();
  }

  /** 世界尺寸变化时重新摆位 */
  layout(): void {
    this.xpY = GAME_H - 22;
    this.hpY = GAME_H - 58;
    const bx = GAME_W - 58;
    const bombY = GAME_H - 190;
    const dashY = GAME_H - 96;

    this.score.setPosition(PAD, 28);
    this.high.setPosition(PAD, 56);
    this.stage.setPosition(GAME_W / 2, 28);
    this.combo.setPosition(GAME_W / 2, 56);
    this.bossLabel.setPosition(GAME_W / 2, 86);
    this.buffs.setPosition(PAD, this.hpY - 56);
    this.weapon.setPosition(PAD, this.hpY - 30);
    this.levelText.setPosition(PAD, this.xpY - 18);
    this.xpText.setPosition(GAME_W - PAD, this.xpY - 18);

    this.bombButton.setPosition(bx, bombY);
    this.bombIcon.setPosition(bx, bombY - 4).setScale(1);
    this.bombCount.setPosition(bx, bombY + 20);

    this.dashButton.setPosition(bx, dashY);
    this.dashIcon.setPosition(bx, dashY);
  }

  update(s: HudState): void {
    const p = s.player;
    const now = this.scene.time.now;
    this.score.setText(`SCORE ${s.score.toString().padStart(8, '0')}`);
    this.high.setText(`HI ${Math.max(s.high, s.score).toString().padStart(8, '0')}`);
    this.stage.setText(`STAGE ${s.stage}`);
    this.combo.setText(s.multiplier > 1 ? `COMBO x${s.multiplier}` : '');
    this.weapon.setText(`WEAPON Lv${p.weapon}${p.weapon >= PLAYER.maxWeapon ? ' MAX' : ''}`);
    const buffs: string[] = [];
    if (p.rapid) buffs.push(`急速 ${Math.ceil((p.rapidUntil - now) / 1000)}s`);
    if (p.starred) buffs.push(`无敌 ${Math.ceil((p.starUntil - now) / 1000)}s`);
    this.buffs.setText(buffs.join('   '));
    this.bombCount.setText(`×${s.bombs}`);
    this.bombButton.setAlpha(s.bombs > 0 ? 1 : 0.35);

    // 升级时等级数字弹一下
    if (s.level !== this.shownLevel) {
      this.shownLevel = s.level;
      this.levelText.setScale(1.6);
      this.scene.tweens.add({ targets: this.levelText, scale: 1, duration: 400, ease: 'Back.out' });
    }
    this.levelText.setText(`LV ${s.level}`);
    this.xpText.setText(`EXP ${Math.floor(s.xp)} / ${s.xpNeed}`);

    // 右上：剩余命数
    let i = 0;
    for (let n = 0; n < s.lives && i < this.icons.length; n++, i++) this.icons[i].setPosition(GAME_W - 26 - n * 30, 32).setVisible(true);
    for (; i < this.icons.length; i++) this.icons[i].setVisible(false);

    const g = this.g;
    g.clear();

    // 底部经验条
    const xw = GAME_W - PAD * 2;
    g.fillStyle(COLORS.blue, 0.15);
    g.fillRect(PAD, this.xpY, xw, 10);
    g.fillStyle(COLORS.blue, 0.9);
    g.fillRect(PAD, this.xpY, xw * Math.min(1, s.xp / s.xpNeed), 10);
    g.lineStyle(1, COLORS.cyan, 0.8);
    g.strokeRect(PAD, this.xpY, xw, 10);

    // 船体耐久格 + 护盾
    for (let n = 0; n < p.maxHp; n++) {
      const on = n < p.hp;
      const color = p.hp <= 1 ? COLORS.red : COLORS.green;
      g.fillStyle(color, on ? 0.85 : 0.1);
      g.fillRect(PAD + n * HP_CELL, this.hpY, HP_CELL - 6, 12);
      g.lineStyle(1, color, 0.8);
      g.strokeRect(PAD + n * HP_CELL, this.hpY, HP_CELL - 6, 12);
    }
    for (let n = 0; n < p.shield; n++) {
      g.lineStyle(2, COLORS.cyan, 0.9);
      g.strokeCircle(PAD + p.maxHp * HP_CELL + 12 + n * 22, this.hpY + 6, 7);
    }
    if (p.shield > 0 && p.alive) {
      g.lineStyle(2, COLORS.cyan, 0.35 + 0.15 * Math.sin(now / 120));
      g.strokeCircle(p.x, p.y, 36);
    }

    // 冲刺冷却：按钮上盖一层扇形
    const dash = this.dashButton;
    const charge = p.dashCharge;
    this.dashButton.setAlpha(charge > 0 ? 0.45 : 1);
    this.dashIcon.setAlpha(charge > 0 ? 0.5 : 1);
    if (charge > 0) {
      g.fillStyle(0x05030d, 0.65);
      g.slice(dash.x, dash.y, DASH_R - 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge, false);
      g.fillPath();
    } else if (p.alive) {
      g.lineStyle(2, COLORS.cyan, 0.4 + 0.3 * Math.sin(now / 150));
      g.strokeCircle(dash.x, dash.y, DASH_R + 4);
    }

    // Boss 血条
    const boss = s.boss;
    this.bossLabel.setVisible(!!boss);
    if (boss) {
      const w = Math.min(520, GAME_W - 120);
      const x = GAME_W / 2 - w / 2;
      const y = 100;
      g.fillStyle(COLORS.magenta, 0.12);
      g.fillRect(x, y, w, 10);
      g.fillStyle(boss.enraged ? COLORS.red : COLORS.magenta, 0.9);
      g.fillRect(x, y, (w * Math.max(0, boss.hp)) / boss.maxHp, 10);
      g.lineStyle(1, COLORS.magenta, 0.9);
      g.strokeRect(x, y, w, 10);
    }
  }
}

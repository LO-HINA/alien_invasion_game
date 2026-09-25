import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W, PLAYER } from '../config';
import type { Boss } from '../objects/Boss';
import type { Player } from '../objects/Player';
import { neonText } from '../systems/ui';

export interface HudState {
  score: number;
  high: number;
  stage: number;
  bombs: number;
  multiplier: number;
  level: number;
  xp: number;
  xpNeed: number;
  /** 已经满级：经验条改显示 MAX，也不再按比例算宽度（满级时 xpNeed 没意义） */
  maxed: boolean;
  player: Player;
  boss?: Boss;
}

const PAD = 20;
const BOMB_R = 32;
const DASH_R = 38;
const PAUSE_R = 26;
/** 血条尺寸 */
const HP_H = 18;

export class Hud {
  /** 触屏按钮，GameScene 用它判断点击落点 */
  readonly bombButton: Phaser.GameObjects.Arc;
  readonly dashButton: Phaser.GameObjects.Arc;
  readonly pauseButton: Phaser.GameObjects.Arc;
  private g: Phaser.GameObjects.Graphics;
  private score: Phaser.GameObjects.Text;
  private high: Phaser.GameObjects.Text;
  private stage: Phaser.GameObjects.Text;
  private combo: Phaser.GameObjects.Text;
  private weapon: Phaser.GameObjects.Text;
  private buffs: Phaser.GameObjects.Text;
  private levelText: Phaser.GameObjects.Text;
  private xpText: Phaser.GameObjects.Text;
  private hpText: Phaser.GameObjects.Text;
  private bombCount: Phaser.GameObjects.Text;
  private bossLabel: Phaser.GameObjects.Text;
  private bombIcon: Phaser.GameObjects.Image;
  private dashIcon: Phaser.GameObjects.Image;
  private pauseIcon: Phaser.GameObjects.Image;
  private shownLevel = 1;
  private xpY = 0;
  private infoY = 0;
  private hpW = 0;
  private hpX = 0;
  private hpY = 0;
  /** 血条的滞后值：受伤时先掉一截白的，条子再慢慢追上来 */
  private hpShown = 1;
  /** 上一次的血量，用来判断这一帧是刚挨打还是刚回血 */
  private lastHp = -1;
  private hpFlashAt = -9999;
  private hpHealAt = -9999;

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
    this.hpText = neonText(scene, 0, 0, '', 12, COLORS.white).setDepth(101);
    this.bossLabel = neonText(scene, 0, 0, 'MOTHERSHIP', 12, COLORS.magenta).setDepth(100).setVisible(false);

    this.bombButton = scene.add.circle(0, 0, BOMB_R, COLORS.orange, 0.08).setStrokeStyle(2, COLORS.orange, 0.7).setDepth(100).setInteractive();
    this.bombIcon = scene.add.image(0, 0, 'pu_bomb').setDepth(100);
    this.bombCount = neonText(scene, 0, 0, '', 14, COLORS.white).setDepth(100);

    this.dashButton = scene.add.circle(0, 0, DASH_R, COLORS.cyan, 0.08).setStrokeStyle(2, COLORS.cyan, 0.7).setDepth(100).setInteractive();
    this.dashIcon = scene.add.image(0, 0, 'pu_dash').setDepth(100);

    // 右上角暂停，触屏上也得有地方按
    this.pauseButton = scene.add.circle(0, 0, PAUSE_R, COLORS.cyan, 0.08).setStrokeStyle(2, COLORS.cyan, 0.55).setDepth(100).setInteractive();
    this.pauseIcon = scene.add.image(0, 0, 'pause').setDepth(100).setScale(0.8);

    this.layout();
  }

  /** 世界尺寸变化时重新摆位 */
  layout(): void {
    this.xpY = GAME_H - 22;
    this.infoY = GAME_H - 58;
    const bx = GAME_W - 58;
    const bombY = GAME_H - 190;
    const dashY = GAME_H - 96;

    this.score.setPosition(PAD, 28);
    this.high.setPosition(PAD, 56);
    this.stage.setPosition(GAME_W / 2, 28);
    this.combo.setPosition(GAME_W / 2, 56);
    this.bossLabel.setPosition(GAME_W / 2, 86);
    this.buffs.setPosition(PAD, this.infoY - 56);
    this.weapon.setPosition(PAD, this.infoY - 30);
    this.levelText.setPosition(PAD, this.xpY - 18);
    this.xpText.setPosition(GAME_W - PAD, this.xpY - 18);

    // 血条贴在右上角，右边空出来给触屏按钮
    this.hpW = Math.min(240, GAME_W * 0.34);
    this.hpX = GAME_W - PAD - this.hpW;
    this.hpY = 24;
    this.hpText.setPosition(GAME_W - PAD - this.hpW / 2, this.hpY + HP_H / 2);

    this.bombButton.setPosition(bx, bombY);
    this.bombIcon.setPosition(bx, bombY - 4).setScale(1);
    this.bombCount.setPosition(bx, bombY + 20);

    this.dashButton.setPosition(bx, dashY);
    this.dashIcon.setPosition(bx, dashY);

    // 右上角，错开血条和 Boss 血条
    this.pauseButton.setPosition(GAME_W - PAD - PAUSE_R, 116);
    this.pauseIcon.setPosition(GAME_W - PAD - PAUSE_R, 116);
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
    this.levelText.setText(s.maxed ? `LV ${s.level} MAX` : `LV ${s.level}`);
    this.xpText.setText(s.maxed ? 'EXP MAX' : `EXP ${Math.floor(s.xp)} / ${s.xpNeed}`);

    const g = this.g;
    g.clear();

    // 底部经验条。满级之后整条填满：它现在的意思是「这条线走完了」，
    // 而不是「进度」。不清空也不填满的话，满级在屏幕上根本看不出来
    const xw = GAME_W - PAD * 2;
    const xr = s.maxed ? 1 : Phaser.Math.Clamp(s.xp / s.xpNeed, 0, 1);
    g.fillStyle(COLORS.blue, 0.15);
    g.fillRect(PAD, this.xpY, xw, 10);
    g.fillStyle(COLORS.blue, 0.9);
    g.fillRect(PAD, this.xpY, xw * xr, 10);
    g.lineStyle(1, COLORS.cyan, 0.8);
    g.strokeRect(PAD, this.xpY, xw, 10);

    // 右上：血条
    const ratio = Phaser.Math.Clamp(p.hp / p.maxHp, 0, 1);
    if (this.lastHp < 0) this.hpShown = ratio;
    if (p.hp < this.lastHp) this.hpFlashAt = now;
    if (p.hp > this.lastHp) this.hpHealAt = now;
    this.lastHp = p.hp;
    // 滞后条：回血直接跟上，掉血时留一截白的慢慢追，一眼看得出这一下掉了多少
    if (ratio >= this.hpShown) this.hpShown = ratio;
    else this.hpShown = Math.max(ratio, this.hpShown - (this.hpShown - ratio) * 0.12);
    const low = ratio <= 0.3;
    const hpColor = low ? COLORS.red : COLORS.green;
    g.fillStyle(COLORS.white, 0.07);
    g.fillRect(this.hpX, this.hpY, this.hpW, HP_H);
    if (this.hpShown > ratio) {
      g.fillStyle(COLORS.white, 0.4);
      g.fillRect(this.hpX + this.hpW * ratio, this.hpY, this.hpW * (this.hpShown - ratio), HP_H);
    }
    g.fillStyle(hpColor, (low ? 0.72 + 0.24 * Math.sin(now / 140) : 0.9));
    g.fillRect(this.hpX, this.hpY, this.hpW * ratio, HP_H);
    if (now - this.hpFlashAt < 130) {
      g.fillStyle(COLORS.white, 0.5);
      g.fillRect(this.hpX, this.hpY, this.hpW, HP_H);
    } else if (now - this.hpHealAt < 180) {
      // 回血也闪一下（绿），不然血条往回涨容易被忽略
      g.fillStyle(COLORS.green, 0.45);
      g.fillRect(this.hpX - 2, this.hpY - 2, this.hpW + 4, HP_H + 4);
    }
    g.fillStyle(COLORS.white, 0.85);
    g.fillRect(this.hpX + this.hpW * ratio - 1.5, this.hpY, 3, HP_H);
    // 四等分的刻度，血量变化读起来更快
    g.lineStyle(1, COLORS.cyan, 0.22);
    for (let n = 1; n < 4; n++) g.lineBetween(this.hpX + (this.hpW * n) / 4, this.hpY, this.hpX + (this.hpW * n) / 4, this.hpY + HP_H);
    g.lineStyle(1.5, hpColor, 0.9);
    g.strokeRect(this.hpX, this.hpY, this.hpW, HP_H);
    this.hpText.setText(`${Math.max(0, Math.ceil(p.hp))} / ${p.maxHp}`);

    // 护盾挂在血条下面
    for (let n = 0; n < p.shield; n++) {
      g.lineStyle(2, COLORS.cyan, 0.9);
      g.strokeCircle(GAME_W - PAD - 9 - n * 22, this.hpY + HP_H + 13, 7);
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

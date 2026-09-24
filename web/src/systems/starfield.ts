import Phaser from 'phaser';
import { COLORS, GAME_H, GAME_W } from '../config';

const LAYERS = [
  { count: 160, size: 1, alpha: 0.5, speed: 25 },
  { count: 70, size: 1.6, alpha: 0.75, speed: 70 },
  { count: 25, size: 2.4, alpha: 1, speed: 160 },
];
const TILE = 512;
const GRID = 90;

/** 三层视差星空 + 向下滚动的淡霓虹网格（竖版） */
export class Starfield {
  private layers: Phaser.GameObjects.TileSprite[] = [];
  /** 竖线是静止的，单独放一个 Graphics 只在窗口变化时画一次 */
  private gridCols: Phaser.GameObjects.Graphics;
  /** 横线要滚动，每帧重画 */
  private grid: Phaser.GameObjects.Graphics;
  private gridOffset = 0;
  speedMul = 1;

  constructor(scene: Phaser.Scene) {
    LAYERS.forEach((l, i) => {
      const key = `stars${i}`;
      if (!scene.textures.exists(key)) {
        const g = scene.make.graphics({}, false);
        const tints = [COLORS.white, COLORS.cyan, COLORS.magenta];
        for (let n = 0; n < l.count; n++) {
          g.fillStyle(Phaser.Utils.Array.GetRandom(tints), Phaser.Math.FloatBetween(0.4, 1));
          g.fillCircle(Phaser.Math.Between(0, TILE), Phaser.Math.Between(0, TILE), l.size);
        }
        g.generateTexture(key, TILE, TILE);
        g.destroy();
      }
      const ts = scene.add.tileSprite(0, 0, GAME_W, GAME_H, key).setOrigin(0).setAlpha(l.alpha).setDepth(-10 + i);
      this.layers.push(ts);
    });
    this.gridCols = scene.add.graphics().setDepth(-5);
    this.grid = scene.add.graphics().setDepth(-5);
    this.drawCols();
  }

  /** 窗口比例变了之后重铺背景 */
  layout(): void {
    this.layers.forEach((ts) => ts.setSize(GAME_W, GAME_H));
    this.drawCols();
  }

  /** 竖网格只跟画布尺寸有关，画一次就够了 */
  private drawCols(): void {
    const g = this.gridCols;
    g.clear();
    g.lineStyle(1, COLORS.purple, 0.12);
    for (let x = GRID / 2; x < GAME_W; x += GRID) g.lineBetween(x, 0, x, GAME_H);
  }

  update(delta: number): void {
    const dt = delta / 1000;
    this.layers.forEach((ts, i) => (ts.tilePositionY -= LAYERS[i].speed * this.speedMul * dt));
    this.gridOffset = (this.gridOffset + 120 * this.speedMul * dt) % GRID;
    this.drawRows();
  }

  private drawRows(): void {
    const g = this.grid;
    g.clear();
    // 横线向下滚动，越靠下越亮，营造前进感
    for (let y = this.gridOffset - GRID; y < GAME_H; y += GRID) {
      g.lineStyle(1, COLORS.magenta, 0.04 + 0.14 * Math.max(0, y / GAME_H));
      g.lineBetween(0, y, GAME_W, y);
    }
  }
}

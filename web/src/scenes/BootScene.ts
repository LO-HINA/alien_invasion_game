import Phaser from 'phaser';
import { generateTextures } from '../systems/textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateTextures(this);
    // 等 Web 字体加载完再进菜单，避免文字先用后备字体渲染
    const fontReady = document.fonts ? document.fonts.load('32px "Orbitron"') : Promise.resolve();
    const timeout = new Promise((r) => setTimeout(r, 1500));
    Promise.race([fontReady, timeout]).finally(() => this.scene.start('Menu'));
  }
}

import Phaser from 'phaser';
import { FONT, hex } from '../config';

export function neonText(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: number): Phaser.GameObjects.Text {
  return scene.add
    .text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), align: 'center' })
    .setShadow(0, 0, hex(color), Math.max(8, size * 0.5), true, true)
    .setOrigin(0.5);
}

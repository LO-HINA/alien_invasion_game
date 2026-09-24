import Phaser from 'phaser';
import { GAME_H, GAME_W } from '../config';

/**
 * 世界尺寸随窗口变化时，让这个场景整体重建一次。
 * 菜单 / 暂停 / 升级 / 结算这类界面元素不多，重建比逐个改坐标省事也不容易漏。
 */
export function restartOnResize(scene: Phaser.Scene, data?: () => object): void {
  let w = GAME_W;
  let h = GAME_H;
  const onResize = (): void => {
    if (GAME_W === w && GAME_H === h) return;
    w = GAME_W;
    h = GAME_H;
    scene.scene.restart(data ? data() : undefined);
  };
  scene.scale.on(Phaser.Scale.Events.RESIZE, onResize);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => scene.scale.off(Phaser.Scale.Events.RESIZE, onResize));
}

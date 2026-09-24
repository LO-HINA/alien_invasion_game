import Phaser from 'phaser';
import { COLORS, computeWorld, GAME_H, GAME_W, setWorld } from './config';
import { BootScene } from './scenes/BootScene';
import { GameOverScene } from './scenes/GameOverScene';
import { GameScene } from './scenes/GameScene';
import { LevelUpScene } from './scenes/LevelUpScene';
import { MenuScene } from './scenes/MenuScene';
import { PauseScene } from './scenes/PauseScene';

// 先按窗口比例定好逻辑分辨率，FIT 缩放后画布正好铺满，不留黑边
const initial = computeWorld(window.innerWidth, window.innerHeight);
setWorld(initial.w, initial.h);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: GAME_W,
  height: GAME_H,
  backgroundColor: COLORS.bg,
  physics: { default: 'arcade', arcade: { debug: false } },
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  input: { activePointers: 2 },
  scene: [BootScene, MenuScene, GameScene, LevelUpScene, PauseScene, GameOverScene],
});

/** 窗口比例变了就换一套逻辑分辨率；各场景收到 RESIZE 后自己重排 */
function syncWorldSize(): void {
  const { w, h } = computeWorld(window.innerWidth, window.innerHeight);
  if (w === GAME_W && h === GAME_H) return;
  setWorld(w, h);
  game.scale.setGameSize(w, h);
}

let resizeTimer: number | undefined;
window.addEventListener('resize', () => {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(syncWorldSize, 180);
});

// 进出全屏时 parent 尺寸不会立刻更新，稍等一下再量
for (const ev of [Phaser.Scale.Events.ENTER_FULLSCREEN, Phaser.Scale.Events.LEAVE_FULLSCREEN]) {
  game.scale.on(ev, () => window.setTimeout(syncWorldSize, 150));
}

// 挂到 window 上方便在控制台/自动化脚本里查看和干预战局
(window as unknown as { game: Phaser.Game }).game = game;

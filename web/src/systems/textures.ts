import Phaser from 'phaser';
import { COLORS } from '../config';

type G = Phaser.GameObjects.Graphics;
type Pt = [number, number];

// 由外到内的描边层，叠出霓虹辉光
const GLOW_PASSES = [
  { w: 14, a: 0.05 },
  { w: 9, a: 0.1 },
  { w: 5, a: 0.28 },
  { w: 2.5, a: 0.95 },
];

function glow(g: G, color: number, path: (g: G) => void, scale = 1): void {
  for (const p of GLOW_PASSES) {
    g.lineStyle(p.w * scale, color, p.a);
    path(g);
  }
  g.lineStyle(1.1 * scale, COLORS.white, 0.85);
  path(g);
}

function polyPath(pts: Pt[], cx: number, cy: number, closed = true) {
  const vecs = pts.map(([x, y]) => new Phaser.Math.Vector2(x + cx, y + cy));
  return (g: G) => g.strokePoints(vecs, closed, closed);
}

function circlePath(r: number, cx: number, cy: number) {
  return (g: G) => g.strokeCircle(cx, cy, r);
}

function fillPoly(g: G, pts: Pt[], cx: number, cy: number, color: number, alpha = 0.14): void {
  g.fillStyle(color, alpha);
  g.fillPoints(pts.map(([x, y]) => new Phaser.Math.Vector2(x + cx, y + cy)), true);
}

function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (g: G, cx: number, cy: number) => void): void {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  draw(g, w / 2, h / 2);
  g.generateTexture(key, w, h);
  g.destroy();
}

function regular(n: number, r: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function shape(scene: Phaser.Scene, key: string, w: number, h: number, color: number, parts: Pt[][], extra?: (g: G, cx: number, cy: number) => void): void {
  make(scene, key, w, h, (g, cx, cy) => {
    fillPoly(g, parts[0], cx, cy, color);
    for (const p of parts) glow(g, color, polyPath(p, cx, cy));
    extra?.(g, cx, cy);
  });
}

/** 顶点逆时针转 90°：原来朝右的变朝上，朝左的变朝下（竖版用） */
function up(pts: Pt[]): Pt[] {
  return pts.map(([x, y]): Pt => [y, -x]);
}

export function generateTextures(scene: Phaser.Scene): void {
  // 玩家：朝上的箭形战机
  shape(scene, 'player', 52, 80, COLORS.cyan, [
    up([[30, 0], [-18, -18], [-8, 0], [-18, 18]]),
    up([[4, -4], [14, 0], [4, 4]]),
  ]);

  // 僚机：缩小版玩家
  shape(scene, 'wingman', 34, 46, COLORS.green, [
    up([[17, 0], [-11, -11], [-5, 0], [-11, 11]]),
  ]);

  shape(scene, 'drone', 48, 48, COLORS.magenta, [
    [[0, -14], [14, 0], [0, 14], [-14, 0]],
    [[0, -5], [5, 0], [0, 5], [-5, 0]],
  ]);

  // 以下敌机均朝下
  shape(scene, 'wave', 48, 56, COLORS.orange, [
    up([[-17, 0], [14, -14], [7, 0], [14, 14]]),
  ]);

  make(scene, 'shooter', 60, 60, (g, cx, cy) => {
    const hexPts = regular(6, 18);
    fillPoly(g, hexPts, cx, cy, COLORS.green);
    glow(g, COLORS.green, polyPath(hexPts, cx, cy));
    glow(g, COLORS.green, circlePath(5, cx, cy), 0.7);
  });

  shape(scene, 'charger', 48, 64, COLORS.red, [
    up([[-24, 0], [16, -17], [21, -8], [4, 0], [21, 8], [16, 17]]),
  ]);

  make(scene, 'tank', 88, 88, (g, cx, cy) => {
    const oct = regular(8, 30, Math.PI / 8);
    fillPoly(g, oct, cx, cy, COLORS.purple, 0.18);
    glow(g, COLORS.purple, polyPath(oct, cx, cy));
    glow(g, COLORS.purple, polyPath(regular(4, 13, Math.PI / 4), cx, cy), 0.8);
    glow(g, COLORS.purple, polyPath([[0, 30], [0, 40]], cx, cy, false), 0.8);
  });

  make(scene, 'boss', 240, 280, (g, cx, cy) => {
    const hull = up([[-120, 0], [-70, -70], [20, -95], [110, -60], [80, 0], [110, 60], [20, 95], [-70, 70]]);
    fillPoly(g, hull, cx, cy, COLORS.magenta, 0.12);
    glow(g, COLORS.magenta, polyPath(hull, cx, cy), 1.3);
    glow(g, COLORS.purple, polyPath(up([[-70, -70], [-20, -30], [20, -95]]), cx, cy, false));
    glow(g, COLORS.purple, polyPath(up([[-70, 70], [-20, 30], [20, 95]]), cx, cy, false));
    glow(g, COLORS.magenta, polyPath(regular(6, 42, Math.PI / 2), cx, cy));
    glow(g, COLORS.cyan, circlePath(20, cx, cy + 10), 1.2);
    g.fillStyle(COLORS.white, 0.9);
    g.fillCircle(cx, cy + 10, 7);
  });

  // 子弹类贴图都朝右，发射时按飞行角度旋转
  make(scene, 'pbullet', 48, 22, (g, cx, cy) => {
    g.fillStyle(COLORS.cyan, 0.35);
    g.fillEllipse(cx, cy, 40, 13);
    glow(g, COLORS.cyan, polyPath([[-14, 0], [14, 0]], cx, cy, false), 1);
  });
  make(scene, 'wbullet', 36, 18, (g, cx, cy) => {
    g.fillStyle(COLORS.green, 0.3);
    g.fillEllipse(cx, cy, 28, 10);
    glow(g, COLORS.green, polyPath([[-9, 0], [9, 0]], cx, cy, false), 0.7);
  });
  make(scene, 'missile', 36, 20, (g, cx, cy) => {
    const body: Pt[] = [[11, 0], [3, -4], [-9, -4], [-9, 4], [3, 4]];
    fillPoly(g, body, cx, cy, COLORS.orange, 0.4);
    glow(g, COLORS.orange, polyPath(body, cx, cy), 0.5);
  });

  // 等离子环绕球
  make(scene, 'orb', 40, 40, (g, cx, cy) => {
    g.fillStyle(COLORS.cyan, 0.3);
    g.fillCircle(cx, cy, 11);
    glow(g, COLORS.cyan, circlePath(9, cx, cy), 0.7);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(cx, cy, 4);
  });

  const bulletTex = (key: string, color: number) =>
    make(scene, key, 22, 22, (g, cx, cy) => {
      g.fillStyle(color, 0.25);
      g.fillCircle(cx, cy, 9);
      g.fillStyle(color, 0.8);
      g.fillCircle(cx, cy, 5.5);
      g.fillStyle(COLORS.white, 1);
      g.fillCircle(cx, cy, 3);
    });
  bulletTex('ebullet', COLORS.magenta);
  bulletTex('ebullet2', COLORS.orange);

  // 道具
  make(scene, 'pu_weapon', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.yellow, polyPath(regular(4, 14, Math.PI / 4), cx, cy), 0.8);
    glow(g, COLORS.yellow, polyPath([[-5, 5], [0, -4], [5, 5]], cx, cy, false), 0.6);
  });
  make(scene, 'pu_shield', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.cyan, circlePath(13, cx, cy), 0.8);
    glow(g, COLORS.cyan, circlePath(6, cx, cy), 0.6);
  });
  make(scene, 'pu_bomb', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.orange, polyPath(regular(3, 15, -Math.PI / 2), cx, cy), 0.8);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(cx, cy + 2, 3);
  });
  make(scene, 'pu_heal', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.green, polyPath(regular(6, 14), cx, cy), 0.8);
    glow(g, COLORS.green, polyPath([[-6, 0], [6, 0]], cx, cy, false), 0.6);
    glow(g, COLORS.green, polyPath([[0, -6], [0, 6]], cx, cy, false), 0.6);
  });
  // 急速射击：双箭头
  make(scene, 'pu_rapid', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.orange, circlePath(14, cx, cy), 0.8);
    glow(g, COLORS.orange, polyPath([[-5, 0], [0, -6], [5, 0]], cx, cy, false), 0.5);
    glow(g, COLORS.orange, polyPath([[-5, 6], [0, 0], [5, 6]], cx, cy, false), 0.5);
  });
  // 无敌星
  make(scene, 'pu_star', 40, 40, (g, cx, cy) => {
    const star: Pt[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 ? 6 : 15;
      star.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    fillPoly(g, star, cx, cy, COLORS.yellow, 0.3);
    glow(g, COLORS.yellow, polyPath(star, cx, cy), 0.7);
  });
  // 经验晶体
  make(scene, 'pu_xp', 40, 40, (g, cx, cy) => {
    const gem: Pt[] = [[0, -15], [10, -3], [0, 15], [-10, -3]];
    fillPoly(g, gem, cx, cy, COLORS.blue, 0.35);
    glow(g, COLORS.blue, polyPath(gem, cx, cy), 0.7);
    glow(g, COLORS.blue, polyPath([[-10, -3], [10, -3]], cx, cy, false), 0.4);
  });
  // 闪电图标（技能卡用）
  make(scene, 'bolt', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.blue, polyPath([[4, -15], [-6, 1], [2, 1], [-4, 15], [8, -3], [0, -3]], cx, cy), 0.6);
  });
  // 1UP：小战机
  make(scene, 'pu_life', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.magenta, circlePath(15, cx, cy), 0.7);
    glow(g, COLORS.cyan, polyPath(up([[9, 0], [-6, -6], [-2, 0], [-6, 6]]), cx, cy), 0.5);
  });
  // 冲刺：双层箭头
  make(scene, 'pu_dash', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.cyan, circlePath(15, cx, cy), 0.7);
    glow(g, COLORS.cyan, polyPath([[-7, 1], [0, -7], [7, 1]], cx, cy, false), 0.6);
    glow(g, COLORS.cyan, polyPath([[-7, 9], [0, 1], [7, 9]], cx, cy, false), 0.5);
  });

  make(scene, 'particle', 32, 32, (g, cx, cy) => {
    for (let r = 16; r > 0; r -= 2) {
      g.fillStyle(COLORS.white, 0.08 + (1 - r / 16) * 0.5);
      g.fillCircle(cx, cy, r);
    }
  });

  make(scene, 'ring', 128, 128, (g, cx, cy) => {
    glow(g, COLORS.white, circlePath(52, cx, cy));
  });
}

import Phaser from 'phaser';
import { BULLET, COLORS, PLAYER } from '../config';

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

/** 整体缩放一组顶点。贴图尺寸不动，只把画的东西缩小，画布留白正好不裁掉辉光 */
function shrink(pts: Pt[], s: number): Pt[] {
  return pts.map(([x, y]): Pt => [x * s, y * s]);
}

function regular(n: number, r: number, rot = 0): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function shape(scene: Phaser.Scene, key: string, w: number, h: number, color: number, parts: Pt[][], extra?: (g: G, cx: number, cy: number) => void, scale = 1): void {
  make(scene, key, w, h, (g, cx, cy) => {
    fillPoly(g, parts[0], cx, cy, color);
    for (const p of parts) glow(g, color, polyPath(p, cx, cy), scale);
    extra?.(g, cx, cy);
  });
}

/** 顶点逆时针转 90°：原来朝右的变朝上，朝左的变朝下（竖版用） */
function up(pts: Pt[]): Pt[] {
  return pts.map(([x, y]): Pt => [y, -x]);
}

export function generateTextures(scene: Phaser.Scene): void {
  const SHIP = PLAYER.scale;
  const SHOT = BULLET.scale;

  // 玩家：朝上的箭形战机
  shape(scene, 'player', 52, 80, COLORS.cyan, [
    shrink(up([[30, 0], [-18, -18], [-8, 0], [-18, 18]]), SHIP),
    shrink(up([[4, -4], [14, 0], [4, 4]]), SHIP),
  ], undefined, SHIP);

  // 僚机：缩小版玩家
  shape(scene, 'wingman', 34, 46, COLORS.green, [shrink(up([[17, 0], [-11, -11], [-5, 0], [-11, 11]]), SHIP)], undefined, SHIP);

  // 炮塔：机头前方的炮口，跟着机头转，子弹从它的炮口出去
  make(scene, 'turret', 26, 34, (g, cx, cy) => {
    glow(g, COLORS.cyan, polyPath(shrink([[-3, 1], [-3, -14], [3, -14], [3, 1]], SHIP), cx, cy), SHIP);
    glow(g, COLORS.white, polyPath(shrink([[-1.2, -3], [-1.2, -13], [1.2, -13], [1.2, -3]], SHIP), cx, cy), SHIP * 0.72);
    glow(g, COLORS.cyan, circlePath(8 * SHIP, cx, cy + 2 * SHIP), SHIP * 1.05);
    g.fillStyle(COLORS.cyan, 0.4);
    g.fillCircle(cx, cy + 2 * SHIP, 4.5 * SHIP);
  });

  // 判定点：机身中心那个亮点。判定圈半径只有 5 像素、机身看起来却有 35 像素宽，
  // 不画出来玩家只能靠感觉猜自己离弹幕还有多远，白白躲得过宽
  make(scene, 'core', 22, 22, (g, cx, cy) => {
    glow(g, COLORS.cyan, circlePath(8, cx, cy), 0.95);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(cx, cy, 2.6);
  });

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

  // 狙击机：细长的矛，前端一根炮管
  shape(scene, 'sniper', 64, 44, COLORS.cyan, [
    up([[26, 0], [4, -11], [-24, -7], [-24, 7], [4, 11]]),
    up([[16, -2], [30, 0], [16, 2]]),
  ]);

  // 旋舞机：三叶风车，边转边往外撒弹
  make(scene, 'spinner', 68, 68, (g, cx, cy) => {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const blade: Pt[] = [[0, 0], [30, -7], [23, 11]].map(([x, y]): Pt => [c * x - s * y, s * x + c * y]);
      if (i === 0) fillPoly(g, blade.map(([x, y]): Pt => [x + cx, y + cy]), cx, cy, COLORS.purple, 0.16);
      glow(g, COLORS.purple, polyPath(blade, cx, cy));
    }
    glow(g, COLORS.purple, circlePath(9, cx, cy), 0.7);
    g.fillStyle(COLORS.white, 0.9);
    g.fillCircle(cx, cy, 3.5);
  });

  // 分裂球：被打破后裂成两架小飞机
  make(scene, 'splitter', 56, 56, (g, cx, cy) => {
    const hex = regular(6, 22, Math.PI / 2);
    fillPoly(g, hex, cx, cy, COLORS.magenta, 0.16);
    glow(g, COLORS.magenta, polyPath(hex, cx, cy));
    // 中间一道裂缝，暗示它会裂开
    glow(g, COLORS.magenta, polyPath([[-11, 0], [0, -3], [11, 0]], cx, cy, false), 0.7);
    glow(g, COLORS.white, circlePath(5, cx, cy), 0.45);
  });

  // 轰炸机：宽机身 + 两侧弹仓
  shape(scene, 'bomber', 80, 64, COLORS.orange, [
    up([[24, 0], [6, -20], [-20, -16], [-24, 0], [-20, 16], [6, 20]]),
    up([[10, -9], [-12, -5], [-12, 5], [10, 9]]),
  ]);

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
    g.fillEllipse(cx, cy, 40 * SHOT, 13 * SHOT);
    glow(g, COLORS.cyan, polyPath([[-14 * SHOT, 0], [14 * SHOT, 0]], cx, cy, false), SHOT);
  });
  make(scene, 'wbullet', 36, 18, (g, cx, cy) => {
    g.fillStyle(COLORS.green, 0.3);
    g.fillEllipse(cx, cy, 28 * SHOT, 10 * SHOT);
    glow(g, COLORS.green, polyPath([[-9 * SHOT, 0], [9 * SHOT, 0]], cx, cy, false), SHOT * 0.7);
  });
  make(scene, 'missile', 36, 20, (g, cx, cy) => {
    fillPoly(g, shrink([[11, 0], [3, -4], [-9, -4], [-9, 4], [3, 4]], SHOT), cx, cy, COLORS.orange, 0.4);
    glow(g, COLORS.orange, polyPath(shrink([[11, 0], [3, -4], [-9, -4], [-9, 4], [3, 4]], SHOT), cx, cy), SHOT * 0.5);
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
  // 高速弹单独一个外形：细长的一条，形状本身就在说「这个快」。
  // 圆弹和快弹共用一颗球的话，玩家没法一眼分清该躲哪个。
  // 颜色避开自机的青 / 僚机的绿 / 导弹的橙，免得看错是谁打的。
  make(scene, 'ebullet3', 40, 16, (g, cx, cy) => {
    g.fillStyle(COLORS.yellow, 0.28);
    g.fillEllipse(cx, cy, 30, 7);
    glow(g, COLORS.yellow, polyPath([[-13, 0], [13, 0]], cx, cy, false), 0.55);
    g.fillStyle(COLORS.white, 1);
    g.fillCircle(cx, cy, 2.2);
  });

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
  // 冲刺：双层箭头
  make(scene, 'pu_dash', 40, 40, (g, cx, cy) => {
    glow(g, COLORS.cyan, circlePath(15, cx, cy), 0.7);
    glow(g, COLORS.cyan, polyPath([[-7, 1], [0, -7], [7, 1]], cx, cy, false), 0.6);
    glow(g, COLORS.cyan, polyPath([[-7, 9], [0, 1], [7, 9]], cx, cy, false), 0.5);
  });

  // 暂停图标：两根竖条
  make(scene, 'pause', 32, 32, (g, cx, cy) => {
    g.fillStyle(COLORS.white, 0.92);
    g.fillRect(cx - 8.5, cy - 9, 5, 18);
    g.fillRect(cx + 3.5, cy - 9, 5, 18);
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

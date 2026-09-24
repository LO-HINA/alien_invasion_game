// ───────── 自适应逻辑分辨率 ─────────
// 逻辑世界会按窗口比例换算：短边固定 720，长边按比例拉伸（横屏 1280x720，竖屏 720x1280）。
// Phaser 用 FIT 缩放，比例一致时画布正好铺满窗口，不会出现黑边。
const SHORT_SIDE = 720;
const MIN_ASPECT = 9 / 16;
const MAX_ASPECT = 2;

/** 逻辑世界尺寸。会随窗口变化，因此用 let + 实时绑定导出。 */
export let GAME_W = 720;
export let GAME_H = 1280;

export function computeWorld(winW: number, winH: number): { w: number; h: number } {
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, winW / winH));
  return aspect <= 1
    ? { w: SHORT_SIDE, h: Math.round(SHORT_SIDE / aspect) }
    : { w: Math.round(SHORT_SIDE * aspect), h: SHORT_SIDE };
}

export function setWorld(w: number, h: number): void {
  GAME_W = w;
  GAME_H = h;
}

/** 世界是横的还是竖的，HUD 和出怪分布会参考它 */
export function isWide(): boolean {
  return GAME_W > GAME_H;
}

export const COLORS = {
  bg: 0x05030d,
  cyan: 0x00f0ff,
  magenta: 0xff2bd6,
  yellow: 0xffe94d,
  green: 0x39ff88,
  orange: 0xff8a1f,
  red: 0xff3355,
  purple: 0x9d4dff,
  blue: 0x4d7dff,
  white: 0xffffff,
} as const;

export const FONT = '"Orbitron", Consolas, "Microsoft YaHei", monospace';
export const CN_FONT = '"Microsoft YaHei", "PingFang SC", Consolas, sans-serif';

export const PLAYER = {
  speed: 460,
  fireDelay: 130,
  bulletSpeed: 900,
  maxHp: 5,
  lives: 3,
  bombs: 2,
  maxBombs: 5,
  maxShield: 3,
  maxWeapon: 5,
  respawnInvulnMs: 2500,
  hitInvulnMs: 1500,
  /** 升级选完技能后的短暂无敌，防止刚回到战斗就被打中 */
  levelUpInvulnMs: 1000,
};

/** 主炮子弹：更大、能在场上存活一段时间、撞墙反弹 */
export const BULLET = {
  radius: 10,
  lifeMs: 1700,
  bounces: 2,
  /** 贴到墙上的内缩距离 */
  margin: 10,
};

/** 冲刺：短暂无敌 + 撞击伤害，用来在关键时刻规避伤害 */
export const DASH = {
  speed: 1500,
  durationMs: 190,
  /** 按技能等级取冷却 */
  cooldownMs: [2600, 2150, 1750, 1400],
  /** 按技能等级取撞击伤害 */
  damage: [3, 5, 7, 10],
};

/** 经验晶体：原地掉落，只有靠近才会被吸附 */
export const XP_PICKUP = {
  /** 同时存在的晶体上限，超过后合并到附近的晶体上 */
  mergeLimit: 150,
  mergeRadius: 280,
  maxOrbs: 240,
  /** 关卡结算时全部吸过来 */
  clearMagnet: true,
};

export const COMBO_WINDOW_MS = 2500;
export const MAX_MULTIPLIER = 5;

/** 从 level 升到 level+1 需要的经验 */
export function xpToNext(level: number): number {
  return 10 + (level - 1) * 7;
}

export function hex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

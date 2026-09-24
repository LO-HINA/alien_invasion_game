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
  fireDelay: 150,
  bulletSpeed: 900,
  /** 机体贴图的缩放。720 宽的场地上原尺寸太占地方，走位空间被压得厉害 */
  scale: 0.68,
  /**
   * 单颗子弹的基础伤害。一轮是扇面，小目标通常只会吃到其中一两颗，
   * 所以单发就按「一发能点掉一架杂兵」来配。
   */
  bulletDamage: 1,
  /** 血条上限 */
  maxHp: 100,
  /** 强化船体每级加多少上限 */
  hullHp: 25,
  bombs: 2,
  maxBombs: 5,
  maxShield: 3,
  maxWeapon: 5,
  hitInvulnMs: 1500,
  /** 升级选完技能后的短暂无敌，防止刚回到战斗就被打中 */
  levelUpInvulnMs: 1000,
};

/** 炮塔挂在机头前方多远。机体整体缩小了，这个距离跟着缩 */
export const TURRET_FWD = 26 * PLAYER.scale;

/** 一次受击掉多少血 */
export const HIT = {
  /** 吃一发敌弹 */
  bullet: 12,
  /** 撞上一架敌机 */
  ram: 20,
  /** 被 Boss 撞到 */
  boss: 26,
};

/** 修复道具回多少血 */
export const HEAL_AMOUNT = 40;

/** 吸血：击杀回血，越硬的敌人回得越多（按经验值折算） */
export const LEECH = {
  /** 按等级取的基础回复。给得足一点，清一波杂兵就能看到血条往回涨 */
  heal: [0, 3, 5, 8],
  /** 目标每这点经验追加 1 点回复 */
  xpDiv: 2,
  /** 击杀 Boss 的回复 */
  boss: 35,
};

/** 主炮子弹：小而密，能在场上存活一段时间、撞墙反弹 */
export const BULLET = {
  radius: 6,
  /** 贴图缩放，和 textures.ts 里的 SHOT 是同一个值 */
  scale: 0.6,
  lifeMs: 1000,
  bounces: 2,
  /** 贴到墙上的内缩距离 */
  margin: 7,
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

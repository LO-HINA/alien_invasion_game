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

/**
 * 难度曲线：关数 → 敌机的整体强度。
 *
 * 玩家的技能是有上限的（点满就那么多，一局二十级之后基本满配），敌机要是只按线性变强，
 * 十几关之后满配玩家站着不动都赢 —— 所以这里后段必须加速：
 * 线性项决定前几关的手感，二次项负责把「迟早会死」这件事还回来。
 *
 * 敌机的血 / 速度 / 射速三个倍率都由 GameScene.diff 这一个数推出来，
 * 所以调曲线只要动这里，不必满地图找散落的魔数。
 */
export const DIFF = {
  /** 每关的线性增量 */
  perStage: 0.3,
  /** 每关的二次增量：第 5 关往后开始明显压过线性项 */
  accel: 0.015,
  /**
   * 血量倍率和它的上限 —— **刻意压得很低**。这一项不是难度杠杆：
   * 技能点对了就该一直秒杀杂兵，把杂兵调厚只会把手感从「爽」拖成「磨」。
   * 上限 2 倍意味着杂兵从「一发改成两发」，之后就再不涨了（重装机那些硬骨头按同样的
   * 倍数变厚，24 → 48）。真正往上加的是**数量**和**攻击频率**
   */
  hp: 0.22,
  hpMax: 2,
  /**
   * 射速倍率（间隔缩到原来的几分之一）与它的下限。
   * 这一项和数量是乘起来的，最容易失控：敌弹是按池子开的，取空了 get() 返回 null、
   * 之后会悄悄不刷了（实测第 8 关就顶到过池上限，屏幕上看着还是满的，其实已经不再出弹）。
   * 所以系数压得比数量低，再难也不快过基础间隔的四成
   */
  fire: 0.18,
  fireFloor: 0.42,
  /** 速度倍率，以及它的上限：敌机比玩家（460）还快，那就不是躲不躲的问题了 */
  speed: 0.2,
  speedMax: 1.8,
  /**
   * 编队规模倍率与它的上限。**这一项是后期难度的主力**：
   * 同样是一关几十波，一波里飞进来的是十几架还是三十架，完全是两个游戏。
   * 上限压在 1.35 倍是量出来的：1.8 倍时第 8 关场上能到 201 架、帧率掉到 51，
   * 而满技能玩家的火力还要再占一大块 —— 敌机堆太满，先掉帧的是玩家自己的弹幕
   */
  pack: 0.07,
  packMax: 1.35,
};

export function stageDiff(stage: number): number {
  const s = Math.max(0, stage - 1);
  return 1 + s * DIFF.perStage + s * s * DIFF.accel;
}

/** 编队规模倍率：一波里到底飞进来多少架 */
export function stagePack(stage: number): number {
  return Math.min(DIFF.packMax, 1 + (stage - 1) * DIFF.pack);
}

/**
 * 顿帧：砸得重的那一下把画面按住几毫秒，打击感才立得住。
 * 按「这一下有多重」分档，轻的只按两三帧，重的按到八帧上下。
 */
export const FREEZE = {
  /** 放炸弹 */
  bomb: 60,
  /** 打爆重装机 */
  tank: 90,
  /** Boss 半血变招 */
  rage: 110,
  /** 打掉 Boss */
  boss: 150,
};

/** 挨打后屏幕边上那圈红色暗角留多久 */
export const HURT_VIGNETTE_MS = 450;

/** 每次升级能重随几次选项（一局的总量） */
export const REROLLS = 2;

/**
 * 擦弹：敌弹贴着机身掠过就算一次。
 * 机身判定圈只有 5 像素（见 Player.BODY_R），玩家看不见那条线，光画出来还不够 ——
 * 得给「贴着飞」一点回报，不然谁都会本能地躲得远远的，判定小反而成了浪费。
 */
export const GRAZE = {
  /** 判定点中心到弹心的距离小于这个值就算擦过。碰撞大约发生在 10 上下，所以留了一圈安全边 */
  radius: 26,
  /** 每次擦弹的基础分，再乘当前连击倍率 —— 单独一发不值钱，值得的是贴着弹幕待住 */
  score: 10,
  /** 火花、音效、判定点跳动的最小间隔：贴着打时一帧能擦到十几发，不封顶会刷屏 */
  fxMs: 70,
};

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

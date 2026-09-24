import Phaser from 'phaser';
import { COLORS, DASH, PLAYER } from '../config';
import type { Player } from '../objects/Player';

export type SkillId = 'gun' | 'rate' | 'power' | 'pierce' | 'bounce' | 'dash' | 'missile' | 'orb' | 'wingman' | 'lightning' | 'magnet' | 'regen' | 'hull' | 'xp' | 'repair';

export interface SkillDef {
  id: SkillId;
  name: string;
  max: number;
  color: number;
  icon: string;
  /** 升到 next 级时的效果说明 */
  desc: (next: number) => string;
}

export const REGEN_INTERVAL_MS = [0, 20000, 14000, 9000];
/** 道具吸附半径，按磁力等级取；0 级只有贴近了才会被吸走 */
export const MAGNET_RANGE = [140, 260, 400, 560];

export const SKILLS: SkillDef[] = [
  { id: 'gun', name: '主炮扩散', max: PLAYER.maxWeapon - 1, color: COLORS.yellow, icon: 'pu_weapon', desc: () => '主炮弹道 +1' },
  { id: 'rate', name: '急速装填', max: 5, color: COLORS.orange, icon: 'pu_rapid', desc: () => '主炮射速 +18%' },
  { id: 'power', name: '高能弹头', max: 5, color: COLORS.red, icon: 'pbullet', desc: () => '所有伤害 +25%' },
  { id: 'pierce', name: '穿甲弹', max: 3, color: COLORS.cyan, icon: 'pbullet', desc: () => '主炮子弹可多穿透 1 个敌人' },
  { id: 'bounce', name: '弹射弹', max: 3, color: COLORS.blue, icon: 'pbullet', desc: () => '主炮子弹多反弹 1 次，存活时间 +0.5 秒' },
  {
    id: 'dash', name: '相位冲刺', max: DASH.damage.length - 1, color: COLORS.cyan, icon: 'pu_dash',
    desc: (n) => `冲刺冷却 ${(DASH.cooldownMs[n] / 1000).toFixed(2)} 秒，撞击伤害 ${DASH.damage[n]}`,
  },
  {
    id: 'missile', name: '追踪导弹', max: 5, color: COLORS.orange, icon: 'missile',
    desc: (n) => (n === 1 ? '定期自动发射追踪导弹' : '导弹数量 +1，冷却缩短'),
  },
  {
    id: 'orb', name: '等离子环', max: 4, color: COLORS.cyan, icon: 'orb',
    desc: (n) => (n === 1 ? '2 颗光球环绕战机，撞伤敌人并抵消子弹' : '环绕光球 +1'),
  },
  {
    id: 'wingman', name: '僚机', max: 3, color: COLORS.green, icon: 'wingman',
    desc: (n) => ['', '召唤 1 架僚机协同射击', '再召唤 1 架僚机', '僚机射速翻倍'][n],
  },
  {
    id: 'lightning', name: '连锁闪电', max: 5, color: COLORS.blue, icon: 'bolt',
    desc: (n) => (n === 1 ? '定期电击敌人并弹射到附近目标' : '弹射 +1，伤害提升，冷却缩短'),
  },
  { id: 'magnet', name: '磁力回收', max: 3, color: COLORS.purple, icon: 'pu_xp', desc: (n) => `靠近 ${MAGNET_RANGE[n]} 码内的道具与经验会被吸过来` },
  {
    id: 'regen', name: '护盾发生器', max: 3, color: COLORS.cyan, icon: 'pu_shield',
    desc: (n) => `每 ${REGEN_INTERVAL_MS[n] / 1000} 秒自动充能 1 层护盾`,
  },
  { id: 'hull', name: '强化船体', max: 3, color: COLORS.green, icon: 'pu_heal', desc: () => '船体上限 +1 并完全修复' },
  { id: 'xp', name: '学习芯片', max: 3, color: COLORS.blue, icon: 'pu_xp', desc: () => '经验获取 +25%' },
];

/** 所有技能都满级后的保底选项 */
const REPAIR: SkillDef = { id: 'repair', name: '紧急维修', max: Infinity, color: COLORS.green, icon: 'pu_heal', desc: () => '修复 2 格船体，获得 1000 分' };

export function skillLevel(p: Player, id: SkillId): number {
  return id === 'gun' ? p.weapon - 1 : p.skills[id];
}

/** 随机抽 n 个还能升级的技能 */
export function rollSkills(p: Player, n = 3): SkillDef[] {
  const pool = SKILLS.filter((s) => skillLevel(p, s.id) < s.max);
  const picks = Phaser.Utils.Array.Shuffle(pool).slice(0, n);
  while (picks.length < n && !picks.includes(REPAIR)) picks.push(REPAIR);
  return picks;
}

export function applySkill(p: Player, id: SkillId): void {
  switch (id) {
    case 'gun':
      p.weapon = Math.min(PLAYER.maxWeapon, p.weapon + 1);
      return;
    case 'hull':
      p.skills.hull++;
      p.hp = p.maxHp;
      return;
    case 'repair':
      p.hp = Math.min(p.maxHp, p.hp + 2);
      return;
    default:
      p.skills[id]++;
  }
}

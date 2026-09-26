import Phaser from 'phaser';
import { BULLET, BULLET_HIT, COLORS, COMBO_WINDOW_MS, DROP, dropScale, eliteCap, eliteFieldCap, elitePerWave, FREEZE, GAME_H, GAME_W, GRAZE, HEAL_AMOUNT, hex, hitDamage, HIT, HURT_VIGNETTE_MS, LASER, LEECH, MAX_MULTIPLIER, MIX, MIX_FIELD_MAX, PLAYER, REROLLS, stageDiff, stagePack, stageTier, XP_PICKUP, xpToNext } from '../config';
import { Arsenal } from '../objects/Arsenal';
import { Boss } from '../objects/Boss';
import { Bullet, type BulletOpts } from '../objects/Bullet';
import { ENEMY_DEFS, Enemy, type EnemyKind, type SpawnOpts } from '../objects/Enemy';
import { BODY_R, Player } from '../objects/Player';
import { POWER_INFO, PowerUp, randomPowerKind, type PowerKind } from '../objects/PowerUp';
import { audio } from '../systems/audio';
import { applySkill, MAGNET_RANGE, rollSkills, type SkillId } from '../systems/skills';
import { Starfield } from '../systems/starfield';
import { loadHighScore } from '../systems/storage';
import { neonText } from '../systems/ui';
import { Hud } from './Hud';

type Phase = 'waves' | 'boss-wait' | 'boss' | 'clear' | 'over';
type WavePattern = 'row' | 'column' | 'v' | 'sine' | 'shooters' | 'chargers' | 'tank' | 'swarm' | 'snipers' | 'spinners' | 'splitters' | 'bombers' | 'rammers';
/** 敌机从哪条边进场 */
type EntrySide = 'top' | 'right' | 'bottom' | 'left';

/**
 * 编队分两摞：会开火的和不开火的。
 *
 * 一波里两摞各出一组 —— 只出「不开火的」那摞，场上就是一堆哑巴杂兵，一发弹没有；
 * 只出「会开火的」那摞，又变成站着打靶。混着来，弹幕才一直在、同时不停有东西要躲。
 */
const GUN_PATTERNS: [WavePattern, number][] = [
  ['shooters', 1],
  ['tank', 2],
  ['snipers', 2],
  ['spinners', 3],
  ['bombers', 3],
];

const BULK_PATTERNS: [WavePattern, number][] = [
  ['row', 1],
  ['column', 1],
  ['v', 1],
  ['sine', 1],
  ['chargers', 2],
  ['splitters', 2],
  ['swarm', 3],
  ['rammers', 4],
];

/** 「会开火的」机型。判断场上还有没有弹幕威胁时看这几个在不在 */
const GUN_KINDS = new Set<EnemyKind>(['shooter', 'tank', 'sniper', 'spinner', 'bomber', 'elite']);

/** 场上一发弹都没有、而且快空了的时候，把下一波提前拉到这么多毫秒以内 */
const EMPTY_PULL_MS = 900;

/**
 * 精英机和激光机从什么时候开始出现：**第 5 关起**，而且那一关也要先过掉前 5 波。
 *
 * 两个条件管的不是一回事：stage 管「这一整局里什么时候才开始有这种东西」，
 * wave 管「每关开头那几波先别上」。为什么两个都要：
 *   · 它们不是杂兵。第一关的玩家手里只有一级主炮，一上来就被红色弹幕追着打，
 *     那不叫难度，叫不讲理 —— 这两种是「打到后面才配撞上」的机型
 *   · 每关的前 5 波是留给玩家把武器和技能拉起来的，所以就算到了第 5 关，
 *     一关的开头也不该直接撞上它们
 * waveCount 每关开场归零，所以第二个条件是**每一关**都生效的 —— 只写 wave 的话
 * 每一关的第六波都会来一架，第一关也不例外（之前就是这么漏的）
 *
 * 关数那一半放在 config 的 MIX.fromStage：换血的起始关、精英机数量的爬升
 * 都从同一个数起算，写两份迟早会调歪一份
 */
const SPECIAL_FROM_STAGE = MIX.fromStage;
const SPECIAL_FROM_WAVE = 5;
/**
 * 换血阶段**不顶替**的机型：精英机自己是顶替进来的那一个；激光机走的是
 * special 那条线、本来就不算杂兵；冲击机是刻意留下的普通机型 ——
 * 「留三分之一杂兵」里就有它（血量另给了一大截，见 Enemy 的 charger）。
 *
 * 注意这一条只管「顶不顶替」，**不管总数闸** —— 不顶替的机型一样占场上的位置
 * （见下面 spawn 里那段：两件事共用一个条件的话，后期会变成一屏幕冲击机）
 */
const MIX_KEEP = new Set<EnemyKind>(['elite', 'laser', 'charger']);
/**
 * 激光机的出场概率与同时上限 —— 全场最少的机型，多了一屏幕都是线，反而没地方站
 */
const LASER_CHANCE = 0.16;
/** 激光机同时最多几台：第 10 关起放宽到三台，一道光束封不住的时候加第二、第三道 */
const LASER_MAX = (stage: number) => (stage >= 10 ? 3 : 2);

// 四边出现概率，正面仍然是主要压力来源
const SIDE_WEIGHT: [EntrySide, number][] = [
  ['top', 0.4],
  ['left', 0.2],
  ['right', 0.2],
  ['bottom', 0.2],
];

/** 每一波压过来时，有多大概率换个方向、从上一波的对侧来 */
const SIDE_FLIP = 0.6;
/** 对面的那条边 */
const OPPOSITE: Record<EntrySide, EntrySide> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
/** 每这么多波留一次喘息，间隔拉长 */
const BREATH_EVERY = 5;
/** 喘息那一下多给多少毫秒 */
const BREATH_MS = 1400;
/**
 * 一条纵列最多排几架。纵列是顺着入场方向排出去的，最后几架会退到入场边之外，
 * 这个数 × 间距（55）必须留在 Enemy.SPAWN_BACK（没进过战场的回收框）以内
 */
const COLUMN_MAX = 14;

type KeyName = 'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'X' | 'K' | 'P' | 'ESC' | 'M' | 'SPACE' | 'SHIFT' | 'F';

/** 爆炸光环池大小 */
const RING_POOL = 24;
/** 光环起始缩放，和以前 Tween 的起点一致 */
const RING_FROM = 0.1;
/** 一帧最多出几条飘字：击杀密集时超出的攒到下一帧合并显示 */
const POPUP_PER_FRAME = 3;

export class GameScene extends Phaser.Scene {
  player!: Player;
  private enemies!: Phaser.Physics.Arcade.Group;
  private pBullets!: Phaser.Physics.Arcade.Group;
  private eBullets!: Phaser.Physics.Arcade.Group;
  private powerups!: Phaser.Physics.Arcade.Group;
  private xpOrbs!: Phaser.Physics.Arcade.Group;
  private boss?: Boss;
  private bossColliders: Phaser.Physics.Arcade.Collider[] = [];
  private starfield!: Starfield;
  private hud!: Hud;
  private arsenal!: Arsenal;
  private keys!: Record<KeyName, Phaser.Input.Keyboard.Key>;
  private emitters = new Map<number, Phaser.GameObjects.Particles.ParticleEmitter>();
  private drag?: { px: number; py: number; sx: number; sy: number };
  /** 爆炸光环池：一帧炸死一片时不用逐个 new Image + Tween */
  private rings: { img: Phaser.GameObjects.Image; t: number; dur: number; to: number }[] = [];
  private ringAt = 0;
  /** 飘字按尺寸池化，复用 Text 就不必反复重建画布贴图 */
  private popupPool = new Map<number, Phaser.GameObjects.Text[]>();
  /** 本帧还能出几条飘字，防止一帧内建几十个 Text */
  private popupBudget = 0;
  /** 没来得及显示的分数，攒到下一帧合成一条 */
  private pendingScore = 0;
  private readonly pendingScoreAt = new Phaser.Math.Vector2();

  private phase: Phase = 'waves';
  private stage = 1;
  private score = 0;
  private high = 0;
  private bombs = PLAYER.bombs;
  private combo = 0;
  private comboUntil = 0;
  private waveCount = 0;
  private nextWaveAt = 0;
  private bossAt = 0;
  /** 这一波的换血比例（0~1），spawnWave 每波重算，见 MIX */
  private takeover = 0;
  /** 道具掉落的令牌桶：手头还有几个令牌、下一次补是什么时候（见 config 的 DROP） */
  private dropTokens = DROP.capacity;
  private dropRefillAt = 0;
  private level = 1;
  private xp = 0;
  private pendingLevels = 0;
  private pausedAt = 0;
  private dashBossAt = 0;
  private layoutW = 0;
  private layoutH = 0;
  /** 屏幕暗角：挨打与残血共用一层，画在战场之上、HUD 之下 */
  private vignette!: Phaser.GameObjects.Graphics;
  /**
   * 激光。**全场共用这一个 Graphics**，每帧清掉重画：敌机是从池子里反复取用的，
   * 每架自带一个 Graphics 的话，回收时不清干净就会把上一轮的光束留在屏幕上。
   * 一层画完所有激光，也就不必去管谁进谁出了
   */
  private laserGfx!: Phaser.GameObjects.Graphics;
  /** 激光下一次结算灼烧的时刻。全场一个 —— 同时站在两道光束里也只算一下 */
  private nextLaserTick = 0;
  private hurtAt = -9999;
  /** 顿帧结束的时刻，0 表示没在顿 */
  private freezeUntil = 0;
  /** 本局还剩几次升级重随 */
  rerolls = REROLLS;
  /** 上一波从哪条边来，用来做「换边」的压力节奏 */
  private lastSide: EntrySide = 'bottom';
  /** 本局擦弹次数，结算时给玩家看一眼 */
  private grazeCount = 0;
  /** 擦弹的火花与音效上次是什么时候放的，用来限流 */
  private grazeFxAt = 0;
  /** 场上还有没有会开火的敌机、一共还剩几架。由 scanThreat 每帧刷新，别单独改 */
  private gunsAlive = false;
  private enemiesAlive = 0;

  constructor() {
    super('Game');
  }

  /** 难度倍率：敌机的血 / 速度 / 射速都由它推出来（曲线本身在 config 的 DIFF） */
  private get diff(): number {
    return stageDiff(this.stage);
  }

  /** 编队规模倍率：后期「数量多」靠的是它 */
  private get pack(): number {
    return stagePack(this.stage);
  }

  private get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.combo / 10));
  }

  private get wavesThisStage(): number {
    return Math.min(36, 12 + this.stage * 3);
  }

  get currentBoss(): Boss | undefined {
    return this.boss && this.boss.hp > 0 ? this.boss : undefined;
  }

  create(): void {
    this.phase = 'waves';
    this.stage = 1;
    this.score = 0;
    this.high = loadHighScore();
    this.bombs = PLAYER.bombs;
    this.combo = 0;
    this.waveCount = 0;
    this.nextWaveAt = this.time.now + 1500;
    this.level = 1;
    this.xp = 0;
    this.pendingLevels = 0;
    this.boss = undefined;
    this.bossColliders = [];
    this.dashBossAt = 0;
    this.hurtAt = -9999;
    this.freezeUntil = 0;
    this.rerolls = REROLLS;
    this.lastSide = 'bottom';
    this.grazeCount = 0;
    this.grazeFxAt = 0;
    this.emitters = new Map();
    this.drag = undefined;
    this.pendingScore = 0;
    this.popupBudget = 0;
    this.popupPool = new Map();
    this.buildRingPool();

    this.cameras.main.fadeIn(300, 5, 3, 13);
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
    this.starfield = new Starfield(this);

    // 池子按「后期最挤的一拍」开：后期一波能有二十来架，几组同时压过来就上百，
    // 取空了 get() 会返回 null、之后悄悄不刷（浸泡测试专门盯这一条），所以留足余量。
    // 上限本身不是目标 —— 数字顶到上限就说明该调曲线了，不是该把池子开大。
    // 敌弹这一格是唯一的例外，而且抬了两次：先是 Boss 加了冲刺和更密的弹幕，
    // 接着每一波都必定带一组会开火的（见 GUN_PATTERNS）—— 峰值是真的上去了。
    // 敌弹和敌机不一样，它没有寿命，要飞出屏幕才回收，
    // 所以「每秒发多少」会按弹速直接乘成一个很高的在场数
    this.pBullets = this.physics.add.group({ classType: Bullet, maxSize: 400 });
    this.eBullets = this.physics.add.group({ classType: Bullet, maxSize: 2200 });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 420, runChildUpdate: true });
    this.powerups = this.physics.add.group({ classType: PowerUp, maxSize: 40 });
    this.xpOrbs = this.physics.add.group({ classType: PowerUp, maxSize: XP_PICKUP.maxOrbs });
    this.player = new Player(this, GAME_W / 2, GAME_H * 0.68);
    this.arsenal = new Arsenal(this);

    this.physics.add.overlap(this.pBullets, this.enemies, (b, e) => {
      const bullet = b as unknown as Bullet;
      const enemy = e as unknown as Enemy;
      if (!bullet.active || !enemy.active || !bullet.hitTarget(enemy)) return;
      this.hitEnemy(enemy, bullet.damage);
    });
    this.physics.add.overlap(this.player, this.eBullets, (_p, b) => {
      const bullet = b as unknown as Bullet;
      if (!bullet.active || !this.player.alive || this.player.invulnerable) return;
      bullet.kill();
      // 档次决定这一下有多重（见 config 的 BULLET_HIT）。精英弹还额外带
      // 「挡不住」—— 它连护盾一起无视，所以要把这个标志传到结算那一步
      this.hurtPlayer(this.takenDamage(BULLET_HIT[bullet.tier]), bullet.unblockable);
    });
    this.physics.add.overlap(this.player, this.enemies, (_p, e) => {
      const enemy = e as unknown as Enemy;
      if (!enemy.active || !this.player.alive) return;
      const p = this.player;
      // 冲刺撞上敌人：无敌穿过去并把它撞伤
      if (p.dashing) {
        if (this.time.now >= enemy.dashHitAt) {
          enemy.dashHitAt = this.time.now + 220;
          this.hitEnemy(enemy, p.dashDamage);
        }
        return;
      }
      if (p.invulnerable) return;
      this.hurtPlayer(this.takenDamage(HIT.ram));
      // 自爆机是撞上就同归于尽（被撞是走位失误，不给分也不给经验），
      // 其余机型是被撞开、接着往外飞
      if (enemy.kind === 'rammer') this.detonate(enemy);
      else this.hitEnemy(enemy, 8);
    });
    const pickup = (_p: unknown, u: unknown) => {
      const pu = u as unknown as PowerUp;
      if (!pu.active || !this.player.alive) return;
      pu.disableBody(true, true);
      this.collect(pu);
    };
    this.physics.add.overlap(this.player, this.powerups, pickup);
    this.physics.add.overlap(this.player, this.xpOrbs, pickup);

    this.hud = new Hud(this);
    // 暗角压在战场之上、HUD 和横幅之下
    this.vignette = this.add.graphics().setDepth(90);
    // 激光在暗角之下、闪电（21）附近：它是战场元素，不该盖住 HUD
    this.laserGfx = this.add.graphics().setDepth(21).setBlendMode(Phaser.BlendModes.ADD);
    this.nextLaserTick = 0;

    this.keys = this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,X,K,P,ESC,M,SPACE,SHIFT,F') as Record<KeyName, Phaser.Input.Keyboard.Key>;
    const kb = this.input.keyboard!;
    kb.on('keydown-X', () => this.useBomb());
    kb.on('keydown-K', () => this.useBomb());
    kb.on('keydown-SPACE', () => this.tryDash());
    kb.on('keydown-SHIFT', () => this.tryDash());
    kb.on('keydown-P', () => this.pauseGame());
    kb.on('keydown-ESC', () => this.pauseGame());
    kb.on('keydown-M', () => audio.toggleMusic());
    kb.on('keydown-F', () => this.scale.toggleFullscreen());
    this.setupPointer();

    // 失焦自动暂停；暂停期间 time.now 仍在走，恢复时把各种到期时间整体后移
    this.game.events.on(Phaser.Core.Events.BLUR, this.pauseGame, this);
    this.events.on(Phaser.Scenes.Events.PAUSE, this.onPause, this);
    this.events.on(Phaser.Scenes.Events.RESUME, this.onResume, this);
    this.layoutW = GAME_W;
    this.layoutH = GAME_H;
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onScaleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(Phaser.Core.Events.BLUR, this.pauseGame, this);
      this.events.off(Phaser.Scenes.Events.PAUSE, this.onPause, this);
      this.events.off(Phaser.Scenes.Events.RESUME, this.onResume, this);
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onScaleResize, this);
    });

    this.banner('STAGE 1', COLORS.cyan);
  }

  /** 窗口比例变了：世界尺寸换了，重新铺背景、摆 HUD、按比例把玩家挪过去 */
  private onScaleResize(): void {
    if (GAME_W === this.layoutW && GAME_H === this.layoutH) return;
    const rx = this.layoutW > 0 ? GAME_W / this.layoutW : 1;
    const ry = this.layoutH > 0 ? GAME_H / this.layoutH : 1;
    this.layoutW = GAME_W;
    this.layoutH = GAME_H;
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
    this.starfield.layout();
    this.hud.layout();
    this.drag = undefined;
    this.player.dragTarget = undefined;
    if (this.player.active) {
      // 按比例挪过去，转屏之后战机还在原来的相对位置，不会突然贴边
      this.player.setPosition(
        Phaser.Math.Clamp(this.player.x * rx, 40, GAME_W - 40),
        Phaser.Math.Clamp(this.player.y * ry, 60, GAME_H - 60),
      );
    }
  }

  /** 触屏 / 鼠标：按住拖动，战机按手指的相对位移移动（不会被手指挡住） */
  private setupPointer(): void {
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (over.includes(this.hud.bombButton)) {
        this.useBomb();
        return;
      }
      if (over.includes(this.hud.dashButton)) {
        this.tryDash();
        return;
      }
      if (over.includes(this.hud.pauseButton)) {
        this.pauseGame();
        return;
      }
      this.drag = { px: ptr.x, py: ptr.y, sx: this.player.x, sy: this.player.y };
      this.player.dragTarget = new Phaser.Math.Vector2(this.player.x, this.player.y);
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.drag || !ptr.isDown || !this.player.dragTarget) return;
      this.player.dragTarget.set(this.drag.sx + (ptr.x - this.drag.px) * 1.2, this.drag.sy + (ptr.y - this.drag.py) * 1.2);
    });
    const release = () => {
      this.drag = undefined;
      this.player.dragTarget = undefined;
    };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);
  }

  update(time: number, delta: number): void {
    this.starfield.update(delta);
    this.updateRings(delta);
    this.drawVignette(time);
    // 碰撞结算在本帧的 scene.update 之前就跑完了，这里补满的是下一帧的额度
    this.popupBudget = POPUP_PER_FRAME;

    const p = this.player;
    if (p.alive) {
      // 自动瞄准：每帧把最近的敌机喂给炮口（没目标就保持上一次的方向）。
      // 喂进去的是「想打哪」，炮口自己按 AIM_TURN_SPEED 转过去，不瞬移
      const target = this.nearestTarget();
      if (target) p.aimAt(target.x, target.y, delta);
      p.move(this.keys, delta);
      p.updateBlink(time);
      const shots = p.tryFire(time);
      if (shots.length) {
        const bounces = BULLET.bounces + p.skills.bounce;
        const lifeMs = BULLET.lifeMs + p.skills.bounce * 400;
        // 一轮三发起步，所以单发伤害低，靠密度打
        const dmg = PLAYER.bulletDamage * p.damageMul;
        for (const s of shots) this.firePlayerBullet(s.x, s.y, s.a, PLAYER.bulletSpeed, 'pbullet', dmg, p.skills.pierce, { bounces, lifeMs });
        audio.shoot();
      }
      this.pullPowerUps();
      this.checkGraze(time);
    }

    if (this.combo > 0 && time > this.comboUntil) this.combo = 0;
    this.boss?.tick(time, delta);
    this.arsenal.update(time, delta);
    this.updateLasers(time);
    this.runDirector(time);

    this.hud.update({
      score: this.score,
      high: this.high,
      stage: this.stage,
      bombs: this.bombs,
      multiplier: this.multiplier,
      level: this.level,
      xp: this.xp,
      xpNeed: xpToNext(this.level),
      maxed: this.level >= PLAYER.maxLevel,
      player: p,
      boss: this.boss,
    });

    if (this.pendingLevels > 0 && p.alive && this.phase !== 'over') this.openLevelUp();
  }

  // ───────── 关卡推进 ─────────

  private runDirector(time: number): void {
    if (this.phase === 'waves') {
      this.scanThreat();
      // 一发弹都没有、场上又快空了 —— 把下一波拉过来。空场是最没意思的几秒，
      // 玩家在这儿会走神。每 5 波那口喘息只要场上还有东西就不会被打断
      if (!this.gunsAlive && this.enemiesAlive < 6 && this.nextWaveAt - time > EMPTY_PULL_MS) {
        this.nextWaveAt = time + EMPTY_PULL_MS;
      }
      if (time >= this.nextWaveAt) {
        if (this.waveCount < this.wavesThisStage) {
          this.spawnWave();
          this.waveCount++;
          // 每 5 波喘一口：一直顶在最高强度，玩家会从紧张变成麻木，有起伏才有爽点
          const breath = this.waveCount % BREATH_EVERY === 0 ? BREATH_MS : 0;
          this.nextWaveAt = time + Math.max(780, 1900 - this.stage * 120) + breath;
        } else {
          // 不要求清光敌人，短暂间隔后 Boss 直接登场
          this.phase = 'boss-wait';
          this.bossAt = time + 2500;
        }
      }
    } else if (this.phase === 'boss-wait' && time >= this.bossAt) {
      this.phase = 'boss';
      this.startBoss();
    }
  }

  /**
   * 看一眼场上还有几架、其中有没有会开火的。
   * 复用两个字段而不是每帧 new 一个对象 —— 这段每帧都跑。
   * 这里数的是**全部**活着的敌机，不筛 onScreen：刚刷出来还在场外的那批也算数，
   * 否则一波刚发出去、敌机还没飞进屏幕，就会被当成「空场」再拉一波过来
   */
  private scanThreat(): void {
    let guns = false;
    let total = 0;
    this.eachEnemy((e) => {
      total++;
      if (!guns && GUN_KINDS.has(e.kind)) guns = true;
    });
    this.gunsAlive = guns;
    this.enemiesAlive = total;
  }

  /** 把「从某条边入场」的编队坐标换算成世界坐标：u = 沿边的位置，back = 退到边外多远 */
  private entry(side: EntrySide, u: number, back: number): { x: number; y: number; angle: number } {
    switch (side) {
      case 'top':
        return { x: u, y: -back, angle: Math.PI / 2 };
      case 'bottom':
        return { x: u, y: GAME_H + back, angle: -Math.PI / 2 };
      case 'left':
        return { x: -back, y: u, angle: 0 };
      default:
        return { x: GAME_W + back, y: u, angle: Math.PI };
    }
  }

  /** 从指定边生成一架敌机 */
  private spawn(side: EntrySide, kind: EnemyKind, u: number, back: number, opts: SpawnOpts = {}): void {
    // 换血阶段：普通杂兵**按比例直接顶替成精英机**，而且场上的总数另有上限
    // （两道闸都在 config 的 MIX / MIX_FIELD_MAX 里，这里只按顺序执行）。
    //
    // 是「顶替」不是「少放几架外加几架」：一波里飞进来多少架基本不变，
    // 变的只是构成 —— 换掉的杂兵不用另外找东西来填。这一手比「缩编」也好：
    // 编队形态原样保留（V 字还是 V 字、横排还是横排），只是里面坐的东西换了，
    // 玩家一眼看到的是「怎么全变红了」，而不是「队形怎么变了」
    let spawnKind = kind;
    if (this.takeover > 0) {
      // 顶替和总数闸是两件事，别混成一个条件：
      //   · 顶替只对「会被精英机换掉」的杂兵生效 —— 冲击机、激光机不在其列（见 MIX_KEEP）
      //   · 总数闸是**所有机型都占位置**，包括那两种不顶替的
      // 早先两件事共用一个 if，结果冲击机既不顶替、又不受总数管，后期变成一屏幕
      // 十七架冲击机（第 15 关实测），而它们本该是「保留的少数派」——
      // 那会儿场上被冲击机占满，精英机反而挤不进来，跟这套设计正好反着
      const swap = !MIX_KEEP.has(kind) && Math.random() < this.takeover * (1 - MIX.mookFloor);
      if (swap && this.countKind('elite') < eliteFieldCap(this.stage)) {
        spawnKind = 'elite';
      } else if (this.liveCount() >= MIX_FIELD_MAX) {
        // 总数闸。满了就**省掉这一架**，但顶替成精英机的那一架不受这条闸限制 ——
        // 顺序反过来（先闸总数再定机型）的话，场上一挤精英机就进不来了，
        // 比例会一路滑回「一屏幕杂兵」，正是这一整套要治的那个毛病
        return;
      }
    }
    const p = this.entry(side, u, back);
    // 阶跃档数在这里统一发下去。只有精英机吃它，别的机型读了也不用 ——
    // 但发在这一处，就不必每次加新机型都记得带上
    this.spawnEnemy(spawnKind, p.x, p.y, { ...opts, angle: p.angle, tier: stageTier(this.stage) });
  }

  private pickSide(): EntrySide {
    // 上一波的敌人还在往这边压，新一波就从对面来，玩家刚清完一边压力就换向，
    // 这样才有「来回救火」的感觉，而不是一直守着一个方向
    if (this.stage >= 2 && Math.random() < SIDE_FLIP) return OPPOSITE[this.lastSide];
    let r = Math.random();
    for (const [side, w] of SIDE_WEIGHT) {
      r -= w;
      if (r <= 0) return side;
    }
    return 'top';
  }

  /**
   * 一波 = 「会开火的」一组 + 「填场面的」一组，同时压过来；关数上去还会再加一组。
   * 每组各自挑一条边（pickSide），所以同一个波次里天然就是混着、从不同方向来的。
   */
  private spawnWave(): void {
    // 这一波的换血比例先定下来，后面 spawn / spawnSpecials 都读它
    this.takeover = this.takeoverAt();
    this.wavePattern(this.pick(GUN_PATTERNS));
    this.wavePattern(this.pick(BULK_PATTERNS));
    // 第三组跟着关数涨：三面同时压过来是后期才该出现的场面
    if (this.stage >= 3 && Math.random() < Math.min(0.5, 0.12 + this.stage * 0.05)) {
      this.wavePattern(this.pick(Math.random() < 0.6 ? GUN_PATTERNS : BULK_PATTERNS));
    }
    this.spawnSpecials();
  }

  /**
   * 这一波有多少比例该换成精英机（0~1）：**每关第 8 波起**开始换，
   * 换 `MIX.overWaves` 波到位，之后这一关剩下的波数就都是换完的场面（见 config 的 MIX）。
   *
   * 只有两档：换血前的 0 和换血后的 1（连同中间那几波的斜坡）。
   * 早先还按关数压了一道「深度」——第 5 关先换一小半、第 9 关才换满。删掉它是因为
   * 它压出来的效果正好和想做的相反：换掉的杂兵少了，场上就既没有杂兵的分量、
   * 也没有精英机的分量，第 5 关和第 9 关玩起来几乎一样，后期该来的压力迟迟不来。
   * 第 5 关之后就该是后期 —— 这是个小游戏，一波十几秒，节奏拖不起
   *
   * waveCount 是 0 基的（spawnWave 跑完才 ++），所以 +1 才是玩家看到的「第几波」
   */
  private takeoverAt(): number {
    if (this.stage < SPECIAL_FROM_STAGE) return 0;
    const wave = this.waveCount + 1;
    if (wave < MIX.fromWave) return 0;
    return Math.min(1, (wave - MIX.fromWave + 1) / MIX.overWaves);
  }

  /**
   * 精英机和激光机。两个都**不算编队**：各自挑一条边、单独进场。
   * 混在队形里飞进来的话，玩家会把它当成「又一架小飞机」，它就不精英了。
   */
  private spawnSpecials(): void {
    // 第 5 关之前、以及每一关的前 5 波，这两种都不该出现（见 SPECIAL_FROM_STAGE）
    if (this.stage < SPECIAL_FROM_STAGE || this.waveCount < SPECIAL_FROM_WAVE) return;
    // 精英机：换血之前（第 6、7 波）按老规矩一波掺一两架；第 10 关之后这个上限
    // 一关抬一级（见 config 的 STEP），它是「难度一关比一关高一档」的那个着力点。
    //
    // 换血一开始（第 8 波起）这里就**不再补了** —— 那时候精英机是从队形里
    // 顶替杂兵上来的（见 spawn 的 takeover），按架数一波能顶上来十几架，
    // 再在这儿额外叠一层，精英机就比原来的杂兵总数还多了：场上是变挤了，
    // 但「总数不变、只换构成」这件事也就没了
    if (this.takeover <= 0) {
      const room = eliteCap(this.stage) - this.countKind('elite');
      for (let i = 0; i < Math.min(room, elitePerWave(this.stage)); i++) this.spawnOne('elite');
    }
    // 激光机：概率很低。它不开弹，作用是封走位 —— 一屏幕都是线的话，
    // 玩家反而无处可站，那就从「逼你挪窝」变成「不让你玩」了
    if (Math.random() < LASER_CHANCE && this.countKind('laser') < LASER_MAX(this.stage)) this.spawnOne('laser');
  }

  /** 单独一架，从自己挑的边进场（不排队形，所以不用管纵深限制） */
  private spawnOne(kind: EnemyKind): void {
    const side = this.pickSide();
    this.lastSide = side;
    const span = side === 'top' || side === 'bottom' ? GAME_W : GAME_H;
    this.spawn(side, kind, Phaser.Math.Between(120, span - 120), 0);
  }

  /** 场上还有几架这个机型 */
  private countKind(kind: EnemyKind): number {
    let c = 0;
    this.eachEnemy((e) => {
      if (e.kind === kind) c++;
    });
    return c;
  }

  /**
   * 场上现在一共几架 —— **当场数**，不用每帧刷新的 enemiesAlive。
   *
   * 差别在「一波」上：一波是在**同一帧里连发几十架**的（蜂群 22 架、横排 14 架、
   * 第三组再叠一层），那一帧里 enemiesAlive 还是波次开始前的旧值，读它等于没闸 ——
   * 实测第 15 关偶发场上 67 架（那时候闸值是 39）。每一架都当场数一遍就不会漏，
   * 一遍是几十次循环，一波几十架，代价可以忽略
   */
  private liveCount(): number {
    let c = 0;
    this.eachEnemy(() => {
      c++;
    });
    return c;
  }

  /** 从一摞编队里挑一个「这一关已经放出来」的 */
  private pick(list: [WavePattern, number][]): WavePattern {
    return Phaser.Utils.Array.GetRandom(list.filter(([, s]) => this.stage >= s).map(([p]) => p)) as WavePattern;
  }

  private wavePattern(pattern: WavePattern): void {
    const side = this.pickSide();
    this.lastSide = side;
    // 沿这条边的可用长度
    const span = side === 'top' || side === 'bottom' ? GAME_W : GAME_H;
    // 编队规模：后期一波里飞进来的是十几架还是三十架，靠这一个数（见 config 的 DIFF.pack）
    const n = (base: number) => Math.round(base * this.pack);

    switch (pattern) {
      case 'row': {
        const c = n(10 + Math.min(4, this.stage));
        for (let i = 0; i < c; i++) this.spawn(side, 'drone', (span * (i + 0.5)) / c, (i % 2) * 40);
        break;
      }
      case 'column':
        // 纵列是顺着入场方向一条线排出去的，最长 14 架 —— 再长尾巴就退到
        // 「没进过战场」的兜底回收框（Enemy.SPAWN_BACK）外面，会被当漏网清掉。
        // 所以数量翻倍靠的是并排再来一条，不是把这一条拉长
        for (const [at, per] of this.lanes(n(9 + Math.min(5, this.stage)), COLUMN_MAX, span)) {
          for (let i = 0; i < per; i++) this.spawn(side, 'drone', at, i * 55);
        }
        break;
      case 'v': {
        // 斜边始终张开 ±240：再宽两翼就落在入场边之外，永远飞不进战场（Enemy 里另有兜底回收）。
        // 人多了就往密里排，不改张角
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 240, span - 240);
        const c = n(11);
        for (let i = 0; i < c; i++) {
          const t = c > 1 ? (i / (c - 1)) * 2 - 1 : 0;
          this.spawn(side, 'drone', cx + t * 240, Math.abs(t) * 225);
        }
        break;
      }
      case 'sine': {
        const amp = Phaser.Math.Between(60, 130);
        for (const [at, per] of this.lanes(n(11), 12, span, amp + 50)) {
          for (let i = 0; i < per; i++) this.spawn(side, 'wave', at, i * 60, { amp, phase: -i * 0.5 });
        }
        break;
      }
      case 'shooters': {
        // 这一摞现在是每一波都出（以前是五个编队里抽一个），所以单次带的架数往下压了一半：
        // 出得勤了，每次还带那么多的话总量是翻几倍，而不是「变密」
        const c = n(2 + Math.min(2, Math.floor(this.stage / 3)));
        for (let i = 0; i < c; i++) this.spawn(side, 'shooter', (span * (i + 0.5)) / c, i * 30, { phase: i });
        break;
      }
      case 'chargers': {
        const c = n(5 + Math.min(3, this.stage - 2));
        for (let i = 0; i < c; i++) this.spawn(side, 'charger', Phaser.Math.Between(80, span - 80), i * 80);
        break;
      }
      case 'tank': {
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 160, span - 160);
        for (let i = 0, c = Math.min(3, Math.round(this.pack)); i < c; i++) this.spawn(side, 'tank', cx + (i - (c - 1) / 2) * 150, 20 + i * 30);
        for (const d of [-150, -90, -30, 30, 90, 150]) this.spawn(side, 'drone', cx + d, 100);
        break;
      }
      case 'snipers': {
        // 隔着大半个屏幕点名，得靠不停移动把枪线甩掉
        const c = n(2 + Math.min(2, this.stage - 2));
        for (let i = 0; i < c; i++) this.spawn(side, 'sniper', (span * (i + 0.5)) / c, i * 40, { phase: i });
        break;
      }
      case 'spinners': {
        const c = n(2 + (this.stage >= 5 ? 1 : 0));
        for (let i = 0; i < c; i++) this.spawn(side, 'spinner', (span * (i + 0.5)) / c, i * 60, { phase: i });
        break;
      }
      case 'splitters': {
        const c = n(6);
        for (let i = 0; i < c; i++) this.spawn(side, 'splitter', (span * (i + 0.5)) / c, (i % 2) * 50);
        break;
      }
      case 'bombers': {
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 160, span - 160);
        for (let i = 0, c = Math.min(3, Math.round(this.pack)); i < c; i++) this.spawn(side, 'bomber', cx + i * 160, 20 + i * 70);
        for (const d of [-110, 0, 110]) this.spawn(side, 'drone', cx + d, 120);
        break;
      }
      case 'swarm':
        for (let i = 0, c = n(22); i < c; i++) {
          // 第 6 关起混几架自爆机：蛇形队里突然有几架脱离队伍直冲过来，最烦人
          const kind = this.stage >= 6 && i % 7 === 3 ? 'rammer' : i % 3 === 0 ? 'wave' : 'drone';
          this.spawn(side, kind, Phaser.Math.Between(60, span - 60), i * 35, { amp: 50 });
        }
        break;
      case 'rammers':
        // 一架一架地追过来，逼你不停换位置 —— 站着不动清屏的那套在这儿不成立。
        // 它和别的机型不一样：不会飞走，会一直粘着，所以数量要压着给
        for (let i = 0, c = n(2 + Math.min(3, Math.floor(this.stage / 3))); i < c; i++) {
          this.spawn(side, 'rammer', Phaser.Math.Between(80, span - 80), i * 90);
        }
        break;
    }
  }

  /**
   * 一批成员拆成几条并排的编队，返回每条的中心位置和成员数。
   * 单条编队的纵深有硬上限（顺着入场方向排出去的那一串，退到入场边外不能超过 715 像素，
   * 见 Enemy.SPAWN_BACK），所以数量涨上去只能靠并排，不能靠拉长。
   * `inset` 是两侧要留出的余量（蛇形要摆幅）。
   */
  private lanes(count: number, max: number, span: number, inset = 60): [number, number][] {
    const groups = Math.max(1, Math.ceil(count / max));
    const per = Math.ceil(count / groups);
    const out: [number, number][] = [];
    for (let i = 0; i < groups; i++) {
      const at = (span * (i + 0.5)) / groups + Phaser.Math.Between(-25, 25);
      out.push([Phaser.Math.Clamp(at, inset, span - inset), per]);
    }
    return out;
  }

  spawnEnemy(kind: EnemyKind, x: number, y: number, opts?: SpawnOpts): void {
    const e = this.enemies.get(x, y) as Enemy | null;
    e?.spawn(kind, x, y, this.diff, opts);
  }

  private startBoss(): void {
    audio.alarm();
    this.banner('⚠ WARNING ⚠', COLORS.red, 2400);
    this.time.delayedCall(2200, () => {
      if (this.phase !== 'boss') return;
      const boss = new Boss(this, this.stage);
      this.boss = boss;
      this.bossColliders = [
        this.physics.add.overlap(this.pBullets, boss, (_b, bb) => {
          // Arcade 对 “组 vs 单体” 回调参数顺序不固定，取非 boss 的那个
          const bullet = (bb === boss ? _b : bb) as unknown as Bullet;
          if (!bullet.active || !boss.active || !bullet.hitTarget(boss)) return;
          this.hitBoss(bullet.damage);
        }),
        this.physics.add.overlap(this.player, boss, () => {
          const p = this.player;
          if (!p.alive) return;
          if (p.dashing) {
            if (this.time.now >= this.dashBossAt) {
              this.dashBossAt = this.time.now + 260;
              this.hitBoss(p.dashDamage * 2);
            }
            return;
          }
          if (!p.invulnerable) this.hurtPlayer(this.takenDamage(HIT.boss));
        }),
      ];
    });
  }

  hitBoss(dmg: number): void {
    const boss = this.boss;
    if (!boss || boss.hp <= 0) return;
    const wasEnraged = boss.enraged;
    boss.hp -= dmg;
    this.flash(boss);
    // 半血变招是个转折点，不喊一声玩家会以为它一直就是这么凶
    if (!wasEnraged && boss.enraged && boss.hp > 0) {
      this.banner('⚠ 狂 暴 ⚠', COLORS.red, 1400);
      this.cameras.main.shake(320, 0.014);
      this.freeze(FREEZE.rage);
    }
    if (Math.random() < 0.3) audio.hit();
    if (boss.hp <= 0) this.killBoss(boss);
  }

  private killBoss(boss: Boss): void {
    this.bossColliders.forEach((c) => c.destroy());
    this.bossColliders = [];
    this.phase = 'clear';
    this.freeze(FREEZE.boss);
    this.clearEnemyBullets();
    boss.setVelocity(0, 0);
    this.addScore(5000 * this.stage, boss.x, boss.y, false);
    // 打掉 Boss 大补一口
    this.healPlayer(LEECH.boss);
    // 一地的经验晶体，炸完自己去捡
    const total = 15 + this.stage * 5;
    for (let i = 0; i < total; i += 5) {
      this.dropXp(boss.x + Phaser.Math.Between(-140, 140), boss.y + Phaser.Math.Between(-100, 100), Math.min(5, total - i));
    }

    // 连环爆炸
    for (let i = 0; i < 10; i++) {
      this.time.delayedCall(i * 140, () => {
        this.explode(boss.x + Phaser.Math.Between(-90, 90), boss.y + Phaser.Math.Between(-100, 100), i % 2 ? COLORS.magenta : COLORS.cyan, 1.2);
        audio.explode(i === 9);
      });
    }
    this.time.delayedCall(1450, () => {
      this.explode(boss.x, boss.y, COLORS.white, 3);
      this.cameras.main.shake(500, 0.02);
      const drops: PowerKind[] = ['weapon', 'heal', 'shield', randomPowerKind()];
      drops.forEach((k, i) => this.dropPowerUp(boss.x + (i - 1.5) * 60, boss.y, k));
      boss.destroy();
      this.boss = undefined;
      this.stageClear();
    });
  }

  private stageClear(): void {
    this.banner(`STAGE ${this.stage} CLEAR`, COLORS.green, 2600);
    this.tweens.add({ targets: this.starfield, speedMul: 8, duration: 800, yoyo: true, hold: 1400, ease: 'Sine.inOut' });
    // 结算时把剩下的经验全部吸过来，免得前期漏捡的晶体卡在场上
    if (XP_PICKUP.clearMagnet) {
      (this.xpOrbs.getMatching('active', true) as PowerUp[]).forEach((pu) => pu.attract(this.player.x, this.player.y));
    }
    this.time.delayedCall(3600, () => {
      if (this.phase !== 'clear') return;
      this.stage++;
      this.waveCount = 0;
      this.phase = 'waves';
      this.nextWaveAt = this.time.now + 1500;
      // 把关数背后的强度也报出来：难度是后段加速的，玩家该看得见自己被推着走。
      // 第 5 关之后「强度」那个数就不太说明问题了（乘数还在涨，但底下的东西都封顶了），
      // 真正在变的是**这一关后半段场上站着的是什么**，所以改成报它 ——
      // 台阶要看得见才叫台阶
      const sub = this.stage >= SPECIAL_FROM_STAGE
        ? `敌方强度 ×${this.diff.toFixed(1)} · 第 ${MIX.fromWave} 波起换成精英机为主`
        : `敌方强度 ×${this.diff.toFixed(1)}`;
      this.banner(`STAGE ${this.stage}`, COLORS.cyan, 1800, sub);
    });
  }

  // ───────── 射击 ─────────

  firePlayerBullet(x: number, y: number, angle: number, speed: number, texture: string, damage: number, pierce = 0, opts: BulletOpts = {}): Bullet | null {
    const b = this.pBullets.get(x, y) as Bullet | null;
    b?.fire(x, y, angle, speed, texture, damage, pierce, opts);
    return b;
  }

  fireEnemy(x: number, y: number, angle: number, speed: number, texture: string, opts: BulletOpts = {}): void {
    if (this.phase === 'over') return;
    const b = this.eBullets.get(x, y) as Bullet | null;
    b?.fire(x, y, angle, speed, texture, 1, 0, opts);
  }

  /** 朝玩家方向发射 count 发扇形弹 */
  fireEnemyAimed(x: number, y: number, speed: number, texture: string, count: number, spread: number, opts: BulletOpts = {}): void {
    const base = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    for (let i = 0; i < count; i++) this.fireEnemy(x, y, base + (i - (count - 1) / 2) * spread, speed, texture, opts);
  }

  /** 狙击机开火时的一道光，一闪就没，让这一发有来处 */
  tracer(x1: number, y1: number, x2: number, y2: number, color: number): void {
    const g = this.add.graphics().setDepth(22).setBlendMode(Phaser.BlendModes.ADD);
    g.lineStyle(1.5, color, 0.9);
    g.lineBetween(x1, y1, x2, y2);
    this.tweens.add({ targets: g, alpha: 0, duration: 240, onComplete: () => g.destroy() });
  }

  activeEnemies(): Enemy[] {
    return this.enemies.getMatching('active', true) as Enemy[];
  }

  activeEnemyBullets(): Bullet[] {
    return this.eBullets.getMatching('active', true) as Bullet[];
  }

  activePlayerBullets(): Bullet[] {
    return this.pBullets.getMatching('active', true) as Bullet[];
  }

  /** 逐颗遍历场上的玩家子弹。不新建数组，但回调里不能把子弹从组里摘掉（kill 只是置 inactive，安全） */
  eachPlayerBullet(fn: (b: Bullet) => void): void {
    for (const o of this.pBullets.getChildren()) {
      const b = o as Bullet;
      if (b.active) fn(b);
    }
  }

  /** 同上，遍历敌弹 */
  eachEnemyBullet(fn: (b: Bullet) => void): void {
    for (const o of this.eBullets.getChildren()) {
      const b = o as Bullet;
      if (b.active) fn(b);
    }
  }

  /** 同上，遍历敌机 */
  eachEnemy(fn: (e: Enemy) => void): void {
    for (const o of this.enemies.getChildren()) {
      const e = o as Enemy;
      if (e.active) fn(e);
    }
  }

  // ───────── 激光 ─────────

  /**
   * 画激光并结算灼烧。方向是敌机在起手那一刻锁死的（见 Enemy 的 laserAngle），
   * 这里只管画和判，不再碰角度 —— 会跟着玩家转的话它就成鞭子了，
   * 而它要的是「把你现在站的地方封掉，你自己挪」
   */
  private updateLasers(time: number): void {
    const g = this.laserGfx;
    g.clear();
    const p = this.player;
    // 光束要一直画到屏幕外，否则会在屏幕当中凭空断掉
    const far = Math.hypot(GAME_W, GAME_H);
    const w = LASER.halfWidth;
    let burning = false;
    this.eachEnemy((e) => {
      // 只认「正在走」的那一轮。laserFireUntil 已经是过去时 = 打完了；
      // 这架被打掉的话它根本不会进这个循环，光束跟着一起消失
      if (e.kind !== 'laser' || !e.laserFireUntil || time >= e.laserFireUntil) return;
      const ex = e.x + Math.cos(e.laserAngle) * far;
      const ey = e.y + Math.sin(e.laserAngle) * far;
      if (time < e.laserWarnUntil) {
        // 预警：细细一条，一闪一闪。它是通知不是伤害，所以画得细 ——
        // 「还有得躲」和「已经在烧」必须一眼分得开
        const k = 1 - (e.laserWarnUntil - time) / LASER.warnMs;
        g.lineStyle(2, COLORS.red, 0.25 + 0.5 * Math.abs(Math.sin(k * Math.PI * 6)));
        g.lineBetween(e.x, e.y, ex, ey);
        return;
      }
      // 灼烧：由宽到窄三层，最里面那根白的才是芯
      g.lineStyle(w * 3, COLORS.orange, 0.13);
      g.lineBetween(e.x, e.y, ex, ey);
      g.lineStyle(w * 1.3, COLORS.orange, 0.45);
      g.lineBetween(e.x, e.y, ex, ey);
      g.lineStyle(2.6, COLORS.white, 0.92);
      g.lineBetween(e.x, e.y, ex, ey);
      if (p.alive && this.laserHits(e, p.x, p.y)) burning = true;
    });
    // 站进光束里就按 tick 掉血，而不是「碰到一次算一次」—— 蹭一下和站满一秒
    // 本来就该是两个代价，持续伤害这四个字就在这里
    if (burning && time >= this.nextLaserTick) this.laserTick(time);
  }

  /**
   * 玩家在不在光束里：把玩家投到那条射线上，投影为正（在出光口前方，
   * 不是背后的反向延长线）且垂距在「光束半宽 + 机身判定圈」以内就算中。
   * 按射线算而不是线段，因为光束本来就画到屏幕外
   */
  private laserHits(e: Enemy, px: number, py: number): boolean {
    const dx = px - e.x;
    const dy = py - e.y;
    const c = Math.cos(e.laserAngle);
    const s = Math.sin(e.laserAngle);
    if (dx * c + dy * s < 0) return false;
    return Math.abs(dy * c - dx * s) <= LASER.halfWidth + BODY_R;
  }

  /**
   * 激光灼烧一下。**刻意不走 hurtPlayer** —— 那个会给 1.5 秒受击无敌，
   * 站在光束里反而成了全程免疫，正好和「把你从这儿赶走」拧着来。
   * 护盾照旧先顶（激光不是精英弹，挡得住），冲刺的无敌帧也照旧有效 ——
   * 冲过去是留给玩家的操作空间，不是漏洞
   */
  private laserTick(time: number): void {
    this.nextLaserTick = time + LASER.tickMs;
    const p = this.player;
    if (!p.alive || p.invulnerable) return;
    if (p.shield > 0) {
      p.shield--;
      p.invulnUntil = time + 800;
      audio.shield();
      this.explode(p.x, p.y, COLORS.cyan, 0.4);
      return;
    }
    p.hp -= this.takenDamage(HIT.laser);
    this.hurtAt = time;
    audio.hurt();
    this.flash(p);
    if (p.hp <= 0) this.killPlayer();
  }

  /** 清除敌弹；传 radius 时只清玩家附近的 */
  private clearEnemyBullets(radius?: number): void {
    const p = this.player;
    this.activeEnemyBullets().forEach((b) => {
      if (radius !== undefined && Phaser.Math.Distance.Between(b.x, b.y, p.x, p.y) > radius) return;
      this.explode(b.x, b.y, COLORS.magenta, 0.15);
      b.kill();
    });
  }

  // ───────── 伤害 / 得分 / 经验 ─────────

  hitEnemy(e: Enemy, dmg: number): void {
    if (!e.active) return;
    e.hp -= dmg;
    this.flash(e);
    if (e.hp > 0) {
      audio.hit();
      return;
    }
    const def = ENEMY_DEFS[e.kind];
    this.explode(e.x, e.y, def.color, e.kind === 'tank' ? 1.5 : 0.7);
    audio.explode(e.kind === 'tank');
    if (e.kind === 'tank') {
      this.cameras.main.shake(200, 0.008);
      // 啃了半天的硬骨头终于爆了，这一下值得按住画面
      this.freeze(FREEZE.tank);
    }
    // 分裂球：打爆不算完，裂出来的两架小机接着往外飞
    if (e.kind === 'splitter') this.splitEnemy(e);
    this.addScore(def.score, e.x, e.y);
    // 经验掉在原地，得自己飞过去捡
    this.dropXp(e.x, e.y, def.xp);
    // 道具要过两道闸：先按关数压过的概率掷一次，再看令牌桶里还有没有额度
    // （见 config 的 DROP）。顺序不能反 —— 先扣令牌再掷骰子的话，
    // 概率一低就永远攒不满桶
    if (Math.random() < def.dropChance * dropScale(this.stage) && this.takeDropToken(this.time.now)) {
      this.dropPowerUp(e.x, e.y);
    }
    this.leech(def.xp);
    e.disableBody(true, true);
  }

  /**
   * 掉落的硬闸：令牌桶。有令牌才放行，并且扣掉一个。
   * 掷骰子没过的时候不该走这里 —— 否则掉率越低，桶越是攒不起来
   */
  private takeDropToken(time: number): boolean {
    if (this.dropRefillAt === 0) this.dropRefillAt = time + DROP.refillMs;
    if (time >= this.dropRefillAt) {
      // 一次补齐这段时间攒下的（封顶 capacity），而不是只补一个：
      // 场上安静了一阵之后，紧接着的那几下击杀该照常掉东西，不必重新等满一轮
      const gained = 1 + Math.floor((time - this.dropRefillAt) / DROP.refillMs);
      this.dropTokens = Math.min(DROP.capacity, this.dropTokens + gained);
      this.dropRefillAt += gained * DROP.refillMs;
    }
    if (this.dropTokens <= 0) return false;
    this.dropTokens--;
    return true;
  }

  /**
   * 自爆机引爆：撞上玩家、或者燃料烧完自己炸，走同一条路。
   * 刻意不走 hitEnemy —— 被撞是走位失误，不该顺手给分给经验（连带把吸血也送了）
   */
  detonate(e: Enemy): void {
    if (!e.active) return;
    this.explode(e.x, e.y, ENEMY_DEFS.rammer.color, 1.1);
    audio.explode(false);
    e.disableBody(true, true);
  }

  /** 吸血装甲：击杀回血，越硬的敌人回得越多（按它的经验值折算） */
  private leech(xp: number): void {
    const lv = this.player.skills.leech;
    if (lv <= 0) return;
    this.healPlayer(LEECH.heal[lv] + Math.floor(xp / LEECH.xpDiv));
  }

  /** 分裂球被打爆：顺着原来的方向朝两侧各散出一架小机 */
  private splitEnemy(e: Enemy): void {
    const v = (e.body as Phaser.Physics.Arcade.Body).velocity;
    const ang = v.lengthSq() > 0 ? Math.atan2(v.y, v.x) : Math.PI / 2;
    for (const s of [-1, 1]) {
      const a = ang + s * 0.55;
      this.spawnEnemy('drone', e.x + Math.cos(a) * 26, e.y + Math.sin(a) * 26, { angle: a });
    }
  }

  private addScore(base: number, x: number, y: number, combo = true): void {
    if (combo) {
      this.combo++;
      this.comboUntil = this.time.now + COMBO_WINDOW_MS;
    }
    const gained = base * (combo ? this.multiplier : 1);
    this.score += gained;
    // 一波打爆一片时飘字会糊成一片，攒起来合成一条显示
    this.pendingScore += gained;
    this.pendingScoreAt.set(x, y);
    this.flushScorePopup();
  }

  /** 分数飘字：额度够才出，出完清空累计（不够就留到下一帧） */
  private flushScorePopup(): void {
    if (this.pendingScore <= 0) return;
    if (!this.floatText(this.pendingScoreAt.x, this.pendingScoreAt.y, `+${this.pendingScore}`, COLORS.yellow, 14)) return;
    this.pendingScore = 0;
  }

  /**
   * 擦弹：敌弹从机身旁边掠过就算一次，加分并把连击窗口续上。
   * 判定点（机身中心那个亮点）只有 5 像素，光让玩家看见还不够 ——
   * 「贴着弹幕飞」得真的有好处，玩家才会去用那份判定余量，而不是躲得远远的。
   */
  private checkGraze(now: number): void {
    const p = this.player;
    const r2 = GRAZE.radius * GRAZE.radius;
    let hits = 0;
    let lastX = 0;
    let lastY = 0;
    // 直接遍历组内数组，和别处一样不用 getMatching（那个会新建数组）
    for (const o of this.eBullets.getChildren()) {
      const b = o as Bullet;
      if (!b.active || b.grazed) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy > r2) continue;
      b.grazed = true;
      hits++;
      lastX = b.x;
      lastY = b.y;
    }
    if (hits === 0) return;
    this.grazeCount += hits;
    this.score += GRAZE.score * this.multiplier * hits;
    // 续窗口但不涨连击：连击仍然只能靠击杀攒，擦弹管的是「别让它断」
    this.comboUntil = now + COMBO_WINDOW_MS;
    // 火花与音效封顶，判定点跳动跟着一起限流（一帧能擦到十几发，否则会响成一片）
    if (now - this.grazeFxAt < GRAZE.fxMs) return;
    this.grazeFxAt = now;
    this.explode(lastX, lastY, COLORS.white, 0.2);
    audio.graze();
    p.graze(now);
  }

  /**
   * 吃经验。到 PLAYER.maxLevel 就停 —— 技能点满一共 55 点，60 级本来就点得完，
   * 再往上加只是让等级条继续跑，对局里没有任何东西会变；把线画在这儿，
   * 「满级」才是一件看得见的事。
   * 满级之后经验条清空显示 MAX，不再攒着：攒着的话它会在满格上一直亮着，
   * 看着像「马上又要升级」，其实永远升不了
   */
  private gainXp(amount: number): void {
    if (this.level >= PLAYER.maxLevel) {
      this.xp = 0;
      return;
    }
    this.xp += amount * this.player.xpMul;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.pendingLevels++;
      if (this.level >= PLAYER.maxLevel) {
        this.xp = 0;
        break;
      }
    }
  }

  private openLevelUp(): void {
    this.pendingLevels--;
    audio.levelUp();
    this.drag = undefined;
    this.player.dragTarget = undefined;
    this.scene.pause();
    this.scene.launch('LevelUp', { level: this.level - this.pendingLevels, choices: rollSkills(this.player) });
  }

  /** 升级时重掷选项。次数有限，留给「想留的那条线一个都没出」的时候 */
  tryReroll(): boolean {
    if (this.rerolls <= 0) return false;
    this.rerolls--;
    return true;
  }

  /** LevelUp 场景选完后调用（此时本场景仍处于暂停） */
  chooseSkill(id: SkillId): void {
    applySkill(this.player, id);
    if (id === 'repair') this.score += 1000;
  }

  private onPause(): void {
    this.pausedAt = this.game.loop.time;
    // 暂停期间 delayedCall 不走，这里先松开，免得一直按着物理和补间
    if (this.freezeUntil > 0) this.thaw();
  }

  private onResume(): void {
    const d = this.game.loop.time - this.pausedAt;
    const p = this.player;
    p.invulnUntil = Math.max(p.invulnUntil + d, this.game.loop.time + PLAYER.levelUpInvulnMs);
    p.rapidUntil += d;
    p.dashUntil += d;
    this.comboUntil += d;
    this.nextWaveAt += d;
    this.bossAt += d;
    this.dashBossAt += d;
    this.nextLaserTick += d;
    this.activePlayerBullets().forEach((b) => b.shift(d));
    this.arsenal.shift(d);
    this.input.keyboard?.resetKeys();
  }

  /**
   * 自动瞄准的目标：场上离玩家最近的敌机（Boss 也算一个）。
   * 只挑进了屏幕的 —— 瞄一架还在场外的，整轮扇面会全打在空气上。
   */
  private nearestTarget(): Enemy | Boss | undefined {
    const p = this.player;
    let best = Infinity;
    let found: Enemy | Boss | undefined;
    this.eachEnemy((e) => {
      if (!e.onScreen) return;
      const d = Phaser.Math.Distance.Squared(p.x, p.y, e.x, e.y);
      if (d < best) {
        best = d;
        found = e;
      }
    });
    const boss = this.currentBoss;
    if (boss) {
      const d = Phaser.Math.Distance.Squared(p.x, p.y, boss.x, boss.y);
      if (d < best) found = boss;
    }
    return found;
  }

  /**
   * 扣血。护盾先顶，护盾没破就不掉血。
   * `unblockable` 是精英弹那条线：护盾对它无效，直接进扣血那一步 ——
   * 所以精英机逼的是「躲」，而不是「多囤几个盾」。
   */
  private hurtPlayer(dmg: number, unblockable = false): void {
    const p = this.player;
    this.cameras.main.shake(180, 0.01);
    if (p.shield > 0 && !unblockable) {
      p.shield--;
      p.invulnUntil = this.time.now + 800;
      audio.shield();
      this.explode(p.x, p.y, COLORS.cyan, 0.5);
      return;
    }
    p.hp -= dmg;
    p.invulnUntil = this.time.now + PLAYER.hitInvulnMs;
    // 屏幕边上红一下。掉血、震屏、音效全挤在同一刻，红晕能把这一下串成一个事件
    this.hurtAt = this.time.now;
    audio.hurt();
    this.flash(p);
    // 受击后清掉身边的子弹，避免连续挨打
    this.clearEnemyBullets(160);
    if (p.hp <= 0) this.killPlayer();
  }

  /**
   * 这一下打掉多少血：按血条比例算，比例随关数涨到 99% 封顶（见 config 的 HIT）。
   * 传的是「基础比例」不是点数 —— 后面点了强化船体，血条长了，同一下依然掉同样多比例。
   */
  private takenDamage(base: number): number {
    return hitDamage(base, this.stage, this.player.maxHp);
  }

  /** 回血：满了就不飘字，免得刷屏 */
  private healPlayer(amount: number): void {
    const p = this.player;
    if (amount <= 0 || !p.alive || p.hp >= p.maxHp) return;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    this.floatText(p.x, p.y - 30, `+${amount}`, COLORS.green, 13);
  }

  private killPlayer(): void {
    const p = this.player;
    p.alive = false;
    p.engine.emitting = false;
    this.explode(p.x, p.y, COLORS.cyan, 2.2);
    audio.explode(true);
    this.cameras.main.shake(400, 0.02);
    p.disableBody(true, true);
    // 机身一旦 inactive，Player.preUpdate 就不再跑，判定点得手动收掉
    p.core.setVisible(false);
    this.combo = 0;

    // 血条见底就结束，不再有复活
    this.phase = 'over';
    this.time.delayedCall(1400, () => {
      this.physics.pause();
      this.scene.pause();
      this.scene.launch('GameOver', { score: this.score, stage: this.stage, level: this.level, graze: this.grazeCount });
    });
  }

  private tryDash(): void {
    if (!this.player.alive || this.phase === 'over' || !this.scene.isActive()) return;
    if (!this.player.tryDash()) return;
    audio.dash();
    this.player.invulnUntil = Math.max(this.player.invulnUntil, this.player.dashUntil);
    this.explode(this.player.x, this.player.y, COLORS.cyan, 0.4);
  }

  private useBomb(): void {
    if (this.bombs <= 0 || !this.player.alive || this.phase === 'over' || !this.scene.isActive()) return;
    this.bombs--;
    audio.bomb();
    this.freeze(FREEZE.bomb);
    this.cameras.main.flash(350, 255, 255, 255);
    this.cameras.main.shake(400, 0.015);
    this.clearEnemyBullets();
    const ring = this.add.image(this.player.x, this.player.y, 'ring').setTint(COLORS.orange).setScale(0.2).setBlendMode(Phaser.BlendModes.ADD);
    this.tweens.add({ targets: ring, scale: 30, alpha: 0, duration: 700, onComplete: () => ring.destroy() });
    this.activeEnemies().forEach((e) => this.hitEnemy(e, 25 * this.player.damageMul));
    if (this.currentBoss) this.hitBoss(Math.ceil(this.currentBoss.maxHp * 0.06));
    this.player.invulnUntil = Math.max(this.player.invulnUntil, this.time.now + 800);
  }

  // ───────── 道具 / 经验晶体 ─────────

  private dropPowerUp(x: number, y: number, kind: PowerKind = randomPowerKind()): void {
    const pu = this.powerups.get(x, y) as PowerUp | null;
    pu?.spawn(kind, x, y);
  }

  /** 经验晶体掉在原地，走位过去才吸得到 */
  private dropXp(x: number, y: number, value: number): void {
    if (value <= 0) return;
    // 只是想知道「够不够多」，countActive 不会像 getMatching 那样建数组
    if (this.xpOrbs.countActive(true) >= XP_PICKUP.mergeLimit) {
      // 场上晶体太多了，就近合并，避免越堆越掉帧
      let best: PowerUp | undefined;
      let bestD = XP_PICKUP.mergeRadius * XP_PICKUP.mergeRadius;
      for (const o of this.xpOrbs.getChildren()) {
        const pu = o as PowerUp;
        if (!pu.active) continue;
        const d = Phaser.Math.Distance.Squared(pu.x, pu.y, x, y);
        if (d < bestD) {
          bestD = d;
          best = pu;
        }
      }
      if (!best) return;
      best.addValue(value);
      return;
    }
    const pu = this.xpOrbs.get(x, y) as PowerUp | null;
    pu?.spawn('xp', x + Phaser.Math.Between(-14, 14), y + Phaser.Math.Between(-14, 14), { still: true, value });
  }

  private pullPowerUps(): void {
    const p = this.player;
    const range = MAGNET_RANGE[p.skills.magnet];
    const range2 = range * range;
    this.suck(this.powerups, p.x, p.y, range2);
    this.suck(this.xpOrbs, p.x, p.y, range2);
  }

  /** 吸附范围内才拉过来。直接遍历组内数组，不额外分配 */
  private suck(group: Phaser.Physics.Arcade.Group, px: number, py: number, range2: number): void {
    for (const o of group.getChildren()) {
      const pu = o as PowerUp;
      if (!pu.active) continue;
      if (Phaser.Math.Distance.Squared(pu.x, pu.y, px, py) < range2) pu.attract(px, py);
    }
  }

  private collect(pu: PowerUp): void {
    const p = this.player;
    const now = this.time.now;
    const kind = pu.kind;

    if (kind === 'xp') {
      // 满级之后经验没处可去，晶体按分数回收 —— 不然这一地的晶体捡起来
      // 什么都不会发生，看着像坏了。等级那条线停了，分数这条还开着
      const maxed = this.level >= PLAYER.maxLevel;
      this.gainXp(pu.value);
      audio.pickup();
      if (maxed) {
        this.score += pu.value * 100;
        this.floatText(p.x, p.y - 44, `+${pu.value * 100}`, COLORS.yellow, 16);
        return;
      }
      this.floatText(p.x, p.y - 44, `+${pu.value} EXP`, COLORS.blue, 16);
      return;
    }

    audio.powerUp();
    let label = POWER_INFO[kind].label;
    switch (kind) {
      case 'weapon':
        if (p.weapon < PLAYER.maxWeapon) p.weapon++;
        else {
          this.score += 2000;
          label = '+2000';
        }
        break;
      case 'shield':
        p.shield = Math.min(PLAYER.maxShield, p.shield + 1);
        break;
      case 'bomb':
        this.bombs = Math.min(PLAYER.maxBombs, this.bombs + 1);
        break;
      case 'heal':
        this.healPlayer(HEAL_AMOUNT);
        break;
      case 'rapid':
        p.rapidUntil = Math.max(now, p.rapidUntil) + 8000;
        break;
      default:
        break;
    }
    this.floatText(p.x, p.y - 44, label, POWER_INFO[kind].color, 18);
  }

  /** 飘字：带额度限制和对象池，返回是否真的显示出来了 */
  private floatText(x: number, y: number, text: string, color: number, size: number): boolean {
    if (this.popupBudget <= 0) return false;
    this.popupBudget--;
    const t = this.takePopup(size);
    t.setText(text).setColor(hex(color)).setShadow(0, 0, hex(color), Math.max(8, size * 0.5), true, true);
    t.setPosition(x, y).setAlpha(1).setVisible(true);
    this.tweens.add({
      targets: t,
      y: y - 56,
      alpha: 0,
      duration: 900,
      onComplete: () => {
        t.setVisible(false);
        (this.popupPool.get(size) ?? []).push(t);
      },
    });
    return true;
  }

  /** 按字号从池里取一个 Text，取不到才新建 */
  private takePopup(size: number): Phaser.GameObjects.Text {
    let free = this.popupPool.get(size);
    if (!free) {
      free = [];
      this.popupPool.set(size, free);
    }
    const pooled = free.pop();
    if (!pooled) return neonText(this, 0, 0, '', size, COLORS.white).setDepth(50);
    this.tweens.killTweensOf(pooled);
    return pooled;
  }

  // ───────── 特效 ─────────

  private emitter(color: number): Phaser.GameObjects.Particles.ParticleEmitter {
    let em = this.emitters.get(color);
    if (!em) {
      em = this.add.particles(0, 0, 'particle', {
        speed: { min: 60, max: 420 },
        lifespan: { min: 300, max: 850 },
        scale: { start: 0.7, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: color,
        blendMode: 'ADD',
        emitting: false,
      });
      em.setDepth(20);
      this.emitters.set(color, em);
    }
    return em;
  }

  explodeAt(x: number, y: number, color: number, size = 1): void {
    this.explode(x, y, color, size);
  }

  private explode(x: number, y: number, color: number, size = 1): void {
    this.emitter(color).explode(Math.round(10 + 22 * size), x, y);
    if (size >= 0.5) this.showRing(x, y, color, size);
  }

  /** 光环池：轮流取用，够一帧内几十次爆炸同时用了 */
  private buildRingPool(): void {
    this.rings = [];
    this.ringAt = 0;
    for (let i = 0; i < RING_POOL; i++) {
      const img = this.add.image(0, 0, 'ring').setVisible(false).setBlendMode(Phaser.BlendModes.ADD).setDepth(19);
      this.rings.push({ img, t: 0, dur: 1, to: 1 });
    }
  }

  private showRing(x: number, y: number, color: number, size: number): void {
    const r = this.rings[this.ringAt];
    this.ringAt = (this.ringAt + 1) % this.rings.length;
    r.img.setPosition(x, y).setTint(color).setVisible(true).setAlpha(1).setScale(RING_FROM);
    r.to = 0.6 * size;
    r.t = 0;
  }

  /** 手动推进光环，比每个爆炸挂一个 Tween 便宜得多 */
  private updateRings(delta: number): void {
    for (const r of this.rings) {
      if (!r.img.visible) continue;
      r.t += delta;
      const k = Math.min(1, r.t / r.dur);
      const eased = 1 - (1 - k) * (1 - k) * (1 - k);
      r.img.setScale(RING_FROM + (r.to - RING_FROM) * eased).setAlpha(1 - k);
      if (k >= 1) r.img.setVisible(false);
    }
  }

  private flash(target: Phaser.GameObjects.Sprite): void {
    target.setTintFill(COLORS.white);
    this.time.delayedCall(50, () => target.active && target.clearTint());
  }

  /**
   * 顿帧：物理和补间一起按住 ms 毫秒，画面就停在爆点那一瞬。
   * 恢复走场景时钟，不受按住的影响，所以时长是准的。
   */
  private freeze(ms: number): void {
    if (this.time.now < this.freezeUntil) return; // 已经在顿着，既不再叠也不再提前松开
    this.freezeUntil = this.time.now + ms;
    this.physics.world.pause();
    this.tweens.pauseAll();
    this.time.delayedCall(ms, () => this.thaw());
  }

  private thaw(): void {
    this.freezeUntil = 0;
    // 玩家阵亡那一次是永久停物理的，别在这里顺手给它解了
    if (this.phase !== 'over') this.physics.world.resume();
    this.tweens.resumeAll();
  }

  /** 屏幕暗角：挨打时红一下，残血时一直红着呼吸。画在战场之上、HUD 之下 */
  private drawVignette(now: number): void {
    const g = this.vignette;
    g.clear();
    const p = this.player;
    if (!p.alive) return;
    // 挨打的红：一下亮起来再退回边上
    const hurt = Phaser.Math.Clamp(1 - (now - this.hurtAt) / HURT_VIGNETTE_MS, 0, 1);
    // 残血的红：意思是「快没了」而不是「刚挨打」，所以是慢呼吸，不跟受击那一下抢注意力
    const low = p.hp / p.maxHp <= 0.3 ? 0.2 + 0.1 * Math.sin(now / 260) : 0;
    const a = Math.max(hurt * 0.36, low);
    if (a <= 0.004) return;
    // 四条边各一块四角渐变：边上最浓、往里化开。
    // 早先拿一排等宽色带叠，浓度一调高就看出台阶和中间那块方形的「洞」，渐变没这问题。
    // 也别铺得太深 —— 红压过屏幕三分之一就会把弹幕的颜色带偏
    const c = COLORS.red;
    const depth = Math.min(GAME_W, GAME_H) * 0.14;
    const band = (x: number, y: number, w: number, h: number, tl: number, tr: number, bl: number, br: number): void => {
      g.fillGradientStyle(c, c, c, c, tl, tr, bl, br);
      g.fillRect(x, y, w, h);
    };
    band(0, 0, GAME_W, depth, a, a, 0, 0);
    band(0, GAME_H - depth, GAME_W, depth, 0, 0, a, a);
    band(0, 0, depth, GAME_H, a, 0, a, 0);
    band(GAME_W - depth, 0, depth, GAME_H, 0, a, 0, a);
  }

  private banner(text: string, color: number, duration = 1800, sub = ''): Phaser.GameObjects.Text {
    const t = neonText(this, GAME_W / 2, GAME_H / 2 - 80, text, 48, color).setDepth(95).setAlpha(0).setScale(1.4);
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 300, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: duration - 300, duration: 300, onComplete: () => t.destroy() });
    if (sub) {
      // 副标题挂在主标题下面一行，字号小一号 —— 主次分明才不会抢焦点
      const s = neonText(this, GAME_W / 2, GAME_H / 2 - 20, sub, 22, color).setDepth(95).setAlpha(0);
      this.tweens.add({ targets: s, alpha: 0.85, duration: 300 });
      this.tweens.add({ targets: s, alpha: 0, delay: duration - 300, duration: 300, onComplete: () => s.destroy() });
    }
    return t;
  }

  private pauseGame(): void {
    if (this.phase === 'over' || !this.scene.isActive()) return;
    this.scene.pause();
    this.scene.launch('Pause');
  }
}

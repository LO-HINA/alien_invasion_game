import Phaser from 'phaser';
import { BULLET, COLORS, COMBO_WINDOW_MS, FREEZE, GAME_H, GAME_W, GRAZE, HEAL_AMOUNT, hex, HIT, HURT_VIGNETTE_MS, LEECH, MAX_MULTIPLIER, PLAYER, REROLLS, XP_PICKUP, xpToNext } from '../config';
import { Arsenal } from '../objects/Arsenal';
import { Boss } from '../objects/Boss';
import { Bullet, type BulletOpts } from '../objects/Bullet';
import { ENEMY_DEFS, Enemy, type EnemyKind, type SpawnOpts } from '../objects/Enemy';
import { Player } from '../objects/Player';
import { POWER_INFO, PowerUp, randomPowerKind, type PowerKind } from '../objects/PowerUp';
import { audio } from '../systems/audio';
import { applySkill, MAGNET_RANGE, rollSkills, type SkillId } from '../systems/skills';
import { Starfield } from '../systems/starfield';
import { loadHighScore } from '../systems/storage';
import { neonText } from '../systems/ui';
import { Hud } from './Hud';

type Phase = 'waves' | 'boss-wait' | 'boss' | 'clear' | 'over';
type WavePattern = 'row' | 'column' | 'v' | 'sine' | 'shooters' | 'chargers' | 'tank' | 'swarm' | 'snipers' | 'spinners' | 'splitters' | 'bombers';
/** 敌机从哪条边进场 */
type EntrySide = 'top' | 'right' | 'bottom' | 'left';

// 每种编队从第几关开始出现
const WAVE_UNLOCK: [WavePattern, number][] = [
  ['row', 1],
  ['column', 1],
  ['v', 1],
  ['sine', 1],
  ['shooters', 1],
  ['chargers', 2],
  ['tank', 2],
  ['snipers', 2],
  ['splitters', 2],
  ['swarm', 3],
  ['spinners', 3],
  ['bombers', 3],
];

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
  private level = 1;
  private xp = 0;
  private pendingLevels = 0;
  private pausedAt = 0;
  private dashBossAt = 0;
  private layoutW = 0;
  private layoutH = 0;
  /** 屏幕暗角：挨打与残血共用一层，画在战场之上、HUD 之下 */
  private vignette!: Phaser.GameObjects.Graphics;
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

  constructor() {
    super('Game');
  }

  private get diff(): number {
    return 1 + (this.stage - 1) * 0.3;
  }

  private get multiplier(): number {
    return Math.min(MAX_MULTIPLIER, 1 + Math.floor(this.combo / 10));
  }

  private get wavesThisStage(): number {
    return Math.min(30, 12 + this.stage * 3);
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

    this.pBullets = this.physics.add.group({ classType: Bullet, maxSize: 400 });
    this.eBullets = this.physics.add.group({ classType: Bullet, maxSize: 900 });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 320, runChildUpdate: true });
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
      this.hurtPlayer(HIT.bullet);
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
      if (p.starred) {
        this.hitEnemy(enemy, 50);
        return;
      }
      if (p.invulnerable) return;
      this.hurtPlayer(HIT.ram);
      this.hitEnemy(enemy, 8);
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
      player: p,
      boss: this.boss,
    });

    if (this.pendingLevels > 0 && p.alive && this.phase !== 'over') this.openLevelUp();
  }

  // ───────── 关卡推进 ─────────

  private runDirector(time: number): void {
    if (this.phase === 'waves' && time >= this.nextWaveAt) {
      if (this.waveCount < this.wavesThisStage) {
        this.spawnWave();
        this.waveCount++;
        // 每 5 波喘一口：一直顶在最高强度，玩家会从紧张变成麻木，有起伏才有爽点
        const breath = this.waveCount % BREATH_EVERY === 0 ? BREATH_MS : 0;
        this.nextWaveAt = time + Math.max(750, 1900 - this.stage * 120) + breath;
      } else {
        // 不要求清光敌人，短暂间隔后 Boss 直接登场
        this.phase = 'boss-wait';
        this.bossAt = time + 2500;
      }
    } else if (this.phase === 'boss-wait' && time >= this.bossAt) {
      this.phase = 'boss';
      this.startBoss();
    }
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
    const p = this.entry(side, u, back);
    this.spawnEnemy(kind, p.x, p.y, { ...opts, angle: p.angle });
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

  /** 一波 = 一组编队。关数上去之后会同一拍再来一两组，从别的边压过来 */
  private spawnWave(): void {
    this.wavePattern();
    if (this.stage >= 2 && Math.random() < Math.min(0.55, 0.18 + this.stage * 0.1)) this.wavePattern();
    if (this.stage >= 4 && Math.random() < 0.3) this.wavePattern();
  }

  private wavePattern(): void {
    const pool = WAVE_UNLOCK.filter(([, s]) => this.stage >= s).map(([p]) => p);
    const pattern = Phaser.Utils.Array.GetRandom(pool) as WavePattern;
    const side = this.pickSide();
    this.lastSide = side;
    // 沿这条边的可用长度
    const span = side === 'top' || side === 'bottom' ? GAME_W : GAME_H;

    switch (pattern) {
      case 'row': {
        const n = 10 + Math.min(4, this.stage);
        for (let i = 0; i < n; i++) this.spawn(side, 'drone', (span * (i + 0.5)) / n, (i % 2) * 40);
        break;
      }
      case 'column': {
        const c = Phaser.Math.Between(80, span - 80);
        for (let i = 0; i < 9 + Math.min(5, this.stage); i++) this.spawn(side, 'drone', c, i * 55);
        break;
      }
      case 'v': {
        // 斜边张开 ±240，中心要留出这么多，否则两翼会落在入场边之外 ——
        // 那几个成员永远飞不进战场，玩家一眼都看不到（Enemy 里另有兜底回收）
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 240, span - 240);
        for (let i = 0; i < 11; i++) {
          const k = i - 5;
          this.spawn(side, 'drone', cx + k * 48, Math.abs(k) * 45);
        }
        break;
      }
      case 'sine': {
        const amp = Phaser.Math.Between(60, 130);
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), amp + 50, span - amp - 50);
        for (let i = 0; i < 11; i++) this.spawn(side, 'wave', cx, i * 60, { amp, phase: -i * 0.5 });
        break;
      }
      case 'shooters': {
        const n = 4 + Math.min(3, Math.floor(this.stage / 2));
        for (let i = 0; i < n; i++) this.spawn(side, 'shooter', (span * (i + 0.5)) / n, i * 30, { phase: i });
        break;
      }
      case 'chargers': {
        const n = 5 + Math.min(3, this.stage - 2);
        for (let i = 0; i < n; i++) this.spawn(side, 'charger', Phaser.Math.Between(80, span - 80), i * 80);
        break;
      }
      case 'tank': {
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 160, span - 160);
        this.spawn(side, 'tank', cx, 20);
        for (const d of [-150, -90, -30, 30, 90, 150]) this.spawn(side, 'drone', cx + d, 100);
        break;
      }
      case 'snipers': {
        // 隔着大半个屏幕点名，得靠不停移动把枪线甩掉
        const n = 2 + Math.min(2, this.stage - 2);
        for (let i = 0; i < n; i++) this.spawn(side, 'sniper', (span * (i + 0.5)) / n, i * 40, { phase: i });
        break;
      }
      case 'spinners': {
        const n = 2 + (this.stage >= 5 ? 1 : 0);
        for (let i = 0; i < n; i++) this.spawn(side, 'spinner', (span * (i + 0.5)) / n, i * 60, { phase: i });
        break;
      }
      case 'splitters':
        for (let i = 0; i < 6; i++) this.spawn(side, 'splitter', (span * (i + 0.5)) / 6, (i % 2) * 50);
        break;
      case 'bombers': {
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 160, span - 160);
        this.spawn(side, 'bomber', cx, 20);
        if (this.stage >= 5) this.spawn(side, 'bomber', cx + 160, 90);
        for (const d of [-110, 0, 110]) this.spawn(side, 'drone', cx + d, 120);
        break;
      }
      case 'swarm':
        for (let i = 0; i < 22; i++) this.spawn(side, i % 3 === 0 ? 'wave' : 'drone', Phaser.Math.Between(60, span - 60), i * 35, { amp: 50 });
        break;
    }
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
          if (!p.invulnerable) this.hurtPlayer(HIT.boss);
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
      this.banner(`STAGE ${this.stage}`, COLORS.cyan);
    });
  }

  // ───────── 射击 ─────────

  firePlayerBullet(x: number, y: number, angle: number, speed: number, texture: string, damage: number, pierce = 0, opts: BulletOpts = {}): Bullet | null {
    const b = this.pBullets.get(x, y) as Bullet | null;
    b?.fire(x, y, angle, speed, texture, damage, pierce, opts);
    return b;
  }

  fireEnemy(x: number, y: number, angle: number, speed: number, texture: string): void {
    if (this.phase === 'over') return;
    const b = this.eBullets.get(x, y) as Bullet | null;
    b?.fire(x, y, angle, speed, texture);
  }

  /** 朝玩家方向发射 count 发扇形弹 */
  fireEnemyAimed(x: number, y: number, speed: number, texture: string, count: number, spread: number): void {
    const base = Phaser.Math.Angle.Between(x, y, this.player.x, this.player.y);
    for (let i = 0; i < count; i++) this.fireEnemy(x, y, base + (i - (count - 1) / 2) * spread, speed, texture);
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
    if (Math.random() < def.dropChance) this.dropPowerUp(e.x, e.y);
    this.leech(def.xp);
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

  private gainXp(amount: number): void {
    this.xp += amount * this.player.xpMul;
    while (this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level);
      this.level++;
      this.pendingLevels++;
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
    p.starUntil += d;
    p.dashUntil += d;
    this.comboUntil += d;
    this.nextWaveAt += d;
    this.bossAt += d;
    this.dashBossAt += d;
    this.activePlayerBullets().forEach((b) => b.shift(d));
    this.arsenal.shift(d);
    this.input.keyboard?.resetKeys();
  }

  /** 扣血。护盾先顶，护盾没破就不掉血 */
  private hurtPlayer(dmg: number): void {
    const p = this.player;
    this.cameras.main.shake(180, 0.01);
    if (p.shield > 0) {
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
    // 机身一旦 inactive，Player.preUpdate 就不再跑，炮塔得手动收掉
    p.turret.setVisible(false);
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
      this.gainXp(pu.value);
      audio.pickup();
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
      case 'star':
        p.starUntil = Math.max(now, p.starUntil) + 6000;
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

  private banner(text: string, color: number, duration = 1800): Phaser.GameObjects.Text {
    const t = neonText(this, GAME_W / 2, GAME_H / 2 - 80, text, 48, color).setDepth(95).setAlpha(0).setScale(1.4);
    this.tweens.add({ targets: t, alpha: 1, scale: 1, duration: 300, ease: 'Back.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: duration - 300, duration: 300, onComplete: () => t.destroy() });
    return t;
  }

  private pauseGame(): void {
    if (this.phase === 'over' || !this.scene.isActive()) return;
    this.scene.pause();
    this.scene.launch('Pause');
  }
}

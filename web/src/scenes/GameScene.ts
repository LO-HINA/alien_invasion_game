import Phaser from 'phaser';
import { BULLET, COLORS, COMBO_WINDOW_MS, GAME_H, GAME_W, MAX_MULTIPLIER, PLAYER, XP_PICKUP, xpToNext } from '../config';
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
type WavePattern = 'row' | 'column' | 'v' | 'sine' | 'shooters' | 'chargers' | 'tank' | 'swarm';
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
  ['swarm', 3],
];

// 四边出现概率，正面仍然是主要压力来源
const SIDE_WEIGHT: [EntrySide, number][] = [
  ['top', 0.4],
  ['left', 0.2],
  ['right', 0.2],
  ['bottom', 0.2],
];

type KeyName = 'W' | 'A' | 'S' | 'D' | 'UP' | 'DOWN' | 'LEFT' | 'RIGHT' | 'X' | 'K' | 'P' | 'ESC' | 'M' | 'SPACE' | 'SHIFT' | 'F';

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

  private phase: Phase = 'waves';
  private stage = 1;
  private score = 0;
  private high = 0;
  private lives = PLAYER.lives;
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
    return Math.min(18, 8 + this.stage * 2);
  }

  get currentBoss(): Boss | undefined {
    return this.boss && this.boss.hp > 0 ? this.boss : undefined;
  }

  create(): void {
    this.phase = 'waves';
    this.stage = 1;
    this.score = 0;
    this.high = loadHighScore();
    this.lives = PLAYER.lives;
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
    this.emitters = new Map();
    this.drag = undefined;

    this.cameras.main.fadeIn(300, 5, 3, 13);
    this.physics.world.setBounds(0, 0, GAME_W, GAME_H);
    this.starfield = new Starfield(this);

    this.pBullets = this.physics.add.group({ classType: Bullet, maxSize: 400 });
    this.eBullets = this.physics.add.group({ classType: Bullet, maxSize: 600 });
    this.enemies = this.physics.add.group({ classType: Enemy, maxSize: 150, runChildUpdate: true });
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
      this.hurtPlayer();
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
      this.hurtPlayer();
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

    const p = this.player;
    if (p.alive) {
      p.move(this.keys);
      p.updateBlink(time);
      const shots = p.tryFire(time);
      if (shots.length) {
        const bounces = BULLET.bounces + p.skills.bounce;
        const lifeMs = BULLET.lifeMs + p.skills.bounce * 500;
        for (const s of shots) this.firePlayerBullet(s.x, s.y, s.a, PLAYER.bulletSpeed, 'pbullet', p.damageMul, p.skills.pierce, { bounces, lifeMs });
        audio.shoot();
      }
      this.pullPowerUps();
    }

    if (this.combo > 0 && time > this.comboUntil) this.combo = 0;
    this.boss?.tick(time, delta);
    this.arsenal.update(time, delta);
    this.runDirector(time);

    this.hud.update({
      score: this.score,
      high: this.high,
      stage: this.stage,
      lives: this.lives,
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
        this.nextWaveAt = time + Math.max(1300, 2800 - this.stage * 150);
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
    let r = Math.random();
    for (const [side, w] of SIDE_WEIGHT) {
      r -= w;
      if (r <= 0) return side;
    }
    return 'top';
  }

  private spawnWave(): void {
    const pool = WAVE_UNLOCK.filter(([, s]) => this.stage >= s).map(([p]) => p);
    const pattern = Phaser.Utils.Array.GetRandom(pool) as WavePattern;
    const side = this.pickSide();
    // 沿这条边的可用长度
    const span = side === 'top' || side === 'bottom' ? GAME_W : GAME_H;

    switch (pattern) {
      case 'row': {
        const n = 5 + Math.min(2, this.stage - 1);
        for (let i = 0; i < n; i++) this.spawn(side, 'drone', (span * (i + 0.5)) / n, (i % 2) * 40);
        break;
      }
      case 'column': {
        const c = Phaser.Math.Between(80, span - 80);
        for (let i = 0; i < 5 + Math.min(3, this.stage); i++) this.spawn(side, 'drone', c, i * 55);
        break;
      }
      case 'v': {
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 180, span - 180);
        for (let i = 0; i < 7; i++) {
          const k = i - 3;
          this.spawn(side, 'drone', cx + k * 48, Math.abs(k) * 45);
        }
        break;
      }
      case 'sine': {
        const amp = Phaser.Math.Between(60, 130);
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), amp + 50, span - amp - 50);
        for (let i = 0; i < 7; i++) this.spawn(side, 'wave', cx, i * 60, { amp, phase: -i * 0.5 });
        break;
      }
      case 'shooters': {
        const n = 2 + Math.min(2, Math.floor(this.stage / 2));
        for (let i = 0; i < n; i++) this.spawn(side, 'shooter', (span * (i + 0.5)) / n, i * 30, { phase: i });
        break;
      }
      case 'chargers':
        for (let i = 0; i < 3; i++) this.spawn(side, 'charger', Phaser.Math.Between(80, span - 80), i * 90);
        break;
      case 'tank': {
        const cx = Phaser.Math.Clamp(Phaser.Math.Between(0, span), 160, span - 160);
        this.spawn(side, 'tank', cx, 20);
        for (const d of [-90, 90]) this.spawn(side, 'drone', cx + d, 100);
        break;
      }
      case 'swarm':
        for (let i = 0; i < 12; i++) this.spawn(side, i % 3 === 0 ? 'wave' : 'drone', Phaser.Math.Between(60, span - 60), i * 35, { amp: 50 });
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
          if (!p.invulnerable) this.hurtPlayer();
        }),
      ];
    });
  }

  hitBoss(dmg: number): void {
    const boss = this.boss;
    if (!boss || boss.hp <= 0) return;
    boss.hp -= dmg;
    this.flash(boss);
    if (Math.random() < 0.3) audio.hit();
    if (boss.hp <= 0) this.killBoss(boss);
  }

  private killBoss(boss: Boss): void {
    this.bossColliders.forEach((c) => c.destroy());
    this.bossColliders = [];
    this.phase = 'clear';
    this.clearEnemyBullets();
    boss.setVelocity(0, 0);
    this.addScore(5000 * this.stage, boss.x, boss.y, false);
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

  activeEnemies(): Enemy[] {
    return this.enemies.getMatching('active', true) as Enemy[];
  }

  activeEnemyBullets(): Bullet[] {
    return this.eBullets.getMatching('active', true) as Bullet[];
  }

  activePlayerBullets(): Bullet[] {
    return this.pBullets.getMatching('active', true) as Bullet[];
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
    if (e.kind === 'tank') this.cameras.main.shake(200, 0.008);
    this.addScore(def.score, e.x, e.y);
    // 经验掉在原地，得自己飞过去捡
    this.dropXp(e.x, e.y, def.xp);
    if (Math.random() < def.dropChance) this.dropPowerUp(e.x, e.y);
    e.disableBody(true, true);
  }

  private addScore(base: number, x: number, y: number, combo = true): void {
    if (combo) {
      this.combo++;
      this.comboUntil = this.time.now + COMBO_WINDOW_MS;
    }
    const gained = base * (combo ? this.multiplier : 1);
    this.score += gained;
    const t = neonText(this, x, y, `+${gained}`, 14, COLORS.yellow).setDepth(50);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 700, onComplete: () => t.destroy() });
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

  /** LevelUp 场景选完后调用（此时本场景仍处于暂停） */
  chooseSkill(id: SkillId): void {
    applySkill(this.player, id);
    if (id === 'repair') this.score += 1000;
  }

  private onPause(): void {
    this.pausedAt = this.game.loop.time;
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

  private hurtPlayer(): void {
    const p = this.player;
    this.cameras.main.shake(180, 0.01);
    if (p.shield > 0) {
      p.shield--;
      p.invulnUntil = this.time.now + 800;
      audio.shield();
      this.explode(p.x, p.y, COLORS.cyan, 0.5);
      return;
    }
    p.hp--;
    p.invulnUntil = this.time.now + PLAYER.hitInvulnMs;
    audio.hurt();
    this.flash(p);
    // 受击后清掉身边的子弹，避免连续挨打
    this.clearEnemyBullets(160);
    if (p.hp <= 0) this.killPlayer();
  }

  private killPlayer(): void {
    const p = this.player;
    p.alive = false;
    p.engine.emitting = false;
    this.explode(p.x, p.y, COLORS.cyan, 2.2);
    audio.explode(true);
    this.cameras.main.shake(400, 0.02);
    p.disableBody(true, true);
    this.lives--;
    this.combo = 0;

    if (this.lives <= 0) {
      this.phase = 'over';
      this.time.delayedCall(1400, () => {
        this.physics.pause();
        this.scene.pause();
        this.scene.launch('GameOver', { score: this.score, stage: this.stage, level: this.level });
      });
      return;
    }
    this.time.delayedCall(1300, () => {
      this.clearEnemyBullets();
      p.enableBody(true, GAME_W / 2, GAME_H * 0.68, true, true);
      p.alive = true;
      p.hp = p.maxHp;
      p.weapon = Math.max(1, p.weapon - 1);
      p.invulnUntil = this.time.now + PLAYER.respawnInvulnMs;
      p.engine.emitting = true;
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
    const live = this.xpOrbs.getMatching('active', true) as PowerUp[];
    if (live.length >= XP_PICKUP.mergeLimit) {
      // 场上晶体太多了，就近合并，避免越堆越掉帧
      let best: PowerUp | undefined;
      let bestD = XP_PICKUP.mergeRadius * XP_PICKUP.mergeRadius;
      for (const pu of live) {
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
    const suck = (list: Phaser.GameObjects.GameObject[]): void => {
      for (const o of list) {
        const pu = o as PowerUp;
        if (Phaser.Math.Distance.Squared(pu.x, pu.y, p.x, p.y) < range2) pu.attract(p.x, p.y);
      }
    };
    suck(this.powerups.getMatching('active', true));
    suck(this.xpOrbs.getMatching('active', true));
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
        p.hp = Math.min(p.maxHp, p.hp + 2);
        break;
      case 'rapid':
        p.rapidUntil = Math.max(now, p.rapidUntil) + 8000;
        break;
      case 'star':
        p.starUntil = Math.max(now, p.starUntil) + 6000;
        break;
      case 'life':
        this.lives = Math.min(9, this.lives + 1);
        break;
      default:
        break;
    }
    this.floatText(p.x, p.y - 44, label, POWER_INFO[kind].color, 18);
  }

  private floatText(x: number, y: number, text: string, color: number, size: number): void {
    const t = neonText(this, x, y, text, size, color).setDepth(50);
    this.tweens.add({ targets: t, y: y - 56, alpha: 0, duration: 900, onComplete: () => t.destroy() });
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
    if (size >= 0.5) {
      const ring = this.add.image(x, y, 'ring').setTint(color).setScale(0.1).setBlendMode(Phaser.BlendModes.ADD).setDepth(19);
      this.tweens.add({ targets: ring, scale: 0.6 * size, alpha: 0, duration: 380, ease: 'Cubic.out', onComplete: () => ring.destroy() });
    }
  }

  private flash(target: Phaser.GameObjects.Sprite): void {
    target.setTintFill(COLORS.white);
    this.time.delayedCall(50, () => target.active && target.clearTint());
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

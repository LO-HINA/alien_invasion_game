import Phaser from 'phaser';
import { BULLET, GAME_H, GAME_W } from '../config';

export interface BulletOpts {
  /** 还能撞几次墙（0 = 撞墙即消失） */
  bounces?: number;
  /** 存活时间，到点自动消失 */
  lifeMs?: number;
  /** 命中判定半径 */
  radius?: number;
}

export class Bullet extends Phaser.Physics.Arcade.Sprite {
  damage = 1;
  /** 还能再穿透几个敌人 */
  pierce = 0;
  /** 追踪导弹：由 Arsenal 每帧修正方向 */
  homing = false;
  speed = 0;
  /** 玩家子弹会撞墙反弹；敌弹撞墙即消失 */
  friendly = true;
  /** 这颗敌弹已经从机身旁边擦过去了（每颗只算一次，靠得太近时会连着好几帧都在圈里） */
  grazed = false;
  private bounces = 0;
  private expireAt = 0;
  /** 穿透弹命中过的敌人，避免同一帧重复结算 */
  readonly hitSet = new Set<object>();

  constructor(scene: Phaser.Scene, x: number, y: number, texture = 'pbullet') {
    super(scene, x, y, texture);
  }

  fire(x: number, y: number, angle: number, speed: number, texture: string, damage = 1, pierce = 0, opts: BulletOpts = {}): void {
    this.setTexture(texture);
    this.enableBody(true, x, y, true, true);
    this.setBlendMode(Phaser.BlendModes.ADD);
    this.setRotation(angle);
    this.damage = damage;
    this.pierce = pierce;
    this.homing = false;
    this.speed = speed;
    this.friendly = !texture.startsWith('e');
    this.grazed = false;
    this.hitSet.clear();
    const body = this.body as Phaser.Physics.Arcade.Body;
    const r = opts.radius ?? (this.friendly ? BULLET.radius : 5);
    body.setCircle(r, this.width / 2 - r, this.height / 2 - r);
    this.bounces = this.friendly ? opts.bounces ?? BULLET.bounces : 0;
    this.expireAt = opts.lifeMs ? this.scene.time.now + opts.lifeMs : 0;
    this.scene.physics.velocityFromRotation(angle, speed, body.velocity);
  }

  /** 命中一个目标；返回 false 表示这个目标已经被这颗子弹打过 */
  hitTarget(target: object): boolean {
    if (this.hitSet.has(target)) return false;
    this.hitSet.add(target);
    if (this.pierce > 0) this.pierce--;
    else this.kill();
    return true;
  }

  /** 暂停 / 升级后把到期时间整体后移 */
  shift(ms: number): void {
    if (this.expireAt) this.expireAt += ms;
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);

    if (this.friendly) {
      if (this.expireAt && this.scene.time.now >= this.expireAt) {
        this.kill();
        return;
      }
      // 场上最多几百颗子弹，这里每帧都跑：bounds 查一次、body 转一次，别放进 helper 里重复做
      const body = this.body as Phaser.Physics.Arcade.Body;
      const b = this.scene.physics.world.bounds;
      const m = BULLET.margin;
      // 两条轴都要判，所以不能用 || 短路
      const hitX = this.bounceX(body, b.left + m, b.right - m);
      const hitY = this.bounceY(body, b.top + m, b.bottom - m);
      if (hitX || hitY) {
        if (this.bounces < 0) {
          this.kill();
          return;
        }
        this.setRotation(Math.atan2(body.velocity.y, body.velocity.x));
      }
    }

    if (this.x < -60 || this.x > GAME_W + 60 || this.y < -60 || this.y > GAME_H + 60) this.kill();
  }

  private bounceX(body: Phaser.Physics.Arcade.Body, lo: number, hi: number): boolean {
    if (this.x < lo && body.velocity.x < 0) {
      this.x = lo;
      body.velocity.x = -body.velocity.x;
    } else if (this.x > hi && body.velocity.x > 0) {
      this.x = hi;
      body.velocity.x = -body.velocity.x;
    } else {
      return false;
    }
    this.bounces--;
    return true;
  }

  private bounceY(body: Phaser.Physics.Arcade.Body, lo: number, hi: number): boolean {
    if (this.y < lo && body.velocity.y < 0) {
      this.y = lo;
      body.velocity.y = -body.velocity.y;
    } else if (this.y > hi && body.velocity.y > 0) {
      this.y = hi;
      body.velocity.y = -body.velocity.y;
    } else {
      return false;
    }
    this.bounces--;
    return true;
  }

  kill(): void {
    this.disableBody(true, true);
  }
}

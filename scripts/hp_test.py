"""血条 / 吸血 / 三连发的验证脚本：
  扣血数值、护盾先顶、修复道具、击杀吸血、齐射颗数、血光见底后结束
用法： python scripts/hp_test.py [URL]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"

SETUP = """
() => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    // 关掉刷怪和 Boss，单独量伤害
    s.waveCount = 999; s.nextWaveAt = Number.MAX_SAFE_INTEGER; s.bossAt = Number.MAX_SAFE_INTEGER;
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    s.activeEnemyBullets().forEach(b => b.kill());
    p.shield = 0;
    p.invulnUntil = 0;
    p.hp = p.maxHp;
    return { hp: p.hp, maxHp: p.maxHp };
}
"""

# 每步都先把无敌时间清掉，否则第二次伤害会被无敌挡掉
HIT = """
(n) => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    p.invulnUntil = 0;
    s.hurtPlayer(n);
    return { hp: p.hp, shield: p.shield, over: s.phase };
}
"""

# 找一架敌机打死，看回血多少
KILL = """
({ kind, leech }) => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    p.skills.leech = leech;
    const before = p.hp;
    const e = s.enemies.get(200, 300);
    e.spawn(kind, 200, 300, 1);
    s.hitEnemy(e, 99999);
    return { before, after: p.hp, gain: p.hp - before };
}
"""

# 齐射颗数：直接调 tryFire 拿一轮的弹道，不看场上有几颗（那还受存活时间影响）
VOLLEY = """
(lv) => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    p.weapon = lv;
    // tryFire 会把 lastShot 推到传入的时间上，所以先把它清掉，否则第二次调用还在冷却里
    p.lastShot = -1e9;
    const shots = p.tryFire(0);
    const rel = shots.map(q => (q.a - p.aim) * 180 / Math.PI).sort((a, b) => a - b);
    return {
        shots: shots.length,
        // 最左到最右差多少度：是扇面还是平行，看这个
        fan: +(rel[rel.length - 1] - rel[0]).toFixed(1),
        // 所有子弹应该都从同一个炮口出去
        muzzle: new Set(shots.map(q => `${Math.round(q.x)},${Math.round(q.y)}`)).size,
    };
}
"""

MEASURE = """
() => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    const h = s.hud;
    return {
        hp: p.hp, maxHp: p.maxHp, shield: p.shield, phase: s.phase,
        ship: [Math.round(p.displayWidth), Math.round(p.displayHeight)],
        body: p.body.radius,
        bar: [Math.round(h.hpX), Math.round(h.hpY), Math.round(h.hpW)],
        over: window.game.scene.isActive('GameOver'),
    };
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 720, "height": 1280})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errs.append(m.text))
    page.goto(URL)
    page.wait_for_timeout(2500)
    page.keyboard.press("Space")
    page.wait_for_timeout(2000)

    print("初始:", page.evaluate(SETUP))

    # 1. 一发敌弹 / 一次撞机 / Boss 撞击
    print("敌弹 12:", page.evaluate(HIT, 12))
    print("撞机 20:", page.evaluate(HIT, 20))
    print("Boss 26:", page.evaluate(HIT, 26))

    # 2. 护盾先顶
    print("护盾:", page.evaluate("""() => {
        const s = window.game.scene.getScene('Game');
        const p = s.player;
        p.shield = 2; p.invulnUntil = 0; p.hp = 60;
        s.hurtPlayer(12);
        return { hp: p.hp, shield: p.shield };
    }"""))

    # 3. 修复道具 +40（照抄拾取回调：先收掉 body 再结算，否则下一帧会被真的碰撞再吃一次）
    print("修复 +40:", page.evaluate("""() => {
        const s = window.game.scene.getScene('Game');
        const p = s.player;
        p.shield = 0; p.hp = 20;
        const pu = s.powerups.get(0, 0);
        pu.spawn('heal', p.x, p.y);
        pu.disableBody(true, true);
        s.collect(pu);
        return { hp: p.hp };
    }"""))

    # 4. 吸血：小飞机回得少，坦克回得多（按经验折算）
    page.evaluate("""() => { const p = window.game.scene.getScene('Game').player; p.hp = 30; }""")
    print("吸血 Lv1 小飞机:", page.evaluate(KILL, {"kind": "drone", "leech": 1}))
    page.evaluate("""() => { const p = window.game.scene.getScene('Game').player; p.hp = 30; }""")
    print("吸血 Lv1 坦克:", page.evaluate(KILL, {"kind": "tank", "leech": 1}))
    page.evaluate("""() => { const p = window.game.scene.getScene('Game').player; p.hp = 30; }""")
    print("吸血 Lv3 坦克:", page.evaluate(KILL, {"kind": "tank", "leech": 3}))
    page.evaluate("""() => { const p = window.game.scene.getScene('Game').player; p.skills.leech = 0; p.hp = 30; }""")
    print("没学吸血:", page.evaluate(KILL, {"kind": "drone", "leech": 0}))

    # 5. 齐射颗数（Lv1 起就是三连发）
    for lv in (1, 2, 3, 4, 5):
        print(f"火力 Lv{lv} 齐射:", page.evaluate(VOLLEY, lv))

    # 场上同时存在的子弹数：一轮多、存活短，稳态子弹量不该失控
    page.evaluate("""() => {
        const s = window.game.scene.getScene('Game');
        s.player.weapon = 5;
        s.player.lastShot = 0;
        s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
        s.activePlayerBullets().forEach(b => b.kill());
    }""")
    page.wait_for_timeout(1500)
    print("场上子弹稳态:", page.evaluate("() => window.game.scene.getScene('Game').activePlayerBullets().length"))

    print("机体 / 血条:", page.evaluate(MEASURE))
    page.screenshot(path="shots/07_hpbar.png")

    # 6. 血光见底 -> 结束
    page.evaluate("""() => {
        const s = window.game.scene.getScene('Game');
        const p = s.player;
        p.weapon = 1; p.hp = 10; p.invulnUntil = 0;
        s.hurtPlayer(12);
    }""")
    page.wait_for_timeout(1800)
    print("打空血:", page.evaluate(MEASURE))
    page.screenshot(path="shots/08_gameover.png")

    print("ERRORS:", errs[:5] if errs else "none")
    browser.close()

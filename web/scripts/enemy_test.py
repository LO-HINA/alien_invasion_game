"""新敌机的验证脚本：
  狙击机（蓄力闪烁 + 枪线 + 快弹）、旋舞机（螺旋撒弹）、轰炸机（环形弹幕）、
  分裂球（打爆裂成两架小机），以及关数上去之后场上的敌机 / 敌弹密度
用法： python scripts/enemy_test.py [URL]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"

CLEAR = """
() => {
    const s = window.game.scene.getScene('Game');
    s.waveCount = 99999;
    s.nextWaveAt = Number.MAX_SAFE_INTEGER;
    s.bossAt = Number.MAX_SAFE_INTEGER;
    s.phase = 'waves';
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    s.activeEnemyBullets().forEach(b => b.kill());
    s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
}
"""

# 单独放一架新机型，挂上钩子数它打了几发、弹速多少
FIRE = """
([kind, ms]) => {
    const s = window.game.scene.getScene('Game');
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    s.activeEnemyBullets().forEach(b => b.kill());
    const e = s.enemies.get(360, 200);
    e.spawn(kind, 360, 200, 1);
    e.hp = 99999;
    const shots = [];
    const traces = [];
    const origFire = s.fireEnemy.bind(s);
    const origTracer = s.tracer.bind(s);
    s.fireEnemy = (x, y, a, sp, tex) => { shots.push(Math.round(sp)); origFire(x, y, a, sp, tex); };
    s.tracer = (...a) => { traces.push(a); origTracer(...a); };
    // 蓄力闪烁会改 alpha，采样看一眼
    const alphas = new Set();
    const iv = setInterval(() => alphas.add(+e.alpha.toFixed(2)), 40);
    return new Promise((resolve) => setTimeout(() => {
        clearInterval(iv);
        s.fireEnemy = origFire;
        s.tracer = origTracer;
        resolve({
            kind,
            shots: shots.length,
            speeds: [...new Set(shots)].sort((a, b) => a - b),
            traces: traces.length,
            alpha: [...alphas].sort((a, b) => a - b),
            live: s.activeEnemyBullets().length,
            alive: e.active, onScreen: e.onScreen, tex: e.texture.key,
        });
    }, ms));
}
"""

# 分裂球：打死之后场上该多出两架小机，而且朝两边分开
SPLIT = """
() => {
    const s = window.game.scene.getScene('Game');
    const before = s.activeEnemies().length;
    const e = s.enemies.get(360, 300);
    e.spawn('splitter', 360, 300, 1);
    s.hitEnemy(e, 99999);
    const kids = s.activeEnemies();
    const deg = (v) => Math.round(Math.atan2(v.y, v.x) * 180 / Math.PI);
    // spawn 结尾会把速度清零，飞行方向要等下一帧 update 才写进去
    return new Promise((resolve) => setTimeout(() => resolve({
        added: kids.length - before,
        kinds: kids.map(k => k.kind),
        angles: kids.map(k => deg(k.body.velocity)),
    }), 150));
}
"""

# 让导演按第 3 关正常刷怪，量峰值密度、出现过的机型，以及这个密度下的场景帧耗时
DENSITY = """
(ms) => {
    const s = window.game.scene.getScene('Game');
    s.stage = 3;
    s.waveCount = 0;
    s.phase = 'waves';
    s.nextWaveAt = 0;
    const peaks = { enemies: 0, bullets: 0, waves: 0 };
    const kinds = new Set();
    // 给 sys.step 计时：更新列表（敌机 AI）、物理、碰撞回调、场景 update 都在里面，不含渲染
    const sys = s.sys;
    const origStep = sys.step.bind(sys);
    const steps = [];
    sys.step = (time, delta) => {
        const t0 = performance.now();
        origStep(time, delta);
        steps.push(performance.now() - t0);
    };
    const iv = setInterval(() => {
        const n = s.activeEnemies().length;
        if (n > peaks.enemies) peaks.enemies = n;
        const b = s.activeEnemyBullets().length;
        if (b > peaks.bullets) peaks.bullets = b;
        if (s.waveCount > peaks.waves) peaks.waves = s.waveCount;
        s.activeEnemies().forEach(e => kinds.add(e.kind));
        s.player.hp = s.player.maxHp;
    }, 100);
    return new Promise((resolve) => setTimeout(() => {
        clearInterval(iv);
        sys.step = origStep;
        steps.sort((a, b) => a - b);
        const at = (q) => +steps[Math.min(steps.length - 1, Math.floor(steps.length * q))].toFixed(2);
        resolve({
            ...peaks,
            kinds: [...kinds].sort(),
            phase: s.phase,
            frames: steps.length,
            avg: +(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(2),
            p50: at(0.5), p95: at(0.95), max: +steps[steps.length - 1].toFixed(2),
            fps: +window.game.loop.actualFps.toFixed(1),
        });
    }, ms));
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
    page.evaluate(CLEAR)

    # 每种新机型单独跑一段，看它到底打不打、打多快、贴图对不对
    for kind, ms in [("sniper", 5000), ("spinner", 4000), ("bomber", 5000), ("splitter", 2000)]:
        page.evaluate(CLEAR)
        print(f"{kind}:", page.evaluate(FIRE, [kind, ms]))

    page.evaluate(CLEAR)
    print("分裂球打爆:", page.evaluate(SPLIT))

    page.evaluate(CLEAR)
    print("第 3 关密度:", page.evaluate(DENSITY, 25000))
    page.screenshot(path="shots/09_swarm.png")

    print("ERRORS:", errs[:5] if errs else "none")
    browser.close()

"""帧耗时基准。三个场景，都在同一个「重度负载」下跑，用于对比优化前后：

  burst — 一帧里连爆 24 只杂兵（炸弹/清屏时刻），量的是爆炸光环、飘字、掉经验的开销
  micro — 单独压 dropXp / pullPowerUps，量的是每帧/每次击杀的固定开销
  frame — 90 只杂兵 + 满技能的稳态帧耗时（prestep -> poststep，不含渲染）

用法： python scripts/bench_test.py [URL] [标签]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
TAG = sys.argv[2] if len(sys.argv) > 2 else "run"

SETUP = """
() => {
    const s = window.game.scene.getScene('Game');
    s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
    s.player.hp = 9999;
    s.waveCount = 99999;                        // 关掉刷怪导演，负载全由脚本控制
    s.nextWaveAt = Number.MAX_SAFE_INTEGER;
    s.bossAt = Number.MAX_SAFE_INTEGER;
    s.phase = 'waves';
    Object.assign(s.player.skills, {
        gun: 3, rate: 3, power: 3, pierce: 3, bounce: 3, dash: 3,
        missile: 3, orb: 3, wingman: 3, lightning: 3, magnet: 3, regen: 3, hull: 3, xp: 3, repair: 0,
    });
    s.player.setPosition(360, 900);
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    return true;
}
"""

# 每一轮：先补到 window.__n 只「一碰就碎」的杂兵，再往角落里丢晶体把吸附组撑满
TOPPER = """
() => {
    const s = window.game.scene.getScene('Game');
    const want = window.__n || 90;
    for (let i = s.activeEnemies().length; i < want; i++) {
        const x = 60 + Math.random() * 600, y = 80 + Math.random() * 520;
        const e = s.enemies.get(x, y);
        if (!e) break;
        e.spawn('drone', x, y, 1);
        e.hp = 0.35;
    }
    for (let i = 0; i < 3; i++) s.dropXp(60 + Math.random() * 600, 30 + Math.random() * 120, 1);
}
"""

BURST = """
(n => {
    const s = window.game.scene.getScene('Game');
    const realRandom = Math.random;
    // 用固定种子的 mulberry32 顶掉 Math.random：掉落判定两边完全一致，
    // 但又不能退化成常数 —— Phaser 的 Text 贴图键是 UUID()，键一重复建第二个飘字就炸。
    // （手写 LCG 不行：seed*1103515245 超过 2^53，浮点丢精度会让序列很快打转。）
    let seed = 123456789;
    Math.random = () => {
        seed = (seed + 0x6d2b79f5) >>> 0;
        let t = seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const round = () => {
        s.popupBudget = 3;                      // 新版的飘字额度，旧版没这个字段也无妨
        for (let i = 0; i < 24; i++) {
            const e = s.enemies.get(100 + i * 20, 200);
            if (!e) continue;
            e.spawn('drone', 100 + i * 20, 200, 1);
            s.hitEnemy(e, 99999);
        }
    };
    seed = 1;                                   // 预热，别把 JIT 首次编译算进去
    for (let k = 0; k < 3; k++) round();
    // 正式测量换一串种子：预热那批飘字还活着，
    // 把种子倒回去会让它们拿到同一批 UUID，键重复就建不出来了。
    seed = 123456789;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) round();
    const ms = (performance.now() - t0) / n;
    Math.random = realRandom;
    return +ms.toFixed(3);
})
"""

MICRO = """
(n => {
    const s = window.game.scene.getScene('Game');
    const out = {};
    const time = (fn) => {
        fn(200);                                // 预热
        const t0 = performance.now();
        fn(n);
        return +((performance.now() - t0) / n * 1000).toFixed(2);   // 微秒/次
    };
    out.dropXp = time((k) => { for (let i = 0; i < k; i++) s.dropXp(60 + (i % 600), 30 + (i % 100), 1); });
    out.pullPowerUps = time((k) => { for (let i = 0; i < k; i++) s.pullPowerUps(); });
    out.orbs = s.xpOrbs.countActive(true);
    return out;
})
"""

FRAME = """
(seconds => {
    const s = window.game.scene.getScene('Game');
    window.__loadTimer = setInterval(() => {
        const fn = %s;
        fn();
    }, 100);
    // 给 sys.step 计时：这一层是「场景一帧要跑的活」——更新列表（敌机 AI）、物理、碰撞回调、
    // 场景自己的 update，都在里面，但不含渲染。
    // （原先用 prestep/poststep 事件，p50 一直是 0，量不准，弃用。）
    const sys = s.sys;
    const origStep = sys.step.bind(sys);
    const samples = [];
    sys.step = (time, delta) => {
        const t0 = performance.now();
        origStep(time, delta);
        samples.push(performance.now() - t0);
    };
    return new Promise((resolve) => {
        setTimeout(() => {
            clearInterval(window.__loadTimer);
            sys.step = origStep;
            samples.sort((a, b) => a - b);
            const at = (q) => +samples[Math.min(samples.length - 1, Math.floor(samples.length * q))].toFixed(3);
            resolve({
                frames: samples.length,
                avg: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(3),
                p50: at(0.5),
                p95: at(0.95),
                p99: at(0.99),
                max: +samples[samples.length - 1].toFixed(2),
                enemies: s.activeEnemies().length,
                bullets: s.activeEnemyBullets().length,
                orbs: s.xpOrbs.countActive(true),
                fps: +window.game.loop.actualFps.toFixed(1),
            });
        }, seconds * 1000);
    });
})
""" % TOPPER

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
    page.evaluate(SETUP)
    page.evaluate(TOPPER)
    page.evaluate(TOPPER)

    burst = page.evaluate(f"{BURST}(200)")
    micro = page.evaluate(f"{MICRO}(4000)")
    frame = page.evaluate(FRAME, 8)
    # 再来一轮更挤的：现在的出怪密度峰值能到 70 上下，得知道帧耗时还撑不撑得住
    page.evaluate("() => { window.__n = 200; }")
    heavy = page.evaluate(FRAME, 8)

    print(f"[{TAG}] burst(24 连爆/帧, ms): {burst}")
    print(f"[{TAG}] micro(微秒/次): {micro}")
    print(f"[{TAG}] frame(ms): {frame}")
    print(f"[{TAG}] frame200(ms): {heavy}")
    print(f"[{TAG}] ERRORS:", errs[:3] if errs else "none")
    browser.close()

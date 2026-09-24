"""长时间真实流程的浸泡测试（默认三分钟，不干预战局，只保证玩家不死）：

  · 真实导演刷怪、真实升级面板（自动替他选第一项）、真实 Boss 战，一路打穿几关
  · 每 500ms 采一次：帧率、各类实体数量、场景状态、战局阶段
  · 查三类不报错、但会让画面「莫名变稀」的问题：
      1. 池子见底 —— get() 返回 null 就悄悄不刷了（数量顶到上限即视为可疑）
      2. 敌机永远进不了场却留在场上（泄漏，越积越多就再也刷不出新的）
          注意「还在入场路上」的编队本来就在界外（最远退到入场边外 715 像素），
          这里只算「进过场还留在界外」和「没进场却已经朝外飞／停住」的
      3. 升级面板连续多次采样都还开着（等于卡住，玩家再也动不了）

用法： python scripts/soak_test.py [URL] [秒数]
"""
import statistics
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
SECONDS = int(sys.argv[2]) if len(sys.argv) > 2 else 180

# 玩家一路开着无敌，但不许站着不动：没有 Boss 时画李萨如曲线扫过全场
# （顺便把吸附、拖动 dragTarget、僚机跟随这些每帧都要跑的路径压上）；
# 出了 Boss 就绕到它下方往上打，否则它打不死，战局会一直卡在 Boss 关。
TICK = """
() => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    const t0 = performance.now();
    window.__soak = [];
    window.__soakIds = new WeakMap();     // 敌机 -> 编号，用来追踪「同一架连续多久在界外」
    window.__soakNext = 1;
    window.__soakRun = new Map();         // 编号 -> 连续在界外的采样数
    window.__soakTimer = setInterval(() => {
        const sec = (performance.now() - t0) / 1000;
        // 别让战局停在升级面板上：真实流程里那是要玩家点的，这里替他点第一项
        const lv = window.game.scene.getScene('LevelUp');
        if (lv && lv.scene.isActive() && lv.ready) lv.confirm(0);
        if (!s.scene.isActive()) s.scene.resume();
        p.invulnUntil = Number.MAX_SAFE_INTEGER;
        p.hp = p.maxHp;
        // 不起 Phaser 依赖：dragTarget 只需要是个带 set(x, y) 的点
        p.dragTarget = p.dragTarget || { x: p.x, y: p.y, set(x, y) { this.x = x; this.y = y; } };
        if (s.boss) p.dragTarget.set(s.boss.x, Math.min(1120, s.boss.y + 420));
        else p.dragTarget.set(360 + Math.sin(sec * 0.9) * 240, 640 + Math.sin(sec * 1.37) * 380);

        // 界外敌机要分开看，否则量出来的全是噪声：
        //   · 编队会退到入场边外最多 715 像素再飞进来，这段时间它在界外完全正常
        //   · 真正的漏洞是「永远进不来还一直在场外赖着」的（编队两翼落在入场边之外的那种），
        //     它们会一直占着池位，攒够了就再也刷不出新敌机
        // 所以分两种来判：进过场的出了 160 就该被回收（真 violation）；
        // 没进过场的要是停住不动了，也会在兜底框里赖着不走（spawn 完第一帧还没走起来不算，
        // 所以要求连着两次采样都在界外）。朝向不判 —— 横着擦过屏幕外时，
        // 和「指向世界中心」的方向本来就近乎垂直，判了全是误报
        let maxOut = 0;
        let stray = 0;
        let idle = 0;
        const strayInfo = [];
        const seenIds = new Set();
        for (const e of s.enemies.getChildren()) {
            if (!e.active) continue;
            const dx = Math.max(0, -e.x, e.x - 720);
            const dy = Math.max(0, -e.y, e.y - 1280);
            const d = Math.hypot(dx, dy);
            const id = window.__soakIds.get(e) || (window.__soakIds.set(e, window.__soakNext++), window.__soakNext - 1);
            seenIds.add(id);
            if (d <= 160) {
                window.__soakRun.delete(id);
                continue;
            }
            maxOut = Math.max(maxOut, d);
            const run = (window.__soakRun.get(id) || 0) + 1;
            window.__soakRun.set(id, run);
            const v = e.body.velocity;
            const sp = Math.hypot(v.x, v.y);
            const bad = e.entered || (run >= 2 && sp < 20);
            if (bad) {
                if (e.entered) stray++; else idle++;
                if (strayInfo.length < 3) strayInfo.push({ k: e.kind, en: e.entered, x: Math.round(e.x), y: Math.round(e.y), sp: Math.round(sp), d: Math.round(d) });
            }
        }
        for (const id of [...window.__soakRun.keys()]) if (!seenIds.has(id)) window.__soakRun.delete(id);
        window.__soak.push({
            sec: Math.round(sec),
            fps: +window.game.loop.actualFps.toFixed(1),
            stage: s.stage, level: s.level, phase: s.phase,
            enemies: s.activeEnemies().length,
            ebullets: s.activeEnemyBullets().length,
            pbullets: s.activePlayerBullets().length,
            orbs: s.xpOrbs.countActive(true),
            scenes: window.game.scene.getScenes(true).map((x) => x.scene.key).join('+'),
            maxOut: Math.round(maxOut), stray, idle, strayInfo, longest: Math.max(0, ...window.__soakRun.values()),
        });
    }, 500);
    return true;
}
"""

STOP = "() => { clearInterval(window.__soakTimer); return window.__soak; }"
LIMITS = """
() => {
    const s = window.game.scene.getScene('Game');
    return { enemies: s.enemies.maxSize, ebullets: s.eBullets.maxSize, pbullets: s.pBullets.maxSize, orbs: s.xpOrbs.maxSize };
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
    page.wait_for_timeout(1500)
    limits = page.evaluate(LIMITS)
    page.evaluate(TICK)
    page.wait_for_timeout(SECONDS * 1000)
    rows = page.evaluate(STOP)

    fps = [r["fps"] for r in rows]
    peak = lambda k: max(r[k] for r in rows)  # noqa: E731
    print(f"采样 {len(rows)} 次 / {SECONDS}s")
    print(f"  帧率 中位 {statistics.median(fps):.1f}  最低 {min(fps):.1f}")
    print(f"  峰值 敌机 {peak('enemies')}  敌弹 {peak('ebullets')}  我方弹 {peak('pbullets')}  晶体 {peak('orbs')}"
          f"   池上限 {limits['enemies']} / {limits['ebullets']} / {limits['pbullets']} / {limits['orbs']}")
    stages = sorted({r["stage"] for r in rows})
    print(f"  推进 第 {rows[0]['stage']} 关 -> 第 {rows[-1]['stage']} 关（走过 {stages}），"
          f"等级 {rows[0]['level']} -> {rows[-1]['level']}")
    print(f"  阶段 出现过 {sorted({r['phase'] for r in rows})}")

    full = [r for r in rows if r["enemies"] >= limits["enemies"] or r["ebullets"] >= limits["ebullets"]
            or r["pbullets"] >= limits["pbullets"] or r["orbs"] >= limits["orbs"]]
    stray = [r for r in rows if r["stray"]]
    idle = [r for r in rows if r["idle"]]
    # 升级面板在后半段连着两次以上还在，才算卡住（正常一次也就一两百毫秒）
    frozen, run = [], 0
    for r in rows:
        run = run + 1 if "LevelUp" in r["scenes"] else 0
        if run >= 3:
            frozen.append((r["sec"], r["scenes"], r["phase"]))
    # 界外最远 800 是设计内的（编队最远退到入场边外 715），再远就是漏网
    far = peak("maxOut")
    print(f"  池子见底 {len(full)} 次  |  升级面板卡住 {len(frozen)} 次")
    print(f"  界外最远 {far} px（编队入场退距上限 715，兜底边界 800）"
          f"  |  进过场还留在界外 {len(stray)} 次  |  没进场却停在场外 {len(idle)} 次"
          f"  |  同一架连续界外最久 {peak('longest') * 0.5:.1f}s")
    for what, hit in (("s", stray), ("i", idle)):
        if hit:
            print(f"   例[{what}]:", [(r["sec"], r["stray"], r["idle"], r["phase"], r["strayInfo"]) for r in hit[:3]])
    if frozen:
        print("   例:", frozen[:3])
    print("  ERRORS:", errs[:5] if errs else "none")
    browser.close()


"""新敌机的验证脚本：
  狙击机（蓄力闪烁 + 枪线 + 快弹）、旋舞机（螺旋撒弹）、轰炸机（环形弹幕）、
  分裂球（打爆裂成两架小机）、自爆机（有限转弯率追踪 / 撞上同归于尽 / 燃料烧完自爆），
  关数上去之后场上的敌机 / 敌弹密度，以及难度曲线本身（血条与攻击频率随关数怎么涨）
用法： python scripts/enemy_test.py [URL]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"

CLEAR = """
() => {
    const s = window.game.scene.getScene('Game');
    // 前面的探针里玩家会自动开火，打死东西就掉经验、就会弹升级面板。
    // 没人替他点的话面板一直挂着，游戏场景是暂停的 —— 后面的探针全在暂停的场景里空跑
    // （量出来的密度只有头几秒的数据），攒多了还会把页面拖垮。
    // 所以等级、经验、待升级数一起清干净，再把场景叫醒
    if (window.game.scene.isActive('LevelUp')) window.game.scene.stop('LevelUp');
    if (!s.scene.isActive()) s.scene.resume();
    s.pendingLevels = 0;
    s.xp = 0;
    s.level = 1;
    s.waveCount = 99999;
    s.nextWaveAt = Number.MAX_SAFE_INTEGER;
    s.bossAt = Number.MAX_SAFE_INTEGER;
    s.phase = 'waves';
    // Boss 也要清掉：留着的话它会一直出招，后面每个探针都泡在它的弹幕里，
    // 池子被它占着，量出来的密度全是上一段探针的残留
    s.bossColliders.forEach(c => c.destroy());
    s.bossColliders = [];
    if (s.boss) { s.boss.destroy(); s.boss = undefined; }
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    s.activeEnemyBullets().forEach(b => b.kill());
    for (const g of ['xpOrbs', 'powerups']) s[g].getChildren().forEach(o => o.active && o.disableBody(true, true));
    // 玩家的装备也要复位：上一段探针放着他自己飞了 25 秒，路上会捡到武器 / 护盾 / 急速 /
    // 无敌星，还会升级点技能。不清掉的话每个探针都从**不同的配置**起跑 ——
    // 密度读数跟探针顺序有关（技能多点一档，清怪快了，场上就没那么挤），
    // 而「撞上自爆机掉不掉血」会被路上捡的护盾吃掉（hurtPlayer 先扣盾、那一下不掉血，
    // 实测就是这么量出「撞上了但掉血 0」的）
    s.player.shield = 0;
    s.player.weapon = 1;
    s.player.rapidUntil = 0;
    s.player.starUntil = 0;
    s.player.dashUntil = 0;
    Object.keys(s.player.skills).forEach((k) => { s.player.skills[k] = 0; });
    s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
    s.player.hp = s.player.maxHp;
    s.thaw();
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

# 让导演按指定关数正常刷怪，量峰值密度、出现过的机型，以及这个密度下的场景帧耗时
DENSITY = """
([stage, ms]) => {
    const s = window.game.scene.getScene('Game');
    s.stage = stage;
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
        // 采样途中玩家照样在开火、照样升级。没人点面板的话场景就暂停了，
        // 暂停的场景不 step —— 样本会被悄悄截短（25 秒只量到四五秒的峰值，
        // frames 远小于 25 秒该有的帧数就是这个），量出来的密度偏低。
        // 这里替他点掉，让导演在这 25 秒里一直转
        if (s.pendingLevels > 0 || window.game.scene.isActive('LevelUp')) {
            if (window.game.scene.isActive('LevelUp')) window.game.scene.stop('LevelUp');
            s.pendingLevels = 0;
            if (!s.scene.isActive()) s.scene.resume();
        }
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

# 难度曲线：同一套公式换个关数会变成什么样。
# 血条和攻击频率都从「真放一架出来、真数它打了几发」量，不在脚本里重算公式 ——
# 那等于自己证明自己，代码里改了曲线这里照样通过
CURVE = """
(stages) => {
    const s = window.game.scene.getScene('Game');
    const row = (stage) => {
        s.stage = stage;
        s.waveCount = 0;
        s.phase = 'waves';
        s.nextWaveAt = 0;
        s.runDirector(s.time.now);
        const waveGap = Math.round(s.nextWaveAt - s.time.now);
        const waves = s.wavesThisStage;
        s.activeEnemies().forEach(e => e.disableBody(true, true));
        const e = s.enemies.get(360, 300);
        e.spawn('drone', 360, 300, s.diff);
        const droneHp = e.hp;
        e.spawn('tank', 360, 300, s.diff);
        const tankHp = e.hp;
        e.disableBody(true, true);
        return { stage, diff: +s.diff.toFixed(2), droneHp, tankHp, waveGap, waves };
    };
    return stages.map(row);
}
"""

# 攻击频率：放一架射手悬停在那儿，数它两轮弹之间隔多久（不同关数各量一段）
FIRE_RATE = """
(stages) => {
    const s = window.game.scene.getScene('Game');
    const one = (stage) => new Promise((resolve) => {
        s.stage = stage;
        s.activeEnemies().forEach(e => e.disableBody(true, true));
        s.activeEnemyBullets().forEach(b => b.kill());
        const e = s.enemies.get(360, 400);
        e.spawn('shooter', 360, 400, s.diff);
        e.hp = 99999;
        e.entered = true;              // 直接当成已进场，省得等它飞进来
        const shots = [];
        const orig = s.fireEnemyAimed.bind(s);
        s.fireEnemyAimed = (...a) => { shots.push(performance.now()); orig(...a); };
        setTimeout(() => {
            s.fireEnemyAimed = orig;
            e.disableBody(true, true);
            const gaps = shots.slice(1).map((t, i) => t - shots[i]);
            resolve({
                stage,
                volleys: shots.length,
                gap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b) / gaps.length) : null,
            });
        }, 5000);
    });
    return stages.reduce((chain, st) => chain.then((acc) => one(st).then((r) => acc.concat(r))), Promise.resolve([]));
}
"""

# 自爆机：三种情形各量一遍。数值都从场上真发生的事里取：
#   hunt  —— 玩家站着不动，它该追上来撞上（掉血 20）、引爆、不给分
#   dodge —— 站着让它贴到 300 像素，然后按**真实速度横着跑**（不是瞬移），
#            看转弯半径是不是真的把它甩开：转弯率有限的话它会拐一个大弯冲过头
#   fuel  —— 一直把它甩到对面去，它该在引信烧完时自己炸掉
RAMMER = """
([mode, ms]) => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    const SPEED = 460;                 // 玩家的真实速度，瞬移等于开挂，量不出跑不跑得掉
    const W = s.physics.world.bounds.width;   // 逻辑世界宽度（短边固定 720，长边按窗口比例变）
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    s.activeEnemyBullets().forEach(b => b.kill());
    p.setPosition(W / 2, 1000);
    p.invulnUntil = mode === 'fuel' ? Number.MAX_SAFE_INTEGER : 0;
    p.hp = p.maxHp;
    const e = s.enemies.get(W / 2, 60);
    e.spawn('rammer', W / 2, 60, 1);
    e.hp = 99999;
    const t0 = performance.now();
    const score0 = s.score;
    const xp0 = s.xpOrbs.countActive(true);
    const hp0 = p.hp;
    const clampX = (x) => Math.max(40, Math.min(W - 40, x));
    let lockAt = 0, detAt = 0, minD = 1e9, minRun = 1e9, far = 0, spd = 0, rate = 0;
    let juked = false, runTo = 0, prevA = null;
    const origDet = s.detonate.bind(s);
    s.detonate = (x) => { if (x === e && !detAt) detAt = performance.now() - t0; origDet(x); };
    // 转弯率按**帧**量，不按采样间隔量：一帧转过的角度会落在两次 25 毫秒采样之间，
    // 拿它除以采样间隔，得到的瞬时值能到设计值的两倍（实测抓到过 181°/秒，设计是 92）
    const onStep = () => {
        if (!e.active) return;
        const a = e.moveAngle;
        if (prevA !== null) {
            const turned = Math.abs(Math.atan2(Math.sin(a - prevA), Math.cos(a - prevA)));
            rate = Math.max(rate, turned / (s.game.loop.delta / 1000));
        }
        prevA = a;
    };
    s.events.on('postupdate', onStep);
    const iv = setInterval(() => {
        if (!e.active) return;
        const now = performance.now();
        if (e.mode === 1 && !lockAt) lockAt = now - t0;
        const d = Math.hypot(p.x - e.x, p.y - e.y);
        if (mode === 'dodge') {
            // 贴到 300 像素之内才开始跑 —— 离得远时挪一下根本不算甩
            if (!juked && d < 300) { juked = true; runTo = p.x < W / 2 ? W - 60 : 60; }
            if (juked) {
                const step = Math.min(SPEED * 0.025, Math.abs(runTo - p.x));
                p.setPosition(clampX(p.x + Math.sign(runTo - p.x) * step), 1000);
                if (Math.abs(p.x - runTo) < 2) runTo = runTo === 60 ? W - 60 : 60;
                minRun = Math.min(minRun, d);
            }
        } else if (mode === 'fuel') {
            if (d < 420) p.setPosition(p.x < W / 2 ? W - 60 : 60, 1000);
            far = Math.max(far, d);
        }
        minD = Math.min(minD, d);
        const v = e.body.velocity;
        const v2 = Math.hypot(v.x, v.y);
        if (v2 > 1) spd = Math.max(spd, v2);
    }, 25);
    return new Promise((resolve) => setTimeout(() => {
        clearInterval(iv);
        s.events.off('postupdate', onStep);
        s.detonate = origDet;
        resolve({
            mode,
            锁定ms: Math.round(lockAt),
            引爆ms: detAt ? Math.round(detAt) : null,
            转弯率max: Math.round(rate * 180 / Math.PI),
            极速: Math.round(spd),
            最近距离: mode === 'fuel' ? null : Math.round(minD),
            拉开后最近: mode === 'dodge' ? Math.round(minRun) : null,
            甩开距离: mode === 'fuel' ? Math.round(far) : null,
            掉血: hp0 - p.hp,
            得分: s.score - score0,
            晶体: s.xpOrbs.countActive(true) - xp0,
            还活着: e.active,
        });
    }, ms));
}
"""

# 把一架某机型摆到玩家跟前，用来截图看外形（以及它贴着玩家时读不读得出来）
SHOW = """
(kind) => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    const e = s.enemies.get(p.x, p.y - 190);
    e.spawn(kind, p.x, p.y - 190, s.diff);
    e.hp = 99999;
    return e.texture.key;
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

    # 难度曲线：一张表看关数上去之后血条、攻击频率、波次密度各变成什么样
    print("难度曲线:")
    for r in page.evaluate(CURVE, [1, 3, 5, 8, 12, 20]):
        print(f"    第 {r['stage']:>2} 关  强度 ×{r['diff']:<5} 杂兵血 {r['droneHp']}  重装血 {r['tankHp']:>2}"
              f"  每关 {r['waves']:>2} 波  波间隔 {r['waveGap']}ms")
    page.evaluate(CLEAR)
    print("射手攻击间隔:", page.evaluate(FIRE_RATE, [1, 3, 5, 8, 12, 20]))

    page.evaluate(CLEAR)
    # 密度是「这一段里最挤的一拍」，所以样本时长必须是真的 25 秒。
    # 场景中途被暂停的话 step 就不跑了，量出来的峰值偏低而且看不出来 —— 这里把
    # 实际量到的帧数摆出来，帧数对不上就直接标出来（脚本里的自动点面板就是为了它）
    want = 25000 / (1000 / 60)
    # 每关连量三段再取最挤的一次：单段 25 秒的峰值抖得厉害 —— 波型是随机抽的，
    # 抽到 swarm（三十来架）和抽到 tank（三架重装）差着数量级。同一份代码前后两次跑，
    # 第 3 关量出过 114 架，也量出过 53 架。池子要按**最坏情况**开，不是按这一次的手气开，
    # 所以取三段里的最大值，并把各次的数一起摆出来，让抖动本身看得见
    REPS = 3
    for st in (3, 8, 12, 20):
        reps = []
        for _ in range(REPS):
            page.evaluate(CLEAR)
            reps.append(page.evaluate(DENSITY, [st, 25000]))
        short = [r["frames"] for r in reps if r["frames"] < want * 0.8]
        worst = lambda k: max(r[k] for r in reps)  # noqa: E731
        med = lambda k: sorted(r[k] for r in reps)[len(reps) // 2]  # noqa: E731
        print(f"第 {st:>2} 关密度（{REPS}×25 秒，取最挤的一次）:")
        print(f"     敌机峰值 {worst('enemies'):>3} {[r['enemies'] for r in reps]}"
              f"   敌弹峰值 {worst('bullets'):>3} {[r['bullets'] for r in reps]}"
              f"   波数 {[r['waves'] for r in reps]}")
        print(f"     p50 {med('p50')}ms  p95 {worst('p95')}ms  峰值 {worst('max')}ms"
              f"  帧率 {min(r['fps'] for r in reps)}  帧数 {[r['frames'] for r in reps]}"
              + (f"  ← 样本被截断 {short}" if short else ""))
        if st == 3:
            page.screenshot(path="shots/09_swarm.png")   # 趁场上还满着，留一张密度截图
    page.evaluate(CLEAR)
    page.evaluate(SHOW, "rammer")
    page.wait_for_timeout(900)
    page.screenshot(path="shots/14_rammer.png")

    # 自爆机引信是 5.2 秒，所以每种情形都要跑到 6 秒往上，才看得到它最后是怎么收场的
    for mode, ms in (("hunt", 7000), ("dodge", 8000), ("fuel", 8000)):
        page.evaluate(CLEAR)
        print(f"自爆机 {mode}:", page.evaluate(RAMMER, [mode, ms]))

    print("ERRORS:", errs[:5] if errs else "none")
    browser.close()

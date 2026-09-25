"""打击感与节奏的验证脚本（都是「手感」这类不好截图、只能量出来的东西）：
  顿帧（物理 / 补间被按住多久、有没有松开）、受击红晕与残血呼吸、
  换边刷怪、每 5 波一次的喘息、升级重随、Boss 出招前摇，
  以及转向 —— 瞄准误差该是 0、机身单帧步进该均匀（13.4° ≈ 角速度 14 rad/s × 一帧）
用法： python scripts/feel_test.py [URL] [shots]
"""
import math
import os
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "shots"
os.makedirs(SHOTS, exist_ok=True)

CLEAR = """
() => {
    const s = window.game.scene.getScene('Game');
    // 前面的探针会打死东西、掉经验、弹升级面板，把战斗场景暂停掉；
    // 这里连等级一起清干净，否则后面的探针全是在暂停的场景里空跑
    if (window.game.scene.isActive('LevelUp')) window.game.scene.stop('LevelUp');
    if (!s.scene.isActive()) s.scene.resume();
    s.pendingLevels = 0;
    s.xp = 0;
    s.level = 1;
    s.waveCount = 99999;
    s.nextWaveAt = Number.MAX_SAFE_INTEGER;
    s.bossAt = Number.MAX_SAFE_INTEGER;
    s.phase = 'waves';
    s.activeEnemies().forEach(e => e.disableBody(true, true));
    s.activeEnemyBullets().forEach(b => b.kill());
    // 打掉 Boss 时结算会把一地的经验晶体全吸过来，不清掉的话后面每次探针都会被
    // 剩下的晶体喂出一次升级，战斗场景就一直是暂停的
    for (const g of ['xpOrbs', 'powerups']) s[g].getChildren().forEach(o => o.active && o.disableBody(true, true));
    s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
    s.player.hp = s.player.maxHp;
    s.thaw();
}
"""

# 顿帧：打爆重装机 / 放炸弹，各看按住多久、之后有没有松开
FREEZE = """
([what, ms]) => {
    const s = window.game.scene.getScene('Game');
    const w = s.physics.world;
    s.activeEnemyBullets().forEach(b => b.kill());
    const probe = () => ({ phys: w.isPaused, tweens: s.tweens.paused });
    const before = probe();
    if (what === 'tank') {
        const e = s.enemies.get(360, 300);
        e.spawn('tank', 360, 300, 1);
        s.hitEnemy(e, 99999);
    } else {
        s.bombs = 3;
        s.useBomb();
    }
    const during = probe();
    const mark = Math.round(s.freezeUntil - s.time.now);
    return new Promise((resolve) => setTimeout(() => resolve({
        what, before, during, mark, after: probe(),
        // 松开之后物理要是还停着，玩家就再也动不了了
        recovered: !w.isPaused && !s.tweens.paused,
    }), ms));
}
"""

# 打掉 Boss 也该顿一下，而且不能把「玩家阵亡后永久停物理」那一步顺手解开
BOSSKILL = """
() => {
    const s = window.game.scene.getScene('Game');
    const w = s.physics.world;
    s.phase = 'boss-wait';
    s.bossAt = 0;
    s.startBoss();
    return new Promise((resolve) => {
        const wait = setInterval(() => {
            if (!s.boss) return;
            clearInterval(wait);
            s.hitBoss(1e6);
            const snapped = { phys: w.isPaused, tweens: s.tweens.paused, until: Math.round(s.freezeUntil - s.time.now) };
            setTimeout(() => resolve({
                snapped, phase: s.phase,
                recovered: !w.isPaused && !s.tweens.paused,
            }), 400);
        }, 100);
    });
}
"""

# 假 Boss：交给导演按正常流程放出来，数它的前摇和出招
TELEGRAPH = """
(ms) => {
    const s = window.game.scene.getScene('Game');
    s.phase = 'boss-wait';
    s.bossAt = 0;
    return new Promise((resolve) => {
        let boss = null;
        const hit = [];
        let teleAt = 0;
        let scaled = 0;
        let teleFrames = 0;
        let raged = false;
        const trace = [];
        let lastLog = 0;
        const iv = setInterval(() => {
            boss = s.boss;
            const n = performance.now();
            if (n - lastLog > 250) {
                lastLog = n;
                const scenes = window.game.scene.getScenes(true).map(x => x.scene.key).join('+');
                trace.push(`${s.phase}|${s.scene.isActive() ? 'on' : 'off'}|lvl${s.pendingLevels}|${scenes}`);
            }
            if (!boss) return;
            if (boss.enraged) raged = true;
            if (!boss.__wrapped) {
                boss.__wrapped = true;
                const orig = boss.attack.bind(boss);
                boss.attack = (kind, t, g) => { hit.push({ kind, gap: t - teleAt }); return orig(kind, t, g); };
            }
            if (boss.telegraphUntil > 0) {
                if (!teleAt) teleAt = boss.telegraphUntil - 340;
                if (boss.scaleX > 1.01) scaled++;
                teleFrames++;
            } else {
                teleAt = 0;
            }
        }, 20);
        setTimeout(() => {
            clearInterval(iv);
            resolve({
                attacks: hit.length,
                kinds: hit.map(h => h.kind),
                gaps: hit.map(h => Math.round(h.gap)),
                teleFrames, scaledFrames: scaled, raged,
                hp: boss ? Math.round(boss.hp) : null,
                trace: trace.slice(0, 2).join(' ') + '  …  ' + trace.slice(-2).join(' '),
            });
        }, ms);
    });
}
"""

# 擦弹：判定圈内算、圈外不算、同一颗只算一次、擦完连击窗口要续上、判定点跟着跳
GRAZE = """
() => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    p.setPosition(360, 700);
    s.combo = 5;                                // 倍率还是 1（10 次击杀才涨一级），分数好算
    s.comboUntil = s.time.now + 100;
    s.grazeCount = 0;
    const before = { count: s.grazeCount, score: s.score };
    // 速度 0：子弹悬在原地，好让「同一颗不会连着几帧重复计数」也一并测到
    const shoot = (dx) => s.fireEnemy(p.x + dx, p.y, 0, 0, 'ebullet');
    // 判定半径 26、碰撞半径约 10：20 在圈内（算擦弹），60 在圈外（不算）
    shoot(20);
    shoot(60);
    return wait(40).then(() => {
        // 判定点该在擦到的那一刻涨起来（跳动时长 140ms），跳完收回原大小
        const pulse = +p.core.scaleX.toFixed(2);
        const one = { count: s.grazeCount, score: s.score - before.score, comboUntil: Math.round(s.comboUntil - s.time.now) };
        return wait(200).then(() => {
            const settled = +p.core.scaleX.toFixed(2);
            // 机身一旦收起来（阵亡走的就是这条路），判定点不能还留在场上
            p.setVisible(false);
            return wait(60).then(() => {
                const hiddenWithShip = !p.core.visible;
                p.setVisible(true);
                return {
                    one, again: { count: s.grazeCount, score: s.score - before.score },
                    pulse, settled, hiddenWithShip,
                    coreAtShip: Math.round(Math.hypot(p.core.x - p.x, p.core.y - p.y)),
                };
            });
        });
    });
}
"""

# 转向：这两件事现在是分开的，所以要分开量。
#   · 瞄准（子弹打哪）——按下方向的那一帧就该到位，误差必须是 0
#   · 机身转角（看得见的那部分）——平滑地追上去，每帧走一小步、方向单一、走到位就停
# 键盘只有八个方向，如果机身也跟着瞬移，看起来就是「只有八个方向、指哪跳哪」；
# 反过来把机身转速调慢又会把子弹一起拖住。所以这里量两个数：瞄准误差、机身单帧步进。
TURN_REC = """
() => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    const sys = s.sys, orig = sys.step.bind(sys);
    const samples = [];
    let rec = true;
    const set = (k, on) => { s.keys[k].isDown = on; };
    const clear = () => ['W', 'A', 'S', 'D'].forEach((k) => set(k, false));
    sys.step = (t, d) => {
        orig(t, d);
        if (rec) samples.push({ r: p.rotation, a: p.aim, d, seg: s.__seg || 'start' });
    };
    // 一段按一个方向，每段都够长（机身该转完并停住）；最后一段是 180° 掉头
    const plan = [['D', 700], ['W', 700], ['A', 700], ['D', 700], ['A', 800]];
    let i = 0;
    const next = () => {
        if (i >= plan.length) {
            rec = false;
            sys.step = orig;
            clear();
            window.__turnSamples = samples;
            return;
        }
        const [k, ms] = plan[i++];
        clear();
        set(k, true);
        s.__seg = k + i;
        setTimeout(next, ms);
    };
    clear();
    s.__seg = 'start';
    next();
    return true;
}
"""
# 每段按的方向 → 期望的瞄准角（Phaser：0 = 右，顺时针为正，所以上 = -90°）
TURN_SEG = {"D1": 0, "W2": -90, "A3": 180, "D4": 0, "A5": 180}


SIDES = """
(n) => {
    const s = window.game.scene.getScene('Game');
    s.stage = 3;
    s.lastSide = 'top';
    const count = (side) => { s.lastSide = side; const c = {}; for (let i = 0; i < n; i++) { const p = s.pickSide(); c[p] = (c[p] || 0) + 1; } return c; };
    const flip = count('top');
    // 第 1 关不换边，应该还是原来的权重
    s.stage = 1;
    const early = count('top');
    // 真刷一波，看 lastSide 有没有跟着更新
    s.stage = 3;
    s.lastSide = 'left';
    s.spawnWave();
    return { flip, early, afterWave: s.lastSide };
}
"""

# 喘息：第 5、10 波那一拍的间隔要比平常长
BREATH = """
() => {
    const s = window.game.scene.getScene('Game');
    const t = s.time.now;
    const at = (waveCount) => {
        s.stage = 1;
        s.waveCount = waveCount;
        s.phase = 'waves';
        s.nextWaveAt = 0;
        s.runDirector(t);
        const gap = Math.round(s.nextWaveAt - t);
        s.activeEnemies().forEach(e => e.disableBody(true, true));
        return gap;
    };
    return { w2: at(2), w3: at(3), w4: at(4), w5: at(5), w10: at(9), w11: at(10) };
}
"""

# 重随：次数上限、重掷换不换选项、开新局有没有复位
REROLL = """
() => {
    const s = window.game.scene.getScene('Game');
    const clicks = [s.tryReroll(), s.tryReroll(), s.tryReroll()];
    const left = s.rerolls;
    s.rerolls = 2;
    s.pendingLevels = 1;
    return { clicks, left };
}
"""

REROLL_UI = """
() => {
    const s = window.game.scene.getScene('Game');
    const lv = window.game.scene.getScene('LevelUp');
    const ids = lv ? lv.choices.map(c => c.id) : null;
    const before = s.rerolls;
    return new Promise((resolve) => setTimeout(() => {
        resolve({ active: !!lv && lv.scene.isActive(), before, ids });
    }, 600));
}
"""

# 升级选项的权重：点过的技能该更容易再被抽到，不然一局什么线都成不了型
ROLL = """
(n) => {
    const s = window.game.scene.getScene('Game');
    s.player.skills.leech = 2;
    const seen = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const step = (i) => {
        if (i >= n) return Promise.resolve(seen);
        s.pendingLevels = 1;
        return wait(45).then(() => {
            const lv = window.game.scene.getScene('LevelUp');
            if (lv && lv.choices) lv.choices.forEach(c => { seen[c.id] = (seen[c.id] || 0) + 1; });
            window.game.scene.stop('LevelUp');
            if (!s.scene.isActive()) s.scene.resume();
            return wait(20).then(() => step(i + 1));
        });
    };
    return step(0).then((r) => {
        s.player.skills.leech = 0;
        return { rounds: n, picked: r };
    });
}
"""

def turn_report(samples):
    """转向分两件事算：瞄准误差（子弹打哪，该是 0）和机身单帧步进（看得见的那部分）。"""
    deg = lambda r: r * 180 / math.pi  # noqa: E731
    norm = lambda a: math.atan2(math.sin(a), math.cos(a))  # noqa: E731
    order, segs = [], {}
    for sm in samples:
        if sm["seg"] not in segs:
            segs[sm["seg"]] = []
            order.append(sm["seg"])
        segs[sm["seg"]].append(sm)
    rows = []
    for seg in order:
        want = TURN_SEG.get(seg)
        if want is None:
            continue
        rows.append((seg, segs[seg], math.radians(want)))
    out = {}
    aim_max = 0.0
    rate_max = 0.0
    steps = []
    worst = []
    lag_peak = 0.0
    settles = []
    for seg, rs, want in rows:
        aim = [abs(deg(norm(s["a"] - want))) for s in rs]
        # 机身离目标还差多少（机身角 = 瞄准角 + 90°，贴图朝上）
        lag = [abs(deg(norm(s["r"] - (want + math.pi / 2)))) for s in rs]
        aim_max = max(aim_max, max(aim))
        lag_peak = max(lag_peak, max(lag))
        # 单帧步进：跳过每段头一帧（那一帧里含上一段的方向切换）。
        # 按角速度看，不按角度看 —— 偶尔一帧卡顿（delta 大）会让角度很大，
        # 那是掉帧不是「瞬移」，角速度才反映机身实际是怎么转的
        for i in range(1, len(rs)):
            step = abs(norm(rs[i]["r"] - rs[i - 1]["r"]))
            if step > math.radians(0.2):
                steps.append(deg(step))
            rate = deg(step) / max(rs[i]["d"], 1) * 1000
            rate_max = max(rate_max, rate)
            worst.append((seg, round(deg(step), 1), rs[i]["d"]))
        # 转到位要几帧（进入 2° 以内就不再动）
        settle = next((i for i, v in enumerate(lag) if v < 2), None)
        if settle is not None:
            settles.append((seg, settle + 1))
    steps.sort()
    worst.sort(key=lambda w: -w[1] / max(w[2], 1))
    return {
        "瞄准误差max(度)": round(aim_max, 2),          # 按哪打哪，滞后必须是 0
        "机身滞后峰值(度)": round(lag_peak),            # 换向那一瞬差多少
        "机身转速 max(度/秒)": round(rate_max),
        "单帧步进 中位(度)": round(steps[len(steps) // 2], 1) if steps else 0,
        "转到位帧数": settles,                          # 每段花了多少帧追平
        "最猛三帧(段, 步进, delta)": worst[:3],
    }

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

    for what, ms in [("tank", 300), ("bomb", 300)]:
        page.evaluate(CLEAR)
        print(f"顿帧 {what}:", page.evaluate(FREEZE, [what, ms]))

    page.evaluate(CLEAR)
    print("顿帧 打掉Boss:", page.evaluate(BOSSKILL))

    page.evaluate(CLEAR)
    print("换边:", page.evaluate(SIDES, 400))
    page.evaluate(CLEAR)
    print("喘息间隔:", page.evaluate(BREATH))

    # 受击红晕：挨打的那一刻暗角该画出来，之后收干净。
    # 暗角是每帧重画的，得等下一帧再读 commandBuffer 才看得到
    page.evaluate(CLEAR)
    vig = page.evaluate(
        """() => {
        const s = window.game.scene.getScene('Game');
        const cmds = () => s.vignette.commandBuffer.length;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const idle = cmds();
        s.hurtPlayer(12);
        return wait(60).then(() => {
            const hit = cmds();
            s.player.hp = 25;
            return wait(60).then(() => {
                const lowHp = cmds();
                s.player.hp = s.player.maxHp;
                return wait(700).then(() => ({ idle, hit, lowHp, faded: cmds() }));
            });
        });
    }"""
    )
    print("受击暗角:", vig)
    # 残血那张单独截一张，红边得看得见
    page.evaluate("() => { window.game.scene.getScene('Game').player.hp = 22; }")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SHOTS}/10_vignette.png")
    page.evaluate(CLEAR)

    page.evaluate(CLEAR)
    print("擦弹:", page.evaluate(GRAZE))
    page.screenshot(path=f"{SHOTS}/13_graze.png")
    page.evaluate(CLEAR)

    page.evaluate(CLEAR)
    page.evaluate(TURN_REC)
    page.wait_for_timeout(4200)  # 五段，每段 0.7~0.8 秒
    print("转向:", turn_report(page.evaluate("() => window.__turnSamples")))
    page.evaluate(CLEAR)

    print("Boss 前摇:", page.evaluate(TELEGRAPH, 14000))
    print("升级权重:", page.evaluate(ROLL, 100))

    page.evaluate(CLEAR)
    print("重随次数:", page.evaluate(REROLL))
    page.wait_for_timeout(700)
    print("重随面板:", page.evaluate(REROLL_UI))
    page.screenshot(path=f"{SHOTS}/11_reroll.png")
    page.keyboard.press("r")
    page.wait_for_timeout(800)
    after = page.evaluate(
        """() => {
        const s = window.game.scene.getScene('Game');
        const lv = window.game.scene.getScene('LevelUp');
        return { rerolls: s.rerolls, ids: lv ? lv.choices.map(c => c.id) : null, active: !!lv && lv.scene.isActive() };
    }"""
    )
    print("按 R 之后:", after)
    page.screenshot(path=f"{SHOTS}/12_reroll_after.png")

    print("ERRORS:", errs[:5] if errs else "none")
    browser.close()

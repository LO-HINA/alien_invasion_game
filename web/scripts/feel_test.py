"""打击感与节奏的验证脚本（都是「手感」这类不好截图、只能量出来的东西）：
  顿帧（物理 / 补间被按住多久、有没有松开）、受击红晕与残血呼吸、
  换边刷怪、每 5 波一次的喘息、升级重随、Boss 出招前摇
用法： python scripts/feel_test.py [URL] [shots]
"""
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

# 换边：stage 2 之后，多数波次该从上一波的对侧来
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

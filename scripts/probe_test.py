"""干净地验证过关结算的「全吸」：场上只留经验晶体、没有 Boss、且不会升级打断，
然后调用 stageClear，看晶体是不是全部飞到玩家身上被收走。
用法： python scripts/probe_test.py [URL]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"

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

    setup = page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            // 不退场、不刷怪、不升级，只留下「掉落物会不会被吸走」这一件事
            s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
            s.level = 500;                 // xpToNext 变得很大，不会触发升级暂停
            s.waveCount = 99999;           // 杂兵阶段直接结束
            s.nextWaveAt = Number.MAX_SAFE_INTEGER;
            s.bossAt = Number.MAX_SAFE_INTEGER;
            s.phase = 'waves';
            s.activeEnemies().forEach(e => e.disableBody(true, true));
            s.xpOrbs.getMatching('active', true).forEach(o => o.disableBody(true, true));
            s.powerups.getMatching('active', true).forEach(o => o.disableBody(true, true));
            // 玩家待在地图左下角，晶体全丢在右上角，相距很远
            s.player.setPosition(120, 1100);
            s.dragTarget = undefined;
            s.player.dragTarget = undefined;
            const drops = [];
            for (let i = 0; i < 12; i++) {
                const x = 480 + (i % 4) * 50;
                const y = 120 + Math.floor(i / 4) * 60;
                s.dropXp(x, y, 5);
                drops.push([x, y]);
            }
            return { orbs: s.xpOrbs.getMatching('active', true).length, player: [s.player.x, s.player.y] };
        }"""
    )
    print("布置完毕:", setup)

    page.wait_for_timeout(1500)
    idle = page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            const orbs = s.xpOrbs.getMatching('active', true);
            return {
                count: orbs.length,
                moved: orbs.filter(o => Math.abs(o.body.velocity.x) + Math.abs(o.body.velocity.y) > 1).length,
                nearest: Math.round(Math.min(...orbs.map(o => Math.hypot(o.x - s.player.x, o.y - s.player.y)))),
                xp: Math.round(s.xp),
            };
        }"""
    )
    print("没走近时(应该原地不动、不减少):", idle)

    page.evaluate("() => window.game.scene.getScene('Game').stageClear()")
    page.wait_for_timeout(500)
    moving = page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            const orbs = s.xpOrbs.getMatching('active', true);
            return { count: orbs.length, moving: orbs.filter(o => Math.abs(o.body.velocity.x) + Math.abs(o.body.velocity.y) > 1).length };
        }"""
    )
    print("stageClear 刚调用(应该全部在飞):", moving)

    for t in (1000, 2000, 3000):
        page.wait_for_timeout(1000)
        print(
            f"  +{t}ms:",
            page.evaluate(
                """() => {
                    const s = window.game.scene.getScene('Game');
                    return { orbs: s.xpOrbs.getMatching('active', true).length, xp: Math.round(s.xp), pending: s.pendingLevels };
                }"""
            ),
        )

    print("ERRORS:", errs if errs else "none")
    browser.close()

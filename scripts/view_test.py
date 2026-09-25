"""看朝向和 UI 的截图脚本：
  菜单 / 玩法小窗 / 四个方向飞行时的机头与弹道 / 右上角暂停按钮 / 横屏版菜单
用法： python scripts/view_test.py [URL]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
OUT = "shots"

WORLD = """
() => {
    const c = document.querySelector('canvas').getBoundingClientRect();
    const s = window.game.scale;
    return {
        left: c.left, top: c.top,
        sx: c.width / s.gameSize.width, sy: c.height / s.gameSize.height,
        w: s.gameSize.width, h: s.gameSize.height,
    };
}
"""

STATE = """
() => {
    const s = window.game.scene.getScene('Game');
    const p = s.player;
    // 机头方向 = 子弹速度方向。反弹过的子弹方向会反过来，所以要求「机头够快」不打折扣：
    // 先把子弹清空、机身挪回场中央，等一小会儿再读，这时场上的子弹都还是刚出膛的。
    const bs = s.activePlayerBullets().map(b => ({
        a: +Math.atan2(b.body.velocity.y, b.body.velocity.x).toFixed(2),
        d: +Math.hypot(b.x - p.x, b.y - p.y).toFixed(0),
    })).sort((x, y) => x.d - y.d);
    const norm = (v) => Math.atan2(Math.sin(v), Math.cos(v));
    const hit = bs.filter(a => Math.abs(norm(a.a - p.aim)) < 0.3).length;
    return {
        aim: +p.aim.toFixed(2),
        heading: +p.rotation.toFixed(2),
        vel: [+p.body.velocity.x.toFixed(0), +p.body.velocity.y.toFixed(0)],
        muzzle: bs[0] || null,
        bullets: `${hit}/${bs.length} 与机头同向`,
        turret: [+(p.turret.x - p.x).toFixed(0), +(p.turret.y - p.y).toFixed(0)],
    };
}
"""


def world_click(page, wx, wy):
    m = page.evaluate(WORLD)
    page.mouse.click(m["left"] + wx * m["sx"], m["top"] + wy * m["sy"])
    return m


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 720, "height": 1280})
    errs = []
    page.on("pageerror", lambda e: errs.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errs.append(m.text))
    page.goto(URL)
    page.wait_for_timeout(2500)

    page.screenshot(path=f"{OUT}/01_menu.png")
    m = page.evaluate(WORLD)
    print("世界:", {k: round(v, 2) if isinstance(v, float) else v for k, v in m.items()})

    # 玩法小窗
    world_click(page, m["w"] / 2, m["h"] * 0.688)
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/02_help.png")
    print("小窗打开:", page.evaluate("() => !!window.game.scene.getScene('Menu').help"))

    # 点任意处关掉，再开局
    world_click(page, m["w"] / 2, m["h"] * 0.25)
    page.wait_for_timeout(300)
    print("小窗关闭:", page.evaluate("() => !window.game.scene.getScene('Menu').help"))
    page.keyboard.press("Space")
    page.wait_for_timeout(2000)

    # 无敌 + 关掉刷怪，专心看朝向和弹道
    page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
            s.waveCount = 0; s.nextWaveAt = Number.MAX_SAFE_INTEGER; s.bossAt = Number.MAX_SAFE_INTEGER;
            s.activeEnemies().forEach(e => e.disableBody(true, true));
            s.player.setPosition(s.player.x, s.player.y);
        }"""
    )

    # 四个方向各飞一会儿，看机头是不是跟着转、子弹是不是从机头出来
    for name, key in [("up", "w"), ("right", "d"), ("down", "s"), ("left", "a")]:
        page.keyboard.down(key)
        page.wait_for_timeout(500)   # 先让机头转到位
        # 贴到墙上会撞出反弹弹、方向反过来干扰判读，所以量之前挪回场中央再清一次弹
        page.evaluate(
            """() => {
                const s = window.game.scene.getScene('Game');
                s.player.setPosition(window.game.scale.gameSize.width / 2, window.game.scale.gameSize.height / 2);
                s.activePlayerBullets().forEach(b => b.kill());
            }"""
        )
        page.wait_for_timeout(120)
        page.screenshot(path=f"{OUT}/03_dir_{name}.png")
        print(f"  朝 {name}:", page.evaluate(STATE))
        page.keyboard.up(key)
        page.wait_for_timeout(150)

    # 右上角暂停按钮
    before = page.evaluate("() => window.game.scene.isActive('Game')")
    world_click(page, m["w"] - 46, 116)
    page.wait_for_timeout(400)
    after = page.evaluate("() => ({ game: window.game.scene.isActive('Game'), pause: window.game.scene.isActive('Pause') })")
    print("暂停按钮:", before, "->", after)
    page.screenshot(path=f"{OUT}/04_pause.png")
    page.keyboard.press("Space")
    page.wait_for_timeout(400)
    print("恢复:", page.evaluate("() => window.game.scene.isActive('Game')"))

    # 横屏菜单
    page.set_viewport_size({"width": 1280, "height": 720})
    page.wait_for_timeout(1200)
    # 注意别写成 `stop('Game') || start('Menu')`：stop 返回的是 ScenePlugin，恒为真，后面那句永远不执行
    page.evaluate("() => { window.game.scene.stop('Game'); window.game.scene.start('Menu'); }")
    page.wait_for_timeout(900)
    page.screenshot(path=f"{OUT}/05_menu_land.png")
    m2 = page.evaluate(WORLD)
    world_click(page, m2["w"] / 2, m2["h"] * 0.688)
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/06_help_land.png")
    print("横屏世界:", m2["w"], m2["h"])

    print("ERRORS:", errs[:5] if errs else "none")
    browser.close()

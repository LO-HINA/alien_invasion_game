"""Boss 战冒烟测试：跳过杂兵阶段直接叫出 Boss，验证四边入场 / 冲刺撞 Boss /
击破后的经验晶体与过关流程，中途还会改一次窗口比例。

用法： python scripts/boss_test.py [URL] [输出目录]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."

SNAPSHOT = """() => {
    const s = window.game.scene.getScene('Game');
    if (!s || !s.player) return null;
    return {
        phase: s.phase,
        stage: s.stage,
        world: [window.game.scale.gameSize.width, window.game.scale.gameSize.height],
        player: [Math.round(s.player.x), Math.round(s.player.y)],
        invuln: s.player.invulnerable,
        dashReady: s.player.dashReady,
        dashing: s.player.dashing,
        enemies: s.activeEnemies().map(e => [e.kind, Math.round(e.x), Math.round(e.y), e.onScreen]),
        xpOrbs: s.xpOrbs.getMatching('active', true).length,
        bullets: s.activePlayerBullets().length,
        boss: s.boss ? [Math.round(s.boss.x), Math.round(s.boss.y), Math.max(0, Math.round(s.boss.hp))] : null,
        level: s.level,
    };
}"""

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 540, "height": 960})
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_timeout(2500)
    page.keyboard.press("Space")
    page.wait_for_timeout(1500)

    # 让玩家不死，并把杂兵阶段直接跳过去
    page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            s.player.invulnUntil = Number.MAX_SAFE_INTEGER;
            s.waveCount = 999;
            s.nextWaveAt = 0;
        }"""
    )

    # 等 Boss 入场，期间四处走位看看左右两边会不会来怪
    for i in range(10):
        key = ["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"][i % 4]
        page.keyboard.down(key)
        page.wait_for_timeout(450)
        page.keyboard.up(key)
        if i == 3:
            print("杂兵期快照:", page.evaluate(SNAPSHOT))
    print("Boss 入场:", page.evaluate(SNAPSHOT))
    page.screenshot(path=f"{OUT}/boss_enter.png")

    # 冲刺撞 Boss + 正常输出
    for i in range(6):
        page.keyboard.press("Space")
        page.wait_for_timeout(700)
    print("冲刺中/后:", page.evaluate(SNAPSHOT))
    page.screenshot(path=f"{OUT}/boss_fight.png")

    # Boss 战中途改比例，检查世界与 HUD 是否跟着变
    page.set_viewport_size({"width": 1280, "height": 720})
    page.wait_for_timeout(900)
    print("横屏:", page.evaluate(SNAPSHOT))
    page.screenshot(path=f"{OUT}/boss_landscape.png")
    page.set_viewport_size({"width": 540, "height": 960})
    page.wait_for_timeout(900)
    print("回到竖屏:", page.evaluate(SNAPSHOT))

    # 直接把 Boss 打残，看击破结算与满地的经验晶体
    page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            if (s.boss) s.boss.hp = 1;
        }"""
    )
    page.wait_for_timeout(1200)
    print("击破瞬间:", page.evaluate(SNAPSHOT))
    page.screenshot(path=f"{OUT}/boss_dead.png")

    # 结算要把全场经验吸过来
    page.evaluate(
        """() => {
            const s = window.game.scene.getScene('Game');
            s.player.invulnUntil = 0;
            s.player.setPosition(
                s.xpOrbs.getMatching('active', true)[0]?.x ?? 270,
                s.xpOrbs.getMatching('active', true)[0]?.y ?? 480);
        }"""
    )
    page.wait_for_timeout(2500)
    print("过关后:", page.evaluate(SNAPSHOT))
    page.screenshot(path=f"{OUT}/stage_clear.png")

    browser.close()

print("ERRORS:", errors if errors else "none")

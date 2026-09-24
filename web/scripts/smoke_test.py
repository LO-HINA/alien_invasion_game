"""冒烟测试：打开游戏，进入战斗，冲刺、走位、缩放窗口，截图并收集控制台错误。

用法： python scripts/smoke_test.py [URL] [输出目录]
"""
import sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "."

errors = []


def canvas_fill(page):
    """画布相对窗口的填充率，1.0 表示满屏没有黑边"""
    box = page.evaluate(
        """() => {
            const c = document.querySelector('canvas');
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { w: r.width, h: r.height, iw: window.innerWidth, ih: window.innerHeight };
        }"""
    )
    if not box:
        return None
    return (box["w"] / box["iw"], box["h"] / box["ih"])


def resize(page, w, h, shots=None, settle=900):
    """改窗口尺寸，等防抖 + 重建落定后检查是否仍然满屏"""
    page.set_viewport_size({"width": w, "height": h})
    page.wait_for_timeout(settle)
    fill = canvas_fill(page)
    if fill is None:
        errors.append(f"resize {w}x{h}: canvas missing")
        return
    fx, fy = fill
    print(f"  resize {w}x{h} -> fill {fx:.3f} x {fy:.3f}")
    if fx < 0.99 or fy < 0.99:
        errors.append(f"resize {w}x{h}: letterboxed, canvas fills {fx:.3f} x {fy:.3f}")
    if shots:
        page.screenshot(path=f"{OUT}/{shots}")


with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=angle", "--autoplay-policy=no-user-gesture-required"])
    page = browser.new_page(viewport={"width": 540, "height": 960})
    # 全屏 API 在无头浏览器里必然失败，这类噪音不算问题
    noisy = lambda t: "fullscreen" in t.lower()
    page.on("console", lambda m: m.type == "error" and not noisy(m.text) and errors.append(m.text))
    page.on("pageerror", lambda e: not noisy(str(e)) and errors.append(str(e)))
    page.goto(URL)
    page.wait_for_timeout(2500)
    print("竖屏 540x960 fill:", canvas_fill(page))
    page.screenshot(path=f"{OUT}/shot_menu.png")

    page.keyboard.press("Space")
    page.wait_for_timeout(1200)

    # 左右来回走位（自动射击），穿插冲刺，期间遇到升级就选第一项
    for i in range(30):
        key = "ArrowLeft" if i % 2 == 0 else "ArrowRight"
        page.keyboard.down(key)
        page.wait_for_timeout(600)
        page.keyboard.up(key)
        if i % 3 == 1:
            page.keyboard.press("Space")   # 冲刺
        if i == 8:
            page.screenshot(path=f"{OUT}/shot_battle.png")
        if i == 12:
            page.keyboard.press("x")
        if i == 14:
            page.keyboard.press("Shift")   # 冲刺的另一个键位
        if i % 5 == 4:
            page.screenshot(path=f"{OUT}/shot_levelup_{i}.png")
            page.keyboard.press("1")

    # 上下走位，逼敌机从左右两边进场
    for i in range(8):
        page.keyboard.down("ArrowUp" if i % 2 == 0 else "ArrowDown")
        page.wait_for_timeout(500)
        page.keyboard.up("ArrowDown" if i % 2 == 0 else "ArrowUp")
    page.screenshot(path=f"{OUT}/shot_sides.png")

    # 窗口比例变化：横屏 / 超长竖屏 / 回到初始，每次都应该还是满屏
    resize(page, 1280, 720, "shot_landscape.png")
    resize(page, 900, 1600, "shot_tall.png")
    resize(page, 540, 960)

    # 触屏拖动
    page.mouse.move(270, 800)
    page.mouse.down()
    page.mouse.move(120, 700, steps=10)
    page.mouse.up()
    page.wait_for_timeout(300)
    page.screenshot(path=f"{OUT}/shot_battle2.png")

    # 全屏切换（无头环境下会失败，只确认不会崩）
    page.keyboard.press("f")
    page.wait_for_timeout(600)
    page.screenshot(path=f"{OUT}/shot_fullscreen.png")

    page.keyboard.press("p")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{OUT}/shot_pause.png")
    page.keyboard.press("p")
    page.wait_for_timeout(300)

    browser.close()

print("ERRORS:", errors if errors else "none")

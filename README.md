# Neon Starfighter 霓虹星际战机

Phaser 3 + TypeScript 做的竖版弹幕射击游戏，浏览器打开就能玩，不用安装。

## 玩法特点

- 自动射击，专心走位
- 十种敌机，各有各的打法（点射 / 狙击 / 旋舞 / 分裂 / 自爆冲锋 / 环形轰炸…）
- 升级三选一，一局点出一套流派，不中意可以重随
- 机身中心的判定点只有 5 像素，贴着敌弹擦过去能加分
- 撑过敌潮会遇到 Boss
- 横屏竖屏自适应，手机浏览器也能玩

## 怎么跑

需要 Node 18+ 和 pnpm：

```bash
pnpm install
pnpm dev        # 开发服务器 → http://localhost:5173
pnpm build      # 类型检查 + 打包到 dist/
pnpm preview    # 预览打包结果
```

打包产物在 `dist/`，扔到任何静态服务器上就能跑。

## 操作

| 操作 | 按键 |
| --- | --- |
| 移动 | WASD / 方向键 / 按住屏幕拖动 |
| 冲刺 | 空格 / SHIFT / 右下角按钮 |
| 炸弹 | X / K / 右下角按钮 |
| 暂停 | P / ESC / 右上角按钮 |
| 全屏 | F |
| 音乐 | M |
| 升级选择 | 1 2 3 / 方向键 + 回车 / 点卡片 |

### ❤️❤️点击即玩❤️❤️

[点击下载游戏源码包](https://github.com/LO-HINA/alien_invasion_game/archive/refs/heads/main.zip)

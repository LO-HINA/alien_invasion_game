import pygame
from pygame.sprite import Sprite



class Bullet(Sprite):
    """管理飞机发射子弹的类"""
    def __init__(self, ai_game):
        """在飞船所在的当前位置创建一个子弹对象"""
        super().__init__()
        # 把 “主屏幕” 的引用赋值给子弹的self.screen属性，让子弹后续能知道 “自己要显示在哪个窗口上”。
        self.screen = ai_game.screen
        # 引入settings里面的子弹配置
        self.settings = ai_game.settings
        self.color = self.settings.bullet_color

        # 在(0,0)处创建一个表示子弹的矩形，再设置正确的位置
        self.rect = pygame.Rect(0, 0, self.settings.bullet_width, self.settings.bullet_height)
        self.rect.midtop = ai_game.ship.rect.midtop  # ai_game.ship.rect.midtop → 飞船矩形的"上边缘中点"（发射子弹的最佳位置）
        # 使用浮点数表示子弹的位置
        self.y = float(self.rect.y)

    def update(self):
        """向上移动子弹"""
        # 更新子弹的准确位置
        self.y -= self.settings.bullet_speed
        # 更新表示子弹的rect的位置
        self.rect.y = self.y

    def draw_bullet(self):
        """在屏幕绘制子弹"""
        pygame.draw.rect(self.screen, self.color, self.rect)


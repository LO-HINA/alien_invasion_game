import pygame
from pygame.sprite import Sprite

class Alien(Sprite):
    """创建单个外星人的类"""
    def __init__(self, ai_game):
        """初始化外星人并设计其起始位置"""
        super().__init__()
        # 把 “主屏幕” 的引用赋值给外星人的self.screen属性，让外星人后续能知道 “自己要显示在哪个窗口上”。
        self.screen = ai_game.screen
        # 引入settings里面的外星人配置
        self.settings = ai_game.settings
        # 加载外星人图像并设置其rect属性
        self.image = pygame.image.load('images/alien.png')
        # 这里我把它调小了一点
        self.image = pygame.transform.scale(self.image, (52.5, 37.5))
        self.rect = self.image.get_rect()

        # 每个外星人图像最初在屏幕的左上角附件
        self.rect.x = self.rect.width
        self.rect.y = self.rect.height

        # 存储外星人的准确位置
        self.x = float(self.rect.x)

    def check_edges(self):
        """如果外星人位于屏幕边缘，就返回True"""
        screen_rect = self.screen.get_rect()
        return (self.rect.right >= screen_rect.right ) or (self.rect.left <= 0)




    def update(self):
        """向左或右移动外星人"""
        self.x += self.settings.alien_speed * self.settings.fleet_direction
        self.rect.x = self.x

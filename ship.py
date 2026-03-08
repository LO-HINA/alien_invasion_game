import pygame
from pygame.sprite import Sprite

class Ship(Sprite):
    """管理飞船的类"""
    def __init__(self,ai_game):
        """初始化飞船并设置起始位置"""
        super().__init__()
        # 把 “主屏幕” 的引用赋值给飞船的self.screen属性，让飞船后续能知道 “自己要显示在哪个窗口上”。
        self.screen = ai_game.screen
        # 引入settings里面的屏幕配置
        self.settings = ai_game.settings
        self.screen_rect = ai_game.screen.get_rect()

        """加载飞船图片并获取它的外形接矩形"""
        self.image = pygame.image.load('images/green.png')
        # 这里我把它调小了一点
        self.image = pygame.transform.scale(self.image, (45, 60))

        self.rect = self.image.get_rect()

        """每艘飞船都放在屏幕底部的中央"""
        self.rect.midbottom = self.screen_rect.midbottom
        # 在飞船的属性x中存储一个浮点数
        self.x = float(self.rect.x)
        self.y = float(self.rect.y)

        # 这里初始化移动的指针
        self.moving_right = False
        self.moving_left = False
        self.moving_up = False
        self.moving_down = False

    def blitme(self):
        """在指定位置绘制飞船"""
        self.screen.blit(self.image, self.rect)


    def update(self):
        """根据移动标志调整飞船位置"""
        # 更新飞船的属性x的值，而不是其接近矩形的属性x的值
        if self.moving_right and self.rect.right < self.screen_rect.right:  # self.rect.right 直接表示 “飞船右边缘的 x 坐标
            self.x += self.settings.ship_speed                  # self.rect.x 是 “飞船左上角的 x 坐标所以用self.rect.right
        if self.moving_left and self.rect.left > 0:
            self.x -= self.settings.ship_speed
        if self.moving_up and self.rect.top > 0:
            self.y -= self.settings.ship_speed
        if self.moving_down and self.rect.bottom < self.screen_rect.bottom:
            self.y += self.settings.ship_speed
        # 根据self.x更新rect对象
        self.rect.x = self.x
        self.rect.y = self.y

    def center_ship(self):
        """将飞船放到屏幕底部的中央"""
        self.rect.midbottom = self.screen_rect.midbottom
        self.x = float(self.rect.x)
        self.y = float(self.rect.y)


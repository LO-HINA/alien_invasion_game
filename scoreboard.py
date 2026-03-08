import pygame.font
from pygame.sprite import Group

from ship import Ship


class Scoreboard:
    """显示得分信息的类"""

    def __init__(self,ai_game):
        """初始化显示得分涉及的属性"""
        self.ai_game = ai_game
        # 保存游戏窗口（screen）的引用—— 简单说就是 “让这个类能直接操作游戏窗口”，比如在窗口上绘制按钮、飞船、文字等。
        self.screen = ai_game.screen
        # 获取游戏窗口（屏幕）的 “矩形边界对象（Rect）
        self.screen_rect = self.screen.get_rect()
        self.settings = ai_game.settings  # 方便访问settings
        self.stats = ai_game.stats   # 同理

        # 显示得分信息时使用的字体设置
        self.text_color = (30,30,30)
        self.font = pygame.font.SysFont(None, 48)

        # 准备初始得分和最高得分的图像
        self.prep_score()
        self.prep_high_socre()
        # 显示关卡的图像
        self.prep_level()
        # 显示飞机剩余的图像
        self.prep_ships()


    def prep_score(self):
        """将得分渲染成为图像"""
        # 将原始分数四舍五入到 “最近的 10 的整数倍”
        rounded_score = round(self.stats.score, -1)
        # 将四舍五入后的分数转换成字符串，并添加 “千位分隔符”（英文逗号,）
        score_str = f"score:{rounded_score:,}"
        self.score_image = self.font.render(score_str,True,self.text_color,self.settings.bg_color)

        # 在右上角显示得分
        self.score_rect = self.score_image.get_rect()
        self.score_rect.right = self.screen_rect.right - 20
        self.score_rect.top = 0
        # 表示在屏幕右上角距边缘各20的地方


    def prep_high_socre(self):
        """将最高分渲染为图像"""
        high_score = round(self.stats.high_score, -1)
        high_score_str = f"highest:{high_score:,}"
        self.high_score_image = self.font.render(high_score_str,True,self.text_color,self.settings.bg_color)
        # 将最高分放在屏幕中央
        self.high_score_rect = self.high_score_image.get_rect()
        self.high_score_rect.centerx = self.screen_rect.centerx
        self.high_score_rect.top = self.screen_rect.top


    def check_high_score(self):
        """判断是否诞生了最高分"""
        if self.stats.score >= self.stats.high_score:
            self.stats.high_score = self.stats.score
            self.prep_high_socre()



    def prep_level(self):
        """将关卡渲染成为图片"""
        level_str = f"level:{self.stats.level}"
        self.level_image = self.font.render(level_str,True,self.text_color,None)

        # 将关卡放在得分的下面
        self.level_rect = self.level_image.get_rect()
        self.level_rect.right = self.score_rect.right
        self.level_rect.top = self.score_rect.bottom + 10

    def prep_ships(self):
        """显示还剩下多少艘飞船"""
        self.ships = Group()
        for ship_num in range(self.stats.ships_left):  # 取出定义了多少艘飞船
            # 导入alien_invasion里面的对象
            ship = Ship(self.ai_game)
            # 防止重叠，每一个相距10像素
            ship.rect.x = 10 + ship_num * ship.rect.width
            # 并排显示在顶部
            ship.rect.y = 5
            self.ships.add(ship)


    def show_score(self):
        """在屏幕显示得分和关卡"""
        self.screen.blit(self.score_image,self.score_rect)
        self.screen.blit(self.high_score_image,self.high_score_rect)
        self.screen.blit(self.level_image,self.level_rect)
        self.ships.draw(self.screen)

import pygame


class Setting:
    """专门存储游戏《外星人游戏》中所以的设置得到类"""
    def __init__(self):
        """初始化游戏的静态设置"""
        # 屏幕的设置
        self.screen_width = 1200 # 屏幕的宽
        self.screen_height = 800 # 屏幕的长
        # 设置背景色
        self.bg_color = (112, 128, 144)
        # 飞船的设置
        self.ship_limit = 3  # 这里表示限制飞机数量

        # 子弹设计

        self.bullet_width = 300
        self.bullet_height = 25
        self.bullet_color = (60, 60, 60)
        self.bullets_allowed = 10

        # 外星人设置
        # 外星舰队（一整群外星人）向下移动的速度（比如每次横向移动到边界后，向下 “下落” 10个单位距离
        self.fleet_drop_speed = 15
        # 以什么速度加快游戏的节奏
        # 飞船，子弹，外星人变快
        self.speedup_scale = 3
        # 外星人分数提高的速度
        self.score_scale = 1.1

        # 节奏变化
        self.initialize_dynamic_setting()


        # 飞船爆炸
        # 新增：加载破坏特效图片（替换为你的图片路径）
        self.ship_aliens_break = pygame.image.load("images/something_break.png")  # convert_alpha() 保留透明背景
        # 可选：缩放图片（根据需要调整尺寸，比如缩到60x60）
        self.ship_aliens_break = pygame.transform.scale(self.ship_aliens_break, (30, 37.5))

        # 新增：记录飞船和外星人爆炸特效的状态（初始：无特效）
        self.show_ship_aliens_break = False  # 是否显示飞船爆炸特效
        self.ship_aliens_break_pos = (0, 0)  # 特效显示位置（碰撞时设为飞船中心）
        self.ship_aliens_break_timer = 0  # 特效显示时长计时器（控制多久消失）



    def initialize_dynamic_setting(self):
        """初始化随游戏进行而变化的设置"""
        # 表示外星人水平移动的速度
        self.alien_speed = 1.5
        # 表示子弹的速度
        self.bullet_speed = 8
        # 这里设置了飞船速度
        self.ship_speed = 5
        # 记分设置
        self.alien_points = 50

        # self.fleet_direction = 1表示向右移动，为-1表示向左移动
        self.fleet_direction = 1


    def increase_speed(self):
        """提高速度设置的值和外星人得分"""
        self.alien_speed *= self.speedup_scale
        self.bullet_speed *= self.speedup_scale
        self.ship_speed *= self.speedup_scale

        self.alien_points *= self.speedup_scale




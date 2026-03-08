import pygame
import sys
from time import sleep
import random

from scoreboard import Scoreboard
from settings import Setting
from ship import Ship
from bullet import Bullet
from alien import Alien
from game_starts import GameStarts
from button import Button


class AlienInvasion:
    """管理游戏资源和行为的类"""
    def __init__(self):
        """初始化游戏并创建游戏资源"""
        pygame.init()
        # 这里是控制帧率的应用
        self.clock = pygame.time.Clock()
        # 引入settings设置，联系起来
        self.settings = Setting()
        # 创建一个用于存储运行统计信息的实例
        self.stats = GameStarts(self)
        # 表示绘制一个屏幕
        self.screen = pygame.display.set_mode(  # → 这行代码创建了主显示窗口，同时pygame会把这个窗口标记为 “当前要显示的窗口”。
            (self.settings.screen_width, self.settings.screen_height),
            pygame.RESIZABLE  # 关键：添加这个标志，启用窗口调整功能
        )
       # 创建一个用于绘制游戏运行信息的模块
        self.sb = Scoreboard(self)
        # 引入飞船列表
        self.ship = Ship(self)
        # 这是创建一个显示窗口
        pygame.display.set_caption('Alien Invasion')
        # 关键：创建子弹精灵组 = 一个“子弹容器”，用来统一管理所有发射的子弹
        self.bullets = pygame.sprite.Group()
        # 关键：创建外星舰队精灵组 = 一个“外星舰队容器”，用来统一管理所有外星舰队
        self.aliens = pygame.sprite.Group()
        self._create_fleet()
        # 让游戏一开始处于非活跃状态
        self.game_active = False
        # 创建play按钮,其实这里只是导入Bullet类
        self.play_button = Button(self,"play")



    def run_game(self):
        """开始游戏主循环"""
        while True:
            self._check_events() # 必须先检查键盘才引入update
            if self.game_active:
                self.ship.update()
                self._update_bullet()
                self._update_aliens()
            self._update_screen()
            self.clock.tick(60) # 控制帧率

    """
    pygame.display.flip()→ 这行代码会自动找到pygame内部记录的 “当前主显示窗口”（也就是你用set_mode创建的self.screen），然后更新它的内容。
    pygame.display.set_caption('Alien Invasion') -> 同理，绑定活跃窗口
    """


    # 下面的_check_events和_update_screen都是简化run_game的作用
    def _check_events(self):
        # 监听键盘和鼠标事件
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                sys.exit()
            elif event.type == pygame.KEYDOWN:   # pygame.KEYDOWN = 键盘按下事件常量
                self._check_keydown_events(event)
            elif event.type == pygame.KEYUP:  # pygame.KEYUP = 键盘松开事件常量
                self._check_keyup_events(event)
            elif event.type == pygame.MOUSEBUTTONDOWN:
                mouse_pos = pygame.mouse.get_pos()
                self._check_play_button(mouse_pos)


    def _check_keydown_events(self,event):
        """响应按下"""
        if event.key == pygame.K_RIGHT:  # pygame.K_RIGHT = 右箭头键的常量
            self.ship.moving_right = True
        if event.key == pygame.K_LEFT:  # pygame.K_LEFT = 左箭头键的常量
            self.ship.moving_left = True
        if event.key == pygame.K_UP:  # pygame.K_UP = 上箭头键的常量
            self.ship.moving_up = True
        if event.key == pygame.K_DOWN:  # pygame.K_DOWN = 下箭头键的常量
            self.ship.moving_down = True
        if event.key == pygame.K_q:
            sys.exit()

    def _check_keyup_events(self,event):
        """响应释放"""
        if event.key == pygame.K_RIGHT:
            self.ship.moving_right = False
        if event.key == pygame.K_LEFT:
            self.ship.moving_left = False
        if event.key == pygame.K_UP:
            self.ship.moving_up = False
        if event.key == pygame.K_DOWN:
            self.ship.moving_down = False
        if event.key == pygame.K_SPACE:   # 核心触发：当你按空格键时，调用发射子弹的方法
            self._fire_bullut()





    def _check_play_button(self,monse_pos):
        """玩家单机play按钮时开始新游戏"""
        button_clicked = self.play_button.rect.collidepoint(monse_pos)
        # 如果没有这一步的话，那么按了按钮之后按钮消失，按同样位置也相当于重置
        if button_clicked and not self.game_active:
            # 还原游戏动态设置
            self.settings.initialize_dynamic_setting()
            # 重置游戏的统计信息
            self.stats.reset_stats()
            self.game_active = True
            self.sb.prep_score()

            # 清空外星人列表和子弹列表
            self.bullets.empty()
            self.aliens.empty()

            # 创建一个新的外星舰队，并将飞船放到屏幕中央底部
            self._create_fleet()
            self.ship.center_ship()

            # 隐藏光标
            # pygame.mouse.set_visible(False) # 没有必要






    def _ship_aliens_break(self):
        """绘制飞船和外星人爆炸特效"""
        if self.settings.show_ship_aliens_break:
            # 把爆炸图绘制到指定位置（center对齐，确保居中）
            self.screen.blit(
                self.settings.ship_aliens_break,
                self.settings.ship_aliens_break.get_rect(center=self.settings.ship_aliens_break_pos)
            )
            self.settings.ship_aliens_break_timer -= 1  # 计时器倒计时
            # 计时器到0，关闭特效（避免一直显示）
            if self.settings.ship_aliens_break_timer <= 0:
                self.settings.show_ship_aliens_break = False

    def _bool(self):  # 艺术就是bool!!!
        """触发飞船和外星人爆炸特效"""
        self.settings.show_ship_aliens_break = True  # 开启特效
        self.settings.ship_aliens_break_timer = 5  # 显示30帧（60帧=1秒，约0.5秒，可按需调整）
        # self.settings.ship_aliens_break_pos = self.所要图片.rect.center 让它在所要图片中间爆

    def _check_bullet_alien_collisions(self):
        """检查是否有子弹击中了了外星人"""
        # 如果是，就删除相应的子弹和外星人。
        collisions = pygame.sprite.groupcollide(self.bullets, self.aliens, True, True)
        # 外星人和子弹碰撞也要爆炸
        if collisions:
            # 遍历所有被击中的外星人（支持一颗子弹打多个外星人）
            for bullets, hit_aliens in collisions.items():
                for alien in hit_aliens:   # 取出碰撞的每个外星人，方便每个爆炸
                    self._bool()  # 开启爆炸、设置时长（复用已有逻辑）
                    self.settings.ship_aliens_break_pos = alien.rect.center    # 爆炸位置=外星人中心
                    # 每打一个外星人加50分
                    self.stats.score += self.settings.alien_points
                    # 将变化的score更新到得分绘制里面去
                    self.sb.prep_score()
                    self.sb.check_high_score()

        if not self.aliens:
            """删除现有子弹并创建一个新的外星舰队"""
            # self.bullets.empty() # 这里是删除现有子弹并创建一个新的外星舰队，但是我个人觉得没有必要
            self._create_fleet()
            # 这里加快游戏节奏
            self.settings.increase_speed()
            # 到下一关
            self.stats.level += 1
            self.sb.prep_level()
            # 显示飞船数量
            self.sb.prep_ships()

    def _ship_hit(self):
        """响应飞船和外星人的碰撞"""
        if self.stats.ships_left > 0:
            # 将ship_left减1并更新计分表
            self.stats.ships_left -= 1
            self.sb.prep_ships()

            # 清空外星人列表和子弹列表
            self.bullets.empty()
            self.aliens.empty()

            # 创建一个外星舰队，并将飞船放到底部
            self._create_fleet()
            self.ship.center_ship()
            # 暂停
            sleep(0.3)
        else:
            self.game_active = False
            pygame.mouse.set_visible(True)







    def _fire_bullut(self):
        """创建一颗子弹，并将其加入编组bullets"""
        if len(self.bullets) < self.settings.bullets_allowed:
            # 新建子弹对象：传入self（游戏主实例），让子弹能拿到飞船位置、屏幕、设置
            new_bullet = Bullet(self)
            # 2. 把新子弹加入“子弹容器”（精灵组）：后续统一管理（移动、绘制）
            self.bullets.add(new_bullet)

    def _update_bullet(self):
        """更新子弹的位置，并删除已消失的子弹"""
        # 更新子弹的位置
        self.bullets.update()
        # 删除飞出屏幕顶部的子弹
        for bullet in self.bullets.copy():  # 遍历子弹组的副本（避免删除时出错）
            # 判定条件：子弹的rect.bottom（子弹底部）≤ 0（屏幕顶部的y坐标是0）
            if bullet.rect.bottom <= 0:
                self.bullets.remove(bullet)  # 从精灵组中删除子弹
        # 导入子弹和外星人的碰撞
        self._check_bullet_alien_collisions()






    def _create_fleet(self):
        """创建一个外星舰队"""
        # 创建一个外星人,再不断添加，直到没有空间添加外星人为止
        # 外星人的间距为外星人的宽度和外星人的高度
        alien = Alien(self)
        alien_width, alien_height = alien.rect.size
        current_x,current_y = alien_width, alien_height
        while current_y < (self.settings.screen_height - 10 * alien_height):
            while current_x < (self.settings.screen_width - 2 * alien_width):
                self._create_alien(current_x,current_y)
                current_x += 2 * alien_width

            # 添加了一行外星人后，重置x值并递增y值
            current_x = alien_width
            current_y += 2 * alien_height

    def _update_aliens(self):
        """更新外星舰队所有外星人的位置"""
        self._check_fleet_edges()
        self.aliens.update()

        # 检验外星人和飞船之间的碰撞
        if pygame.sprite.spritecollide(self.ship, self.aliens,True):
        # 第三个参数 True 的作用：碰撞后是否删除被碰撞的精灵组（self.aliens）中的精灵
            self._bool()
            self.settings.ship_aliens_break_pos = self.ship.rect.center  # 特效位置=飞船中心（确保对准碰撞点）
            # 飞机碰撞外星人的影响
            self._ship_hit()
        # 检查是否有外星人到达屏幕的下边缘
        self._check_aliens_bottom()

    def _create_alien(self,x_position,y_position):
        """创建一个外星人并放入行中"""
        # 随机产生，可能不产生
        num = random.choice([1, 2, 3])
        if num == 1:
            pass
        else:
            new_alien = Alien(self)
            new_alien.x = x_position
            new_alien.rect.x = x_position
            new_alien.rect.y = y_position
            self.aliens.add(new_alien)

    def _check_fleet_edges(self):
        """当有外星人到达边缘的时候采取相应的措施"""

        for aline in self.aliens.sprites():
            if aline.check_edges():
                self._change_fleet_direction()
                break

    def _change_fleet_direction(self):
        """将整个外星舰队向下移动，并改变它们的方向"""
        for alien in self.aliens.sprites():
            # 这里已经在下落了
            alien.rect.y += self.settings.fleet_drop_speed
        self.settings.fleet_direction *= -1

    def _check_aliens_bottom(self):
        """检查是否有外星人到达屏幕的下边缘"""
        for alien in self.aliens.sprites():
            if alien.rect.bottom >= self.settings.screen_height:
                # 像飞船被撞到一样的处理
                self._ship_hit()
                break






    def _update_screen(self):
        """渲染是从下面到上面，要注意顺序，背景→UI 文字→子弹→飞船→外星人→爆炸特效→Play 按钮→刷新屏幕"""
        # 每次循环时都重绘屏幕
        self.screen.fill(self.settings.bg_color)
        # 显示得分
        self.sb.show_score()
        # 遍历“子弹容器”，绘制每一颗子弹
        for bullet in self.bullets.sprites():
            bullet.draw_bullet()
        # 绘制子弹
        self.ship.blitme()
        # 绘制外星人舰队
        self.aliens.draw(self.screen)
        # 加入飞船爆炸的情节
        self._ship_aliens_break()

        # 如果游戏除于非活动状态，就绘制play按钮，这里绘制了
        if not self.game_active:
            self.play_button.draw_button()
        # 让最近绘制的屏幕可见，在每次while的时候绘制一个屏幕，显示新的元素，并隐藏旧元素，实现平移的效果
        pygame.display.flip()

if __name__ == '__main__':

    ai = AlienInvasion()
    ai.run_game()


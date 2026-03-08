import  pygame


class Button:
    """为游戏创建按钮的类"""

    def __init__(self,ai_game,msg):  # ai_game让主屏幕记得，mag:输入的文本
        """初始化按钮的属性"""
        self.screen = ai_game.screen
        self.screen_rect = self.screen.get_rect()


        # 设置按钮的尺寸和其他属性
        # 设定按钮的尺寸：宽度200像素，高度50像素。
        self.width,self.height = 200,50
        # 设定按钮的颜色，这里是RGB格式的 “纯绿色”（0红、255绿、0蓝）
        self.button_color = (0,135,0)
        # 设定按钮上文字的颜色：RGB格式的 “纯白色”
        self.text_color = (255,255,255)
        # 设定按钮文字的字体和大小：使用系统自带的 “ComicSans” 字体，字号48。
        self.font = pygame.font.SysFont(None, 48)

        # 创建按钮的rect对象,这时候上面还没有文本呢
        self.rect = pygame.Rect(0,0,self.width,self.height)
        # 并使其居中
        self.rect.center = self.screen_rect.center

        # 按钮的标签只需创建一次
        self._prep_msg(msg)


    def _prep_msg(self,msg):
        """将msg渲染为图像，并使其在按钮上居中"""
        # 把字符串msg转换成Pygame能绘制的图像（Surface对象）
        self.msg_image = self.font.render(msg,False,self.text_color,self.button_color) # 文本在这里加
        # ，True：开启 “抗锯齿”（让文字边缘更平滑，不锯齿状，False 则边缘锐利）
        # 获取文字图像的 “矩形边界”（Rect对象）
        self.msg_image_rect = self.msg_image.get_rect()
        # 居中
        self.msg_image_rect.center = self.rect.center

    def draw_button(self):
        """绘制一个用颜色填充的按钮，再绘制文本"""
        self.screen.fill(self.button_color,self.rect)
        self.screen.blit(self.msg_image,self.msg_image_rect)
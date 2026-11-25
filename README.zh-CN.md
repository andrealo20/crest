<p align="center">
  <img src="assets/logo/crest-icon.svg" alt="Crest 图标" width="112" height="112" />
</p>

<h1 align="center">Crest</h1>

<p align="center">
  <b>屏幕顶部的灵动岛，支持 Windows 和 macOS；在 Windows 上还有自己的任务栏。</b>
</p>

<p align="center">
  <a href="https://apps.microsoft.com/detail/9N2KXJ2924KS?referrer=appbadge&mode=full"><img src="docs/media/store/get-it-from-microsoft-dark.svg" width="161" height="44" alt="从 Microsoft 获取"></a>
  <a href="https://github.com/andrealo20/crest/releases/latest"><img src="docs/media/badges/platforms-store.svg" width="161" height="44" alt="平台：Windows、Windows on Arm、macOS"></a>
</p>

<p align="center">
  <a href="https://github.com/andrealo20/crest/releases/latest"><img src="https://img.shields.io/github/v/release/andrealo20/crest?style=flat&label=release&color=7B61FF&logo=github&logoColor=white" alt="最新版本" /></a>
  <a href="https://github.com/andrealo20/crest/releases"><img src="https://img.shields.io/github/downloads/andrealo20/crest/total?style=flat&label=downloads&color=2EA44F&logo=github&logoColor=white" alt="总下载量" /></a>
  <a href="https://github.com/andrealo20/crest/stargazers"><img src="https://img.shields.io/github/stars/andrealo20/crest?style=flat&color=FFD700&logo=github&logoColor=white" alt="GitHub 星标" /></a>
  <a href="src/i18n"><img src="https://img.shields.io/badge/languages-EN%20%C2%B7%20ZH%20%C2%B7%20ES%20%C2%B7%20HI%20%C2%B7%20AR%20%C2%B7%20FR%20%C2%B7%20PT%20%C2%B7%20RU%20%C2%B7%20JA%20%C2%B7%20DE%20%C2%B7%20IT-D9480F?style=flat&logo=googletranslate&logoColor=white" alt="语言：英语、简体中文、西班牙语、印地语、阿拉伯语、法语、葡萄牙语、俄语、日语、德语、意大利语" /></a>
  <a href="https://github.com/sponsors/andrealo20"><img src="https://img.shields.io/badge/sponsor-GitHub%20Sponsors-E0559E?style=flat&logo=githubsponsors&logoColor=white" alt="在 GitHub 上赞助" /></a>
</p>

<p align="center">
  <a href="README.md"><img src="https://img.shields.io/badge/README-English-7B61FF?style=flat" alt="English README" /></a>
</p>

<p align="center">
  <a href="https://crestisland.app/"><b>网站</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/andrealo20/crest/releases/latest"><b>下载</b></a>
  &nbsp;·&nbsp;
  <a href="#功能"><b>功能</b></a>
  &nbsp;·&nbsp;
  <a href="#数据只留在你的电脑上"><b>隐私</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/andrealo20/crest/issues/new/choose"><b>提建议</b></a>
</p>

<p align="center">
  <a href="https://crestisland.app/"><img src="https://img.shields.io/badge/%E5%9C%A8%E6%B5%8F%E8%A7%88%E5%99%A8%E4%B8%AD-%E8%AF%95%E7%94%A8-FFC75F?style=for-the-badge&labelColor=0F1015" alt="在浏览器中试用 Crest" /></a>
</p>

https://github.com/user-attachments/assets/f3a34516-0d47-4f0c-a10f-25e95cc2cf64

## 这是什么

Crest 是 Windows 或 Mac 屏幕边缘的一个刘海，悬停、点击或按 **Ctrl + Alt + Space** 即可展开，里面放着你每天都要用的工具：大约三十个，每个都可以随意开关。在 Windows 上，Crest 还可以代替任务栏，把同样的工具作为小组件放在你的应用旁边。免费、开源，无需账号，也不用付费。

上面的视频用不到两分钟展示了它们，[项目主页上的演示](https://crestisland.app/)让你在安装之前就能在浏览器里试用每一个工具。

<p align="center"><img src="docs/media/features/desktop.png" alt="Windows 桌面上的 Crest：刘海展开在硬件页面，显示 CPU、GPU、内存、磁盘、网络、功耗、电池、延迟和占用最多的进程，采用 Material 样式和 Liquid Glass；屏幕底部是 Crest 的任务栏，带有小组件，中间是开始按钮和应用，右边是通知区域和时钟" width="960" /></p>

收起时，Crest 只是一行：歌曲、正在运行的计时器、你的 AI 额度、CPU、内存和 GPU、网络、电池、时钟、天气、下一个会议。有事发生时，它会变成一张卡片停留几秒，然后恢复原样。在 Windows 上，它的任务栏可以代替系统任务栏：开始按钮和应用在中间，可以看到各个窗口的实时预览，同样的读数和工具作为小组件排在两侧（微软商店版暂不提供）。

<p align="center">
  <img src="docs/media/features/notice-code.png" alt="收起的刘海里来自银行应用的通知，带有一次性验证码和“复制验证码”按钮" width="560" /><br />
  <img src="docs/media/features/notice-break.png" alt="收起的刘海里的休息提醒：看向 20 英尺外 20 秒，带“跳过”和“稍后提醒”按钮" width="560" /><br />
  <img src="docs/media/features/downloads.png" alt="收起的刘海里正在进行的三个下载，1.2 GB，18.6 MB/s" width="318" />
  <img src="docs/media/features/caps-lock.png" alt="收起的刘海里短暂显示“大写锁定已开启”" width="236" />
</p>

## 1.3.3 新功能

- **从复制的图片中读取文字和二维码**：在剪贴板里点**复制文字**，链接会在浏览器中打开。全部在这台电脑上完成。
- **一个金额换算成多种货币**：换算里最多同时显示八种。
- **用方向键切换工具**：刘海打开时按左右方向键；在文本框里用 Alt + 方向键（Mac 上用 Cmd + Option）。
- **打开时显示**：刘海打开时显示当前活动、上次打开的工具，或每次都是同一个工具。启动器新增图标大小和显示名称开关。
- **任务栏**：清空回收站只在 Crest 自己的面板里确认一次，搜索按钮放在开始旁边，输入语言也会为中文、日文和韩文显示，Windows 自己的状态图标不再出现在通知区域。

[1.3.3 版本](https://github.com/andrealo20/crest/releases/tag/v1.3.3)页面提供下载和完整的发布说明（英文），并列出每项修复和改动对应的 issue。

## 1.3.2 新功能

<p align="center">
  <img src="docs/media/features/taskbar-1.3.2.png" alt="1.3.2 版 Crest 的任务栏：左边是带封面和控制按钮的歌曲、3 小时 05 分的屏幕使用时间，以及 CPU 和 GPU 的温度和曲线；中间是开始按钮、文件资源管理器、一个显示其中四个应用图标的文件夹、终端、记事本和计算器；右边是东京时间、72 的电池环、通知区域的 ^ 按钮、Wi-Fi、音量和电池、时钟以及 Crest 按钮" width="960" /><br />
  <img src="docs/media/features/folder-1.3.2.png" alt="在任务栏上方的面板中打开的 Creative 文件夹，里面有照片、画图、音乐和视频，下方是它在固定应用之间的按钮" width="340" />
  <img src="docs/media/features/widgets-more-1.3.2.png" alt="放满东西的任务栏：最左端有一个四个方块的按钮，打开的面板里是没放下的小组件：一个汇率、三个蓝牙设备的电量、带控制按钮的歌曲和电池环" width="439" /><br />
  <img src="docs/media/features/screen-time.png" alt="今天的屏幕使用时间：从零点到二十四点的当日时间线，标出日出、日落和两个日程；总共 4 小时 58 分，每小时一根柱子，以及三个应用各自用了多久" width="437" />
  <img src="docs/media/features/wallpapers.png" alt="壁纸的精选页面：一格格来自 Unsplash 的照片，下方是契合度和自动更换" width="340" />
</p>

- **任务栏文件夹**：把一个固定的应用拖到另一个上停一会儿，两者就会放进一个文件夹，在任务栏上方的面板中打开。文件夹里的应用打开后仍会显示在任务栏上。和任务栏的其他新功能一样，仅限 Windows，微软商店版暂不提供。
- **新的小组件和样式**：占用 CPU 或内存最多的应用、电池环和电池格、网络曲线、带封面和控制按钮的正在播放、麦克风、秒表、下一个待办、最新的笔记、日、月、年进度、日期、世界时间、翻页时钟和数码管时钟、天气详情、未来几天、日出日落、汇率、加密货币、屏幕使用时间、当日时间线、未读通知、设备电量、带 10 分钟曲线的温度、保持唤醒和壁纸切换。
- **Windows 按钮**：浅色或深色主题、屏幕键盘、通知中心、勿扰模式、最近的文件、搜索框、桌面图标、安全弹出和移动热点。
- **小组件大小滑块**，以及一个按钮，用来打开任务栏放不下的小组件，时钟则始终留在任务栏上。投资组合、计算器、剪贴板、提问、启动器和录音机等固定的工具会在任务栏上方的面板中打开。
- **屏幕使用时间**，默认关闭：你在每个应用上花的时间，只保存在这台电脑上，保留 30 天；当日时间线显示你的专注轮次、日程、日出和日落。
- **壁纸**：从 Crest 的精选或你自己的文件夹中为每块屏幕挑选图片，也可以定时更换。精选图片在第一次使用时才下载。
- **刘海里**：收起时显示蓝牙设备的电量；计时器最长 24 小时，记住最近三次的时长，还有带分圈的秒表；硬件页面显示本机 IP，公网 IP 只在你要求时显示。

[1.3.2 版本](https://github.com/andrealo20/crest/releases/tag/v1.3.2)页面提供下载和完整的发布说明（英文），并列出每项改动对应的 issue。

## 1.3.0 新功能

<p align="center"><img src="docs/media/features/crest-1.3.gif" alt="Crest 1.3.0：一个窗口滑到任务栏的 Liquid Glass + 下方，透过玻璃发生弯曲；指针停在一个应用上，显示它各个窗口的实时预览；打开带有任务管理器的 Crest 菜单；把一个小组件沿着任务栏拖动；Material 样式的设置窗口，页面后面的等高线在缓缓移动" width="760" /></p>

- **自己的任务栏**：在 **设置 → 任务栏** 中用 Crest 的任务栏代替 Windows 任务栏，可选停靠、悬浮、胶囊或磁贴，带有固定的应用和打开的窗口、通知区域，以及一个用于 Wi-Fi、蓝牙和音量的快速面板。仅限 Windows，默认关闭，微软商店版暂不提供。
- **实时预览**：应用按钮上方显示它每个窗口的实时画面；Crest 菜单里有任务管理器、添加小组件和自动隐藏。
- **来自你的工具的小组件**：天气、时钟、硬件和计时器都可以选择你喜欢的样式，其他工具也可以放成按钮。沿着任务栏拖动即可调整位置。
- **任务栏的 Liquid Glass +**：在屏幕的实时画面上，沿边缘形成一道很强的透镜，下方移动的窗口会透过它弯曲。需要 x64 上的 Windows 11 24H2 或更高版本，微软商店版暂不提供。
- **Material 样式**：所有 Crest 窗口都采用 Material 3，颜色取自你的主题，字体为 Google Sans Flex，图标为 Material Symbols，设置窗口后面还有缓缓移动的等高线。支持 Windows 和 Mac。
- **设置有了自己的窗口**；专注模式回来了：快速点击三下即可把刘海挪开，由一个默认关闭的开关控制。
- **AI 额度环**在每周额度环内显示 5 小时会话额度，音量、亮度等指示也可以显示在全屏应用上方。

[1.3.0 版本](https://github.com/andrealo20/crest/releases/tag/v1.3.0)页面提供下载和完整的发布说明（英文），并列出每项改动对应的 issue。

## 功能

下面的每个工具都在同一个刘海里，在 Windows 上任务栏也能以小组件和按钮的形式放下它们。在 **设置 → 工具** 中选择你要的工具，拖动排成你喜欢的顺序，其余的不会打扰你。完整指南以及每项集成的设置步骤见 [docs/features.md](docs/features.md)（英文）。

<p align="center"><img src="docs/media/features/tools.png" alt="Material 样式的设置窗口，工具页面：列出 Crest 的每一个工具和它的开关" width="720" /></p>

### 收起的刘海

- **三种样式**：贴住屏幕边缘的刘海、可以拖到任意高度的胶囊，或显示歌曲进度的细线。可放在上、下、左、右任一边缘，大小由你决定。
- **这一行**按你选择的顺序显示你挑选的部分，放不下时轮流显示：封面、计时器、歌名或当前歌词、AI 额度环、CPU、内存、GPU、网络、功耗、电池、温度、时钟、GitHub、LeetCode、天气、下一个日程、下载，以及你自己的脚本设置的部分。
- **通知**会短暂占用这一行：计时结束、待办到期、会议即将开始、刚保存的下载或截图、额度提醒、充电器、蓝牙、网络、大写锁定、音量和亮度。
- **隐私圆点**在麦克风或摄像头使用时变绿，屏幕被录制时变红（在 Windows 上仅限系统自带的截图录屏工具和商店应用，因为 Windows 不为桌面录屏软件留下记录）。
- **宠物**住在刘海旁边的小窝里（如果你想要）：随音乐跳舞，CPU 越忙跑得越快。

### 任务栏

- **代替 Windows 任务栏**（设置 → 任务栏，默认关闭，仅限 Windows，微软商店版暂不提供）：Windows 的开始按钮、固定的应用和打开的窗口、通知区域，以及带任务管理器的 Crest 菜单，每个显示器上都有。关掉它或退出 Crest，Windows 任务栏就会回来。
- **四种形状**：沿整个边缘停靠、悬浮、和按钮一样宽的胶囊，或磁贴。高度、图标大小、背景和透明度都由你决定。
- **实时预览**：指针停在一个应用上时，显示它各个窗口的实时预览，和 Windows 11 一样。
- **文件夹**：把一个固定的应用拖到另一个上停半秒，两者就组成一个文件夹，在任务栏上方的面板中打开。可以把应用拖进拖出、重命名文件夹或取消分组。
- **小组件**：天气、时钟、硬件和计时器可以选择样式，还有任务栏自己的小组件，从常用应用、电池、温度和磁盘空间，到世界时间、汇率、加密货币、屏幕使用时间和未读通知。其他工具可以放成按钮，大多会在任务栏上方的面板中打开；也可以放 Windows 自己的按钮，还有状态按钮，打开 Wi-Fi、蓝牙、音量和亮度的快速面板。沿着任务栏拖动即可调整位置。
- **小组件大小**可在 75% 到 125% 之间调整；任务栏放不下时，一个四个方块的按钮会打开没放下的小组件。时钟始终留在任务栏上。
- **Liquid Glass +**：在屏幕的实时画面上，沿任务栏边缘形成一道很强的透镜，需要 x64 上的 Windows 11 24H2 或更高版本。

### 音乐

- **正在播放**可以控制任何支持 Windows 媒体会话的播放器，显示封面、进度和实时均衡器。
- **同步歌词**来自 LRCLIB、酷狗和网易云音乐，来源按字计时时逐字高亮，收起的刘海里也能显示。
- **翻译和罗马音**：使用来源自带的翻译，或用 Firefox 使用的离线模型在你的电脑上翻译成你选择的语言。日语、中文和韩语可以显示拉丁字母。
- **Discord**：你的语音通话、正在说话的人，以及静音、拒听和挂断按钮。

### 时间与专注

- **计时器**带专注和休息预设、六种提示音、专注时的背景音，以及十几种样式，从像素数字到翻页时钟。
- **世界时钟**最多 12 个城市，拖动滑块可把时间前后移动一天，并显示日出、日落、黄金时刻和月相。
- **休息提醒**：每 20 分钟提醒你休息眼睛，每小时提醒你真正休息一下，按你实际使用电脑的时间计算。演示、全屏应用和勿扰模式期间会等待。
- **屏幕使用时间**，默认关闭：逐小时记录你用了哪些应用、用了多久，只在你的电脑上保留 30 天，从不读取窗口标题；**当日时间线**显示当天的日程、专注轮次和白昼。
- **习惯**显示五周的打卡圆点，偶尔漏掉一天也不会中断连续记录。
- **日历**来自 ICS 链接（Google、Outlook、iCloud）或 CalDAV，每个日程开始前提醒，在线会议有加入按钮。
- **喝水**按每日目标记录，在你设定的时间段内提醒。

### 写作与文件

- **待办**带项目、截止时间和提醒。输入 "call Marco tomorrow 9am"，任务就会带上时间（支持英语和意大利语）。
- **笔记**边写边保存，**代码草稿本**带语法高亮。
- **剪贴板**保存文本、链接、图片和文件的历史，从不写入磁盘。小标签可以解码 JWT、Unix 时间戳、Base64、JSON 或满是跟踪参数的链接。
- **暂存区**：把文件拖到刘海上暂存；**发送到手机**：扫描二维码，手机就能通过你自己的网络从电脑下载这些文件。
- **提词器**按你设定的速度滚动讲稿，还有镜像模式。

### 日常工具

- **概览**：时间、天气、正在播放的歌曲、专注、保持唤醒、音量、亮度，以及 Wi-Fi、蓝牙、深色主题和麦克风的快捷开关。
- **计算器**：笔记本式计算器，能识别单位、日期、百分比、货币和变量。
- **转换器**用于单位换算，以及按各国中央银行参考汇率换算约 160 种货币。
- **取色**：从屏幕任意位置取色，复制为 HEX、RGB、HSL 或 OKLCH，检查对比度并查看配色方案。
- **天气**：当前天气、逐小时和一周预报，数据来自 Open-Meteo。
- **投资组合**：把多个券商的资产换算成一种货币显示，只读。

### 开发者工具

- **终端**：刘海里的 PowerShell 或命令提示符。
- **硬件**：CPU、GPU、内存、网络、功耗、温度、最忙的进程和游戏帧率，还有电脑正在监听的端口以及对应的程序。
- **AI 用量**：Claude、ChatGPT、Antigravity、Cursor 等的额度，附带一行预测每项额度的走向，额度重置时可选择通知你。
- **提问**：用你自己的密钥与你选择的 AI 服务对话，或通过 LM Studio 或 Ollama 使用你电脑上的模型。
- **Agents**：电脑上正在运行的 Claude Code 会话、每个会话在等什么，以及恢复它的命令。
- **GitHub** 和 **LeetCode** 的活动日历和连续天数（只读取 github.com 和 leetcode.com），以及固定应用的**启动器**。
- **crest-notify** 让脚本和构建发送通知、用按钮提问，或在收起的一行里放入自己的部分。

### 截图与录制

- **截图**可截取所有屏幕、单个屏幕或一个区域，**录屏**可带系统声音和麦克风。
- **录音机**只录声音，来自麦克风、系统声音或两者。
- **摄像头**在通话前当镜子用；**屏幕查找**识别所有屏幕上的文字并进行搜索。

### 通知与隐私

- **Windows 通知**显示在刘海里，带历史页面；通知里有一次性验证码时会出现**复制验证码**按钮。可以关闭 Windows 自己的横幅，让每条通知只出现一次。
- **保险库**保存密码和两步验证码，用 PIN 或 Windows Hello 保护，从不进入剪贴板历史。
- **演示模式**在你共享屏幕时隐藏剪贴板、余额、保险库和你的截图录屏；**在屏幕共享中隐藏 Crest** 让 Teams、Zoom、Discord 和 OBS 都看不到任何 Crest 窗口。

### 个性化

<p align="center"><img src="docs/media/features/settings-material.png" alt="Material 样式的设置窗口，主题页面：Crest 和 Material 两种样式、页面背后的等高线、十五个主题、字体和彩色图标" width="760" /></p>

- **主题**：十五个内置主题、主题编辑器、十六种字体、彩色图标、可随日出日落切换的昼夜主题，以及 Windows 上的液态玻璃。
- **壁纸**，默认关闭：24 张图片（18 张来自 Unsplash，每张都注明作者）或你自己的文件夹，每块屏幕单独设置，可每 15 分钟、每小时或每天自动更换。
- 全屏应用和游戏的**窗口规则**，可放在任意**显示器**或所有显示器上，每个面板的大小都可以调整。
- **11 种语言**：英语、简体中文、西班牙语、印地语、从右到左的阿拉伯语、法语、葡萄牙语、俄语、日语、德语和意大利语。
- **插件**：用 HTML、CSS 和 JavaScript 编写你自己的工具，在沙盒中运行（[docs/plugins.md](docs/plugins.md)）。

每个版本的变化见[发布说明](docs/releases)（英文）。

## 安装

- **Microsoft Store：** [Crest Island](https://apps.microsoft.com/detail/9N2KXJ2924KS)，由 Microsoft 签名，并由应用商店自动更新。商店版暂时没有任务栏和 Liquid Glass +。
- **安装程序：** 从[最新版本](https://github.com/andrealo20/crest/releases/latest)下载 `Crest_x.y.z_x64-setup.exe`（Windows on ARM 电脑请下载 `Crest_x.y.z_arm64-setup.exe`）并运行。它只为当前用户安装。安装程序暂未进行代码签名，首次运行时 SmartScreen 可能会提示：点击 **更多信息 → 仍要运行**。
- **便携版：** 把 `Crest-x.y.z-Portable-x64.zip`（或 `-Portable-arm64.zip`）解压到任意可写的位置，运行 `Crest.exe`。不会安装任何东西。
- **Mac（预览版）：** Apple 芯片请下载 `Crest_x.y.z_aarch64.dmg`，Intel 请下载 `Crest_x.y.z_x64.dmg`，然后把 Crest 拖到“应用程序”文件夹。应用暂未经过公证，首次打开时 macOS 会拒绝运行：请打开 **系统设置 → 隐私与安全性 → 仍要打开**。1.2.1 及更早的版本完全没有签名，macOS 会提示应用已损坏：请在“终端”中运行一次 `xattr -dr com.apple.quarantine /Applications/Crest.app`。暂存区、硬件、Discord、保险库、终端、启动器、通知、截取、录音机、摄像头、插件和任务栏目前只支持 Windows，在 Mac 上不会显示；概览里的专注、保持唤醒和音量磁贴、FPS、录制指示点，以及“跟随鼠标指针”和“所有显示器”两种显示器模式也不会出现。“在屏幕上查找”在 Mac 上没有快捷键。

每个版本都附带 `SHA256SUMS` 文件，列出每个下载文件的 SHA-256，可以用 `sha256sum -c SHA256SUMS --ignore-missing` 或 `Get-FileHash` 校验。

需要 Windows 11 或 Windows 10，64 位（x64 或 ARM64），或 macOS 12 及更高版本，Apple 芯片或 Intel（预览版）。

## 数据只留在你的电脑上

不需要账户，没有统计分析，没有跟踪。设置和数据保存在你的电脑上，密钥存放在 Windows 凭据管理器里（Mac 上是钥匙串）。Crest 只会为概览里的天气、每 4 小时一次的更新检查，以及你已登录服务的 AI 额度环自行联网；其他功能都要等你设置之后才会联网。哪些内容会经过网络、什么时候：[PRIVACY.md](PRIVACY.md)（英文）。

## 支持这个项目

Crest 免费，没有广告，也没有付费版本。如果它对你有用，可以[在 GitHub Sponsors 上赞助](https://github.com/sponsors/andrealo20)、给仓库加星，或者[提个建议](https://github.com/andrealo20/crest/issues/new/choose)。

从源码构建和参与贡献：[CONTRIBUTING.md](CONTRIBUTING.md)（英文）。

## 致谢和许可

Crest 是 Linux5Real 的 [L4-Notchbar](https://github.com/Linux5Real/L4-Windows-NotchBar) 的修改版本，于 2026 年 10 月 31 日从 1.6.0 版本分叉。之后的每一处改动都记录在提交历史里。第三方代码和资源的完整来源与许可证列在[英文 README](README.md#credits-and-licences) 中。

Material 风格参照了 [Stellaria](https://github.com/SMIDR76/stellaria-windows)（GPL-3.0，许可证文本见 [licenses/Stellaria-LICENSE](licenses/Stellaria-LICENSE)），而 Stellaria 本身是 caelestia-dots 贡献者的 [Caelestia](https://github.com/caelestia-dots/shell)（GPL-3.0）的移植版本；设置窗口的等高线背景和导航标记，以及硬件工具的负载形状，改编自 Stellaria 的代码，其中等高线着色器的哈希函数开头是 David Hoskins 的整数哈希；它本身的页面无法读取，许可证取自他的 [Hash without Sine](https://www.shadertoy.com/view/4djSRW) 的 MIT 许可声明（许可证文本见 [licenses/HashWithoutSine-MIT.txt](licenses/HashWithoutSine-MIT.txt)）。它的颜色由 Google 的 [material-color-utilities](https://github.com/material-foundation/material-color-utilities)（Apache-2.0，[licenses/material-color-utilities-Apache-2.0.txt](licenses/material-color-utilities-Apache-2.0.txt)）计算。它的文字使用 [Google Sans Flex](https://github.com/googlefonts/googlesans-flex)（SIL Open Font License 1.1，[licenses/GoogleSansFlex-OFL.txt](licenses/GoogleSansFlex-OFL.txt)），取自 Fontsource 文件的一个实例，圆角值为 25，仅含 latin 和 latin-ext。它的图标是 Google 的 [Material Symbols Rounded](https://github.com/google/material-design-icons)（Apache-2.0，[licenses/MaterialSymbols-Apache-2.0.txt](licenses/MaterialSymbols-Apache-2.0.txt)），Crest 只附带从字体中提取的、它用到的那些图标的轮廓。

Crest 是 Andrea Loroni 的独立应用，与 Apple、OmniNotch、Microsoft 和 Google 均无关联，也未获其赞助或认可。

## 许可证

[GPL-3.0](LICENSE)。你可以使用、研究、修改和分享这个项目，包括商业用途，但你分发的任何版本都必须以相同的许可证保持开源，并保留版权声明。壁纸图片不在此许可证之内：每张图片保留各自的条款（[src/assets/wallpapers/CREDITS.md](src/assets/wallpapers/CREDITS.md)）。

Crest 是 L4-Notchbar 1.6.0 的分叉。每个版本（包括 Microsoft Store 版本）的源代码都在这个仓库里：每个版本都有一个版本标签，指向构建它的确切代码。

## Star 历史

<a href="https://www.star-history.com/#andrealo20/crest&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=andrealo20/crest&type=Date&theme=dark" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=andrealo20/crest&type=Date" />
    <img alt="Star history of Crest" src="https://api.star-history.com/svg?repos=andrealo20/crest&type=Date" />
  </picture>
</a>

# 游戏 UI：系统外壳与局内界面

2026-11-01 用户确定的长期方向：游戏作为内容运行在一个系统框架内。系统 UI 与游戏内部 UI 是两套完整的视觉体系；运行中系统面板按需出现。规则适用于游戏中心及后续接入的游戏；V2 的系统实现基线为 HeroUI v3 默认浅色，详见 [V2 规则](../../dashboard-v2/CLAUDE.md) 与 [DESIGN.md](../../dashboard-v2/DESIGN.md)。这里的“系统”是产品的功能外壳，不要求模拟 Switch/macOS，也不要求常驻边框或加载 Console Layout。

## 职责边界

| 系统层 UI | 游戏层 UI |
| --- | --- |
| 游戏中心、游戏入口、账户点数、补助、跨游戏会话 | 游戏场景、棋盘/牌桌、角色、卡牌、筹码等玩法对象 |
| 房间发现、创建、加入、等待/准备、房间配置和成员管理 | 当前回合、行动对象、剩余时间、血量/筹码等局内 HUD |
| 排位/榜单（若新增）、战绩、历史详情、选手档案与版本对比 | 直接玩法操作，如移动、出牌、弃牌、过牌、跟注和下注按钮 |
| 暂停菜单、设置、导航、音效开关、视角切换、提醒入口 | 玩法内选中、行动提示、局部标记和即时胜负反馈 |
| 日志/完整结算、AI 判断/提示词、机器人管理、入座/暂离/离桌、真人/AI 接管 | 发牌、翻牌、筹码流转、收池及与玩法同步的动画和音效 |
| 功能侧栏、弹窗、输入表单、参数滑块/预设、通用确认与加载/错误/重试 | 与场景直接关联的短结果摘要和状态提示 |

判断的是用户正在做什么，不是页面 URL、是否正在游戏、组件是否浮动或是否位于画布里。牌桌中的日志侧栏仍然是系统；画布外的弃牌按钮仍然是游戏。房间等待/准备页用系统 UI；已在牌桌上的“等待对手”、回合暂停原因等简短 HUD 可以继续用游戏表达，不要求新建等待页面。

扑克金额面板与全下确认属于系统：下注/加注主按钮保留玩法视觉，打开的金额输入、滑块和预设组成统一系统表单，全下使用系统确认。宽屏内嵌与窄屏浮层遵守同一视觉归属。打开金额面板不等于提交下注，确认步骤与未知结果重试语义必须保留。

## 呈现与实现约束

- 系统层复用所属子包的共享组件、语义 token、字体、间距、按钮与表单规范；V2 使用标准 HeroUI 默认浅色，禁止扑克材质、游戏专属字体和自制游戏按钮进入系统控件。无需为每款游戏另造一套系统皮肤。
- 局内层允许作用域内独立的游戏美术、布局、HUD、按钮、动画与音效。不能用统一系统 UI 为由将牌桌、牌面或直接玩法操作整体改成后台表格/表单。
- 常态游戏只保留必要 HUD、玩法操作和系统入口；系统面板按需展开，关闭后继续呈现游戏。大厅、房间等待、记录等系统页面可完整占据页面；不强制增加常驻系统侧栏或边框。
- 同一空间可以承载两层，但必须区分表面与职责，不能把日志、管理和玩法按钮包在同一游戏皮肤面板中。无需仅为视觉分层更换业务状态所有者或新增并行业务逻辑。
- Portal 挂载位置只决定定位，不决定皮肤。系统浮层即使在游戏节点内，也必须隔离继承的颜色、字体、CSS 变量及选择器；不能通过覆盖 HeroUI 的 overlay/accent 等 token 将其游戏化。底层复用 HeroUI 不代表视觉已合规。
- 游戏插画、缩略图和真实牌面可作为系统页面里的内容，外层标题、状态、列表、按钮和表单仍是系统 UI。结果也按用途区分：桌面即时赢家反馈属于游戏，日志/历史的完整结算属于系统，牌面内容可复用。
- 系统层的操作入口/状态不能擅自改变玩法。打开菜单不自动暂停服务端倒计时，不离桌、不交接控制权、不隐式出牌；保留账户隔离、权限、隐私投影、控制版本、幂等、未知写结果及全下确认。
- 后续实现继续满足现有 850px 响应式规则、三场景 contain 等比缩放、面板互斥、焦点返回和窄屏主要操作不被遮挡；系统层不随游戏坐标缩放。关闭面板不得重挂游戏或重播历史音画。
- 验收需覆盖大厅/等待等系统页、纯局内状态、系统面板打开/关闭，以及宽窄屏、键盘、焦点、表单状态和主题隔离。仅源码阅读不能声称已完成视觉验收。

## 与历史设计的关系

本规则确立后，V2 的视觉归属以本文件为准。旧的大厅整体游戏调色板、深色建房弹窗、所有牌桌浮层继承游戏主题及管理按钮一律使用 PokerButton 的描述不再作为 V2 目标；V1 代码与历史规格不在此次修改范围。模块边界、接入指南及 V2 迁移清单已标注这一关系。

本次仅记录规则并核对源码，没有改造运行界面、增加排位/等待页面或验证浏览器呈现。历史迁移/测试通过记录不代表现有界面符合本次分层规则。不改变玩法协议、服务端、MCP/Skill 能力、数据库或发布流程；游戏内容继续遵守发布静默规则。

## 现状对照（2026-11-01）

核对对象为 `dashboard-v2/src/game-center/`；[游戏注册表](../../dashboard-v2/src/game-center/game-registry.tsx) 仅注册德州扑克 `/poker`。点数/陪练与标准/短牌是同一游戏的模式/规则，不是其他游戏。未发现独立排位页；房间中的等待主要是牌桌 HUD 状态。

| 现有表面及源码 | 应属层 | 源码现状与处理方向 |
| --- | --- | --- |
| [HallHome](../../dashboard-v2/src/game-center/components/HallHome.tsx)、[GameCard](../../dashboard-v2/src/game-center/components/GameCard.tsx)、[MySessions](../../dashboard-v2/src/game-center/components/MySessions.tsx) | 系统，插画为内容 | 已用 HeroUI Card/Button/Table/Chip；保留该方向，PokerArtwork 不扩散到卡片外壳 |
| [page-shell](../../dashboard-v2/src/game-center/runtime/page-shell.tsx)、[PokerApp](../../dashboard-v2/src/game-center/games/poker/PokerApp.tsx) | 系统导航 | 普通页 HeroUI Tabs/Button，进入房间隐藏业务顶栏；符合按需外壳方向，无需恢复 Console 导航 |
| [LobbyView](../../dashboard-v2/src/game-center/games/poker/components/LobbyView.tsx)、[RoomList](../../dashboard-v2/src/game-center/games/poker/components/RoomList.tsx)、[CreateRoomDialog](../../dashboard-v2/src/game-center/games/poker/components/CreateRoomDialog.tsx) | 系统 | 已用 HeroUI 列表、按钮与标准 Modal 表单；保留。列表中的叠放牌背可保留为内容，不沿用 V1 深色建房规则 |
| [HandRecord](../../dashboard-v2/src/game-center/games/poker/components/HandRecord.tsx)、[AgentProfiles](../../dashboard-v2/src/game-center/games/poker/components/AgentProfiles.tsx)、[PersonaVersions](../../dashboard-v2/src/game-center/games/poker/components/PersonaVersions.tsx) | 系统，牌面为内容 | 已有 HeroUI 表格、Tabs 与字段；继续使用系统布局，不因展示牌局而改为牌桌皮肤 |
| [Table](../../dashboard-v2/src/game-center/games/poker/components/Table.tsx) 的场景、[Seat](../../dashboard-v2/src/game-center/games/poker/components/Seat.tsx)、Card、ChipMotion | 游戏 | 保留专属美术、局内座位/筹码/倒计时、牌面与三场景几何，不随系统改造重做 |
| Table 顶部返回、音效、视角、提醒、日志、更多入口 | 系统 | 当前裸 button + `poker-control` 游戏皮肤；需转为必要的系统入口。房号/手数等信息按局内 HUD 用途保留，不能仅按所在顶栏整块归类 |
| [HumanControls](../../dashboard-v2/src/game-center/games/poker/components/HumanControls.tsx) 的行动状态/倒计时和弃牌/过牌/跟注/下注按钮 | 游戏 | 保留局内 HUD 与 PokerButton 直接动作；业务 hook、合法动作和 actionId 重试逻辑继续复用 |
| HumanControls 的金额输入/滑块/预设、全下确认及错误/重试提示 | 系统 | 当前原生 input、PokerButton 和游戏表单皮肤；后续改为标准系统表单/确认/反馈，保留显式提交与原动作意图 |
| HumanControls 的入座、AI 接入/接管、暂离/回座/离桌 | 系统 | 当前与出牌共用 PokerButton，宽屏常驻、窄屏进入“更多”；应分出系统管理呈现，保留窄屏入口和控制权语义 |
| [PokerControlPopover](../../dashboard-v2/src/game-center/games/poker/components/PokerControlPopover.tsx) | 系统表单/菜单容器 | 已用 HeroUI Popover，但挂到牌桌并应用游戏皮肤、PokerButton 关闭按钮；需隔离系统主题，保留锚点、边界、互斥、Escape 和焦点返回 |
| [SidePanel](../../dashboard-v2/src/game-center/games/poker/components/SidePanel.tsx) 的日志/AI 判断/提示词、[PracticeBots](../../dashboard-v2/src/game-center/games/poker/components/PracticeBots.tsx) | 系统 | HeroUI Tabs 仍被游戏变量重染，机器人管理使用 PokerButton；需统一系统侧栏与管理控件，保留仅本人可读与房主权限 |
| [Settlement](../../dashboard-v2/src/game-center/games/poker/components/Settlement.tsx) | 分两种用途 | `compact=false` 桌上短摘要保留游戏反馈；`compact` 日志内完整结果改用系统布局并复用牌面，不按组件名一刀切 |

优先改造交叉最多的 `HumanControls`、`PokerControlPopover`、`SidePanel` 和 `PracticeBots`，再统一 Table 边缘系统入口；大厅/房间/记录/档案沿用既有系统方向，纯牌桌场景保留。相关样式证据为 [responsive-controls.css](../../dashboard-v2/src/game-center/games/poker/styles/responsive-controls.css) 中的 Tabs token 重映射和 `.poker-control-popover` 覆盖，以及 [table-tokens.css](../../dashboard-v2/src/game-center/games/poker/styles/table-tokens.css) 中的游戏按钮/表单样式。

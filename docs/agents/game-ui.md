# 游戏 UI：系统外壳与局内界面

2026-11-01 用户确定的长期方向：游戏作为内容运行在一个系统框架内。系统 UI 与游戏内部 UI 是两套完整的视觉体系；运行中系统面板按需出现。规则适用于游戏中心及后续接入的游戏；V2 的系统实现基线为 HeroUI v3 默认浅色，详见 [V2 规则](../../dashboard-v2/CLAUDE.md) 与 [DESIGN.md](../../dashboard-v2/DESIGN.md)。这里的“系统”是产品的功能外壳，不要求模拟 Switch/macOS，也不要求常驻边框或加载 Console Layout。

2026-11-01 后续用户批准每手结束展示完整 HeroUI 结算，并要求全员准备后续局，取代历史的五秒自动续局。程序陪练自动准备，AI通过MCP显式seat.ready，真人点击准备；关闭面板、查询和回座不准备。全员指有筹码且未暂离/待离桌的实际座位，新加入者也需确认。正文有界滚动，长内容换行，操作固定于原生Footer，不裁切或隐藏玩家金额；底池、返还和净盈亏分开。详见 `docs/superpowers/specs/2026-11-01-poker-settlement-ready-design.md`。

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

- 2026-11-01 后续用户批准的 V2 当前方向为亮色虚拟对局场：浅灰背景、白色抽象对局区、蓝色行动强调，移除深绿毛毡、厚桌沿、缝线和金色装饰，保留真实牌面与局内音画反馈。本节取代下文历史记录中保留旧材质和常驻右栏的描述。
- V2 宽窄屏统一底部操作条，等待时仍保留其高度；日志/AI 判断/陪练使用覆盖主区域的按需面板，开关不挤压或重挂画布。850px 边界控制紧凑顶栏与房间/会话单列呈现；下注/加注始终先打开系统金额表单，显式提交，保留全下确认。未入座直接显示本人入座和接入 AI。
- 三场景使用各自坐标和字号，整体 contain 缩放，不逆缩放局部文字。当前下注锚点并入座位反馈行，筹码动画仍测量真实 DOM；净结果替代重复状态，完整分池记录留在日志。390px 验收下关键 HUD/座位状态至少12px、筹码至少14px，覆盖390×667与390×844。结果栏始终预留空间，不遮顶部座位。
- `PokerSeatView.isHistorical` 表示仅供上一手回显的历史座位，不能参与管理或容量判断；`inCurrentHand` 按座位与账号共同匹配，false 时不绘制已拿牌，新座位显示下一手加入。两个字段可选，旧响应不推断参与状态；机器人管理必须具有有效 botId，待离桌的当前座位继续占位。
- 管理操作收到写入成功后关闭菜单；后续刷新失败明确提示操作已完成，不误导重发。窄屏牌局记录选择后进入同页详情，返回恢复列表滚动与焦点；大厅默认预览明确标为点数牌局。

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

初次规则提交仅记录规则并核对源码；随后用户明确授权实施，落实情况见下文。未增加排位或等待页面。历史迁移/测试通过记录不代替本次分层验收。不改变玩法协议、服务端、MCP/Skill 能力、数据库或发布流程；游戏内容继续遵守发布静默规则。

## 现状对照（2026-11-01）

以下为改造前的源码快照，用于记录改造依据；不是当前未完成清单。核对对象为 `dashboard-v2/src/game-center/`；[游戏注册表](../../dashboard-v2/src/game-center/game-registry.tsx) 仅注册德州扑克 `/poker`。点数/陪练与标准/短牌是同一游戏的模式/规则，不是其他游戏。未发现独立排位页；房间中的等待主要是牌桌 HUD 状态。

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

实施顺序采用先改造交叉最多的 `HumanControls`、`PokerControlPopover`、`SidePanel` 和 `PracticeBots`，再统一 Table 边缘系统入口；大厅/房间/记录/档案沿用既有系统方向，纯牌桌场景保留。相关样式证据为 [responsive-controls.css](../../dashboard-v2/src/game-center/games/poker/styles/responsive-controls.css) 中的 Tabs token 重映射和 `.poker-control-popover` 覆盖，以及 [table-tokens.css](../../dashboard-v2/src/game-center/games/poker/styles/table-tokens.css) 中的游戏按钮/表单样式。

## V2 实施与验证（2026-11-01）

- 已将 Table 边缘系统入口、日志/AI 判断、陪练管理、完整结算、金额字段/滑块/预设及全下确认分为标准 HeroUI 系统表面；游戏画布、座位、HUD、直接出牌 PokerButton、即时结算与音画实现保留。
- 宽屏座位管理也改为按需菜单，窄屏仍从顶部“更多”进入，二者分别使用实际触发按钮定位并返回焦点。Popover 使用 HeroUI 导出的 `popoverVariants` 官方样式与原有显式 triggerRef/Portal，避免无触发子节点的 DialogTrigger 根组件；不手工重制浮层皮肤。
- 移除了系统 Tabs/Popover 的游戏 token 覆盖。系统表面明确恢复默认字体、文字与 light color-scheme；游戏牌面内容可以继续继承游戏素材参数。全下使用独立 AlertDialog，取消保留金额与触发焦点，只有显式确认才调用原动作。
- 陪练标签内容保持挂载以保留请求上下文，仅在选中时显示；未选中的管理内容不再出现在日志下。完整结算的长连续英文姓名可以换行，遮蔽的手牌仍不渲染。
- 专项 Chromium 固定数据回归实际展开宽窄屏日志、AI 判断、陪练、管理、金额表单和确认，比较真实系统控件背景/字体，检查金额校验、滑块同步、焦点返回、边界、画布稳定及带控制版本的动作。截图位于 `dashboard-v2/src/game-center/games/poker/__tests__/.superpowers/sdd/2026-11-01-poker-system-ui/`，为本机生成产物，无在线链接。
- 验证记录见 [实施计划](../superpowers/plans/2026-11-01-poker-system-ui.md)。本次不部署、不 push、不修改数据库或 MCP/Skill 协议；没有连接真实账号或业务库，固定数据截图不代表线上验收。

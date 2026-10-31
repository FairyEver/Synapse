# Dashboard V2 功能与模板迁移清单

本清单以 `dashboard/src` 的现有路由和业务实现为基线，对照 `dashboard-v2/src` 的实际实现编制。审计日期：2026-11-01。它记录**源码对应关系和验收要求**，不是生产上线或全部浏览器流程已经通过的声明。

## 模板约定

- **D / Shell**：[HeroUI Dashboard Template](https://template-dashboard.heroui.pro/) 的侧栏、账户区、页头和内容区域。
- **D / Overview**：同模板的 Overview、指标 Card、时间筛选、图表和 Tabs。
- **D / Employees**：同模板的 All Employees 表格、身份信息、行操作、Filter / Sort / Columns 和搜索。
- **D / Settings**：同模板 Settings 的分区字段、标签、输入、保存与取消。
- **T / Transactions**：[HeroUI Finances Transactions](https://template-4.heroui.pro/transactions) 的记录表格、筛选、排序、搜索、状态 Chip 和数字对齐。
- **HeroUI 标准弹层**：以上页面的编辑、详情、确认、错误和加载界面使用 HeroUI v3 原生 Modal、Drawer、Dropdown、Alert、Skeleton 等；不将模板里不存在的认证页冒充现成模板。认证页使用 D / Settings 的字段语言和标准 Card 组合。
- **保护内容**：独立文档正文/编辑器和实际牌桌保留专业布局；外围导航、菜单、表单和系统弹层按上述模板及 HeroUI 标准组件重做。

模板只决定展示模式。原有接口、权限、校验、分页参数和操作结果不因参考模板的演示数据而改变。普通用户与管理员分别有自己的导航、路由树、会话和退出动作。页面固定浅色，不跟随系统暗色。

## 入口与路由

下表中的 `:id` 等是路由参数。控制台业务路径由 `/console` 承载；独立资源路径保持根路径。源码中使用 TanStack 的内部路径时不重复加 `/console`。

| 入口/路由 | 实际用途与迁移处理 | 模板/组成 | 验收映射 |
|---|---|---|---|
| `/`、`/console/` | 用户应用；已登录默认进入设置，未登录执行用户会话守卫 | D / Shell | E1、E2 |
| `/admin/` | 管理应用；根据管理会话进入系统概览或管理密钥页 | D / Shell | E1、A1 |
| `/console/sign-in` | 邮箱/密码登录，校验及错误反馈，保留允许的登录后目标 | D / Settings + 标准 Card | U1、E2 |
| `/console/sign-up` | 邮箱、用户名、密码及确认密码注册；处理重复邮箱/用户名；成功后去登录 | D / Settings + 标准 Card | U1 |
| `/console/forgot-password` | 沿用现有行为：转到登录并保留合法回跳；不新增邮件找回功能 | 路由兼容 | U1、E2 |
| `/console/reset-password` | 验证一次性 token；新密码/确认密码；成功、失效、网络异常与重试 | D / Settings + 标准 Card | U1 |
| `/console/auth/desktop` | 校验桌面 PKCE 请求、申请授权、协议打开、失败重试/再次打开及回跳 | D / Settings + 标准 Card | U1、E2 |
| `/console/skill-repositories` | 我的 Skill 仓库列表及入口 | D / Employees | U2 |
| `/console/skill-repositories/explore` | 公开 Skill 搜索、打开、安装与 Fork | D / Employees + 搜索 | U2 |
| `/console/skill-repositories/:repositoryId` | 自有仓库文件、编辑及设置 | D / Settings + 保护内容 | U2 |
| `/console/skills/:ownerHandle/:repositoryName` | 按作者/仓库路径打开公开仓库；沿用当前普通用户会话要求，不改成匿名访问 | D / Employees + 保护内容 | U2、E2 |
| `/console/webhooks`、`/console/webhooks/:webhookId` | 用户 Webhook 列表与详情 | T / Transactions；详情 D / Settings | U3 |
| `/console/webhook-deliveries` | 当前用户投递历史 | T / Transactions | U3 |
| `/console/my-devices` | 个人设备列表与重命名 | D / Employees + 标准 Modal | U4 |
| `/console/settings`、`/console/settings/api-keys` | 个人资料/重置链接与 API 密钥 | D / Settings；使用记录 T / Transactions | U5 |
| `/admin/access` | 管理密钥解锁；与用户登录独立 | D / Settings + 标准 Card | A1 |
| `/admin/system`、`/admin/telemetry` | 系统概览和统计 | D / Overview | A2 |
| `/admin/users`、`/admin/devices` | 用户与全站设备管理 | D / Employees | A3、A4 |
| `/admin/teams`、`/admin/teams/:teamId` | 团队、成员及组织结构管理 | D / Employees；详情 D / Settings | A5 |
| `/admin/mail-internal` | 全站站内信只读列表、详情及往来 | T / Transactions + 标准 Drawer | A6 |
| `/admin/skill-repositories` | 仓库治理、公开链接、移除/恢复 | D / Employees | A7 |
| `/admin/webhook-deliveries`、`/admin/audit-logs` | 全局投递历史和审计记录 | T / Transactions | A8、A9 |
| `/admin/problem-feedback`、`/admin/backup`、`/admin/logs` | 反馈、备份及系统日志 | T / Transactions + 标准确认/Drawer | A10、A11、A12 |
| `/drive/items/:itemId?surface=standalone` | 自有文件/文件夹独立阅读与编辑，不显示 Dashboard Layout | 保护内容 + HeroUI 外围 | R1—R5 |
| `/share/:shareId`、`/share/:shareId/items/:browserItemId` | 公开分享及分享目录内下钻；密码与权限状态沿用原协议 | 保护内容 + HeroUI 外围 | R1—R5 |
| `/notifications/:notificationId/open` | 读取讨论通知、标记已读、验证解析目标并定位讨论 | 标准加载/错误/重试 | R4、E2 |
| `/desktop/update` | 独立更新承接：申请凭证、协议打开、重试和焦点恢复；仍拒绝 query | D / Settings + 标准 Button | E3 |
| `/game/`、`/game/poker` | 独立游戏大厅和房间列表；控制台通过新标签页进入 | D / Shell、D / Overview、T / Transactions | G1、G2 |
| `/game/poker/:roomCode`、`/game/poker/records`、`/game/poker/agents` | 牌桌、记录、选手档案；保留浏览器前进/后退 | 牌桌保护内容；其余 T / Transactions、D / Settings | G2—G5 |
| 未知路径、请求失败 | 统一 404 与错误边界；保持恢复/返回操作 | 标准 HeroUI 状态 | E1、E2 |

### 明确移除及兼容处理

| 原入口/能力 | V2 处理 | 保留边界/验收 |
|---|---|---|
| 普通用户侧栏“网盘” | 移除 | 导航和静态边界检查；R1 |
| `/console/drive` 的全部视图，含 `?view=files`、目录页、公开素材、回收站和站点等控制台管理入口 | 不提供管理页面，显示 404（开发/预览入口直接返回 HTTP 404）；不建立替代文件管理列表 | 原有云盘数据和服务端能力不删；独立文件夹阅读不受此限制 |
| 管理员侧栏“云盘管理”、`/admin/drive` 及子路径 | 移除 | 全站文件治理、公开素材、文档图片、存储统计 UI 均不迁入 V2 |
| `/drive`、`/drive/` | 不再作为全盘列表入口，返回 404 | `/drive/items/:id` 继续保留 |
| `/console/drive/items/:id`、`/dashboard/drive/items/:id` | 转到 `/drive/items/:id?surface=standalone`，保留其他 query 和 hash | 讨论目标不丢失；R1、R4 |
| 阅读器“在云盘/控制台打开” | 移除，不生成已退役链接 | 下载、复制分享链接、版本、打开方式和编辑继续按权限提供 |
| 旧 `/dashboard/...` 前缀 | 由显式 Web 入口策略处理；云盘详情先转独立地址，云盘列表先 404，其余兼容入口转 `/console/...` | 不将兼容跳转当作新页面；E1 |
| 用户团队、邀请等原已退役入口 | 继续 404，不在此次 UI 改造中恢复 | 管理员现有团队/组织功能按实际代码保留 |

## 用户功能操作清单

| ID / 功能 | 已在 V2 源码找到的操作、状态与限制 | 推荐模板与具体组件 | 自动化/浏览器验收点 |
|---|---|---|---|
| U1 认证 | 登录；注册及密码确认；重复字段错误；重置 token 验证/确认/失效；桌面授权校验、申请、协议打开及重试；用户会话建立/清理及安全回跳。注册不会自动当成已登录 | D / Settings 字段、TextField/PasswordInput、Card、Button、FieldError | auth 各专项测试；桌面 callback、redirect/session API 测试；真实登录、刷新、失效、回跳 |
| U2 我的 Skills | 列表、刷新、打开详情；“新建”仍只提示通过桌面上传，不伪造 Web 新建能力；目录导航、文件选择/预览/下载；文本重载、保存及版本冲突；文件重命名、删除；仓库名/标题/描述/可见性保存；输入仓库名后删除；安装 deep link | D / Employees 表格与行操作；D / Settings；专业内容/Monaco 保留 | skill-repository-pages、view-model、API、编辑生命周期测试；确认保存、冲突、删除和安装链接 |
| U2 探索与公开 Skills | 搜索公开仓库；打开规范作者路径并处理重命名后的 canonical 跳转；安装、Fork；作者可进入自有设置；只读文件浏览/下载。探索沿用当前首批 20 条，不声称新增分页 | D / Employees 搜索表格、Chip、Button；只读内容区 | skill-repository-pages、api 测试；搜索、Fork 后转新仓库、只读权限 |
| U3 Webhooks | 列表分页/排序；新建与编辑名称；详情；启用/禁用；删除确认；重置密钥确认；仅在创建/重置后显示一次完整 URL 并支持复制；列表/详情缓存同步 | T / Transactions 列表、状态 Chip、行操作；D / Settings Modal；ConfirmDialog | webhook display/error/cache/reset-secret/pagination 测试；新建→一次性 URL→编辑→启停→重置→删除 |
| U3 投递历史 | Webhook ID、状态、开始/结束日期筛选；服务器分页/排序；详情含请求路径、Body 摘要/预览、Query/Headers、客户端回执及错误 | T / Transactions；Select、Input、Drawer | webhook history display/query 测试；筛选、排序、翻页、详情与空/错状态 |
| U4 我的设备 | 列表、服务器分页/排序；在线事件合并/重排；重连后刷新；设备别名编辑和校验；换会话清理旧设备状态 | D / Employees；标准 Modal | device-utils、session/API 测试；设备别名保存、实时上下线与身份切换 |
| U5 个人资料 | 显示登录邮箱与状态；用户名、昵称、联系邮箱校验；只提交变更字段；保存后更新当前身份；生成自己的密码重置链接、显示到期时间、复制、关闭即清理 | D / Settings；Input、Label、Button、Modal | profile-settings、密码重置及 auth 测试；保存/无效字段/链接一次性展示 |
| U5 API 密钥 | 加载 capability 范围；按范围选择创建；一次性显示并复制完整密钥；重命名；编辑权限；撤销确认；打开使用记录并分页/排序；范围说明链接；失败重试及弹层焦点恢复 | D / Settings 创建与权限选择；T / Transactions 密钥及使用记录 | api-keys-settings、api 测试；创建→复制→权限编辑→重命名→使用记录→撤销 |
| U6 账户与布局 | 账户菜单、独立退出、导航、窄屏侧栏；主区域/侧栏滚动；移除外观配置和主题切换 | D / Shell；HeroUI Dropdown、Drawer、ScrollShadow（仅合适区域） | layout/navigation、sign-out/session 测试；键盘、窄屏、长页面滚动 |

## 管理员功能操作清单

| ID / 功能 | 已在 V2 源码找到的操作、查询与写入 | 推荐模板与具体组件 | 自动化/浏览器验收点 |
|---|---|---|---|
| A1 解锁/退出 | 输入管理密钥；仅 400/401 显示“密钥无效”；Origin、服务和网络错误分别处理；每次请求后清空输入；合法目标回跳；独立管理退出，不能代替用户身份 | D / Settings + Card、Form、TextField、FieldError | admin-access 5 项测试、admin-store/query-retry/redirect/API 测试；双会话互不影响 |
| A2 系统概览 | 用户/审计/服务器时间指标；概览/活动 Tabs；7 天增长与审计图表、账号状态比例；加载、错误重试和无数据 | D / Overview；Card、Tabs、ProgressBar、既有 Recharts | system-error；真实指标、Tabs、错误恢复、图表尺寸 |
| A2 埋点统计 | 7/30/90/180 天；登录/匿名身份；服务端搜索用户；模块、事件、应用版本、平台、浏览器及版本、OS 及版本、窗口类型筛选；事件/活跃/失败趋势；高频维度；功能采用、漏斗切换、留存 | D / Overview 的指标/图表；Select、Popover/Input/ListBox | 统计查询源码对应与浏览器验收；切匿名清除用户、筛选组合、无数据/错误、图表缩放 |
| A3 用户管理 | 邮箱/用户名/昵称独立搜索；分页/排序；用户导出；在线客户端快照+事件合并、未知/不稳定状态；用户名、昵称、备注编辑；启用/禁用确认；为有效用户生成一次性重置链接并复制 | D / Employees；Dropdown 行操作、Modal、ConfirmDialog | users status-confirm/live-client/error 测试；搜索、编辑、禁用确认、导出、重置链接 |
| A4 全站设备 | 用户/设备身份、状态、平台、版本与在线时间；分页/排序及失败重试。此页面没有新增远程控制或删除设备能力 | D / Employees | device-utils/API；状态、排序、分页、错误恢复 |
| A5 团队 | 列表/分页/排序；新建、重命名、删除确认；进入详情；查看团队成员；搜索可添加用户、加载后续候选并保留跨页勾选；添加/移除成员 | D / Employees；D / Settings 详情；Checkbox、Modal、Dropdown | teams-page 测试；新建→重命名→候选搜索/翻页/勾选→添加/移除→删除 |
| A5 组织 | 团队详情中的组织树；创建、改名/调整父级、删除；直属成员分页；候选搜索/添加、移除成员；避免父子循环选项 | D / Settings 的分区结构；Select/ListBox、Modal 和公共表格 | teams/organizations 实现与浏览器验收；层级调整、直属成员与删除确认 |
| A6 站内信治理 | 主题/正文/发件人/收件人搜索；信件类型、团队、日期筛选；分页/排序；详情/投递统计/附件元数据；以纯文本展示正文；往来中的回复/转发及加载更早记录。此后台没有新增发送、正文编辑或附件下载操作 | T / Transactions；Drawer、Chip、公共列表 | mail/index 测试；正文不执行 HTML/脚本、详情/往来、筛选分页 |
| A7 Skill 仓库治理 | query、有效/移除状态、分页/排序；作者/可见性/更新时间展示；独立打开普通用户公开路径；移除确认和恢复 | D / Employees；Chip、Link、ConfirmDialog | skill-repository-admin 3 项测试；canonical 链接、移除/恢复、筛选 |
| A8 全局投递历史 | 用户或 userId、Webhook ID、投递状态、日期筛选；分页/排序；与用户历史共享详情/回执展示 | T / Transactions；Drawer | history helper/query 测试；管理范围、用户筛选与详情 |
| A9 审计 | 操作类型筛选；分页/排序；主体/目标/IP/时间；导出；失败重试。导出按原 API 的 action 参数执行 | T / Transactions；Input、公共列表、Button | API 与 query 契约；筛选、翻页、排序、CSV 下载 |
| A10 反馈 | 接收时间/纯文本预览；分页；行或按钮打开完整正文；删除二次确认；删除后刷新；完整正文保持纯文本，不执行脚本/链接 | T / Transactions；Drawer、ConfirmDialog | feedback preview/index 测试；原文、翻页、删除取消/确认 |
| A11 备份 | 列表、大小/时间、分页/排序；触发备份；下载成功/失败反馈；删除二次确认；加载/错误重试 | T / Transactions；公共列表、ConfirmDialog | backup index/download/error 测试；备份、下载、删除及错误 |
| A12 系统日志 | 级别与条数筛选；时间/级别/正文；下载；清理保留期以前日志的二次确认；清理结果反馈；错误重试 | T / Transactions；HeroUI Table、Chip、Input/Select | logs cleanup/date/result/error/levels 测试；筛选、下载、清理取消/确认 |

## 独立文档、分享和评论

这些是用户明确要求保护的阅读/编辑能力；不因移除 Dashboard 云盘管理页而移除。

| ID / 场景 | 保留动作与边界 | 模板与保护范围 | 验收映射 |
|---|---|---|---|
| R1 独立入口/目录 | 自有文件会话校验；独立文件或目录打开；分享根/子项；面包屑与范围内下钻；子项加载更多和重试；文件/目录下载；分享密码校验、失效与权限状态 | HeroUI 外围；目录可参考 T / Transactions；不恢复全盘管理入口 | web-entrypoints、drive-browser/use-drive-browser、分享入口测试；直达/刷新/登录返回/分享目录 |
| R2 查看与导出 | Markdown 预览、MDXEditor、源码/Monaco、图片、HTML iframe、下载降级；选择可用打开方式；图片放大；复制已有分享链接；Markdown 导出 PDF | 正文/媒体/专业编辑器保护；外围使用标准 Toolbar/Dropdown/Modal | renderer-registry/shell/actions、code/markdown/mdxeditor、PDF export 测试；不同文件和浏览器能力 |
| R3 编辑与版本 | 按实时权限编辑文本；重载/保存/冲突与未保存离开确认；协作状态与 Yjs；正文图片上传；富文本/源码切换；历史版本加载更多、下载、固定/取消固定、恢复/删除确认及草稿警告 | 专业内容保护；版本 T / Transactions + HeroUI Modal/ConfirmDialog | editor-lifecycle/collaboration/code、版本、图片上传测试；双端修改、冲突、恢复版本 |
| R4 批注、留言与通知 | 文字/图片选区批注；回复、编辑/删除评论、讨论状态切换；文末留言与回复及图片；已有讨论定位/高亮；通知读取、标记已读、可信目标校验；权限不足或目标失效不跳到其他内容 | 评论交互 HeroUI；锚点/几何算法、正文 DOM 和滚动节点保护 | annotations/messages/discussion-location/notification、comment rail 和 telemetry 测试；深链、权限、失效、输入草稿保持 |
| R5 滚动与兼容 | 正文实际滚动 ref、选区与图片坐标、ResizeObserver、目录/评论联动、分栏/窄屏面板；保留 Markdown 排版；不在正文/评论层增加 ScrollShadow；分享加载前能力检测和服务端零脚本 Reader | 保护内容；外围 Drawer/Modal 不改变坐标基准 | geometry/image/hook、comments rail、editor typography/list/mermaid 等浏览器测试；图片延迟、分栏拖动、卡片展开、缩放与读写切换 |

旧控制台专属“新窗口打开”动作不再承担进入独立阅读器的入口；V2 从桌面链接、分享或已兼容转换的详情 URL 直接进入独立页面。保留已有分享链接复制，不新增 Web 云盘分享管理。

## 游戏外围与受保护内容

本节只用于开发迁移验收，不进入发布说明、更新日志或发布通知。

| ID / 页面 | 保留动作与交互 | 模板与定制界线 | 验收映射 |
|---|---|---|---|
| G1 大厅 | 总/可用/游戏中点数与累计盈亏；可进入游戏；当前会话继续；符合既有条件时领取每日补助；查询错误恢复 | D / Overview 指标 Card、D / Shell、HeroUI Button；保留必要游戏预览素材 | hall-home/account/query/session 测试；登录、会话恢复、补助条件 |
| G2 房间与建房 | 点数/陪练筛选；加入房间；名称、规则（52/32 张）、盲注、座位数、带入/初始筹码；草稿按 userId 隔离；创建请求幂等/忙碌/重试；关闭后的焦点返回 | T / Transactions 房间列表；D / Settings + 标准 Modal/RadioGroup/Input/Button 建房 | room-list/room-creation/unified-lobby/profile-room-filter 测试；全部选项、边界、异步结果、键盘 |
| G3 牌桌 | 入座、离座、控制权、下注/跟注/弃牌等真人动作、陪练机器人、视角、提醒、音效开关、牌桌日志及结算；保留身份/epoch/未知写结果规则 | 实际牌桌/卡牌/筹码/下注/动画/音效/三场景缩放保护；Tabs/Popover 底层 HeroUI，专属皮肤和 Portal 定位保留 | table/adaptive/responsive/human-controls/action-identity/event-history/motion/audio 测试；850px 两侧布局、浮层、焦点与音画 |
| G4 记录 | 点数/陪练筛选；前后页；选择某手查看规则、牌面、座位、盈亏、各轮动作、动作来源/档案版本 | T / Transactions 的主从记录布局；真实牌面素材保留 | record-streets/event-history 测试；分页、详情及动作归属 |
| G5 选手档案 | 列表/选择；新增或编辑选手资料、规则/模式相关字段；保存；历史版本查看与比较；房间内相关档案绑定/展示 | D / Settings 的表单分区；D / Employees 列表；版本对照用 HeroUI Table | agent-profiles/profile-room-filter/practice 测试；保存、版本对照、切身份与房间绑定 |

游戏前端 bridge 的现有 operation 清单与 V1 对照未发现丢失；本次不改变服务端玩法或 MCP 协议。

## 集成验证记录

2026-11-01 在当前 main 完成本地验证，未部署、未 push。

- 全包单元与交互测试：131 个文件、1,044 项通过；真实 Chromium：11 个文件、44 项通过。浏览器回归包含 Markdown/MDXEditor 评论几何、图片延迟加载、分栏、评论展开、目录联动、分享目录、更新承接页，以及宽表格内部横向滚动和桌面分页布局。
- V2 的类型检查、UI 依赖/固定浅色边界检查、四入口生产构建通过；旧 Dashboard 构建通过。专业编辑器的大文件分包仍产生既有构建体积提示。
- 依赖全部复用仓库已有锁定版本；frozen-lockfile 安装和供应链策略检查通过。锁文件只新增/调整 V2 importer，不变更旧版或其他子包的依赖快照。
- 构建选择器 6 项行为测试通过；另有本地隔离启动/构建相关回归通过；`bash -n deploy.sh` 通过。默认 V1，显式 `DASHBOARD_UI=v2` 才选择 V2。本次没有构建容器镜像或执行部署。
- bsk 使用本机独立 `_e2e` 数据库，验证了注册、用户登录、资料修改并保存、API 密钥权限选择及取消草稿、管理员解锁、创建团队及打开详情、用户/管理员双会话，以及独立游戏大厅、HeroUI 建房和原牌桌/日志外观。没有写入生产数据或外部云存储。
- 本地实测普通用户和管理员退役云盘入口均返回 HTTP 404；旧嵌入文件详情链接转到 `/drive/items/:id?surface=standalone`，保留讨论参数与 hash；独立阅读器不带 Dashboard 导航。
- 独立静态代码审阅发现的生产入口旧详情跳转遗漏已修复：统一跳转策略在生产入口 bootstrap 的会话请求和页面挂载前执行，并经过审阅复核。独立文件/通知的登录守卫及 401 也统一使用可刷新的 `/console/sign-in`；有回归测试保留原目标及讨论位置。

### 验收边界

自动化覆盖表中业务行为；本次真实后端浏览器抽查不等于每个 U/A/R/G/E 操作逐一在生产环境执行。专业文档内容、上传、协作、分享权限、下载及评论定位的浏览器回归使用隔离夹具；未向实际 COS 写入或触发正式通知。容器镜像和正式站点切换仍属于后续部署验收。

复验入口：

```bash
pnpm --filter @synapse/dashboard-v2 test
pnpm --filter @synapse/dashboard-v2 test:browser
pnpm --filter @synapse/dashboard-v2 check:ui
pnpm --filter @synapse/dashboard-v2 build
pnpm --filter @synapse/dashboard build
node --test scripts/deploy/dashboard-ui.test.mjs
```

将来明确要求部署 V2 时使用 `DASHBOARD_UI=v2 bash deploy.sh`；省略或置空选择器始终构建 V1。原 URL 与最终容器产物目录不变，不混用两版资源；回滚选择 V1 后整包重建。

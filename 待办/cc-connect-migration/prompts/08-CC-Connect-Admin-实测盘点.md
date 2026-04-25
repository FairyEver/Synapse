# 提示词 08：CC Connect Admin 实测盘点

把下面提示词完整发送给 Codex。

````text
目标：使用 Chrome DevTools MCP 完整操作并记录当前可运行的 CC Connect Admin 外部功能、页面功能排布、界面结构、交互细节和功能之间的连接关系，形成后续重新规划和重新开发 3S 迁移时必须引用的真实产品基准。本阶段只做实测盘点和记录，不写 3S 代码，不修改迁移实现。

角色与职责：
你是资深产品验收负责人 + QA 探索测试负责人 + 前端信息架构分析师。你的职责是像真实用户一样完整浏览 CC Connect Admin，点击所有安全可点击的入口、卡片、Tab、列表项、下拉菜单、抽屉、弹窗、面板和可展开区域，记录每个页面的样子、功能、字段、状态、操作路径、交互结果、页面功能排布以及功能之间如何互相跳转和关联。你不能只看表层导航，不能只根据代码或已有计划猜测功能，不能跳过详情页、二级页面、列表项、卡片、命令面板、最近会话、查看全部、滚动区域、表单选项和错误/空状态。

正式观察对象：

```text
CC Connect Admin URL: http://localhost:9820/
CC Connect 源码路径: /Users/liyang/Desktop/code-guide/cc-connect-main
3S/Synapse 仓库路径: 当前仓库
```

## 工具硬性要求

必须使用 Chrome DevTools MCP 查看和操作页面。优先使用以下工具能力：

```text
mcp__chrome-devtools__list_pages
mcp__chrome-devtools__select_page
mcp__chrome-devtools__take_snapshot
mcp__chrome-devtools__click
mcp__chrome-devtools__hover
mcp__chrome-devtools__fill
mcp__chrome-devtools__press_key
mcp__chrome-devtools__evaluate_script
mcp__chrome-devtools__take_screenshot
mcp__chrome-devtools__list_network_requests
mcp__chrome-devtools__list_console_messages
```

不同客户端可能把工具名显示为 `mcp__chrome-devtools__*` 或 `mcp__chrome_devtools__*`。两者都表示同一个 Chrome DevTools MCP；看到任一形式都应使用它。

第一步必须执行 `list_pages`，找到已经打开的 `http://localhost:9820/`、`http://localhost:9820/projects` 或其他 `localhost:9820` 页面，然后用 `select_page` 切换到该页面。不要优先打开 Codex 内置浏览器，不要优先创建新的隔离浏览器 profile。

如果 `list_pages` 中存在已经登录成功的 `localhost:9820` 页面，必须使用这个页面继续实测。原因：这个页面复用了用户 Chrome 中的 cookie、localStorage 和 Admin API token，可以真实看到后台功能。Codex 内置浏览器或新 profile 通常没有这些登录态，会被重定向到登录/令牌页。

如果 Chrome DevTools MCP 不可用，或 `list_pages` 找不到任何 `localhost:9820` 页面，必须暂停并记录阻塞原因，不要退回到普通浏览器猜测，不要用源码替代实测。

每次进入新页面、打开弹窗/抽屉/面板、切换 Tab、展开命令面板、滚动到新的内容区域后，都必须重新执行 `take_snapshot` 记录页面结构。每个一级页面和关键弹窗/抽屉还必须执行 `take_screenshot` 保存截图证据。

截图保存目录：

```text
待办/cc-connect-migration/artifacts/8.screenshots/
```

截图命名规则：

```text
8-<序号>-<页面或弹窗英文短名>.png
```

可以用 `evaluate_script` 辅助枚举 DOM 中的按钮、链接、输入框、Tab、弹窗、滚动容器和路由，但不能只依赖脚本枚举。所有安全可点击控件必须实际点击或明确记录跳过原因。

如果当前 Chrome 已经打开 `http://localhost:9820/` 且能看到 CC Connect Admin 菜单，应继续使用这个已登录窗口完成实测。只有在无法访问已登录 Chrome 的情况下，才可以打开新的浏览器页面。

如果进入的是“输入服务器地址 / API 令牌”的页面，必须先判断这是否是因为浏览器 profile 隔离导致登录态缺失：

1. 如果用户已有 Chrome 窗口能正常使用 Admin，则切换到该 Chrome 窗口继续，不要在隔离浏览器中继续。
2. 如果无法切换到已登录 Chrome，暂停并请求用户授权下一步，不要自行读取、猜测、复制或输入 API token。
3. 不要把“隔离浏览器缺少 token”记录为 CC Connect Admin 功能阻塞，也不要据此判定后台不可用；只能记录为“实测工具登录态不可用”。

若无法通过 Chrome DevTools MCP 操作已登录页面，必须停止并在输出文件中记录阻塞原因，不允许凭空补全。

安全边界：

1. 默认只观察、不改数据。
2. 可以点击导航、卡片、详情链接、Tab、展开/收起、下拉菜单、命令面板、查看全部、搜索框、输入框聚焦、弹窗打开、抽屉打开、分页、刷新、语言切换、主题切换。
3. 可以打开“新增/编辑/配置”类弹窗或页面来记录字段、选项、校验、按钮和布局，但不要点击最终保存、提交、删除、清空、重置、退出登录、真正发送消息、真正执行命令、真正触发定时任务、真正连接外部服务。
4. 如果某个功能只有保存或创建后才能继续观察，记录为 `needs-user-confirmation`，不要自行创建真实数据。
5. 如果需要临时数据才能覆盖完整流程，先在产物中写明需要创建什么临时数据、为什么需要、会影响什么，不要擅自创建。
6. 不要删除、覆盖、清空或重置任何现有项目、服务商、技能、对话、定时任务、系统配置。
7. 不要启动、停止、重启或调用任何可能影响真实外部服务的任务。

前置读取：

请读取以下文件作为背景，但不得用它们替代实测：

1. 当前仓库 AGENTS.md
2. 待办/cc-connect-migration/整体标准.md
3. 待办/cc-connect-migration/artifacts/1.2-feature-manifest.md
4. 待办/cc-connect-migration/artifacts/2.2-product-design.md
5. 待办/cc-connect-migration/artifacts/7.1-final-audit.md
6. 待办/cc-connect-migration/artifacts/7.2-reverse-coverage-check.md
7. CC Connect 源码中 Web Admin 相关目录，例如 `/Users/liyang/Desktop/code-guide/cc-connect-main/web`、路由、页面、组件、API client、store、i18n、测试和配置文件

实测总原则：

1. 先画站点地图，再逐页进入。
2. 每个左侧菜单都必须进入。
3. 每个页面上的每个可见按钮、链接、卡片、列表项、Tab、下拉、图标按钮、分页、搜索、过滤、刷新、展开区域都必须判断是否可安全点击；安全则点击并记录结果，不安全则记录原因。
4. 每个列表至少点击一个代表性条目；如果列表中条目类型不同，必须分别点击不同类型。
5. 每个卡片至少点击一次；如果卡片内还有箭头、查看全部、二级入口、标签、操作按钮，必须分别记录。
6. 每个页面都要记录：URL、标题、导航位置、主区域布局、顶部工具、空状态、加载状态、错误状态、表单字段、按钮、弹窗、抽屉、Tab、列表列、卡片字段、可滚动面板。
7. 对话/聊天页面必须记录输入框、发送按钮、命令入口、命令面板、命令列表、可滚动区域、附件/语音/图片/文件/二维码等入口是否存在，以及点击后的表现。
8. 概览页必须记录统计卡片、最近会话、查看全部、项目卡片、服务状态、系统状态、任何图表或状态区。
9. 项目页必须记录新增项目入口、项目卡片、项目详情页、项目下的会话、配置、成员/连接/技能/服务商等二级区域。
10. 服务商页必须记录新增/编辑服务商弹窗或页面、字段、Provider 类型、模型配置、密钥配置、测试连接或校验入口。
11. 技能页必须记录技能列表、技能详情、启用/禁用、配置、创建/导入/编辑入口。
12. 定时任务页必须记录任务列表、创建/编辑任务字段、调度表达、启用/禁用、执行记录或日志入口。
13. 系统页必须记录配置项、版本信息、更新、日志、诊断、导入导出、语言、主题、安全和其他系统设置。
14. 如果页面中有滚动容器，必须滚动到底并记录底部内容。
15. 如果页面中有弹窗/抽屉，必须记录打开方式、标题、字段、按钮、关闭方式和是否有二级交互。
16. 如果有隐藏在 icon button 中的功能，必须通过 tooltip、可访问性名称、点击后结果或源码定位记录其含义。
17. 必须记录页面功能排布：左侧导航、顶部工具、主内容区、列表/卡片区域、详情区域、底部区域、弹窗/抽屉层级，以及功能入口在这些区域中的位置。
18. 必须记录功能连接关系：从哪个页面进入哪个详情、哪个卡片跳到哪个会话、哪个“查看全部”跳到哪个列表、哪个配置影响哪个项目/服务商/技能/任务。
19. 必须记录信息层级：一级页面、二级详情、Tab、弹窗、抽屉、Popover、命令面板、滚动子面板之间的父子关系。
20. 如果页面文字、按钮或图标只在截图中可见但 snapshot 不清楚，必须结合截图描述，不要漏掉。

建议操作顺序：

1. 进入 `http://localhost:9820/`，记录初始页面。
2. 记录整体 App Shell：左侧导航、顶部工具、底部版本信息、语言、主题、刷新、退出等，并保存总览截图。
3. 依次进入：
   - 概览
   - 项目
   - 项目详情：逐个点击现有项目卡片，记录每个项目详情内的全部 Tab、按钮、列表和二级入口
   - 服务商
   - 技能
   - 对话
   - 定时任务
   - 系统
4. 回到概览页，点击概览页所有安全入口，包括统计卡片、查看全部、最近会话、项目卡片和任何二级链接。
5. 对每个页面重复：查看顶部、主区域、底部；点击安全控件；打开弹窗/抽屉；切换 Tab；滚动面板；记录字段和结果。
6. 对每个页面重复：用 `evaluate_script` 枚举当前 DOM 中的交互元素，与实际点击台账交叉检查。
7. 结合 CC Connect Web Admin 源码，反向确认是否有页面路由或组件没有在实测中触达；如果发现未触达路由，尝试通过页面入口或直接 URL 访问并记录。

必须生成或更新以下文件：

```text
待办/cc-connect-migration/artifacts/8.1-cc-connect-admin-walkthrough.md
待办/cc-connect-migration/artifacts/8.2-cc-connect-admin-screen-map.md
待办/cc-connect-migration/artifacts/8.3-cc-connect-admin-interaction-ledger.md
待办/cc-connect-migration/artifacts/8.4-cc-connect-admin-to-3s-gap-list.md
待办/cc-connect-migration/artifacts/8.5-cc-connect-admin-layout-and-flow-map.md
```

如果 `待办/cc-connect-migration/artifacts/` 不存在，先创建该目录。
如果 `待办/cc-connect-migration/artifacts/8.screenshots/` 不存在，先创建该目录。

`8.1-cc-connect-admin-walkthrough.md` 必须包含：

1. 实测时间
2. 实测环境和 URL
3. 是否登录成功
4. 操作顺序日志
5. 每一步点击对象
6. 点击前页面
7. 点击后结果
8. 是否安全执行
9. 是否因为安全边界跳过
10. 截止时未覆盖项
11. 阻塞项
12. Chrome DevTools MCP 使用记录：使用了哪些页面、哪些 snapshot、哪些 screenshot、哪些 evaluate_script 检查

`8.2-cc-connect-admin-screen-map.md` 必须按页面记录，每个页面至少包含：

1. 页面名称
2. URL / 路由
3. 入口路径
4. 页面整体布局描述
5. 顶部工具
6. 主内容区
7. 左侧/右侧/底部区域
8. 卡片、列表、表格、Tab、面板、弹窗、抽屉
9. 字段名称、字段类型、默认值、可选项
10. 按钮和操作
11. 空状态、错误状态、加载状态
12. 滚动区域和底部内容
13. 与源码路由或组件的对应关系
14. 对应的 CC ID，如果已有；没有则标记为 `new-candidate`
15. 截图证据路径

`8.3-cc-connect-admin-interaction-ledger.md` 必须是交互台账，每一行至少包含：

```text
交互 ID
页面
URL
控件类型
控件文本或图标含义
位置
操作方式
点击/切换/输入后的结果
是否改变数据
是否执行
是否跳过
跳过原因
对应源码路径
对应 CC ID
是否需要迁移到 3S
3S 预期入口
备注
```

`8.5-cc-connect-admin-layout-and-flow-map.md` 必须专门记录页面功能排布和功能连接关系，至少包含：

```text
页面 / 功能区
URL / 路由
上级入口
下级入口
左侧导航位置
顶部工具
主内容区排布
卡片 / 列表 / 表格 / Tab / 表单布局
弹窗 / 抽屉 / Popover / 命令面板层级
从这里可以跳转到哪里
哪些数据或配置会影响其他页面
关键截图路径
对应源码组件
对应 CC ID 或 new-candidate
3S 应如何承接这个布局和流程
```

`8.4-cc-connect-admin-to-3s-gap-list.md` 必须列出当前 3S 已实现内容与 CC Connect Admin 实测结果之间的差距，每一项至少包含：

```text
差距 ID
CC Connect Admin 页面/功能
实测证据
当前 3S 是否有入口
当前 3S 是否有真实可用功能
缺失类型：入口缺失 / 页面空壳 / 逻辑缺失 / 表单缺失 / 二级流程缺失 / 状态缺失 / 错误处理缺失 / 数据兼容缺失 / 未确认
影响
建议纳入的 CC ID
建议开发批次
是否阻塞迁移完成
```

覆盖检查要求：

1. 必须列出所有左侧菜单并标记 `covered / blocked`。
2. 必须列出所有发现的 URL/路由并标记 `covered / blocked`。
3. 必须列出所有弹窗/抽屉/Popover/Dropdown/Tab 并标记 `covered / blocked`。
4. 必须列出所有表单字段和选项。
5. 必须列出所有没有点击的控件，并说明为什么没有点击。
6. 必须列出所有因安全边界不能执行的动作。
7. 必须通过 Web Admin 源码反查路由和组件，确认实测没有遗漏明显页面。
8. 如果发现源码中存在但页面没入口的功能，记录为 `source-only-candidate`。
9. 如果页面中存在但原 manifest 没有对应 CC ID 的功能，记录为 `admin-observed-candidate`。
10. 不允许把“看起来像”当成覆盖证据，必须写明观察路径或源码路径。
11. 必须列出每个页面保存的 screenshot 路径。
12. 必须列出每个页面使用 `take_snapshot` 得到的关键结构摘要。
13. 必须列出 `evaluate_script` 枚举出的交互元素数量，以及已点击/跳过数量。

完成定义：

只有同时满足以下条件，才能写“CC Connect Admin 实测盘点完成”：

1. 左侧所有菜单均已进入。
2. 所有已发现安全可点击入口均已点击或明确记录跳过原因。
3. 所有现有项目卡片、详情页、Tab 和二级入口均已覆盖，或者明确记录阻塞原因。
4. 所有新增/编辑/配置类弹窗均已打开观察字段，但没有保存真实数据。
5. 对话页输入、命令面板和可滚动区域已覆盖，且没有真实发送消息。
6. 页面实测结果已和 Web Admin 源码路由/组件做反向核对。
7. `8.1`、`8.2`、`8.3`、`8.4`、`8.5` 五个文件均已生成。
8. `8.4` 已明确列出当前 3S 与真实 CC Connect Admin 的差距。
9. `8.5` 已明确记录页面功能排布、信息层级和功能连接关系。
10. `8.screenshots/` 已保存每个一级页面和关键弹窗/抽屉/面板的截图。

如果不能满足完成定义，请不要写完成；只写具体阻塞项和还缺哪些页面/交互没有覆盖。

最终回复只输出：

1. 是否完成
2. 生成的 5 个文件路径
3. 覆盖的页面数量、路由数量、交互数量
4. 阻塞项数量
5. 是否发现当前 3S 是空壳或入口缺失
6. 下一步应该重跑哪个阶段
````

# UI 与产品体验规则

任何 renderer UI、样式、视觉、排版、交互或用户文案改动，都必须同时阅读：

- `.claude/rules/design.md`
- `.claude/rules/ui-rules.md`
- `docs/reference/product-context.md`（涉及产品定位、信息架构、文案或体验取舍时）
- `desktop/components.json`
- `desktop/src/styles/globals.css`
- 当前模块已有实现

当前基线是 shadcn `radix-nova` + Radix。除非用户明确批准迁移，不得添加或重新引入 `@base-ui/react`，不得切换 preset 或 primitive 库。

## 设计护栏

- 优先级：现有业务组合 → `desktop/src/components/ui/` → 官方 shadcn 组件 → 模块内薄组合 → 最后才是自定义 primitive。
- 使用 `bg-background`、`text-foreground`、`bg-card`、`border-border`、`bg-muted` 等主题 token。
- **服务端网页端（dashboard）只有浅色一种外观**：不引入 `.dark` token、`dark:` 变体、`prefers-color-scheme` 分支或主题切换入口。
  深色模式不在这个界面的产品范围内——它承载的功能太广，第三方渲染面（Markdown、代码编辑器、弹层、原生控件）逐处适配不划算。
  桌面应用（`desktop/`）、手机端和文档站的深色外观各自独立，不受此条约束。
- 禁止 hex/rgb/hsl、自定义颜色、Tailwind 任意颜色值、品牌硬编码、装饰性渐变、glow、彩虹文字、emoji heading 和页面级独立视觉语言。
- 优先使用 preset 的字体、radius、border、shadow、focus ring；不要用 arbitrary values 重做组件视觉。
- Tailwind 主要处理布局、间距、尺寸、响应式、overflow 和简单排版；不要用它重写按钮、输入框、卡片、对话框或 tabs。
- 普通场景禁止内联 `style={{...}}`；只有动态运行时计算值可例外。
- 禁止卡片套卡片、连续 Divider，以及同时用 shadow + border + background 制造重复层级。
- 所有元素落在网格线上；表单 label/input 基线对齐，表格数字右对齐，icon/text 垂直居中。

## 终端主题数据例外

- 用户已明确允许社区调色板作为终端专用主题数据。默认、Nord、Gruvbox Dark、Catppuccin Mocha 与 Latte，以及 Rosé Pine Dawn、Ayu Light、Solarized Light、Tokyo Night Day 的目录集中在 `desktop/app-capabilities/terminal/shared/terminal-themes.ts`；颜色字面值只限该数据目录，不散落到 JSX 或普通 UI。
- 终端画布消费解析后的 xterm theme 与运行时 `--terminal-background` token。终端顶栏、底栏及语音条以当前终端主题的 `background` 和 `foreground` 覆盖局部 shadcn token，栏背景在该 background 上叠加 5% 黑色（使用 Tailwind `--color-black` token），普通文字与图标不额外淡化；悬停与展开状态成对使用主题的 selection 配色。默认主题复用现有深色 background／foreground token，并使用相同的背景叠加。设置、侧栏、Dock、文件树和挂到 body 的弹层不继承这些局部覆盖，其它界面继续遵守应用主题 token。
- 调色板来源与许可保存在终端能力包的 `THIRD_PARTY_NOTICES.md`。主题只改变桌面绘制，不改变 PTY、网格、手机端固定配色或程序显式输出的真彩色。

## 桌面语音输入

- Terminal 与 Agent 对话录音期间，普通 Enter 表示结束录音并提交：等待识别收尾，终端写入完整文字后补一次回车，Agent 将转写追加到原草稿后走既有发送与排队流程。尚未出字也可以结束；最终为空时不执行、不发送已有草稿。
- Enter 必须先于当前终端或输入控件处理；Shift / Ctrl / Alt / Meta + Enter、输入法确认和其它弹窗或输入区不受影响。收尾与写入共用互斥状态，连按和按住产生的重复回车不能重复提交，松键后恢复普通输入。
- 点击对勾仍只填入文字，允许先编辑；完成或取消后恢复输入焦点。终端不重复显示「待执行」横条。取消、切换会话或组件卸载后，迟到的转写不得继续提交；终端文字写入失败不得再补回车。
- 该约定更新于 2026-10-16，覆盖旧规格中的「录音时 Enter 等价于点对勾，只填入不发送」。不改变 iOS 语音行为或 MCP 操作契约。

## 按钮尺寸

- 桌面端 `Button` 默认使用标准尺寸（`default`，32px 高）；普通操作、主要操作、空/错误状态的操作、表单动作、对话框底部动作以及空间充足的标题栏动作都用标准尺寸。省略 `size` 即为标准尺寸。
- 只有标准按钮会挤占同一行的必要内容、破坏已有行高，或与同组 28px/24px 控件无法对齐时，才使用 `sm`/`xs`。典型例外是表格与列表行内操作、附件/已选项标签、面包屑、密集工具栏、System App 顶栏和与小尺寸输入框相邻的动作。
- `icon-sm`/`icon-xs` 也只用于上述紧凑区域的纯图标操作。普通独立图标操作使用 `icon`。对话框/Sheet 的共享关闭按钮沿用组件自身尺寸。
- 不能仅因按钮使用 `ghost`/`link`、属于次要操作、位于卡片内、或希望界面显得紧凑就缩小。新增小尺寸按钮时，先检查父容器的实际宽度、行高和相邻控件尺寸；没有可说明的布局约束就用标准尺寸。不得通过 `h-6`/`h-7`、`text-xs` 等类绕过这一规则。
- 侧栏导航项不得在纵向 flex 布局中被压缩；共享侧栏行保持固定行高，主点击区撑满行高。紧凑目录树可整组使用 `sm`，根项与子项使用同一尺寸。选中态统一使用 `bg-selected`，悬停时保留选中底色，不能用悬停态的 `bg-muted` / `bg-secondary` / `bg-accent` 代替选中态。

## 菜单项尺寸

- 桌面端下拉菜单、右键菜单、菜单栏、选择器和命令候选项，沿用对应共享组件的默认行高、内边距和字号；勾选项、单选项、子菜单入口同样适用。菜单项不套用普通 `Button` 的 32px 标准高度。
- 当前 `DropdownMenuItem`、`ContextMenuItem`、`MenubarItem`、`SelectItem` 使用 `text-sm` 与 `py-1`，单行通常约 28px；`CommandItem` 使用 `text-sm` 与 `py-1.5`，单行通常约 32px。这些数值用于核对，权威仍是 `desktop/src/components/ui/` 的当前实现，不在业务代码中另写固定高度。
- 未获用户明确要求，不得用 `h-8` / `h-10`、`min-h-10`、额外 `py-*`、放大字号或行高等方式撑大菜单项，也不得通过父级选择器、全局 CSS 或修改共享组件绕过。不能仅因「更好点」「留白更舒服」或套用移动端触控尺寸而放大桌面菜单。
- 自定义候选菜单（如 Agent `/` 菜单）须对齐语义相近的共享菜单项尺寸，保留已有键盘、焦点与选择行为；不能因使用原生 `button` 就沿用普通按钮高度。
- 确有姓名、邮箱、描述等多行必要内容时，允许内容在默认内边距下自然撑高；不能仅因多行内容就额外扩大最小高度或上下留白，也不能强压到单行高度造成裁剪。
- 修改前检查菜单项自身、父容器及子内容的尺寸覆盖；交付前确认没有无依据的固定高度、最小高度、内边距、字号或行高放大。

## 布局尺寸与运行时测量

- 侧栏滚动容器横向铺满所属面板，滚动条贴靠面板边缘；左右留白放到滚动内容层。固定搜索栏、工具栏和底部操作各自保留原边距，不在滚动容器外统一设置横向 padding。`ModuleSidebar` 与 `ModuleSidebarList` 共用这一约定，自定义侧栏也遵守；窄窗弹出选择器保留其自身内边距。
- 详情分栏、弹窗主体和抽屉列表同样让滚动条贴靠所属面板边缘。默认弹窗壳层已有统一留白时，可只将滚动区用等量负边距展开，并在内容层补回留白；原有额外内容间距继续保留。带独立边框或背景的局部滚动列表以自身容器为边界，不向外扩展；多宿主组件只调整存在内缩的宿主模式。
- 邮箱和站内信的分栏以应用内容区实际宽度为准，不依赖整个窗口的通用大屏断点。只有各栏所需宽度不足时才收起阅读区；导航、列表、详情及返回按钮必须使用同一切换条件。站内信的可拖动面板约束以像素计，切换门槛从面板宽度预算派生，不随根字号额外放大。
- 同一个几何尺寸不得在 CSS/Tailwind class 与 JavaScript 计算中分别写字面值，例如组件使用 `h-10`，定位算法再写 `40`。尺寸变化会影响定位、滚动、裁剪或碰撞计算时，优先测量实际 DOM 尺寸或从单一数据源派生。
- 固定尺寸只有在它本身就是明确的布局规则时才允许使用，例如控制密度、触摸目标、面板宽度范围和元素间距；使用命名常量或设计系统 token，并为依赖该尺寸的行为补回归测试。
- `ResizeObserver` 等动态测量必须复用最少数量的 observer，批量读取后按帧提交更新，更新前比较新旧值，并在卸载时清理 observer 和待执行帧。不得在滚动循环中交替读写布局属性。
- Agent 时间线的贴底修正可以在 `useLayoutEffect` 或 `ResizeObserver` 中于当前帧绘制前完成；先批量读取滚动指标，仅在位置确实需要变化时写入，不另排下一帧，不改变被观察元素的尺寸。
- callback ref 短暂收到 `null` 时，不得立即丢弃仍可复用的最近有效测量；先区分临时脱离和业务对象删除，避免在真实值与预估值之间形成布局振荡。

### Markdown 预览与评论定位

- Markdown 阅读模式的普通正文块保持 `max-w-3xl` 居中，正文中的表格滚动容器和 Mermaid 图表使用目录、评论栏之外的可用内容宽度；宽屏模式仍让所有正文展开。两种模式下，表格窄于可用内容区时按自身宽度水平居中，不强制撑满；超宽图表内部横向滚动，不扩大页面滚动范围。保持原文 DOM 顺序与评论测量坐标，宽度切换即使不改变正文总尺寸，也必须刷新图片评论标记位置。
- 修改 Markdown 正文或评论卡片的字号、字重、行高、间距、宽度、单元格 padding 等纯布局样式时，不得为此修改评论锚点算法或新增定位配置；定位必须继续基于实际 DOM 测量，并验证高亮范围、评论卡片对齐和评论导航滚动。
- 修改 Markdown 的可见文本、DOM 文本顺序、解析器/渲染器语义、图片 alt、换行、代码块或表格的文本映射规则时，必须同步检查服务端 Markdown projection、Renderer rendered-text 映射和评论锚点测试。
- 修改正文、高亮层、评论栏的滚动容器或定位坐标系，或引入折叠、虚拟化、`transform`、异步字体等可能绕过正文 `ResizeObserver` 的动态几何变化时，必须同步检查坐标换算，并在必要时补充重新测量触发机制。
- Drive Markdown 评论定位的权威设计见 `docs/superpowers/specs/2026-06-21-drive-markdown-annotations-design.md`。

## 产品文案

- UI 文案只保留标题、必要 label、操作、空/错误/加载状态。
- 禁止功能介绍、实现解释、路线图、架构理由、重复状态、欢迎横幅、营销文案、AI 自称和装饰性 emoji。
- 错误、空状态和禁用状态应简短、行动导向，优先给出一个明确下一步。
- 判断标准：删掉一句话是否会让普通用户更难完成当前任务？不会就删除。

## 逐步选择与配置向导

- 多步骤、带说明选项的配置流程统一使用 `components/guided-flow`，遵循 `docs/reference/guided-flow.md`。默认选项只修改草稿，由「下一步」推进；同步向导的纯单选步骤点击即确认并推进，左侧显示语义图标，输入与最终执行仍显式确认。分支和异步校验放业务 hook。

## Dialog

- 普通小表单、确认、导入弹窗使用默认 shadcn `DialogContent` 关闭按钮。
- 固定高度、`p-0`、主体滚动、右侧 header actions 或标题栏中间有 tabs 的大弹窗，使用 `desktop/src/components/ui/dialog.tsx` 的 `DialogFrame`、`DialogFrameHeader`、`DialogFrameBody`、`DialogFrameFooter`。
- 大弹窗在 `DialogContent` 显式 `showCloseButton={false}`，由 `DialogFrameHeader` 放置关闭按钮；不得用 `pr-8`/`pr-12` 给绝对定位关闭按钮让位。
- 带 tabs 的大弹窗使用 `DialogFrameHeader center`：左侧标题/描述，中间 tabs，右侧 actions/close；中间视觉位置不得受两侧内容宽度影响。
- 只有真正不可关闭的阻塞流程可不显示关闭按钮，例如数据迁移进入不可安全中断阶段；普通查看或表单不得使用。

## System App 顶栏与表单

- System App 入口不得直接渲染 `SystemAppTopBar`。有 tabs、actions 或顶栏信息时，统一通过 `SystemAppWindowShell` 声明；使用 `ModulePage` 的列表页由 `ModulePage` 代为接入该壳层。
- 启动台内嵌模式只允许 `EmbeddedSystemAppShell` 渲染一条应用顶栏：左侧返回、应用名和可选信息，中间 tabs，右侧应用 actions 和新窗口入口。应用内容区不得再渲染第二条应用顶栏。
- 用户确认的邮箱独立写信窗口例外：`SystemAppWindowShell.left` 放置发送、保存草稿、附件，复用共享 action button；右侧只显示发件账号和保存状态，关闭使用系统窗口按钮，不新增一条工具栏。收件区域仅提供收件人和可展开的抄送，不提供密送。
- 用户确认的邮箱阅读窗口例外：账号切换放在顶栏左侧，独立窗口使用 `left`，启动台内嵌与 Dock 使用 `embeddedLeftAddon`，右侧保留刷新和写邮件；手动刷新请求、列表加载或索引运行期间，短进度条原位替换刷新按钮，结束后恢复。同步暂停或异常也在顶栏展示，列表工具栏始终保留搜索和选择操作，不参与进度切换。侧栏与窄窗口内容区不重复显示账号选择；长名称截断，悬停及菜单可查看完整地址。
- 其他场景 `SystemAppWindowShell.left` 只用于独立窗口的左侧标题；需要在内嵌顶栏应用名旁显示的信息通过 `embeddedLeftAddon` 注册，不能靠保留内部顶栏实现。
- `SystemAppTopBar` 是共享壳层的底层布局组件；业务入口只使用 `SystemAppTopBarActionButton` 声明操作，不自行组装顶栏。
- 居中 tab 顶栏：左侧等宽占位，中间 tab，右侧操作区；不得为填空添加冗余窗口标题。
- 右侧 action 使用紧凑 ghost：文字用 `SystemAppTopBarActionButton` 默认形态，纯图标用 `iconOnly`，危险操作用 `tone="destructive"`。不得放 outline、默认实心或带底色 destructive 胶囊。
- 顶栏 ghost actions 不额外加横向 gap；扩大命中区不得造成相邻 action 重叠。
- 新增或调整 System App 时必须同步更新 `desktop/src/modules/apps/__tests__/system-app-header-architecture.test.ts` 的入口分类，并验证启动台内嵌、Dock 和独立窗口三种宿主形态。
- 单任务表单工具默认参考 `desktop/app-capabilities/document-template/renderer/index.tsx`：收窄居中、单层工作卡片、稳定 label/控件列、InputGroup 文件选择、底部只保留必要选项/主操作/状态。
- 主按钮使用明确动作文案；不要添加介绍段落、重复边框、卡片嵌套或大段帮助文案。

## Dashboard

- `dashboard/` 是独立管理后台，新增/修改页面前先在 `templates/shadcn-admin/` 查找近似页面、组件和布局。
- 服务端分页表格必须优先用 `dashboard/src/components/data-table/server-data-table.tsx` 的 `ServerDataTable`，列头使用 `DataTableColumnHeader`。
- 不得在单页直接拼 `Table`、手写分页或复制 sticky 操作列逻辑。共享表格不足时先扩展共享组件。
- 有操作按钮的列必须固定在右侧，不随横向滚动离开视口。

## 设计文档冲突

`.claude/rules/design.md` 是默认视觉基线，但不是无条件高于当前 shadcn preset、全局 tokens、现有组件实现或用户明确需求。发现冲突时必须指出并请求确认，不得静默套用旧规范。

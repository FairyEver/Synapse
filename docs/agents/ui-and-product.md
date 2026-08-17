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
- 禁止 hex/rgb/hsl、自定义颜色、Tailwind 任意颜色值、品牌硬编码、装饰性渐变、glow、彩虹文字、emoji heading 和页面级独立视觉语言。
- 优先使用 preset 的字体、radius、border、shadow、focus ring；不要用 arbitrary values 重做组件视觉。
- Tailwind 主要处理布局、间距、尺寸、响应式、overflow 和简单排版；不要用它重写按钮、输入框、卡片、对话框或 tabs。
- 普通场景禁止内联 `style={{...}}`；只有动态运行时计算值可例外。
- 禁止卡片套卡片、连续 Divider，以及同时用 shadow + border + background 制造重复层级。
- 所有元素落在网格线上；表单 label/input 基线对齐，表格数字右对齐，icon/text 垂直居中。

## 布局尺寸与运行时测量

- 同一个几何尺寸不得在 CSS/Tailwind class 与 JavaScript 计算中分别写字面值，例如组件使用 `h-10`，定位算法再写 `40`。尺寸变化会影响定位、滚动、裁剪或碰撞计算时，优先测量实际 DOM 尺寸或从单一数据源派生。
- 固定尺寸只有在它本身就是明确的布局规则时才允许使用，例如控制密度、触摸目标、面板宽度范围和元素间距；使用命名常量或设计系统 token，并为依赖该尺寸的行为补回归测试。
- `ResizeObserver` 等动态测量必须复用最少数量的 observer，批量读取后按帧提交更新，更新前比较新旧值，并在卸载时清理 observer 和待执行帧。不得在滚动循环中交替读写布局属性。
- callback ref 短暂收到 `null` 时，不得立即丢弃仍可复用的最近有效测量；先区分临时脱离和业务对象删除，避免在真实值与预估值之间形成布局振荡。

### Markdown 预览与评论定位

- 修改 Markdown 正文或评论卡片的字号、字重、行高、间距、宽度、单元格 padding 等纯布局样式时，不得为此修改评论锚点算法或新增定位配置；定位必须继续基于实际 DOM 测量，并验证高亮范围、评论卡片对齐和评论导航滚动。
- 修改 Markdown 的可见文本、DOM 文本顺序、解析器/渲染器语义、图片 alt、换行、代码块或表格的文本映射规则时，必须同步检查服务端 Markdown projection、Renderer rendered-text 映射和评论锚点测试。
- 修改正文、高亮层、评论栏的滚动容器或定位坐标系，或引入折叠、虚拟化、`transform`、异步字体等可能绕过正文 `ResizeObserver` 的动态几何变化时，必须同步检查坐标换算，并在必要时补充重新测量触发机制。
- Drive Markdown 评论定位的权威设计见 `docs/superpowers/specs/2026-06-21-drive-markdown-annotations-design.md`。

## 产品文案

- UI 文案只保留标题、必要 label、操作、空/错误/加载状态。
- 禁止功能介绍、实现解释、路线图、架构理由、重复状态、欢迎横幅、营销文案、AI 自称和装饰性 emoji。
- 错误、空状态和禁用状态应简短、行动导向，优先给出一个明确下一步。
- 判断标准：删掉一句话是否会让普通用户更难完成当前任务？不会就删除。

## Dialog

- 普通小表单、确认、导入弹窗使用默认 shadcn `DialogContent` 关闭按钮。
- 固定高度、`p-0`、主体滚动、右侧 header actions 或标题栏中间有 tabs 的大弹窗，使用 `desktop/src/components/ui/dialog.tsx` 的 `DialogFrame`、`DialogFrameHeader`、`DialogFrameBody`、`DialogFrameFooter`。
- 大弹窗在 `DialogContent` 显式 `showCloseButton={false}`，由 `DialogFrameHeader` 放置关闭按钮；不得用 `pr-8`/`pr-12` 给绝对定位关闭按钮让位。
- 带 tabs 的大弹窗使用 `DialogFrameHeader center`：左侧标题/描述，中间 tabs，右侧 actions/close；中间视觉位置不得受两侧内容宽度影响。
- 只有真正不可关闭的阻塞流程可不显示关闭按钮，例如数据迁移进入不可安全中断阶段；普通查看或表单不得使用。

## System App 顶栏与表单

- System App 入口不得直接渲染 `SystemAppTopBar`。有 tabs、actions 或顶栏信息时，统一通过 `SystemAppWindowShell` 声明；使用 `ModulePage` 的列表页由 `ModulePage` 代为接入该壳层。
- 启动台内嵌模式只允许 `EmbeddedSystemAppShell` 渲染一条应用顶栏：左侧返回、应用名和可选信息，中间 tabs，右侧应用 actions 和新窗口入口。应用内容区不得再渲染第二条应用顶栏。
- `SystemAppWindowShell.left` 只用于独立窗口的左侧标题；需要在内嵌顶栏应用名旁显示的信息通过 `embeddedLeftAddon` 注册，不能靠保留内部顶栏实现。
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

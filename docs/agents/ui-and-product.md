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

- 顶栏优先复用 `desktop/src/modules/apps/components/system-app-top-bar.tsx`。
- 居中 tab 顶栏：左侧等宽占位，中间 tab，右侧操作区；不得为填空添加冗余窗口标题。
- 右侧 action 使用紧凑 ghost：文字用 `SystemAppTopBarActionButton` 默认形态，纯图标用 `iconOnly`，危险操作用 `tone="destructive"`。不得放 outline、默认实心或带底色 destructive 胶囊。
- 顶栏 ghost actions 不额外加横向 gap；扩大命中区不得造成相邻 action 重叠。
- 单任务表单工具默认参考 `desktop/app-capabilities/document-template/renderer/index.tsx`：收窄居中、单层工作卡片、稳定 label/控件列、InputGroup 文件选择、底部只保留必要选项/主操作/状态。
- 主按钮使用明确动作文案；不要添加介绍段落、重复边框、卡片嵌套或大段帮助文案。

## Dashboard

- `dashboard/` 是独立管理后台，新增/修改页面前先在 `templates/shadcn-admin/` 查找近似页面、组件和布局。
- 服务端分页表格必须优先用 `dashboard/src/components/data-table/server-data-table.tsx` 的 `ServerDataTable`，列头使用 `DataTableColumnHeader`。
- 不得在单页直接拼 `Table`、手写分页或复制 sticky 操作列逻辑。共享表格不足时先扩展共享组件。
- 有操作按钮的列必须固定在右侧，不随横向滚动离开视口。

## 设计文档冲突

`.claude/rules/design.md` 是默认视觉基线，但不是无条件高于当前 shadcn preset、全局 tokens、现有组件实现或用户明确需求。发现冲突时必须指出并请求确认，不得静默套用旧规范。

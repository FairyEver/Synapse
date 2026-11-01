# Dashboard V2 Agent 规则

本文件只适用于 `dashboard-v2/`。规则正文只改 `CLAUDE.md`；同目录 `AGENTS.md` 保持指向它的相对软链接。

## 范围与技术栈

- 本子包使用 React 19、TypeScript、Vite、Tailwind CSS 4 和 HeroUI React v3。这是用户指定的独立 UI 基线；不要套用 desktop 的 shadcn/Radix preset，也不要将 HeroUI 引入其他子包。
- 本子包是普通用户控制台、管理员后台及独立阅读/分享与辅助入口的 HeroUI 实现。功能与模板对应见 `MIGRATION.md`。不添加模板演示数据或无业务对应的功能。
- V2 不提供普通用户或管理员云盘列表、公开素材、文档图片、存储治理页面；保留独立文件/文件夹浏览、编辑、分享、评论和下载。后端接口不因 UI 移除而删除。
- 迁移后的源码不得引用旧 dashboard 或 desktop 源码、shadcn/旧 primitive 封装、应用层 Radix、Sonner。专业编辑器依赖自身的内部实现不属于应用 UI；不得借此恢复通用旧组件。
- 遵守仓库的授权、日志、验证、发布说明和自动本地提交规则。

## 编码前的事实来源

1. 阅读并使用仓库官方 Skill：[`heroui-react`](../.agents/skills/heroui-react/SKILL.md)。运行其脚本时从该 Skill 目录解析 `scripts/` 路径，不要误用子包的 `scripts/`。
2. 安装、升级或使用组件前，优先查询 `heroui-react` MCP：`get_docs` 获取最新 quick-start；`list_components` 确认组件名称；`get_component_docs` 获取 props、组合结构和示例。不要凭 HeroUI v2 或 NextUI 的记忆编写代码。
3. MCP 不可用时使用 Skill 的官方查询脚本；离线时读取 `.heroui-docs/react/INDEX.md` 及其中的文档和 demos。文档快照缺失时运行 `pnpm --filter @synapse/dashboard-v2 docs:heroui:sync`。
4. 在线索引：<https://heroui.com/react/llms.txt>；完整文档：<https://heroui.com/react/llms-full.txt>；组件：<https://heroui.com/react/llms-components.txt>；模式：<https://heroui.com/react/llms-patterns.txt>。按需读取，不把全部文档塞入上下文。
5. 文档与已安装版本不一致时，核对 `package.json`、锁文件和对应版本发布说明；不擅自升级，不虚构 API。

## 视觉与交互

- 所有视觉与交互决策遵循 [DESIGN.md](./DESIGN.md)。主题 CSS 是实际取值的事实来源；固定 HeroUI 默认浅色主题，不提供切换、不读取系统配色偏好。游戏专属画布及专业文档内容保持其作用域内的视觉与几何约束。
- 使用 HeroUI 的语义化 token，例如 `bg-background`、`text-foreground`、`bg-surface`、`text-muted` 和 `border-separator`；禁止将 DESIGN.md 的原始色值复制到业务代码。
- 优先组合 `@heroui/react` 导出的组件和子组件；保留键盘操作、焦点、校验和禁用语义，交互事件按组件文档使用 `onPress` 等 API。
- 不引入 HeroUI v2 的 `HeroUIProvider`、`@heroui/theme`、`@heroui/system`、`heroui()` Tailwind 插件或 Framer Motion 初始化流程。v3 无需 Provider，动画由其 CSS 提供。
- `src/styles/globals.css` 必须先导入 `tailwindcss`，再导入 `@heroui/styles`，并由 `src/main.tsx` 加载；使用 Vite 的 Tailwind 插件，不另加 v3 配置或 PostCSS 链。
- 保持界面文案必要、克制，复用库组件与主题 token，不内联样式、不堆叠装饰、不覆盖组件基础视觉。

### HeroUI 组合与表面规则（必须遵守）

- **图标**：优先使用组件自带的 Indicator、CloseTrigger、`Link.Icon` 等插槽。文档/外链使用 `Link.Icon` 内置箭头；自定义 SVG 放入 `Link.Icon` 时填充插槽尺寸（`size-full`），不得保留会溢出的固有尺寸。普通 Button 的图标由库控制尺寸；`Dropdown.Item` 中的自定义 Lucide/SVG 必须按官方菜单示例显式使用 `size-4 shrink-0 text-muted`（危险操作使用对应语义色）并标记 `aria-hidden`，不得依赖 Button 的 `data-icon` 写法或 Lucide 的默认 24px 尺寸。选中标记使用原生 `Dropdown.ItemIndicator`，不混用动作图标与选择状态。不用全局 SVG 样式修补。HeroUI 不提供独立的通用图标包，不虚构图标导出。
- **菜单内容与分组**：菜单文字使用 `Label`，必要的次要说明使用 `Description`，复杂内容显式提供 `textValue` 以保留键盘按文字查找。命令操作与打开方式等单选状态使用 `Dropdown.Section`、`Header` 和必要的分隔线组织；同一单选集合必须放在同一个 Section，不为每个选项单建 Section。文件信息等非交互内容与操作分层，标题和元信息共用对齐线，长文件名必须在受限宽度内真正省略并保留完整名称。沿用菜单默认行高、内边距、字号、圆角和阴影，不通过放大菜单项或覆盖组件基础视觉掩盖图标与结构问题。
- **弹窗间距**：Modal、Drawer、AlertDialog 使用相邻的 `Header`、`Body`、`Footer` 分区。字段、说明、列表放入 `Body`，不得把输入框、div 或整个内容 form 直接放在 `Footer` 前，绕过库的原生兄弟选择器间距。完整 form 包住三个分区时使用 `flex min-h-0 flex-1 flex-col`，字段间距只加在 Body 内；不得额外叠加外层 gap 或全局 margin 补丁。正文/评论、灯箱等特殊浮层保留明确的专用几何布局。
- **背景与控件变体**：按控件实际所在的最近一层背景选择变体。默认白色 Card/Surface、Modal/Drawer/AlertDialog、Popover 等白色表面内，官方支持表面变体的表单控件必须显式使用 `variant="secondary"`，避免白底白控件；页面 `bg-background`、灰色表面上的控件保留适合背景的 `primary` 默认值。不得不分上下文地全站改成 secondary，也不得通过改主题、全局 CSS、字面色或额外边框代替标准变体。
- **复合控件**：上述表面规则同时检查 Input、TextArea、InputGroup、Select、SearchField、ComboBox、NumberField、InputOTP、Checkbox、RadioGroup，以及 DateField.Group/TimeField.Group。variant 应传给文档规定的拥有者：密码框传至 InputGroup，选择器传至 Select，日期/时间字段传至 Group；不要给 TextField、DatePicker 根节点或不支持该属性的控件硬加 variant。跨组件渲染的表单也必须追踪实际背景；共用业务控件应透传原生 variant，不能暗中固定全局样式。按钮的主次操作 variant 不按表单背景规则批量改动。
- **验证**：新增或修改控件时检查桌面与窄屏的默认、聚焦、无效、禁用和只读状态；运行 `check:ui` 及相关浏览器回归。涉及菜单/Popover 时必须实际展开每一种响应式呈现并查看截图，核对图标与文字的计算尺寸、分组/元信息对齐、截断、悬停/选中/键盘焦点和视口边界；不能只检查顶栏关闭状态。源码检查不能替代实际背景对比、图标测量和滚动验证；阅读器外围变更必须保留正文滚动节点、锚点、分栏和评论定位，并运行既有几何回归。

### 文档阅读与编辑工具栏（必须遵守）

- 文档阅读与富文本编辑的文件级工具栏使用 HeroUI `Toolbar` 承接，保留方向键导航、可见焦点、禁用状态和原有操作顺序；两种模式遵守同一约定，HTML 预览既有浮动菜单边界不变。
- 「目录、批注、留言」使用原生 `ButtonGroup + Button` 组成一个无间距的连体文字按钮组，只在整组两端保留圆角，中间连接处为直边。让组件管理圆角、背景和按下效果，不用额外圆角容器、底色或 CSS 覆盖模拟按钮组。目录等条目因权限或内容条件未注册时不留占位，剩余按钮沿用原生首尾样式。「宽度」「打开方式」「更多」保留在该组之外。
- 目录与批注的分组按钮通过 `aria-pressed` 表达开关状态，使用原生语义 variant 区分选中与未选中；桌面保持原有独立开关，窄屏保持原有面板互斥。留言是跳转动作，保留数量与跳转行为，不添加开关状态，也不改成 Tabs 的互斥页面切换。
- `ButtonGroup` 只组合其原生支持的 `Button`；不得混入 `ToggleButton` 后假定连接圆角会生效。独立开关使用 `ToggleButton`；一组全部为开关时才考虑 `ToggleButtonGroup + ToggleButton`，不能为统一外形把普通动作伪装成开关。
- 顶部「目录、批注、留言」不添加装饰性图标；下拉触发器必须保留下拉箭头，包括「宽度」「打开方式」和文字「更多」，普通按钮隐藏图标的开关不得隐藏下拉指示。此约定不禁止展开菜单的动作图标、原生选中标记或下方批注栏的导航/刷新图标。
- 分组由 renderer contribution 的可选 `group` 元数据声明，host 按相邻同组项呈现；不要按 Markdown/编辑器的具体按钮 ID 硬编码分组。窄屏保留整个按钮组、触摸高度和原有横向溢出处理，不拆散组内按钮；不改正文滚动节点、目录锚点、批注定位和留言焦点行为。
- 验收同时核对桌面与窄屏：首尾圆角、中间直边、相邻按钮同时选中、缺少目录时的剩余分组、数量显示、方向键跳过禁用操作、留言跳转及下拉箭头。视觉结论须有实际界面依据，单元测试和源码检查不能替代视觉验收；浏览器/应用的启动仍遵守仓库授权规则。

## 游戏 UI：系统外壳与局内界面

- 必读 [游戏 UI 分层规则](../docs/agents/game-ui.md)。游戏作为内容运行在系统外壳内；系统层与局内层拥有各自完整的视觉语言。
- 游戏中心、房间列表/等待与管理、排位/战绩、选手档案、设置，以及局内打开的菜单、日志、表单和通用确认使用标准 HeroUI v3 默认浅色系统 UI，不继承游戏配色、字体、材质或按钮皮肤。排位是未来页面的归属规则，不表示已有该功能。
- 游戏场景、牌桌/卡牌/筹码、局内 HUD、行动提示、直接玩法按钮与即时胜负反馈保留游戏专属视觉。弃牌/过牌/跟注/下注按钮属于玩法；金额输入与滑块/预设组成的表单面板、全下确认属于系统层。
- 运行中仅保留必要 HUD、直接玩法操作和系统入口；系统面板按需出现，关闭后回到游戏。大厅、等待等系统页面可完整呈现，不要求常驻窗口边框或 Console 导航。
- 按职责划分，不按是否在画布内、是否浮动或所用 React 组件划分。同一侧栏、`HumanControls` 或结算组件同时服务两层时须区分呈现：日志中的完整结算用系统布局，局内结算摘要用游戏反馈。
- 主题隔离必须覆盖 Portal、Tabs、Popover 和嵌套表单；不得把 HeroUI 系统组件换成游戏颜色后视为已分层。游戏插画/牌面可以作为系统列表中的内容，不能给其外层控件染色。
- 本规则确立新的 V2 视觉边界，替代旧稿中的大厅整体游戏化、深色建房弹窗及所有牌桌浮层继承游戏主题要求。已落实的表面与验收范围见专题文档；资金、控制权、隐私、幂等、倒计时和响应式几何约束继续有效。

## 运行与验证

- 从仓库根运行 `pnpm dev`，或单独运行 `pnpm dev:dashboard-v2`；默认地址 `http://localhost:19703/console/`，端口占用时直接失败。
- 停止用 `pnpm quit:dashboard-v2`；`pnpm quit` 也会停止此子包。
- 构建：`pnpm --filter @synapse/dashboard-v2 build`；类型检查：`pnpm --filter @synapse/dashboard-v2 tsc`；单元测试：`pnpm --filter @synapse/dashboard-v2 test`；真实 Chromium 回归：`pnpm --filter @synapse/dashboard-v2 test:browser`；UI 依赖与主题边界：`pnpm --filter @synapse/dashboard-v2 check:ui`。
- 生产构建默认选择 V2，`DASHBOARD_UI` 未设置或为空也选择 V2；显式 `DASHBOARD_UI=v1` 保留旧版回滚能力。构建完成不自动部署。两者使用相同 URL 与最终产物位置，必须整包切换，不能混合入口资源。
- 包管理器统一为 pnpm `12.16.1`；官方 CLI `heroui-cli@3.1.1` 已安装，可用 `pnpm --filter @synapse/dashboard-v2 exec heroui doctor --json` 检查配置。其 `agents-md` 会克隆仓库，文档刷新继续使用本项目 HTTP 同步命令。
- Node.js 至少 22.22.0，MCP 使用子包 devDependency 的锁定版本。项目级 MCP 配置位于仓库根 `.codex/config.toml`（Codex）和 `.mcp.json`（Claude Code）；新增配置后重启对应客户端。
- 本地文档使用官方 HTTP 内容初始化，不克隆仓库；快照与 demos 位于被忽略的 `.heroui-docs/`，换机器后重新同步。Skill、规则、DESIGN.md 和 MCP 配置纳入 Git。
- 更新主题时同步本地 DESIGN.md；刷新官方 DESIGN.md 会覆盖自定义内容，执行前先检查 diff。

<!-- HEROUI-REACT-AGENTS-MD-START -->
## HeroUI 本地文档索引

- 根目录：`.heroui-docs/react/`
- [完整索引](./.heroui-docs/react/INDEX.md)：组件、指南、发布说明及 demos。
- 官方源提交：`b2c65a5b5236550526f23d475b1ad0c6e5eab1a2`；文档 184 份，示例 783 份。
- 刷新：`pnpm --filter @synapse/dashboard-v2 docs:heroui:sync`。
<!-- HEROUI-REACT-AGENTS-MD-END -->

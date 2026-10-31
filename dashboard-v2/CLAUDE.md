# Dashboard V2 Agent 规则

本文件只适用于 `dashboard-v2/`。规则正文只改 `CLAUDE.md`；同目录 `AGENTS.md` 保持指向它的相对软链接。

## 范围与技术栈

- 本子包使用 React 19、TypeScript、Vite、Tailwind CSS 4 和 HeroUI React v3。这是用户指定的独立 UI 基线；不要套用 desktop 的 shadcn/Radix preset，也不要将 HeroUI 引入其他子包。
- 当前页面保持空白。除非用户要求，不添加示例按钮、演示页面、业务功能、路由、接口或登录流程。
- 遵守仓库的授权、日志、验证、发布说明和自动本地提交规则。

## 编码前的事实来源

1. 阅读并使用仓库官方 Skill：[`heroui-react`](../.agents/skills/heroui-react/SKILL.md)。运行其脚本时从该 Skill 目录解析 `scripts/` 路径，不要误用子包的 `scripts/`。
2. 安装、升级或使用组件前，优先查询 `heroui-react` MCP：`get_docs` 获取最新 quick-start；`list_components` 确认组件名称；`get_component_docs` 获取 props、组合结构和示例。不要凭 HeroUI v2 或 NextUI 的记忆编写代码。
3. MCP 不可用时使用 Skill 的官方查询脚本；离线时读取 `.heroui-docs/react/INDEX.md` 及其中的文档和 demos。文档快照缺失时运行 `pnpm --filter @synapse/dashboard-v2 docs:heroui:sync`。
4. 在线索引：<https://heroui.com/react/llms.txt>；完整文档：<https://heroui.com/react/llms-full.txt>；组件：<https://heroui.com/react/llms-components.txt>；模式：<https://heroui.com/react/llms-patterns.txt>。按需读取，不把全部文档塞入上下文。
5. 文档与已安装版本不一致时，核对 `package.json`、锁文件和对应版本发布说明；不擅自升级，不虚构 API。

## 视觉与交互

- 所有视觉与交互决策遵循 [DESIGN.md](./DESIGN.md)。主题 CSS 是实际取值的事实来源；保留 HeroUI 默认主题及浅色/深色语义。
- 使用 HeroUI 的语义化 token，例如 `bg-background`、`text-foreground`、`bg-surface`、`text-muted` 和 `border-separator`；禁止将 DESIGN.md 的原始色值复制到业务代码。
- 优先组合 `@heroui/react` 导出的组件和子组件；保留键盘操作、焦点、校验和禁用语义，交互事件按组件文档使用 `onPress` 等 API。
- 不引入 HeroUI v2 的 `HeroUIProvider`、`@heroui/theme`、`@heroui/system`、`heroui()` Tailwind 插件或 Framer Motion 初始化流程。v3 无需 Provider，动画由其 CSS 提供。
- `src/styles/globals.css` 必须先导入 `tailwindcss`，再导入 `@heroui/styles`，并由 `src/main.tsx` 加载；使用 Vite 的 Tailwind 插件，不另加 v3 配置或 PostCSS 链。
- 保持界面文案必要、克制，复用库组件与主题 token，不内联样式、不堆叠装饰、不覆盖组件基础视觉。

## 运行与验证

- 从仓库根运行 `pnpm dev`，或单独运行 `pnpm dev:dashboard-v2`；默认地址 `http://localhost:19703/`，端口占用时直接失败。
- 停止用 `pnpm quit:dashboard-v2`；`pnpm quit` 也会停止此子包。
- 构建：`pnpm --filter @synapse/dashboard-v2 build`；类型检查：`pnpm --filter @synapse/dashboard-v2 tsc`。
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

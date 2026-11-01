# Dashboard

React + TypeScript + Vite + HeroUI v3 子包，包名为 `@synapse/dashboard`，提供普通用户控制台、管理员后台及独立阅读、分享和游戏入口。

- 根目录 `pnpm dev` 或 `pnpm dev:prod` 自动启动。
- 开发地址：`http://localhost:19700/`，端口被占用时直接失败。
- 停止：根目录 `pnpm quit:server`；`pnpm quit` 同时停止该子包。
- 构建：`pnpm --filter @synapse/dashboard build`。

## UI 与 AI 编码工具

- HeroUI React / Styles `3.2.7`，已补齐当前版本的必需 peer dependencies；Tailwind CSS / Vite 插件复用仓库的 `4.2.2`。
- CSS 入口 `src/styles/globals.css` 依次导入 Tailwind 和 HeroUI，并由 `src/main.tsx` 加载。HeroUI v3 无需 Provider。
- [CLAUDE.md](./CLAUDE.md) 保存本子包规则，`AGENTS.md` 是同目录相对软链接；[DESIGN.md](./DESIGN.md) 来自官方默认主题规范。
- 官方 `heroui-react` Skill 安装在仓库 `.agents/skills/heroui-react/`，`.claude/skills/heroui-react` 链接到同一份内容。新 Skill 下轮对话可用；未显示时重启客户端。
- 官方 MCP `@heroui/react-mcp@1.1.3` 为子包开发依赖；Codex 读取仓库 `.codex/config.toml`，Claude Code 读取 `.mcp.json`。重启客户端后启用；在仓库根运行 `codex mcp get heroui-react` 可检查配置。
- 官方 CLI `heroui-cli@3.1.1` 为子包开发依赖；使用 `pnpm --filter @synapse/dashboard exec heroui doctor --json` 检查配置，使用 `pnpm --filter @synapse/dashboard exec heroui --help` 查看命令。
- 官方 LLMs 索引及完整文档入口已写入规则。离线文档与示例位于 `.heroui-docs/react/`，入口为其中的 `INDEX.md`；生成内容被 Git 忽略。

安装项目依赖后，同步离线文档与 demos：

```bash
pnpm --filter @synapse/dashboard docs:heroui:sync
```

同步脚本只读取官方 GitHub HTTP 文档、英文 demos 和四份 React LLMs 文件，记录来源提交并更新本子包规则中的索引，不克隆上游仓库。workspace 已统一使用 pnpm `12.16.1`，满足官方 CLI 的包管理器要求。CLI 固定为 npm 官方源与现有容器镜像源均已提供的 `3.1.1`，避免镜像同步延迟阻断安装；其 `agents-md` 会克隆上游仓库，本项目继续使用上述 HTTP 同步命令。

默认设计规范从 <https://heroui.com/react/DESIGN.md> 下载。刷新前先检查本地定制，避免覆盖；主题调整必须同步 DESIGN.md。

官方参考：

- [Quick Start](https://heroui.com/cn/docs/react/getting-started/quick-start.mdx)
- [LLMs.txt](https://heroui.com/cn/docs/react/getting-started/llms-txt.mdx)
- [MCP](https://heroui.com/cn/docs/react/getting-started/mcp-server.mdx)
- [Agent Skills](https://heroui.com/cn/docs/react/getting-started/agent-skills.mdx)
- [AGENTS.md](https://heroui.com/cn/docs/react/getting-started/agents-md.mdx)
- [DESIGN.md](https://heroui.com/cn/docs/react/getting-started/design-md.mdx)

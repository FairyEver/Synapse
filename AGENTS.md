# Synapse Agent 规则

本文件只保留每次任务都必须看到的仓库级规则。详细约束按任务类型分流到 `docs/agents/`、`.claude/rules/` 和模块设计文档；命中某一领域时，必须先阅读对应文档再修改。

## 每次任务都必须遵守

- 当前对话中用户的明确要求优先级最高。规则、设计文档、现有实现与用户要求冲突时，不要静默选择，先指出冲突并请求确认。
- 做外科手术式修改：只改任务要求范围，先复用现有模块、组件、hooks、services、utils 和类型，不顺手重构。
- 未经用户明确要求，不新增依赖，不执行破坏性操作，不启动开发服务器、浏览器调试、Playwright 或正在运行的应用。
- 生产代码禁止用 `console.log` 当日志；错误必须显式处理、结构化记录或带上下文向上抛出。
- 用户可感知变化、问题修复、功能优化、兼容性、稳定性、打包或发版风险，必须在同一次任务中更新根目录 `RELEASE_NOTES_PENDING.md`。内容面向用户说明“得到什么、什么变了、修了什么”，不要写代码路径、提交号或实现流水账。纯内部整理、版本 bump、无产品影响的文档规划通常不记录。
- 改变长期产品边界、存储归属、权限模型、配置、能力注册或部署要求时，必须同步更新对应规则文档；不要让规则与代码脱节。
- 修改 System App、Dock、Workflow Node、Automation Action、MCP capability/tool、Deep Link 或 `desktop/app-capabilities/` 注册表面时，必须同步更新 `docs/agents/capability-registry.md` 的表格、数量和例外说明。
- 修改用户可操作能力时，同步检查其 MCP 描述/schema、系统 Skill 包和 Agent 指南。Synapse MCP 指南的权威位置是 `desktop/app-capabilities/synapse-skill/skill-package/`。

## 项目与代码位置

Synapse 是跨编辑器的 Rules / Skills / Prompts 管理桌面应用，技术栈为 Electron 41、Vite 8、React 19、TypeScript 6、shadcn/ui（Radix Nova）、Tailwind CSS 4 和 pnpm monorepo。

- Electron 主进程：`desktop/electron/`
- Renderer：`desktop/src/`
- Renderer 业务模块：`desktop/src/modules/`，不得新建并行的 `desktop/src/features/`
- App 能力包：`desktop/app-capabilities/`
- 共享 UI：`desktop/src/components/ui/`
- 共享 renderer helper / 类型：`desktop/src/lib/`、`desktop/src/types/`
- 文档站：`document/`
- 服务端：`server/`

Renderer 只能通过窄而类型化的 `window.synapse.*` preload bridge 访问特权能力。文件系统、Git、安装、下载、dialog、updater 和 OS 逻辑属于 Electron 主进程。

## 必读文档路由

| 任务类型 | 修改前必须阅读 |
|---|---|
| 仓库结构、命令、配置、存储、打包、发布 | `docs/agents/repository-guide.md` |
| 设计文档发现、编码与验证方式 | `docs/agents/execution-rules.md` |
| Renderer 架构、状态、IPC 调用 | `.claude/rules/frontend.md` |
| 主进程 service / IPC handler | `.claude/rules/api.md` |
| 测试 | `.claude/rules/testing.md` |
| 子包开发端口 | `.claude/rules/workspace-dev-ports.md` |
| 文档站文案 | `.claude/rules/document-copy.md` |
| System App、Dock、Workflow/Automation/MCP/Deep Link 注册 | `docs/agents/capability-registry.md` |
| Workflow 数据、分享包、App Capability Package、DataRepository | `docs/agents/workflow-and-capabilities.md` |
| 具体业务模块长期边界 | `docs/agents/module-boundaries.md` |
| Knowledge Base、Agent Runtime、Claude SDK、MCP 诊断 | `docs/agents/knowledge-base.md`、`docs/agents/agent-runtime-security.md` |
| macOS 自动更新、ShipIt/Squirrel、`quitAndInstall`、更新退出与恢复 | `docs/superpowers/specs/2026-07-21-desktop-update-handoff-design.md` |
| UI、样式、交互、产品文案 | `docs/agents/ui-and-product.md`、`.claude/rules/design.md`、`.claude/rules/ui-rules.md` |
| 后续规划 | `docs/agents/future-plans.md` |
| System Notifier | `docs/superpowers/specs/2026-07-23-system-notifier-v1-design.md` |
| Rule / Skill / Prompt 编辑器兼容 | `docs/reference/editor-integration-matrix.md` |
| Issue / PRD | `docs/agents/issue-tracker.md`、`docs/agents/triage-labels.md` |
| 领域模型 / ADR | `CONTEXT.md`、`docs/agents/domain.md`、`docs/adr/` |

修改带产品边界的模块前，还要用模块名、目录名、能力名和即将修改的路径在 `docs/` 中搜索相关设计文档，重点检查 `docs/agent-guides/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`。相关文档中的 `Hard Rules`、`Non-Goals` 以及“禁止 / 不允许 / 必须 / 不支持 / 不新增”均为强约束。

## UI 与产品文案底线

- 使用当前 shadcn/Radix 组件、主题 token 和现有模块实现；禁止自定义颜色、hex/rgb/hsl、Tailwind 任意颜色值、装饰性渐变、glow、emoji heading、卡片套卡片和普通场景的内联样式。
- UI 文案只保留必要标题、label、操作和空/错/加载状态；禁止功能介绍、实现解释、重复状态、营销文案和 AI 自称。
- 写 UI 前必须检查 `desktop/components.json`、`desktop/src/styles/globals.css`、`desktop/src/components/ui/` 和当前模块实现。

## Phase 0 架构硬约束

`@synapse/desktop` 的 `check:hard-constraints` 会强制检查以下边界：

1. 新代码不得在 `desktop/electron/runtime/` 或 `bootstrap/` 导出服务单例；通过 `ServiceRegistry` 组装。
2. 只有 `desktop/electron/runtime/ipc/` 可以裸用 `ipcMain.handle/on`；其它代码使用 `IpcRegistry`。
3. 只有 runtime event-bus/window 基础设施可以裸用 `webContents.send`；跨 renderer 通知走 EventBus。
4. 只有 `desktop/electron/runtime/network/` 可以绑定端口；使用 `NetworkServiceRegistry`。
5. 业务数据不得裸用 `fs.writeFile`；通过 `DataRepository` 持久化。
6. 禁止 `modules/A` 导入 `modules/B/internal`；跨模块使用 `ServiceRegistry`、EventBus 或共享类型。
7. 禁止空 `catch {}`。
8. Renderer 不得直接使用 `ipcRenderer`。
9. `runtime/*` 是纯基础设施，不得导入业务 service/database；组装代码放 `bootstrap/`。
10. shell、userData 外写文件、网络、扩展加载、agent spawn、secret 等敏感操作必须经过 `PermissionGuard` 和 `AuditSink`。
11. 可扩展枚举通过 `ExtensionPoint` 注册；新增硬编码枚举需要明确批准。

不确定时运行：

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run test
```

## macOS 更新交接硬约束

修改 `desktop/electron/services/update-service.ts`、`update-install-recovery-service.ts`、`desktop/electron/bootstrap/before-quit.ts`、`core.update`、Electron/Squirrel 版本或桌面更新打包逻辑前，必须先阅读 `docs/superpowers/specs/2026-07-21-desktop-update-handoff-design.md`，并遵守以下不变量：

- `before-quit-for-update` 只表示原生更新任务已提交，不表示 ShipIt 已启动；只有确认当前用户 launchd domain 中 ShipIt 为 `state = running` 且有有效 PID，才允许 Synapse 退出。
- ShipIt 未启动或验证超时时，必须回滚本次安装记录并保留当前进程、主窗口和已下载更新，不得提前退出应用。
- 更新恢复必须在后台执行；launchctl、缓存清理、DataRepository 恢复判断和重新下载不得阻塞主窗口创建。
- launchd 与缓存操作必须经过 `PermissionGuard`、`AuditSink` 和受控进程执行器；只能操作设计文档规定的两个精确缓存目录，并设置可终止的硬超时。
- 不得删除或弱化 ShipIt 未启动、启动验证超时、缓存删除卡死和恢复不阻塞启动的回归测试。相关修改至少运行更新专项测试、desktop typecheck、`check:hard-constraints`；涉及打包边界时还要运行 `check:packaged-asar`，正式发布前完成真实 macOS 跨版本更新验收。

## 开发命令

- 根目录：`pnpm dev`、`pnpm dev:desktop`、`pnpm dev:server`、`pnpm dev:document`
- 停止：`pnpm quit`、`pnpm quit:desktop`、`pnpm quit:server`、`pnpm quit:document`
- 只启动本次改动所需的最小范围；服务已运行且热更新足够时不要重启。
- 自动化测试或 UI 测试只能使用上述根命令，不要猜测启动方式。

## Synapse MCP 快捷指令

用户消息出现 `sss` 时，按上下文使用匹配的 `synapse-mcp` 工具：数据库请求使用 Database；定时任务、cron、启停、运行历史使用 Automation。领域仍不明确时只问一句简短澄清。

## 完成前检查

- diff 保持聚焦，命名、类型、校验和错误处理一致。
- 根据改动风险运行最小充分验证；不要用启动应用代替源码、测试和构建检查。
- 再次判断是否需要更新 `RELEASE_NOTES_PENDING.md`，不要把这一步留到发版时补猜。
- Electron 打包边界或发布流程变化时，运行 `pnpm --filter @synapse/desktop run check:packaged-asar`，并验证正式包结构。
- 确认对应专题规则、能力清单、MCP/Skill 指南与实现保持同步。

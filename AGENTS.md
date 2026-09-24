# Synapse Agent 规则

本文件只保留每次任务都必须看到的仓库级规则。详细约束按任务类型分流到 `docs/agents/`、`.claude/rules/` 和模块设计文档；命中某一领域时，必须先阅读对应文档再修改。

根目录 `CLAUDE.md` 是指向本文件的软链接（Claude Code 自动读 CLAUDE.md，不读 AGENTS.md）。**内容只改本文件**；不要删掉软链接去建一个真的 CLAUDE.md，两份会分叉。

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
| 模型上下文、Provider 模型匹配、模型能力目录更新 | `docs/agents/model-capability-catalog.md` |
| macOS 自动更新、ShipIt/Squirrel、`quitAndInstall`、更新退出与恢复 | `docs/superpowers/specs/2026-07-21-desktop-update-handoff-design.md` |
| UI、样式、交互、产品文案 | `docs/agents/ui-and-product.md`、`.claude/rules/design.md`、`.claude/rules/ui-rules.md` |
| iOS / iPadOS 页面、导航、弹窗、终端尺寸、移动端新功能 | `docs/agents/mobile-adaptive-layout.md` |
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

## iPhone 与 iPadOS 共用界面

- `SynapseMobile/` 的每项用户可操作功能都必须同时考虑 iPhone 与 iPadOS 可缩放窗口；不得只把 iPhone 页面等比放大，或以设备型号代替窗口可用空间判断布局。
- 有列表和详情的功能必须复用 `AdaptiveFeatureNavigation` 的选择与折叠模式：宽窗口列表、详情并排，紧凑窗口单列下钻；选中项和深链目标在旋转、窗口缩放、切 Tab 后保持一致。顶层功能导航使用系统自适应 Tab / Sidebar。
- iPadOS 设置采用分类列表与详情；终端主画布按实际可用尺寸计算网格，窗口拖动中不得向桌面反复发送过渡尺寸。录音、消息和终端的现有业务状态不可因栏位折叠丢失。
- 使用 SwiftUI 和系统控件、系统颜色、安全区与呈现方式；支持动态字体、VoiceOver、硬件键盘和指针。任何新的 iOS 页面都按 `docs/agents/mobile-adaptive-layout.md` 的宽窗、半窗、紧凑窗矩阵设计与验证。旧专题规格中的「不做 iPad 专门适配」仅代表当次范围，不再是后续功能的豁免。

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

## 移动端推送网关固定走生产

服务端 `APNS_USE_SANDBOX` 长期固定 `false`，**不要动它**，也不要为了「我手机上装的是数据线开发的包」翻成 `true`。

苹果的推送 token 分环境：数据线装的开发包拿到 sandbox token，TestFlight / App Store 的包拿到生产 token，而服务端只有这一个开关（`server/src/mobile-live/mobile-push.service.ts:105`）。翻成 `true` 会让**所有** TestFlight 用户的推送失效，而且不会报错：苹果回 `BadDeviceToken`，服务端把这个 token 当死号**永久删掉**（同文件 159 行），日志里只留一句 `Mobile push token rejected`。

开发包收不到推送是**接受的代价**——不需要为它做 per-token 环境分流，也不需要为它切网关。开发包调试完，装回 TestFlight 并**重开一次 App** 就能恢复（旧 token 被删了，不会自己回来）。

## 装到手机上就是一条命令

用户说「装到手机」「装机」「安装到手机」「打个包装上」时，直接运行 `pnpm mobile:install`（`SynapseMobile/scripts/install-ios.sh`）：Debug 开发签名构建 → `devicectl` 安装 → 打印这次装上去的版本号和构建号。不要再重新推导 `xcodebuild` 加 `devicectl` 的调用方式，也不要手工拼命令。

手机需要数据线连着并解锁。没有可用设备时脚本会直接说明，照它说的做，不要改用别的路径兜底。

装上去的是开发包，代价见上一节：**收不到推送**。这是已知且接受的，装机时不必重新讨论，更不要为此去动网关。只出 ipa 用 `pnpm mobile:build`（App Store 签名，装不上机），上传 TestFlight 用 `pnpm mobile:release`；发版细节见 `.claude/skills/ios-release`。

## 「静默发版」/「静默部署」

GitHub 的 `CI` 和 `Release` 工作流仅接受手动 `workflow_dispatch`。日常推送和 PR 更新不触发它们；只有用户明确要求运行 CI、发版或静默发版时才启动相应工作流。发版时先运行 CI，成功后再运行 Release。

用户说「静默发版」或「静默部署」时，这是一条完整指令，按顺序做完四件事，不要拆开问：

1. 需要的话先把当前仓库的改动全部提交。发版命令自己会 `git add -A`（`bump-version-commit-push.mjs`），不先提交，未提交的东西会被安静地卷进那句 `chore: bump version` 里。**只提交，不要 push** —— 紧接着的发版命令会把它一起推上去。
2. 按 `synapse-release-publisher` skill 跑完整发版流程：推送版本提交后显式启动 CI，CI 成功后才显式启动 Release；**跳过第 11 节的企业微信通知**。第 0 节的 destination 校验只是为了让第 11 节能发出去，一并不做 —— 不发通知时，通知配置有问题不该拦下一次发版。
3. 发版成功后把最新 iOS 包传到 TestFlight：`pnpm mobile:release`。
4. 最后执行服务器部署脚本：`bash deploy.sh`。

第 3 步开始上传后就可以并行跑第 4 步，不必等构建处理完：`deploy.sh` 的 `sync_remote_code` 是 `--include` 白名单且收在 `--exclude='*'`，名单里没有 `SynapseMobile/`（也没有 `desktop/`），iOS 产物不会上服务器，两边不碰同一个东西。

「静默」的边界只有通知。归档 Release 正文、写 `docs/releases/`、打开 Release 页面都照做，只是不发企业微信。结束时明说一句「通知已按静默要求跳过」，别让人以为漏了。

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

## 代码任务完成后自动 Git 提交

- 每次 AI 对话中的代码修复或功能开发完成并通过必要验证后，必须在最终回复前自动执行一次本地 Git 提交，无需再次询问；用户明确要求不提交时除外。自动提交不包含 push。
- 只提交本次任务产生的代码及配套测试、文档、发布说明；提交前检查 diff 和暂存区，不得混入用户或其他任务的未提交改动。没有实际改动时不创建空提交。
- 提交信息用中文清楚说明开发了什么功能或解决了什么问题，以及关键行为变化，让复盘者无需阅读 diff 就能理解提交目的。可使用 `feat: 支持按项目筛选 Agent 会话`、`fix: 修复更新安装失败后主窗口提前退出的问题`；禁止只写“更新代码”“修复问题”“优化”等泛化描述。复杂改动在提交正文补充原因和主要效果。
- 最终回复中提供提交短哈希和提交摘要；提交失败时说明原因，不得声称已提交。

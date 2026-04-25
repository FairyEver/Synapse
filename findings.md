# CC Connect 融合开发方案发现记录

## 输入文档

- `待办/融合cc-connet/产品设计.md`
- `待办/融合cc-connet/功能覆盖.md`
- `待办/融合cc-connet/架构方案.md`
- `待办/融合cc-connet/约束与风险.md`

## 关键发现

- 输入实际包含四份文档，不是三份：产品设计、功能覆盖、架构方案、约束与风险。
- `产品设计.md` 是主产品蓝图，覆盖定位、信息架构、顶层导航、会话/项目/连接/自动化/Provider/IDE/规则/命令/权限/文件/语音/系统等模块，并给出 M1-M5 渐进落地建议。
- `功能覆盖.md` 重点判断融合对 Synapse 的侵入性：顶层导航中等侵入，现有模块低侵入扩展，主进程服务层高增量但不破坏，preload 和数据配置中等侵入。
- `架构方案.md` 是技术迁移备忘，核心围绕平台接口、Agent 接口、统一消息模型、Engine 编排层、会话、多项目多工作区、配置、Provider、Agent 适配、平台适配、Bridge、Management API、命令、Skill、权限、自动化、Relay、Hooks 等。
- `约束与风险.md` 强调先迁移模型再迁移功能、特权逻辑放主进程、UI 只迁移信息架构不迁移视觉实现、每阶段要有可独立验收闭环。
- 当前仓库已经有 Phase 0 runtime 基础设施：`ServiceRegistry`、`IpcModule/IpcRegistry`、`EventBus`、`NetworkServiceRegistry`、`PermissionGuard`、`DataRepository`、`ProjectContainer` 等。开发方案应优先把 CC Connect 融合作为这些 runtime 能力上的新服务和新模块，而不是新开平行架构。
- 当前 renderer 顶层在 `desktop/src/App.tsx`，顶层 tab 类型是 `SynapseContentType | "data-store" | "editor-scan" | "settings"`；新增“会话/项目/连接/自动化”需要扩展类型、tabs 和渲染分支，但不能改变仓库/身份空状态流程。
- 当前 preload 以 `window.synapse` 暴露窄接口，类型定义在 `desktop/src/types/bridge.ts`，IPC channel 由 `desktop/electron/generated/ipc-channels.generated.ts` 生成。后续新增 agent/provider/session 等能力必须走 IpcModule + codegen，不应直接暴露 `ipcRenderer`。
- `.claude/rules/design.md` 与 `.claude/rules/ui-rules.md` 确认当前 UI 基线是 `radix-nova`、neutral、CSS variables、lucide、Radix/shadcn。方案中的 UI 阶段必须只迁移信息架构，使用现有 shadcn primitives 和 token。

## 决策

- 开发方案应以四份文档共同约束为依据，不能只按产品页或只按架构页拆分。
- 开发方案只写实施设计，不进行代码实现。
- 开发方案的主落点采用“主进程服务 + typed IPC/preload + renderer modules”的三层拆分，并把所有网络、文件、Agent 子进程、密钥、调度、外部连接都限定在 Electron 主进程。

## 风险

- 如果直接翻译 CC Connect Go Engine，会形成 TypeScript 巨型服务并违反当前 Phase 0 服务化约束。
- 如果 sessionKey、Synapse UI session、Agent backend session 三层 ID 不先定义，后续平台、Cron、Relay、历史都会混乱。
- 如果 provider secret 或 shell/webhook/bridge 能力进入 renderer，会违反项目安全边界。
- 如果先接全平台或先做 STT/TTS/run_as_user，会放大依赖、打包、权限和风控风险。

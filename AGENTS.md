# Synapse Agent 规则

本仓库内的所有任务都先遵循本文件。

## 顶层硬性要求

本节是本仓库的长期硬性要求摘要，只记录不应被长设计文档冲淡的边界。除非用户在当前对话中明确覆盖，否则所有 agent 必须优先遵守。

### 优先级与冲突处理

- 当前对话里的用户明确要求优先级最高。
- 本节优先于下方详细说明和模块设计文档。
- 模块设计文档中的 `Hard Rules`、`Non-Goals`、明确的“禁止 / 不允许 / 必须 / 不支持 / 不新增”语句都是强约束。
- 如果本节、模块设计文档、当前代码实现或用户需求之间冲突，不要静默选择；先指出冲突并请求确认。
- 如果本次任务改变了长期设计基线，必须同步更新对应文档，避免后续 agent 继续读取旧规则。

### UI 与文案

- UI 修改必须优先使用当前 shadcn/Radix 基线、`desktop/components.json`、`desktop/src/styles/globals.css`、现有 `desktop/src/components/ui/` 组件和当前模块已有实现。
- 禁止自定义颜色、hex/rgb/hsl 字面色、Tailwind 任意颜色值、装饰性渐变、glow、emoji heading、卡片套卡片和营销式内部工具界面。
- 禁止普通场景下的内联 `style={{...}}`；动态运行时值除外。
- UI 文案只保留必要标题、label、操作、空/错/加载状态；不要写功能介绍、实现解释、重复状态或 AI 自称。

### 工程边界

- 做外科手术式修改，只改任务要求范围内的内容。
- 新增代码前先查现有模块、组件、hooks、services、utils 和类型。
- 不新增依赖，除非用户明确要求或设计文档明确批准。
- 不做未确认的破坏性操作，不静默覆盖用户数据。
- 生产代码禁止用 `console.log` 当日志；错误必须显式处理、结构化记录或带上下文向上抛出。

### 模块硬边界摘要

- Knowledge Base 是 Synapse 托管项目类型；新建知识库时用户只提供名称，真实目录由 Synapse 创建在 app-managed storage 中，项目路径对用户显示为虚拟 `synapse-kb://<id>`。
- Knowledge Base 托管运行目录可以包含来自内置 `claude-obsidian` 模板的 Claude Code plugin、skill、command、hook、脚本、提示词和 `CLAUDE.md`，因为它不是用户选择的可见项目目录。
- Knowledge Base 不再通过临时 SDK 注入把资源拼装到用户可见 vault；但托管知识库会话可以、且应当把自身 backing directory 作为 Claude Code SDK local plugin 加载，以激活内置 `claude-obsidian` 的 plugin、skill、command 与允许的 hook。Agent 会话仍必须把托管知识库项目解析到其 backing directory，普通项目不得加载知识库 runtime 行为。
- Knowledge Base 专用逻辑必须隔离在知识库模块或知识库专属资源目录内，例如 `desktop/electron/services/knowledge-base/`、`desktop/resources/knowledge-base/` 和最小 renderer 项目能力 UI。不要把知识库专用逻辑散落到普通 Agent 对话、Scheduler、Workflow 或其它触发 Agent 的功能里；普通项目不应加载知识库 plugin、skill、hook、prompt 或快捷动作。
- Agent 会话创建只能基于已配置项目；新会话必须绑定 `agentType`；运行时状态按 conversation 隔离，不要让同项目多会话共享队列、busy 状态或 live session。
- Agent composer slash menu 只负责插入 `/<name>`，不得立即执行或发送；不得改成通用命令面板；不得新增 renderer 侧目录扫描器或改变后端 command/skill 解析语义。
- Workflow 必须保持外层 DAG 约束；MCP/agent 写操作必须走 get -> mutate -> validate -> save 的受控路径，校验失败不得保存；不得删除 end 节点。
- Workflow loop 的退出条件必须由子图内真实节点和 Loop Output 的 continue/break 出口表达，不要退回到隐藏在配置面板里的表达式字符串。
- Scheduler 子进程环境必须经过 allowlist；`PATH` 默认按用户配置和 login shell 环境 merge；运行诊断必须保留，失败时用于 UI 排查。
- Rule / Skill / Content 写入编辑器目录、覆盖、替换、备份失败等敏感路径必须经过确认、权限检查和审计；备份失败必须阻断替换；安装和复制文案不能混用。
- 扫描详情的“发布到仓库”不得静默写库；覆盖路径只能预填本地版本并进入内容详情编辑态，由用户保存后才落库。

## 模块设计文档发现规则

不要在本文件中维护具体设计文档清单。修改带产品边界的模块前，先在 `docs/` 下自动查找相关设计文档作为参考，重点搜索 `docs/agent-guides/`、`docs/superpowers/specs/`、`docs/superpowers/plans/` 和模块专属文档目录。

查找方式：

- 用模块名、目录名和关键能力名搜索，例如 `knowledge-base`、`agent-runtime`、`slash menu`、`workflow`、`scheduler`、`rule skill content`、`editor scan`。
- 同时用即将修改的路径片段搜索，例如 `desktop/src/modules/workflow`、`desktop/electron/services/agent-runtime`。
- 优先阅读标题、路径或正文与当前改动直接相关的设计文档；不要为了“保险”批量读取无关长文档。
- 读取后把其中的 `Hard Rules`、`Non-Goals`、明确的“禁止 / 不允许 / 必须 / 不支持 / 不新增”语句视为强约束。
- 如果搜索不到可信的相关设计文档，继续遵循本文件和现有代码边界；不要编造文档路径或假设不存在的设计说明。

如果任务涉及 UI 行为、样式、视觉设计、排版、颜色、间距、组件外观、主题，或任何 renderer 侧呈现，必须阅读并遵循：

- `.claude/rules/design.md`
- `.claude/rules/ui-rules.md`
- `desktop/components.json`
- `desktop/src/styles/globals.css`
- 当前模块已有 UI 实现

`.claude/rules/design.md` 是默认视觉基线，但不是在所有时间点都自动高于代码现状。若设计文档与当前 shadcn preset、全局 tokens、已有组件实现或用户明确需求冲突，不要静默套用旧文档；必须指出冲突并请求确认。

## 技术栈

- Electron
- React
- Tailwind CSS
- shadcn/ui
- TypeScript

## Synapse MCP 快捷指令

当用户提到 `sss` 时，按意图使用匹配的 `synapse-mcp` MCP 工具：

- 数据库、表、字段、行、SQL、Database 或数据增删改查请求使用 Database 工具。
- 定时任务、scheduler、cron/interval、启用/停用、运行历史或 runtime 状态请求使用 scheduler 工具。
- 如果 `sss` 没有明确领域，先根据上下文推断；仍不明确时，只问一句简短澄清。

## 当前 UI 基础

- 当前 shadcn preset 是 `desktop/components.json` 中的 `radix-nova`。
- 当前 primitive 基础是 Radix，不是 Base UI。
- `desktop/src/components/ui/` 必须保持与当前 shadcn + Radix 设置一致。
- 除非任务是用户明确批准的迁移，否则不要添加或重新引入 `@base-ui/react`。
- 添加或重装 shadcn 组件时，保留当前 Radix 基础。如果任务需要重新初始化或重装 shadcn，使用 Radix 路径，不要切换到 `base`。

## 当前仓库结构

- 本仓库是 pnpm monorepo。工作区根目录包含共享文档（`AGENTS.md`, `CLAUDE.md`, `README.md`）、项目级 Claude 规则 `.claude/rules/`、`.github/` CI，以及 monorepo 的 `package.json` / `pnpm-workspace.yaml`。工作区包包括 `@synapse/desktop`、`@synapse/website`、`@synapse/server`、`@synapse/auto` 和 `@synapse/auto-web`；桌面应用源码位于 `desktop/` 子包。
- 根目录公开开发入口是 `pnpm dev:website`、`pnpm dev:server` 和 `pnpm dev:desktop`；根目录刻意没有 `pnpm dev` 命令。使用 `pnpm quit` 停止本地开发进程和 server compose 服务。其他包级脚本直接使用对应包名运行，例如 `pnpm --filter @synapse/desktop run <script>`。
- 特权 Electron 代码位于 `desktop/electron/`。
- Renderer 代码位于 `desktop/src/`。
- 共享 shell 状态与编排位于 `desktop/src/app-shell/`。
- 共享 UI 组件位于 `desktop/src/components/` 和 `desktop/src/components/ui/`。
- 共享纯工具函数位于 `desktop/src/lib/`。
- 共享 renderer 全局类型位于 `desktop/src/types/`。
- Renderer 新业务模块应放在 `desktop/src/modules/`，不要放在 `desktop/src/features/`。
- 当前已有 renderer 业务模块以 `desktop/src/modules/*` 为准；`rules`、`skills` 和 `settings` 已经存在。新增模块或目录前先查现有结构。

## 核心规则

- 创建新文件或目录前，先遵循现有项目结构。
- 除非任务是明确迁移，否则不要引入 `desktop/src/features/` 这类并行架构。
- 优先做小而局部的修改，避免大范围重写。
- 新增代码前先复用现有组件、hooks、services 和 utilities。
- 除非用户明确要求，不要新增依赖。
- 只使用函数组件。保持组件和 hooks 纯净。
- 副作用应放在事件处理器、effects、Electron 主进程代码或专用服务中。
- 使用严格 TypeScript。避免 `any`；如果确实不可避免，隔离使用并说明原因。

## Phase 0 架构硬约束（SPEC §1）

每个 PR 都必须满足这些约束。`@synapse/desktop` 的 `check:hard-constraints` 脚本会强制检查；CI 会在推送到 `main` 或面向 `main` 的 PR 中运行。

1. **新代码禁止全局单例**：不要在 `desktop/electron/runtime/` 或 `desktop/electron/bootstrap/` 中写 `export default new XxxService()`。通过 `ServiceRegistry` 组装服务（见 `desktop/electron/runtime/service-registry`）。
2. **禁止裸用 `ipcMain.handle/on`**：只有 `desktop/electron/runtime/ipc/` 可以调用它们。其他代码通过 `IpcRegistry.register(IpcModule, ctx)` 注册。
3. **禁止裸用 `webContents.send`**：只有 `desktop/electron/runtime/event-bus/`（通过 `WindowBroadcaster`）和 `desktop/electron/runtime/window/`（通过 `WindowManager.broadcast`）可以调用。跨 renderer 通知走 EventBus。
4. **禁止裸用 `http/net/https.createServer`**：只有 `desktop/electron/runtime/network/` 可以绑定端口。使用 `NetworkServiceRegistry.register(descriptor)`。
5. **业务数据禁止裸用 `fs.writeFile`**：通过 `DataRepository.namespace(name).upsert/setSingleton` 持久化。
6. **禁止 `modules/A` 导入 `modules/B/internal`**：跨模块通信通过 `ServiceRegistry.get<T>(id)` 或 `EventBus`。共享类型放在 `src/types/`。
7. **禁止空 `catch {}`**：必须处理、通过 `StructuredLogger.warn(...)` 记录，或带上下文重新抛出。不要静默吞错。
8. **Renderer**：Electron 能力只能通过 `window.synapse.*` 使用。不要直接使用 `ipcRenderer`。
9. **`runtime/*` 是纯基础设施**：永远不要导入 `desktop/electron/services/*`、`desktop/electron/database/*` 或业务代码。胶水代码放在 `desktop/electron/bootstrap/`。
10. **敏感操作**（shell、写入 userData 之外的文件、网络连接、扩展加载、agent spawn、secret 访问）：必须经过 `PermissionGuard.check()` 并记录到 `AuditSink`。
11. **可扩展枚举**（content types、editor adapters、connectors、providers、hook types、UI panels）：通过 `ExtensionPoint` 注册。新增硬编码枚举需要明确批准。

不确定时运行 `pnpm --filter @synapse/desktop run check:hard-constraints` 和 `pnpm --filter @synapse/desktop run test`。
- 严格保持 renderer、preload 和主进程边界。
- 文件系统、git、安装、下载、dialog、updater 和 OS 逻辑属于 Electron 主进程代码，不要放进 React 组件。
- Renderer 代码只能通过窄而类型化的 preload API 访问特权能力。
- 不要向 renderer 暴露原始 `ipcRenderer`、`window.require` 或宽泛 Electron API。
- 显式处理异步错误。不要静默吞掉失败。
- 除非任务明确改变交互，否则保留现有交互模式。
- 除非用户明确要求，不要为了验证启动开发服务器。代码修改后，把运行时验证留给用户。
- 除非用户明确要求，不要启动或调用 runtime debugging、browser previews、Chrome DevTools、MCP browser/page inspection、Playwright sessions，也不要打开正在运行的应用页面做验证。通过源码推理完成检查。
- 功能 UI 优先使用 shadcn/ui 组合方式，以及 `.claude/rules/design.md` 记录的默认 preset 样式。
- 当任务修改 UI 或样式时，先使用现有 shadcn 组件和主题 token，再考虑新增视觉处理。
- 将当前 renderer UI 栈视为 `shadcn/ui + Radix`；不要静默替换 primitive 库或 preset。
- 优先使用 `desktop/src/components/ui/` 中的 shadcn primitives，不要在 `desktop/src/components/` 创建新的通用组件。
- 如果缺少所需 UI primitive，在 `desktop/src/components/ui/` 添加官方 shadcn 组件，或尽量贴近 CLI 输出；不要先手写自定义 primitive。
- 如果 `.claude/rules/design.md` 指定了当前 shadcn preset、字体导入、tokens 或组件使用规则，优先遵循它，而不是使用页面级临时覆盖。
- 保持 app shell 和功能模块共用同一套 shadcn 基线，不要维护并行视觉系统。
- 如果组件、hook 或 service 变得过大，拆分成更小且命名清晰的单元。

## Karpathy-inspired 执行规则

这些行为准则用于减少常见 LLM 编码错误。与本文件中的项目规则合并执行。

权衡：这些准则偏向谨慎而不是速度。对于很小的任务，按判断执行。

### 1. 编码前先思考

不要假设。不要隐藏困惑。说清权衡。

实现前：

- 明确说明你的假设。不确定就问。
- 如果存在多种理解，列出来，不要静默选择。
- 如果有更简单的方案，说出来。必要时提出反对意见。
- 如果事情不清楚，停下来。指出哪里困惑，并提问。

### 2. 简单优先

用能解决问题的最小代码。不要做 speculative 设计。

- 不添加超出需求的功能。
- 不为单次使用的代码加抽象。
- 不添加未经要求的“灵活性”或“可配置性”。
- 不为不可能出现的场景写错误处理。
- 如果写了 200 行但 50 行可以解决，重写得更简单。

问自己："资深工程师会不会觉得这过度复杂？" 如果会，就简化。

### 3. 外科手术式修改

只改必须修改的内容。只清理你自己造成的问题。

编辑现有代码时：

- 不要“顺手改进”相邻代码、注释或格式。
- 不要重构没有坏掉的东西。
- 匹配现有风格，即使你会用不同方式实现。
- 如果发现无关死代码，提出来，不要删除。

当你的修改产生孤儿代码时：

- 移除由你的修改造成的未使用 imports、变量、函数。
- 除非用户要求，不要删除预先存在的死代码。

检验标准：每一行变更都应该能直接追溯到用户请求。

### 4. 目标驱动执行

定义成功标准。循环推进直到验证完成。

把任务转换为可验证目标：

- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

多步骤任务先给出简短计划：

```text
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

强成功标准能让你独立循环。弱标准（如 "make it work"）需要持续澄清。

这些准则生效的表现是：无必要变更更少，因为过度复杂导致的返工更少，澄清问题发生在实现前而不是出错后。

## 设计护栏

任何 UI 或样式任务，除非用户明确要求例外，都默认遵循这些要求：

- 使用 `desktop/components.json` 和 `desktop/src/styles/globals.css` 中定义的当前 shadcn preset 与 CSS variable tokens。
- 优先使用中性 palette tokens，例如 `bg-background`、`text-foreground`、`bg-card`、`border-border` 和 `bg-muted`。
- 使用 preset 默认字体导入和 tokenized font roles，不要额外添加独立品牌展示字体。
- 优先使用 shadcn 默认 radius、border、shadow 和 focus-ring 处理，不要使用自定义 arbitrary values。
- UI 决策顺序：已经合适的现有业务组合 -> 现有 `desktop/src/components/ui/` 组件 -> 新增到 `desktop/src/components/ui/` 的 shadcn 组件 -> 模块内薄组合 -> 最后才是自定义 primitive。
- 先用 shadcn 组件组合，再考虑手写并行 UI primitives。
- Tailwind 主要用于布局、间距、尺寸、响应式、overflow 和简单排版；不要把它作为重写按钮、输入框、卡片、对话框或 tabs 样式的主要方式。
- 当存在或可以添加 shadcn 等价组件时，不要在 `desktop/src/components/` 创建新的共享展示 primitive。
- 除非任务明确要求，避免硬编码品牌色、自定义阴影系统、装饰性渐变和页面级独立视觉语言。

## 产品文案护栏

- 把所有 UI 文案都视为面向最终用户的产品文案，不是给开发者看的实现说明。
- 除非用户确实需要这些信息来完成当前任务，否则不要把路线图说明、未来阶段计划、架构理由、状态边界解释、技术 caveat 或设计自证放进界面。
- 空状态、加载状态、禁用状态和错误状态应简短、行动导向。用朴素语言告诉用户现在能做什么，或刚刚发生了什么。
- 优先提供一个清楚的下一步，而不是多句解释。
- 保留任何 UI 句子前，先问："普通用户现在使用这个功能时真的需要这句话吗？" 如果不需要，就删掉。

## 放置规则

- 新 renderer 业务逻辑通常应放在相关模块的 `desktop/src/modules/<module>/` 下。
- 模块内部在边界有帮助时，优先使用 `components/`、`hooks/`、`services/`、`types.ts` 和 `utils.ts`。
- 共享纯 helper 放在 `desktop/src/lib/`。
- 共享 renderer 全局类型放在 `desktop/src/types/`。
- 当 Electron 逻辑变多时，拆到 `desktop/electron/` 下命名清晰的文件中，不要把 `desktop/electron/main.ts` 越堆越大。
- 保持 `desktop/src/App.tsx` 专注于 app-shell 组合和顶层 tab 编排，不要放入深层功能逻辑。

## 完成前

- 检查是否已有文件解决了任务的一部分。
- 保持最终 diff 最小且聚焦。
- 确保命名明确且一致。
- 行为变化时，同步更新类型、校验和错误处理。
- 确保另一位工程师无需反向推理隐藏抽象，也能继续扩展代码。

# Synapse Agent 规则

本仓库内的所有任务都先遵循本文件。

## 项目概览

Synapse 是跨编辑器的 Rules / Skills / Prompts 管理桌面应用。用户通过 Synapse 创建、版本管理并安装内容到 Claude Code、Codex、Cursor 等编辑器，同时使用 Agent 会话、工作流自动化、诊断、用量分析和本地数据能力。

渲染进程通过 `window.synapse.*` preload bridge 与主进程通信。主进程、preload、renderer 边界要求以本文件和 `.claude/rules/` 为准。

## 基础上下文

### 规则索引

| 文件 | 覆盖范围 |
|------|----------|
| `AGENTS.md` | 仓库权威规则、模块设计索引、架构硬约束、放置规则 |
| `.claude/rules/design.md` | 视觉基线、颜色 token、字体、组件风格、主题切换 |
| `.claude/rules/ui-rules.md` | UI 编写规则、Tailwind 使用边界、className 纪律、用户文案 |
| `.claude/rules/frontend.md` | 前端架构约定、状态管理、IPC 通信、模块组织 |
| `.claude/rules/api.md` | 主进程 service / IPC handler 设计约定 |
| `.claude/rules/testing.md` | 测试策略与规则 |
| `.claude/rules/workspace-dev-ports.md` | 子包 dev 端口分配 |
| `.claude/rules/website-copy.md` | 文档站文案规范 |

### 技术栈

- Electron 41 + Vite 8 + React 19 + TypeScript 6
- shadcn/ui（radix-nova preset）+ Tailwind CSS 4
- pnpm monorepo（`desktop/` + `website/` + `server/`）
- Git-based 内容存储 + SQLite Database

### 仓库结构与命令

- 本仓库是 pnpm monorepo。工作区根目录包含共享文档（`AGENTS.md`、`NOT.md`、`TODO.md`、`CHANGELOG.md`、`RELEASE_NOTES_PENDING.md`）、项目级规则 `.claude/rules/`、`.github/` CI，以及 monorepo 的 `package.json` / `pnpm-workspace.yaml`。工作区包包括 `@synapse/desktop`、`@synapse/website`、`@synapse/server`、`@synapse/auto` 和 `@synapse/auto-web`；桌面应用源码位于 `desktop/` 子包。
- 仓库速览：
  ```text
  desktop/
  ├── electron/           # 主进程：runtime / bootstrap / services / database
  ├── src/                # 渲染进程：React SPA
  │   ├── app-shell/      # 壳层：Context Providers / Navigation / Logging
  │   ├── modules/        # 功能模块
  │   ├── components/ui/  # shadcn 组件库
  │   ├── hooks/          # 共享 hooks
  │   ├── lib/            # 工具函数
  │   └── types/          # 类型定义
  website/                # VitePress 文档站
  server/                 # 服务端与管理后台相关代码
  ```
- 特权 Electron 代码位于 `desktop/electron/`。
- Renderer 代码位于 `desktop/src/`。
- 共享 shell 状态与编排位于 `desktop/src/app-shell/`。
- 共享 UI 组件位于 `desktop/src/components/` 和 `desktop/src/components/ui/`。
- 共享纯工具函数位于 `desktop/src/lib/`。
- 共享 renderer 全局类型位于 `desktop/src/types/`。
- Renderer 新业务模块应放在 `desktop/src/modules/`，不要放在 `desktop/src/features/`。
- 当前已有 renderer 业务模块以 `desktop/src/modules/*` 为准；`rules`、`skills` 和 `settings` 已经存在。新增模块或目录前先查现有结构。
- 根目录开发启动命令：`pnpm dev`（同时启动 desktop + server）、`pnpm dev:desktop`（仅桌面端）、`pnpm dev:server`（仅后台，含 server API、dashboard 和 compose 服务）、`pnpm dev:website`（仅官网）。停止命令：`pnpm quit`（全部停止）、`pnpm quit:server`、`pnpm quit:desktop`、`pnpm quit:website`。其他包级脚本直接使用对应包名运行，例如 `pnpm --filter @synapse/desktop run <script>`。
- 启动策略：根据当前任务修改的内容选择最小启动范围，不要无差别执行 `pnpm dev`。只改 `desktop/` 就只启 `pnpm dev:desktop`；只改 `server/` 就只启 `pnpm dev:server`；两者都改才用 `pnpm dev`。如果对应服务已经在运行，因为有热更新，通常不需要停止再重启——直接修改代码即可生效。只有在确认热更新不覆盖的场景（如改了 Electron 主进程入口、改了构建配置、改了依赖）时才需要重启。
- 除非用户明确要求，不要为了验证主动启动 dev server 或打开运行中的应用页面。
- 进行自动化测试、UI 测试或需要本地服务的验证时，禁止自行猜测启动 / 停止命令，必须使用上述根目录命令。

### Synapse MCP 快捷指令

当用户提到 `sss` 时，按意图使用匹配的 `synapse-mcp` MCP 工具：

- 数据库、表、字段、行、SQL、Database 或数据增删改查请求使用 Database 工具。
- 定时任务、scheduler、cron/interval、启用/停用、运行历史或 runtime 状态请求使用当前 Automation 工具；legacy `scheduler_*` MCP 工具已退役，不要再引导 Agent 调用。
- 如果 `sss` 没有明确领域，先根据上下文推断；仍不明确时，只问一句简短澄清。

## 未来开发计划

本节用于记录 Synapse 后续可能建设的产品板块、后台能力、长期规划和暂未启动的开发方向。这里的内容不是当前任务的实现要求，也不自动授权新增功能；它的作用是让 Agent 在做当前设计、数据结构、接口、模块边界和扩展点时，能理解产品未来可能演进的方向，并在不增加当前复杂度的前提下避免明显封死后续路线。

当用户明确表达“未来要开发某个功能 / 计划做某个板块 / 先记录一下后续规划”等意图时，默认把该内容整理后追加到本节，而不是当成当前立即实现的开发任务。除非用户明确要求实现、设计详细方案或写到其它文档，否则只更新本节中的未来计划记录。

后续补充计划时，应尽量描述目标、边界、触发场景和对现有模块的潜在影响，不要把未确认想法写成必须立即实现的硬规则。当前章节先作为占位说明，暂不列具体计划。

### 云盘文件编辑与同步

- 未来支持直接编辑云盘中的文档，让云盘文件不只作为附件或预览资源，也可以成为可编辑内容来源。
- 未来支持把云盘中的单个文件关联到本地文件，并进行双向同步：远端文件更新后同步到本地，本地文件更新后同步回远端。
- 未来支持把云盘中的文件夹关联到本地文件夹，并对文件夹内容进行双向同步：远端文件夹内容变化同步到本地，本地文件夹内容变化同步回远端。
- 未来支持用户通过 MCP 直接修改网盘里的文件，包括自己拥有的文件，以及别人分享给自己且自己具备修改权限的文件。
- 设计相关能力时，应注意预留文件身份映射、冲突处理、同步状态、变更检测、权限校验和失败恢复等扩展点；但在没有明确当前任务需求前，不要提前实现完整同步系统。

### Notifier 基础提醒能力

- Sound Notifier 是声音提醒系统应用，负责本机语义声音提示、重复提醒参数，以及对外提供声音提醒 MCP 能力。
- 未来可新增 System Notifier，负责跨平台系统消息通知、默认通知行为设置，以及对外提供系统通知 MCP 能力。
- 未来可新增 Mobile Notifier，负责通过手机 App 向用户自己发送提醒，并对外提供手机提醒 MCP 能力。
- 未来可新增 WeChat Notifier，负责通过微信公众号或微信相关通道向用户自己发送提醒，并对外提供微信提醒 MCP 能力。
- 未来 Agent 对话、终端应用或其它需要用户输入/关注的模块，可以调用对应 Notifier 能力进行提醒；不要在各模块里重复实现声音、系统通知、手机推送或微信通知逻辑。
- 设计新的 Notifier 应保持与 Sound Notifier 的命名关系和能力边界清晰，但在没有明确当前任务需求前，不要提前实现其它提醒通道。

## 顶层硬性要求

本节是本仓库的长期硬性要求摘要，只记录不应被长设计文档冲淡的边界。除非用户在当前对话中明确覆盖，否则所有 agent 必须优先遵守。

### 优先级与冲突处理

- 当前对话里的用户明确要求优先级最高。
- 本节优先于下方详细说明和模块设计文档。
- 模块设计文档中的 `Hard Rules`、`Non-Goals`、明确的“禁止 / 不允许 / 必须 / 不支持 / 不新增”语句都是强约束。
- 如果本节、模块设计文档、当前代码实现或用户需求之间冲突，不要静默选择；先指出冲突并请求确认。
- 如果用户明确要求的改动会让 `AGENTS.md` 中的长期规则、模块边界、配置说明、存储归属、权限模型、部署要求或同步清单与代码不一致，必须在同一次任务中同步更新 `AGENTS.md`；不要只改代码后让后续 agent 继续读取旧规则。用户没有明确要求改变长期基线时，不要借机扩写无关规则。

### UI 与文案

- UI 修改必须优先使用当前 shadcn/Radix 基线、`desktop/components.json`、`desktop/src/styles/globals.css`、现有 `desktop/src/components/ui/` 组件和当前模块已有实现。
- 涉及产品定位、信息架构、用户文案、视觉气质或体验取舍时，先阅读 `docs/reference/product-context.md`，再结合本文件和 `.claude/rules/` 判断。
- 禁止自定义颜色、hex/rgb/hsl 字面色、Tailwind 任意颜色值、装饰性渐变、glow、emoji heading、卡片套卡片和营销式内部工具界面。
- 禁止普通场景下的内联 `style={{...}}`；动态运行时值除外。
- UI 文案只保留必要标题、label、操作、空/错/加载状态；不要写功能介绍、实现解释、重复状态或 AI 自称。
- 模态弹窗必须按用途选择统一结构：普通小表单、确认、导入类弹窗继续使用默认 shadcn `DialogContent` 关闭按钮；固定高度、`p-0`、主体滚动、右侧 header actions、或标题栏中间有 tabs 的大弹窗必须使用 `desktop/src/components/ui/dialog.tsx` 导出的 `DialogFrame`、`DialogFrameHeader`、`DialogFrameBody`、`DialogFrameFooter`，并在 `DialogContent` 上显式 `showCloseButton={false}`，由 `DialogFrameHeader` 放置关闭按钮。
- 带 tabs 的大弹窗必须用 `DialogFrameHeader center`：左侧放标题/描述，中间放 tabs，右侧放 actions 和关闭按钮；tabs 的视觉居中不得受右侧按钮数量影响。禁止业务文件继续用 `pr-8`、`pr-12` 给默认绝对定位关闭按钮让位，禁止同一类弹窗混用默认绝对 close 和 header 内 close。
- 真正不可关闭的阻塞弹窗可以 `showCloseButton={false}` 且不显示 header close，例如知识库存储迁移未安全完成阶段或强制 onboarding；这类例外必须由流程状态支撑，不得用于普通信息查看或表单弹窗。
- 系统 App 独立窗口如需顶栏 tab，必须使用居中顶栏模式：左侧保留等宽占位，中间放 tab，右侧放操作区；tab 的视觉居中不得受右侧按钮、筛选器或左侧是否有内容影响，不要在左侧添加冗余窗口标题。
- 系统 App 顶栏必须优先复用 `desktop/src/modules/apps/components/system-app-top-bar.tsx` 的共享组件。右侧 actions 只能使用无边框的紧凑 ghost 样式：文字按钮用 `SystemAppTopBarActionButton` 默认形态，纯图标按钮用 `iconOnly`，危险操作用 `tone="destructive"`，不要把 `outline`、默认实心按钮或带底色的 destructive 胶囊按钮直接放进顶栏。系统自带的新窗口打开按钮也必须遵守这套样式。顶栏右侧 ghost actions 不额外增加横向 gap，让按钮依靠自身内边距相邻排列；需要扩大命中区时只能做不造成相邻 action 横向重叠的处理。
- 系统 App 如果是单任务表单工具，例如“选择输入 -> 设置选项 -> 执行生成/导出”，默认参考 `desktop/app-capabilities/document-template/renderer/index.tsx` 的布局：内容区使用一个收窄的居中工作卡片，宽度跟任务复杂度匹配，不要铺满大屏；字段采用稳定 label 列 + 控件列对齐；文件选择使用 InputGroup + 右侧 outline 按钮；底部只保留必要选项、主操作和状态摘要。不要在卡片内部再放贴边段落标题、营销介绍、功能说明、卡片套卡片、重复边框或大段帮助文案。主按钮文案应是明确动作，例如“生成文档”，状态只展示是否就绪、缺什么、成功或失败。

### 工程边界

- 做外科手术式修改，只改任务要求范围内的内容。
- 新增代码前先查现有模块、组件、hooks、services、utils 和类型。
- `AGENTS.md` 是仓库级长期约束，不只是说明文档。凡是修改以下关键部分，都必须主动检查并按需同步本文件：对象存储域和 bucket 用途、环境变量和配置项、数据落库位置和备份/恢复策略、权限/审计/安全边界、MCP capability/schema/tool 命名、系统 App 能力包结构、Electron 打包边界、用户可操作模块的长期产品边界。更新时只记录稳定规则、归属和禁止事项，不写一次性实现流水账。
- `desktop/config.ts` 用于集中放置桌面端全局配置常量；该文件内每个常量定义都必须添加中文注释，说明用途和影响范围，后续 AI 编码新增常量时必须自动补齐注释。
- 配置文件（例如 `.env`、`.env.example`、`*.env.*`）必须按职责分组，并为每组和每个配置项添加中文注释，说明用途、影响范围或单位；示例文件不得携带密码、token、secret、私钥、真实数据库连接串等关键信息。
- 服务端腾讯 COS 按业务域隔离，不要因为“都是文件”混用 bucket 或复用错误模块。当前域划分如下：
  - `DRIVE_COS_*` / Drive Storage：只用于用户云盘文件、云盘文件版本、Drive 公开素材和 Drive Sites 发布资源；这些对象受 Drive 元数据、权限、生命周期、容量统计或 Drive 专属公开资源规则约束。不得把用户头像、智能体头像、系统图标、模板封面等平台媒体塞进 Drive，也不得让这类平台媒体占用用户网盘额度。
  - `SKILL_REPOSITORY_COS_*` / Skill Repository Storage：只用于云端 Skill 仓库文件、安装包和分发产物。Skill Repository 服务端存储必须使用这组 COS 配置，不提供本地 root 或 fallback 存储。不得复用它存头像、普通用户文件、临时上传、备份包、Rule/Prompt 云端分享数据或任意平台媒体。
  - `PLATFORM_MEDIA_COS_*` / Platform Media Storage：用于用户头像、智能体头像、系统应用图标、团队头像、模板封面、分享封面、模型图标等平台承担费用的小型媒体资源。默认按私有读写 bucket 设计，前端应使用 Synapse 后端媒体 URL 或后端签发的短期访问能力，不直接暴露 COS bucket/key。对象 key 应使用稳定业务前缀，例如 `platform-media/users/<userId>/avatar/...`、`platform-media/agent-personas/<personaId>/avatar/...`、`platform-media/system/<kind>/...`。
  - `BACKUP_COS_*` / Backup Storage：只用于服务端灾备归档，当前 key 前缀为 `backups/`。不得让业务运行时文件、头像、用户上传文件或 Skill Repository 包写入备份桶。
- 新增任何服务端对象存储用途前，必须先判断能否归入现有 COS 域；如果语义、权限、生命周期、计费归属或备份策略不同，应新增明确的 storage domain，而不是临时复用 Drive、Skill Repository 或 Backup。新增 COS 域时必须同步更新 `server/src/config/env.ts`、`server/src/config/env.spec.ts`、`server/compose.yml`、`server/.env.example`、部署/初始化脚本、README 和本文件，并保持 `*_COS_SECRET_ID`、`*_COS_SECRET_KEY`、`*_COS_BUCKET`、`*_COS_REGION` 四项完整性校验。
- 数据库只能保存对象元数据和引用，例如 `storageKey`、`assetId`、`mimeType`、`size`、`sha256`、归属关系、状态和版本；不要把图片或大文件字节写入 PostgreSQL / SQLite / DataRepository。删除、替换、回滚和孤儿对象清理必须显式设计，底层对象删除失败不得静默丢失元数据。
- 备份策略必须按 COS 域明确说明。当前 Backup 轻量灾备包含数据库和 Drive COS 对象清单，不包含 Drive 文件字节、Skill Repository 对象字节或 Platform Media 对象字节；如果未来某个新域需要可恢复，必须同步补 manifest、复制、恢复说明或其它明确方案。
- 不新增依赖，除非用户明确要求或设计文档明确批准。
- 不做未确认的破坏性操作，不静默覆盖用户数据。
- 生产代码禁止用 `console.log` 当日志；错误必须显式处理、结构化记录或带上下文向上抛出。
- 完成用户可感知或发版相关改动后，必须更新根目录 `RELEASE_NOTES_PENDING.md`。记录要面向后续发版说明，口语化说明用户得到什么、什么行为变了、修了什么问题；不要写代码路径、提交号或实现流水账。纯内部整理、版本 bump、无产品影响的文档规划通常不需要记录。
- 修改工作流、Scheduler、Automation、Content、Rule、Skill、Prompt 等用户可操作能力时，如果该能力有对应 MCP 工具、系统 Skill 包或 Agent 使用指南，必须在功能改动完成后同步更新对应 MCP 能力描述/schema、Skill 包和指南文档；不要只改产品功能本体。
- Synapse MCP 的 Agent 使用指南归属于系统 Skill 包 `desktop/app-capabilities/synapse-skill/skill-package/`，不属于资源仓库内置资源。修改 Database、Drive、Workflow、Automation、Content、Model Price、Variable、Repository 等 MCP 域能力时，必须同步更新该包下对应 `<domain>/index.md` 和必要的 `<domain>/api-reference.md`；不要再新增或维护旧式 `desktop/resources/templates/skills/synapse-*-mcp/` 或资源仓库内置 Skill 模板。
- 修改 Electron 打包边界时必须把 `app.asar` 当成启动关键路径处理。凡是改动 `desktop/package.json` 的 `files`、`asarUnpack`、`extraResources`，或新增/移动 Electron worker、原生模块、可执行文件、运行时资源，都必须同步确认 sourcemap、unpacked 文件和 packed 文件不会错位；不要只把 `.js` 加入 `asarUnpack` 而忽略同目录产物如 `.js.map`。Claude SDK native binary（例如 `node_modules/@anthropic-ai/claude-agent-sdk-*/claude` 或 `claude.exe`）属于启动关键 runtime 文件；只写 `asarUnpack` 不够，必须校验证明目标平台的实际二进制已落在 `app.asar.unpacked` 中。发版前必须用 `pnpm --filter @synapse/desktop run check:packaged-asar` 或等价校验证明 `package.json`、主进程入口、packed hash 和 unpacked 文件存在性正常。

### App Capability Package 架构

- 当新增系统应用同时提供 App UI、MCP 能力、Workflow 节点或其它外部调用入口时，必须按能力包组织代码，目录放在 `desktop/app-capabilities/<app-id>/`。
- 能力包必须按职责拆分：`shared/` 放 schema、类型、capability id、MCP tool 名和 manifest；`main/` 放核心 service、IPC 和 MCP dispatcher；`renderer/` 放系统应用界面；`workflow-node/` 放工作流节点 schema、manifest、executor、panel 和 card。
- 核心业务逻辑必须集中在 `main/service.ts` 或同级 core service 中。App UI、IPC、MCP dispatcher、Workflow node 只能作为入口适配器，不得各自复制核心逻辑。
- 能力包接入现有全局 registry 时，必须保持专属业务逻辑内聚在能力包内；不要把应用专属逻辑散落到 `desktop/src/modules/apps`、`desktop/workflow-nodes`、`desktop/synapse-capabilities` 或 Electron bootstrap 文件中。
- App 类 MCP capability 命名采用 `app.<app_namespace>.<subdomain>.<action>`，MCP tool 名采用 capability id 的下划线形式，例如 `app.document_template.docx.generate` 对应 `app_document_template_docx_generate`。
- 生成类能力使用 `generate` action。新增这类 action 或 domain 时，必须同步更新 capability 命名校验、MCP tool 映射、action router、内置 `synapse-skill` 模板和相关测试。
- 能力包如果涉及本地文件读写、网络、shell、Agent、Drive 或其它敏感能力，入口适配器和核心 service 必须保留统一权限检查、审计、错误脱敏和日志边界，不得只在某一个入口处理。
- 系统应用自有业务数据默认使用 DataRepository namespace，命名格式为 `app.<app-id>.<entity>`，例如 `app.quick-input.items`。`app-id` 使用系统应用 id 的短横线形式，`entity` 使用英文复数名词或明确单例名，例如 `items`、`groups`、`runs`、`settings`。
- 系统应用自有数据不得直接手写 SQLite 业务表名；SQLite backend 的实际表名由 DataRepository namespace 自动映射，例如 `app.quick-input.items` 对应 `ns_app_quick_input_items`。只有确有理由绕过 DataRepository 时，必须先在设计文档中说明并获得当前对话确认。
- 系统应用数据 backend 选择默认规则：小型单例配置用 `json`，列表型用户数据优先用 `sqlite`，密钥或 token 用 `encrypted-json`，追加型审计或运行日志用 `jsonl`。记录必须带 `schemaVersion`，schema 放在 `desktop/electron/runtime/data-repo/schemas/` 并注册进 `allSchemas`。
- 系统应用从旧配置或旧文件迁移数据时，必须有幂等迁移标记，迁移成功后清理旧有效数据来源，避免用户清空新数据后又被旧数据复活。迁移失败不得删除旧数据，必须结构化记录错误并允许下次重试。
- Renderer 不得直接读写 DataRepository。系统应用自有数据必须通过能力包 `main/service.ts` 或同级 core service 读写，再由 IPC、MCP、Workflow node 或 App UI 作为入口适配器调用。

### 参考模板目录

- `templates/` 目录下的内容是外部参考模板，仅供阅读和参考，禁止自动修改其中的任何文件。
- 如需修改模板代码，必须由用户在当前对话中明确要求。
- 当用户提供模板线上 demo URL 时，按以下规则定位本地源码以供模仿：
  - `shadcn-admin`（线上 demo: `https://shadcn-admin.netlify.app/`）：源码位于 `templates/shadcn-admin/`。URL 路径对应 `src/routes/_authenticated/<path>/index.tsx`（路由入口），页面业务实现在 `src/features/<path>/`。

### 金手指系统

- 金手指（cheat code）是代码内注册的隐藏指令身份，稳定名称使用命名空间字符串，例如 `model:flow:disable`；它只是隐蔽入口，不是权限或安全边界。
- 新增或修改类似隐藏入口时，必须优先复用金手指注册层；不要把点击次数、键盘序列、菜单彩蛋等触发逻辑直接散落在组件里。
- 注册项必须分离稳定定义和当前输入绑定：定义声明金手指字符串名、`action`/`state` 类型和回调；输入绑定可以替换，金手指名称和回调语义应保持稳定。
- `action` 类型每次触发只执行一次回调；`state` 类型每次触发通过金手指状态管理器切换 active 状态，持久化成功后再把新状态传给回调。
- 状态型金手指的持久状态走统一状态管理器和 DataRepository，不要在组件、hook 或 `localStorage` 中私自保存。
- 点击字符类输入必须按稳定 index 匹配，不按字符值匹配；重复字符必须可区分。不要在 UI 中暴露提示、tooltip 或说明文案。
- 金手指触发可以记录金手指名称，但不得记录用户完整输入序列。若触发敏感操作，仍按敏感操作规则执行权限检查和审计。

### 模块硬边界摘要

- Knowledge Base 是 Synapse 托管项目类型；新建知识库时用户只提供名称，真实目录由 Synapse 创建在 Synapse-managed storage 中，项目路径对用户显示为虚拟 `synapse-kb://<id>`。Synapse-managed storage 默认位于 Electron `userData`，也允许用户配置一个全局知识库存储根；实际运行目录始终由 Synapse 创建为 `<storage-root>/knowledge-bases/<runtimeId>/`，不得暴露为逐库自选项目路径。
- Knowledge Base 托管运行目录可以包含来自内置 Synapse Knowledge Base 模板的 Claude Code plugin、skill、command、hook、脚本、提示词和 `CLAUDE.md`，因为它不是用户选择的可见项目目录。
- Knowledge Base 不再通过临时 SDK 注入把资源拼装到用户可见 vault；但托管知识库会话可以、且应当把自身 backing directory 作为 Claude Code SDK local plugin 加载，以激活内置 Synapse Knowledge Base runtime 的 plugin、skill、command 与允许的 hook。Agent 会话仍必须把托管知识库项目解析到其 backing directory，普通项目不得加载知识库 runtime 行为。
- Knowledge Base 专用逻辑必须隔离在知识库模块或知识库专属资源目录内，例如 `desktop/electron/services/knowledge-base/`、`desktop/resources/knowledge-base/` 和最小 renderer 项目能力 UI。不要把知识库专用逻辑散落到普通 Agent 对话、Scheduler、Workflow 或其它触发 Agent 的功能里；普通项目不应加载知识库 plugin、skill、hook、prompt 或快捷动作。
- Agent 会话创建只能基于已配置项目；新会话必须绑定 `agentType`；运行时状态按 conversation 隔离，不要让同项目多会话共享队列、busy 状态或 live session。
- Agent composer slash menu 只负责插入 `/<name>`，不得立即执行或发送；不得改成通用命令面板；不得新增 renderer 侧目录扫描器或改变后端 command/skill 解析语义。
- 快捷输入是独立系统应用，不属于系统设置页。Agent 对话只消费快捷输入库中的文本，并默认直接发送；不要恢复“直接发送”开关，也不要把快捷输入重新塞回 slash menu 的插入候选里，除非当前对话明确改变这个产品边界。
- Knowledge Base 资料管理窗口是 `.raw` 文件管理器；上传和拖拽上传必须把用户选择的文件原样复制到当前 `.raw` 文件夹，不得自动转换格式、生成 Markdown 替代文件、额外保留一份 originals 附件，或把普通上传变成 source staging 流程。
- Workflow 必须保持外层 DAG 约束；MCP/agent 写操作必须走 get -> mutate -> validate -> save 的受控路径，校验失败不得保存；不得删除 end 节点。
- Workflow loop 的退出条件必须由子图内真实节点和 Loop Output 的 continue/break 出口表达，不要退回到隐藏在配置面板里的表达式字符串。
- Scheduler 子进程环境必须经过 allowlist；`PATH` 默认按用户配置和 login shell 环境 merge；运行诊断必须保留，失败时用于 UI 排查。
- Rule / Skill / Content 写入编辑器目录、覆盖、替换、备份失败等敏感路径必须经过确认、权限检查和审计；备份失败必须阻断替换；安装和复制文案不能混用。
- Skill 可持续配置使用根目录 `.env.example` 声明键，由安装器生成或合并本地 `.env`；不要把真实 `.env` 写入资源仓库，也不要继续把需要后续同步的值替换进 `SKILL.md`。
- 密钥名称与 `.env` 键名构成文件关联，名称创建后不可修改。密钥值变化后只能扫描受信任编辑器 Skill 目录，并由用户确认后进入内存串行队列；不得保存安装实例或静默改写。
- Skill 运行时 `.env` 的扫描、重新安装合并和队列更新大小上限均为 1 MiB，超限必须安全失败。macOS 和 Linux 新生成的 `.env` 默认只允许文件所有者读写，重新安装不得放宽既有权限。在密钥关联能力中，Windows 支持扫描，但队列写入必须逐项失败并提示手动更新；不得降级为非原子写入。macOS 和 Linux 的队列写入采用最终复查后紧邻同目录原子重命名的乐观并发保护，不承诺跨进程严格 CAS。
- 扫描详情的“发布到仓库”不得静默写库；覆盖路径只能预填本地版本并进入内容详情编辑态，由用户保存后才落库。

## 知识库相关

本节记录 Knowledge Base 的长期边界。后续 agent 修改知识库、Agent Runtime、Claude Code SDK 参数、MCP 注册诊断或 Synapse Knowledge Base 模板时，必须先读本节。

### 产品与运行边界

- Knowledge Base 是 Synapse 托管项目，不是用户可见普通目录。用户只看到 `synapse-kb://<id>`，真实 backing directory 存在 Synapse-managed storage 中。该 storage 默认使用 Electron `userData`，也可以通过全局设置迁移到用户选择的根目录；每个知识库的真实目录仍由 Synapse 管理，不能成为 renderer 可编辑的项目路径。
- 更改全局 Knowledge Base storage root 必须通过显式迁移入口完成：阻止新的知识库会话和写入，拒绝在有运行中知识库会话时迁移，完整复制并校验所有 managed runtime 后再切换配置，成功后才把旧 `knowledge-bases` 目录移入系统废纸篓/回收站。失败时必须保留旧配置和旧数据，不得自动分叉到默认目录。
- Knowledge Base storage root 迁移期间必须用不可通过遮罩、`Esc`、关闭按钮或页面切换关闭的阻塞模态框控制界面。复制和校验阶段允许取消；进入配置切换和旧目录清理阶段后必须禁用取消。应用退出请求也必须被拦截，直到迁移完成或安全取消。
- Knowledge Base storage root 迁移必须持久化恢复状态。切换配置前异常中断时继续使用旧位置；切换后但新位置未验证前中断时启动阶段先验证新位置，验证失败再回滚旧位置；新位置验证成功后即为权威位置，后续旧目录清理失败或中断不得回滚。恢复完成前必须阻止知识库操作并显示阻塞模态框。
- 自定义 Knowledge Base storage root 不可访问时，知识库创建、资料管理和 Agent 会话启动必须停止，只允许重新检测；源数据恢复可访问前不得更改位置或恢复默认位置，不得自动回退默认目录写入新数据。
- Knowledge Base renderer Agent 会话必须把 backing directory 作为 Claude Code SDK local plugin 加载，并允许该知识库模板内已启用的 plugin hooks。普通项目不得加载知识库 plugin、skill、hook、prompt 或快捷动作。
- Scheduler、Workflow 或其它非 renderer Agent 入口不得默认获得知识库 plugin runtime。只有明确绑定托管 Knowledge Base 且入口策略允许时，才加载 Knowledge Base 专用行为。
- Agent composer slash menu 只负责插入 `/<name>`，不得改成自动执行命令，也不要在 renderer 侧新增目录扫描器来替代后端 command/skill 解析。
- Knowledge Base renderer Agent 和普通 Agent 都应尽量与用户本机 Claude Code 看到同一套 MCP：Claude SDK `settingSources` 必须包含 `["user", "project", "local"]`。不要因为 `allowPluginHooks === true` 就移除 `user` settings。
- 不要新增 SDK `mcpServers` 程序化注入来“修复”知识库 MCP。Synapse MCP 继续通过用户 Claude Code 配置读取，注册位置是 `~/.claude.json`，当前 server 名是 `synapse-mcp`。
- Knowledge Base 不做 MCP 隔离。用户本机 Claude Code 能读到的 MCP，知识库 Agent 也应能读到；权限是否允许调用仍走现有工具权限流程。
- 资料管理 UI 的上传语义是 raw file copy：按钮上传和拖拽上传都只写入当前 `.raw` 目录，保持文件名与内容原样；不要在这个入口自动解析 PDF/Office/图片、生成 intake Markdown、写 `_attachments/originals/` 或维护“原件 + 转换产物”两套资料。需要格式转换或摄入整理时，必须通过独立工具、显式命令或 `/wiki-ingest` 处理 `.raw` 中真实存在的原始文件。

### Native slash 与可观测性

- Knowledge Base 的 `/wiki-ingest`、`/save` 等由托管 runtime/Claude plugin 提供的原生 slash，应作为 Claude SDK/plugin native slash 原样透传；不要把它们改成 Synapse renderer 侧命令、普通 prompt command、agent 自行模拟流程或 renderer 目录扫描器。
- Agent command routing 必须保持优先级清晰：已注册 prompt/custom command 和普通 skill 先处理；只有命中 `agentNativeSlashAllowlist` 或 `allowAgentNativeSlash` 的 slash 才能进入 native slash passthrough；`unknownSlashBehavior: "passthrough"` 只表示“不拦截未知 slash”，不得把未知 slash 标记成已允许的 native slash。
- Native slash passthrough 不得改写用户原始消息。发送给 Claude SDK 的内容必须仍是用户输入的完整 `/name ...`，包括参数正文；Synapse 只能在外层增加可观测事件，不应替用户拆参、重组或模拟执行。
- Native slash passthrough 的可观测提示只表示“Synapse 已按白名单把该 slash 原样交给 Claude SDK/plugin”，不表示 SDK 一定加载了某个 skill、command 或工具。UI、日志和文案不得把这一提示写成 SDK 内部执行结果的证明。
- Native slash passthrough annotation 必须在 `liveSession.send(...)` 成功之后、读取 SDK/tool 事件之前插入；如果会话创建、权限检查、spawn、`send` 或取消失败，不得插入“已交给 SDK”的提示。
- Native slash passthrough annotation 走既有 `sdkEvent` 事件链路并端到端进入实时 timeline、`agent.events`、conversation history 和导出 transcript。稳定语义为 `sdkType: "nativeSlashPassthrough"`，`sdkSubtype`/summary 只记录命令名（例如 `/wiki-ingest`），不得记录参数正文、路径列表或其它用户输入内容。
- Timeline 可以显示克制的 `Native slash /wiki-ingest`；导出文本可以显示 `nativeSlashPassthrough /wiki-ingest` 或等价短文本。不要新增解释性长文案，也不要为了该提示改变 slash 菜单“只插入、不自动发送”的交互。
- 修改 native slash routing、SDK event bridge、history metadata、renderer timeline 或 transcript 导出时，必须测试：注册命令/普通 skill 优先于 native slash、白名单 native slash 有 annotation、未知 passthrough 无 annotation、原始消息原样发送、send/权限失败无 annotation、annotation 不包含用户参数。

### 新建 runtime 初始化

- `desktop/resources/knowledge-base/synapse-knowledge-base-template/` 可以完整同步上游 runtime 资源，并在同步后完成 Synapse Knowledge Base 白标转换；新建 Knowledge Base 的数据净化发生在 runtime 创建阶段，不靠手工删模板来保证用户新库干净。
- 新建 Knowledge Base 可以先复制模板，但必须重置数据层，不能继承上游 demo `wiki/` 页面、`.raw/` source 或示例 manifest。
- 新建 runtime 的最小 wiki 骨架必须包含：`wiki/index.md`、`wiki/hot.md`、`wiki/log.md`、`wiki/overview.md`、`wiki/sources/_index.md`、`wiki/concepts/_index.md`、`wiki/entities/_index.md`、`wiki/questions/_index.md` 和空的 `wiki/meta/`。
- 新建 runtime 的 `.raw/` 必须重置为 `.raw/.gitkeep` 和空 `.raw/.manifest.json`；manifest 结构必须保留 `version`、`sources` 和 `address_map`，其中 `sources` 与 `address_map` 初始为空对象。
- 新建 runtime 的 `.vault-meta/address-counter.txt` 必须重置为 `1`，避免继承上游模板地址计数；`tiling-thresholds.json` 等非语义默认配置应保留，不要把整个 `.vault-meta/` 当垃圾目录清空。
- 创建 runtime 时必须保留模板运行资产：`.claude-plugin/`、`skills/`、`commands/`、`hooks/`、`scripts/`、`CLAUDE.md` 以及模板运行所需的其它资源。不要为了清理示例内容误删 runtime 资产。
- `createManaged()` 复制模板或净化失败时，必须删除本次新建的 runtime 目录并抛出原错误；清理失败只能结构化 warn，不能留下半初始化的托管知识库目录。
- 修改新建 runtime 初始化逻辑时，测试必须覆盖：demo wiki/raw 不被继承、最小骨架存在、manifest 为空、runtime 资产保留、address counter 重置、非语义 `.vault-meta` 配置保留、失败回滚。

### Synapse Knowledge Base 模板更新约定

- 模板里不得把开发机绝对路径、旧上游作者本地路径或其它不可移植路径写进新知识库默认 wiki/hot/log 内容。需要路径时基于当前 cwd/backing directory。
- `/save`、`save` skill 和“记录到知识库”默认语义是保存当前对话、结论或洞察为结构化 wiki note；不要把它们改成一律创建 `.raw/` 原始资料文件。这个语义应尽量跟随上游 runtime 行为。
- “保存笔记”和“资料摄入”必须保持产品语义区分：只有用户明确要求摄入资料、处理 source、导入文件、写入 `.raw/`，或通过资料管理 UI 添加材料时，才把内容作为 raw source 落到 `.raw/`。
- 如果新增“作为资料摄入”类入口，必须先通过 Knowledge Base raw file manager 写入 `.raw/` 中真实 source，再由 `/wiki-ingest` 处理；不要让资料管理上传入口自动做 source staging，也不要让 agent 凭空把已生成的 wiki 页面倒填为 source。
- `/wiki-ingest` 只能处理 `.raw/` 中真实存在的新/变更 source。不要让 agent 凭空手写 source manifest；manifest 更新应保留既有 `sources` 和 `address_map`，代码侧优先使用既有 Knowledge Base manifest 写入能力。
- 如果上游模板更新覆盖了 `skills/save/SKILL.md`、`commands/save.md` 或 `skills/wiki-ingest/SKILL.md`，必须重新检查本节的保存笔记语义、真实 source ingest、manifest 保留和路径约束是否仍然存在。

### 已有库与迁移边界

- 不自动迁移、删除或重写已有用户知识库内容。需要清理旧知识库或迁移已有内容时，必须提供显式入口和用户确认。
- Agent 会话启动、SessionStart 前置处理或后台 hygiene 流程不得为了清理模板残留而改写已有知识库的 `wiki/hot.md`、`wiki/`、`.raw/`、manifest、log 或 `.vault-meta/`。模板 hook 可以在会话中读取 `wiki/hot.md` 恢复上下文，但 Synapse 启动代码不得把读取变成自动修复写入。
- 旧知识库若包含上游本地路径，只能在用户明确触发迁移/清理时窄范围处理明确的旧路径提示。不得为修复路径误导而重建、清空或批量重写用户内容。

### MCP、权限、诊断和日志

- 修改 Claude SDK 参数时必须保留 user/project/local 三类 settings。Knowledge Base 启用 plugin hooks 不应改变普通 Agent 与知识库 Agent 对用户 Claude Code MCP 配置的可见性。
- 修改 Claude Agent SDK 环境变量或 settings 传值时，必须先核对官方文档和当前安装包类型。`Options.env` 是 Claude Code 子进程运行环境；`Options.settings` 是更高优先级的 inline/flag settings，不能把二者当成同一层。
- Claude 供应商隔离必须同时写两层：顶层 `Options.env` 传给子进程，`Options.settings.env` 必须包含当前 Synapse provider 的 `ANTHROPIC_*` 配置（至少 `ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`、`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_API_KEY` 及默认模型变量），用于覆盖 `~/.claude/settings.json`、项目 settings 或本机环境里的旧供应商配置。不要为了脱敏、PATH 合并、hook 隔离或 Knowledge Base plugin runtime 删除 `settings.env`。
- `Options.settings.env` 只能承载当前 provider 的 `ANTHROPIC_*` 覆盖项，不得混入 `SYNAPSE_SIDE_CHANNEL_TOKEN`、data-server token、普通 shell env 或其它 runtime secret。修改这条链路时必须有回归测试证明：当前 provider 的 `ANTHROPIC_BASE_URL`/模型/鉴权字段进入 `settings.env`，side-channel 等非 provider secret 不进入 `settings.env`。
- 历史回归记录：2026-05-31 提交 `6778d598e`（`fix(agent): harden native slash and redaction paths`）删除了 `settings.env: options.env`，导致从 v0.2.203 起在用户本机 `~/.claude/settings.json` 配有其它 Claude 供应商时，Synapse 新会话可能混用“旧 base URL + 当前模型名”，报 `model not found or not supported`。以后遇到同类报错，先检查 `desktop/electron/services/agent-runtime/claude-sdk-session.ts` 的 `settings.env` 覆盖层是否仍存在。
- 自动注册/清理 Synapse MCP 时必须继续移除旧 server 名称：`synapse-data`、`synapse-database`、`synapse-services`，并清理 Claude settings 权限 allowlist 里的旧工具名，例如 `mcp__synapse-data__*`。不要自动新增 `mcp__synapse-mcp__*` allowlist，避免扩大权限。
- Synapse MCP HTTP 是只绑定本机 loopback 的 MCP server，不得要求 AI 客户端配置静态 `Authorization` 或 Bearer header；内部 data-server `/api` 仍必须使用 `data-server.json` token 鉴权。不要把 `/api` 的 token 鉴权复制到 `/mcp`。未来如果需要远程 MCP 鉴权，必须采用 MCP 标准 OAuth 或客户端支持的认证方案，不能要求用户手写静态 Bearer。
- MCP 诊断必须区分两件事：Synapse MCP HTTP server 是否运行，以及 Claude Code 配置 `~/.claude.json` 中是否注册了 `synapse-mcp`。不要用 `~/.claude/settings.json` 或旧权限 allowlist 推断 server 是否存在。
- 诊断 Knowledge Base slash 是 native plugin、`commands/*.md` command 还是 agent 模拟时，只做只读文件证据检查：可检查当前 backing directory、`.claude-plugin/plugin.json`、`skills/<name>/SKILL.md`、`commands/<name>.md` 是否存在和 commands 第一层文件名；不得执行目标 slash，不得读取用户 Claude 配置、进程列表、token、secret、Authorization、cookie 或 password。
- Agent 权限卡片、工具事件、错误日志和导出文本必须脱敏 token/API key/Authorization/Bearer/env JSON/data-server token。普通路径和 `file_path` 仍应保留，方便排查。
- Agent 权限事件里的 `toolInput` / `toolInputRaw` 是展示、权限判断和审计摘要，可能已经脱敏、截断或追加 `[truncated]`；除非用户显式编辑并提交新的 `updatedInput`，否则不得把它们回传给 Claude SDK 或其它 agent runtime 当作真实工具入参，尤其不能让 `Write` / `Edit` 的正文内容从权限卡片摘要回流到实际写文件操作。
- Agent/Knowledge Base 相关脱敏规则必须保持 Electron 与 renderer 一致，优先复用共享 helper，不要在主进程、renderer、导出、Usage Analysis 中各写一套正则。规则至少覆盖敏感 key、JSON 字段、shell/env 赋值、Authorization/Bearer、Cookie、`data-server.json` token、`ps aux`/`--env KEY=value` 输出，同时保留普通文件路径。
- Agent 展示、复制、导出和日志链路必须同时脱敏 tool input 与 tool result content；不能只处理工具入参、权限摘要或错误摘要。文件读取类输出可以保留 `file_path`，但不得泄露 token、Authorization、Bearer、Cookie 或 env secret。
- Usage Analysis 读取 Claude Code conversation/raw event 时，只能对 Synapse 内部展示、详情 JSON、事件流预览和搜索 snippet 使用脱敏投影；不得为了脱敏改写用户机器上的外部原始 JSONL/日志文件，也不得让 rawText 搜索返回真实 secret。
- Provider 配置预览、Agent 环境诊断、MCP/side-channel 诊断不得展示 `buildEnv`、`getAgentEnv` 或 data-server 配置里的真实 secret；需要排查时只显示 key 是否存在、来源类别或 `[redacted]`。
- 修改 SDK event bridge、Agent transcript、tool event UI、Usage Analysis raw 展示或 provider preview 时，必须补回归测试：provider token、side-channel token、Authorization/Bearer、Cookie、JSON `token`/`apiKey`、data-server token、`--env KEY=value` 都不出现真实值，普通 `/Users/...` 路径仍保留。
- 手工验证脱敏时只能使用假 canary，并优先使用只打印、不 `export`、不写文件、不改配置的命令；不要要求用户粘贴真实 token，也不要把测试 token 写进 shell 配置、Claude 配置或 Synapse 配置。
- AskUserQuestion/确认类交互如果返回空答案，后续敏感写操作必须停止，并给用户明确反馈“未收到选择，已停止操作。”不要把空答案当成同意或默认选项。
- AskUserQuestion 的前端展示和内部状态可以用稳定 id、key 或 index 区分重复题干，但回传 Claude SDK 的 `updatedInput.answers` 必须遵守 SDK 契约：key 使用原始 `question` 文本，value 使用用户选择的选项文本。若同一次请求存在重复 `question` 文本，必须在 Agent runtime 边界转换为不会丢失多题答案的 `response` 文本或其它 SDK 支持格式；不要把 `question-0`、renderer 私有 key 或脱敏/截断后的展示摘要原样交给 SDK。修改该链路时必须测试：普通单题、重复题干、多题缺失答案、空答案停止，以及 SDK 工具结果不出现 `User has answered your questions: .`。
- Agent 工具调用与工具结果的稳定关联键是 `toolUseId`。修改 SDK event bridge、history metadata、IPC schema、renderer timeline、复制或导出文本时，必须端到端保留该字段；有 `toolUseId` 的结果只能按 `toolUseId` 归属，缺失时才允许走旧数据兼容 fallback。
- 并行工具结果不能只靠顺序或 `toolName` 猜归属；`toolName` 可能重复或只是 SDK 返回的占位名。文件读取类工具日志和导出文本要保留原始 `file_path`，但 token、Authorization、Bearer、env secret 等敏感值必须继续脱敏。

## 模块设计文档发现规则

不要在本文件中维护具体设计文档清单。修改带产品边界的模块前，先在 `docs/` 下自动查找相关设计文档作为参考，重点搜索 `docs/agent-guides/`、`docs/superpowers/specs/`、`docs/superpowers/plans/` 和模块专属文档目录。

查找方式：

- 用模块名、目录名和关键能力名搜索，例如 `knowledge-base`、`agent-runtime`、`slash menu`、`workflow`、`scheduler`、`rule skill content`、`editor scan`。
- 同时用即将修改的路径片段搜索，例如 `desktop/src/modules/workflow`、`desktop/electron/services/agent-runtime`。
- 修改编辑器 Rule / Skill / Prompt 安装、扫描、复制或兼容策略时，先阅读 `docs/reference/editor-integration-matrix.md`。
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

## UI 与产品体验规则

- 当前 shadcn preset 是 `desktop/components.json` 中的 `radix-nova`。
- 当前 primitive 基础是 Radix，不是 Base UI。
- `desktop/src/components/ui/` 必须保持与当前 shadcn + Radix 设置一致。
- 除非任务是用户明确批准的迁移，否则不要添加或重新引入 `@base-ui/react`。
- 添加或重装 shadcn 组件时，保留当前 Radix 基础。如果任务需要重新初始化或重装 shadcn，使用 Radix 路径，不要切换到 `base`。
- `dashboard/` 是独立的管理后台包，视觉与交互规范以 `templates/shadcn-admin/` 为参考基线。凡是新增或修改管理后台页面，必须先在 `templates/shadcn-admin/` 中查找相近页面、组件和布局，优先复用模板已有结构与组件组合，尽量不要自行发挥页面样式；模板没有对应实现时，再按现有 dashboard 共享组件做最小扩展。
- 管理后台列表页禁止在页面内直接组装 `Table` / `TableHeader` / `TableBody` / `TableCell` / 手写分页；服务端分页表格必须优先使用 `dashboard/src/components/data-table/server-data-table.tsx` 暴露的 `ServerDataTable`，列头使用 `DataTableColumnHeader`。如果现有共享表格不满足需求，先扩展共享表格组件，不要在单个页面复制或临时拼一套表格结构。所有管理后台表格只要有操作按钮列，操作列必须固定在表格右侧，不随横向滚动离开视口；优先通过共享表格组件实现，不要在单个页面重复写 sticky 逻辑。

### 设计护栏

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

### 产品文案护栏

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

### 补充工程边界

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

## 完成前

- 检查是否已有文件解决了任务的一部分。
- 保持最终 diff 最小且聚焦。
- 确保命名明确且一致。
- 行为变化时，同步更新类型、校验和错误处理。
- 判断本次任务是否需要待发布说明；如果涉及用户可感知变化、问题修复、功能优化、兼容性、稳定性、打包或发版风险，更新根目录 `RELEASE_NOTES_PENDING.md`。
- 如果改动 Electron 打包配置、worker、原生依赖、可执行资源、`dist-electron` 输出结构或发布流程，完成前必须验证正式包结构，至少运行 `pnpm --filter @synapse/desktop run check:packaged-asar`；若本地重新打包，优先对新生成的 `desktop/release` 产物验证，不要只依赖源码 typecheck。
- 确保另一位工程师无需反向推理隐藏抽象，也能继续扩展代码。

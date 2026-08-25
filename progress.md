# 进度日志

## 2026-08-25 阶段 18：主流模型能力目录与真实上下文窗口

- **状态：** in_progress
- 已新增单一打包 JSON 目录及确定性更新器：公开阿里云文档解析出 93 条百炼文本生成记录，合并 23 条九类官方直连记录，共 116 条。
- 已实现离线 `model-capabilities:check`、官方文档更新和 Browser Skill 原始响应导入；导入具有异常数量下降、唯一键、别名、来源、排序和 token 范围门禁，并使用临时文件原子替换。
- 目录/匹配专项 1 个文件、6 项通过；确认 qwen3.7-plus 为总窗口 1,000,000、最大输入 991,808，且同名模型按 Provider scope 隔离。
- 用户已批准完整实施计划，范围为百炼全部文本生成模型和八类主流官方直连 Provider。
- 已完整读取 Browser Skill、planning-with-files 与 karpathy-guidelines，并恢复现有三份规划文件；保留工作区中既有 Agent、Drive、Git 和设置改动，不覆盖无关差异。
- 已锁定验收：构建期单文件目录、官方来源、精确 Provider/模型匹配、用户环境变量优先、SDK 实际窗口作为顶栏唯一分母。
- 首次尝试同时补三份规划文件时因误判 `progress.md` 标题导致补丁整体未应用；已改为按真实标题分别追加，不重复该失败操作。
- 下一步通过 Browser Skill 捕获百炼 TG 结构化响应，随后建立目录 schema、校验脚本和匹配红灯测试。
- Browser Skill 已进入登录态百炼模型市场并通过 UI 将模型从 180 组筛选为 51 个文本生成组；XHR-only 捕获未取得响应，已记录并切换到 fetch 捕获方案。
- fetch 捕获本身正常，但首轮 marker 仍使用旧版 `listFoundationModels`；已从页面 resource timeline 定位当前 action 为 `listRecommendedModels`，将改用版本无关的 `modelCenter` marker 后重新触发一次。
- `fetch + modelCenter` 再次无命中，已确定需把 XHR 捕获 marker 同步改为 `modelCenter`；这是第二种不同诊断结果，不会继续重复同一方案。
- XHR marker 更新后，筛选和精选/全部切换仍未重新发请求，确认数据为挂载时一次加载；Browser Skill 会话 `fewj` 已正常停止，没有读取或保存任何凭据。下一次只尝试路由卸载/重挂载这一条新路径。
- 路由卸载/重挂载仍未暴露响应体，第二个 Browser Skill 会话 `anpd` 已正常停止。已切换到阿里云公开“文本生成”能力表和完整模型列表作为正式来源，不再继续浏览器试探。
- 官方公开资料已给出主流与旧版模型的上下文表及当前市场模型详情链接，足以建立可追溯首版目录；Browser Skill 导入能力仍会作为维护工具保留。

## 2026-08-25 阶段 17：Synapse MCP 搜索排序优化

- **状态：** complete
- 已从真实百炼导出日志复现 `list files drive` 将普通云盘文件列表排在第 3 的问题；首轮新增回归准确失败，结果为站点启用、回收站列表、普通文件列表。
- 已保留 Fuse.js 召回并增加 capability title、分词覆盖、规范 action 精确度和语义词距重排；没有新增依赖、远程 embedding、模型或 Provider 白名单。
- 已增加中文规范词映射；`list files drive` 与“查看云盘文件列表”现在都将 `app_drive_item_list` 排在第 1，递归树、回收站和站点工具不再抢占通用意图。
- Router 专项 10/10、Desktop typecheck、hard constraints 与 `git diff --check` 通过。

## 2026-08-25 阶段 16：Synapse MCP 工具按需加载

- **状态：** complete
- 已复核实施方案、工作区状态、AGENTS.md、planning-with-files、能力 MCP/Skill 审计和编码约束。
- 已锁定：默认关闭、只对第三方 Provider 生效、只影响新对话、不确定时回退完整 MCP并提示一次。
- 下一步：读取必读架构/UI/测试文档和现有设置、会话、SDK、MCP dispatcher 实现，再以专项测试驱动修改。
- 设置配置确认可直接复用 `SynapseConfigPatch.agent`；不需要新增 IPC、依赖或 Renderer 持久化层。
- 路径发现错误：预估的 `settings/components/settings-category-content.tsx` 不存在；改用 `rg --files desktop/src/modules/settings` 定位真实入口，不重复猜测。
- 已定位真实设置入口：`data.ts` + 通用 `SettingItemRow` + `index.tsx`，toggle 可直接走 `SynapseConfigPatch.agent`。
- 已定位新对话创建入口在主进程 `ConversationRouter`/`SessionRepository`；实验快照不会信任 Renderer 传值。
- SDK 0.2.138 类型与本地文档已复核：严格 discovery + 进程内 SDK MCP 具备正式 API 支撑；ClaudeAI proxy 和显式 Synapse 权限规则列入 fail-safe 回退。
- 已实现完整 223-tool Fuse.js 索引、进程内 `search/invoke`、公共 MCP 结果归一化复用，以及不消费真实 prompt 的 discovery + strict MCP 重建；其它可序列化 MCP 保留，冲突或权限不等价时回退完整配置。
- 已完成 Provider 类型与端点双重判定、Persona/子 Agent 原始 allowlist 校验、各 permission mode、`toolUseId` 事件投影、历史恢复与一次性回退提示；调用仍进入现有 action router、PermissionGuard 与 AuditSink。
- 已更新 Agent Runtime、Knowledge Base、capability registry、内置 Synapse Skill、设计文档与发布说明；公开 `/mcp` 和 225/223 数量不变。
- 两轮组合回归分别通过 13 个文件/351 项与 5 个文件/89 项；配置 IPC 专项 18/18、时间线与 ConversationRouter 107/107、Desktop typecheck 均通过。下一步运行 hard constraints、packaged-asar、IPC codegen 与最终 diff 门禁。
- 最终新增载荷门禁实测完整 223 工具定义为 203,449 bytes、两个 router 定义为 1,998 bytes，初始 Synapse 工具定义减少 99.02%，超过 90% 验收线。
- Desktop typecheck、hard constraints、IPC codegen、production build 与 `git diff --check` 通过。`check:packaged-asar` 已执行，但当前 `desktop/release` 没有 `app.asar`，脚本按设计退出 1；未为本次非打包边界改动擅自生成或发布安装包。
- 阶段 16 完成；未启动或重启应用、未修改 Provider 凭据、未发起百炼付费模型请求。真实百炼 search → invoke 仍需用户另行授权计费调用时执行。

## 会话：2026-08-25

### 阶段 13：百炼 MCP Tool Search 真实验证

- **状态：** complete
- 用户要求验证百炼链路是否可以显式开启 Claude Code MCP Tool Search。
- 计划通过当前 Synapse 开发版临时设置 `ENABLE_TOOL_SEARCH=true`，创建独立空白会话并要求模型调用一个只读 Synapse MCP 工具。
- 成功证据必须包含 ToolSearch 事件、目标 MCP 工具成功结果、最终回答和 Usage；测试后恢复 Provider 原配置。
- 本轮只修改三份规划记录，不修改产品代码；真实调用会产生少量百炼用量。
- 已读取当前开发版基线：百炼 `qwen3.7-plus` 当前上下文 90.2K/200K；该轮缓存读 88,530、缓存写 89,139。
- 已进入“设置 → 模型与供应商”，下一步记录百炼 Provider 原配置后只增加 `ENABLE_TOOL_SEARCH=true`。
- 已记录百炼 Provider 原配置：没有 Tool Search 开关；API Key 输入保持不变且未读取，配置 JSON 中的密钥字段为空占位。
- 首次设置配置值前 Computer Use 检测到应用状态变化并拒绝动作；确认配置未变，已刷新完整界面状态，避免复用旧索引。
- 已只在百炼 Provider `env` 中加入 `ENABLE_TOOL_SEARCH: "true"` 并保存，界面提示“Provider 已保存”；其余可见配置保持一致。
- 已返回对话页并打开 Synapse 项目的“创建自定义对话”入口，准备固定选择百炼 `qwen3.7-plus` 创建无历史会话。
- 已创建独立空白会话“验证百炼 MCP Tool Search”，顶栏确认 Provider/模型为百炼 `qwen3.7-plus`，尚无历史或上下文占用。
- 测试工具选择 `app_automation_trigger_type_list`：它是只读的内置触发类型发现，不读取用户数据库、云盘、密钥或终端内容；明确点名 deferred MCP 工具可迫使兼容链路先执行 ToolSearch。
- 已发送测试提示，要求必须真实调用该精确工具且不得猜测；会话进入“Agent 处理中”。
- 第一轮 16 秒完成，目标 MCP 工具返回 3 个内置 trigger type；未出现用户可见错误。
- 顶栏仍显示 91.6K/200K，缓存写 91,472、缓存读 89,672，未表现出预期的显著降幅；下一步展开过程事件并导出调试包，核实是否实际发生 ToolSearch。
- 已导出 `/Users/liyang/Downloads/synapse-agent-conversation-验证百炼 MCP Tool Search-20260825-100404Z.zip`；71/71 流事件完整，ToolSearch/tool_reference 命中 0，目标 MCP 工具调用成功且失败数为 0。
- 已定位 Claude Code 2.1.138 本地模型门禁：Qwen 不属于 Sonnet 4+/Opus 4+，即使 `ENABLE_TOOL_SEARCH=true` 也会禁用 Tool Search。下一步恢复百炼原配置。
- 恢复配置时 Computer Use 再次检测到界面刷新并拒绝旧索引；刷新后已安全进入设置，未发生误操作。
- 重新打开百炼编辑器确认测试开关确实持久化为 `ENABLE_TOOL_SEARCH: "true"`，排除“开关未保存”这一解释；现开始删除该唯一测试字段。
- 已删除唯一临时字段并保存，界面提示“Provider 已保存”；下一步重新打开做最终恢复核对。
- 已重新打开百炼 Provider 确认 `ENABLE_TOOL_SEARCH` 不再存在，API 地址、四个模型映射、Hook、权限、插件和其余配置与测试前一致；随后关闭编辑器。
- 最终结论：当前百炼 `qwen3.7-plus` 无法通过 Claude Code 2.1.138 使用 MCP Tool Search。测试会话与调试包保留供复核，产品代码未修改。
- 最终调试包复核：目标工具 1 次调用/1 次结果/0 失败，71/71 流事件无丢弃，ToolSearch 相关命中 0；`git diff --check` 通过。

### 阶段 10：通用 Provider 图片派发重构

- **状态：** complete
- 用户要求推翻所有以 Anthropic 官方模型为中心的设计，主路径改为百炼 Kimi/Qwen 等模型可用的通用方案。
- 已冻结保留边界：Renderer/IPC 引用化、受控暂存、安全与 UI 保留；Provider 特判、专属预算和图片型 MCP 主路径进入重审。
- 下一步核实 Claude Agent SDK 多消息输入语义与百炼官方最小图片输入契约，再冻结批次方案。

### 插入修复：Drive MDXeditor 列表与嵌套层级

- 已按 `synapse-skill` 读取用户给出的 Owner Drive 条目元数据、预览、源码与服务端 HTML。
- 已确认 Markdown 源码和渲染结构均正确，有序/无序列表失效位于前端 marker 样式层。
- 已读取 MDXeditor、Markdown 阅读态、评论投影/锚点 ADR、模块边界和 UI 规则。
- 已按 `impeccable` 产品 register 将方案限制为现有 Tailwind utility 与模块正文选择器，不新增颜色、依赖、CSS module 或额外界面层级。
- 下一步先补列表与嵌套层级回归测试，再做最小样式修复并运行 dashboard 门禁。
- 已新增编辑态与阅读态 marker/缩进回归测试；首次运行 115 项中恰有新增 2 项失败，稳定复现现有缺陷。
- 已在两个正文容器上增加相同的 `list-disc`、`list-decimal` 与层级缩进 utility；未修改编辑器插件、Markdown 序列化或评论代码。
- 已新增服务端嵌套 `ol → ul → ol` 投影回归，验证列表/列表项 block id 继续可用于评论锚点。
- Dashboard 生产构建与 Server typecheck 通过；构建产物已确认生成 `disc`、`decimal` 与嵌套缩进规则。
- Dashboard 全量首跑为 81/85 文件、612/622 tests 通过；失败集中于既有 SSR `document is not defined` 与页面文案快照，下一步用 JSON reporter 精确确认与本次 diff 无关。
- JSON reporter 确认 10 项全量基线失败分别来自路由生成快照、字节格式化、旧页面文案和 7 项 SSR `document` 访问，均未命中本次修改文件的新增行为。
- 插入修复状态已完成；活动计划切回附件阶段 9 的真实 Provider 人工验收。

### Drive 列表修复验证结果

| 验证 | 结果 |
|------|------|
| 编辑态 + 阅读态专项 | 2 files、115 tests passed |
| Markdown renderer + projection | 2 files、24 tests passed |
| 最深层评论 V2 anchor 解析 | attached + exact |
| Dashboard production build | passed，CSS 产物含 disc/decimal/padding 规则 |
| Server typecheck | passed |
| Dashboard 全量 | 81/85 files、612/622 tests passed；10 项既有基线失败 |
| git diff --check | passed |

### 实施授权与上下文恢复

- 用户已明确授权全自主逐阶段实施计划中的阶段 1–9。
- 已完整读取 planning-with-files-zh Skill 和三份活动规划文件。
- session-catchup 未报告未同步上下文；以当前工作树和已记录的附件改动为实施基线。
- 阶段 1 已切换为 in_progress。
- 已读取仓库结构、执行、测试、主进程、Renderer、UI/文案规则和附件设计文档。
- 已确认当前未提交工作树只有三份规划文件，没有产品代码 diff。
- 已定位现有字节链路：Renderer/IPC 类型携带图片字节，runtime 在最终消息构造前同步 Base64 编码。
- 已确认外部单文件当前会扩大授权到父目录，阶段 6 需要改为受控副本。
- 已核实 Anthropic 官方图片与请求体上限，并确认百炼 `kimi-k2.5` 官方声明支持图像输入，但没有足够资料证明其图片工具结果或请求预算与 Anthropic 等价。
- 已核对本地 SDK 进程内 MCP server/tool 类型，并定位选择 IPC 与发送 IPC 两次携带完整图片字节的实现。
- 已审计 artifact store 与 DataRepository schema：可在现有存储上演进，无需新增并行附件数据库或外部依赖。
- 已采集 1/8/20/50 张、每张 1 MiB 的三层复制合成基线；50 张最终 Base64 请求约 66.67 MiB，证明直接内联不可行。
- 已新增版本化附件与派发契约及契约测试，并修订附件设计与 runtime security 长期边界。

### 阶段 0：规划状态重置与方案建立

- **状态：** complete
- **目标：** 清除旧的 planning-with-files 活动状态，建立只服务于 Agent 50 图与附件改造的执行计划。

### 已执行操作

- 完整读取 planning-with-files-zh 的 SKILL.md、初始化脚本和三个模板。
- 按技能要求检查既有 task_plan.md、findings.md、progress.md 和会话恢复状态。
- 查看工作区 diff，确认存在已完成的 Agent 附件任务及无关的 MDXEditor 修改。
- 复核“增强聊天气泡图片显示”任务结果：图片持久化与气泡展示已完成，250 项专项测试及必要门禁已通过。
- 确认当前模型输入仍将所有图片转换为 Base64 image blocks，现有上限仍为 8 张和总计 20 MiB。
- 形成受控暂存、引用化 IPC、Provider 能力画像、大批量按需读取、最小权限文件处理和灰度回退方案。
- 按用户明确要求重置三份规划文件，不再延续旧任务阶段编号。

### 创建或修改的文件

- task_plan.md：完整实施阶段、验收条件、测试矩阵、风险与代码范围。
- findings.md：当前实现、SDK 能力、架构决策、安全边界和待验证问题。
- progress.md：本次重置与计划编写记录。

### 产品代码状态

- 本次未修改产品代码。
- 未启动应用。
- 未运行产品测试；当前动作仅涉及 Markdown 规划文件。
- 后续实现尚未获得执行指令。

## 下一阶段

### 阶段 1：契约冻结与基线测试

- **状态：** complete
- 更新设计硬规则。
- 核实 Provider 最新限制。
- 定义版本化附件契约。
- 建立内存和请求体基线。
- 先写目标行为的红灯测试。

### 阶段 1 完成结果

- 版本化 AttachmentRef、StagedAttachment、CommittedAttachment、ProviderAttachmentCapabilities 与 DispatchPlan 已定义。
- 附件设计和 Agent runtime/security 硬边界已修订。
- Anthropic 与百炼官方能力证据、1/8/20/50 图内存基线已记录在 findings.md。
- `attachment-staging-service.test.ts` 已按预期红灯：缺少阶段 2 的服务实现。

### 阶段 2：附件暂存与生命周期

- **状态：** complete
- 实现现有 artifact 基础上的受控暂存、提交、释放、配额和恢复。
- 已新增 `AttachmentStagingService`：魔数 MIME 校验、临时文件+fsync+rename、SHA-256、50 图/字节/项目/全局配额、TTL、commit、release、过期清理与孤儿标记。
- 已实现单文件流式受控复制和精确文件夹引用，接入 PermissionGuard/AuditSink 且审计不记录源路径。
- 暂存服务红灯已转绿：2 项测试通过，包含 50 图与 staged → committed。
- 已补并发限额、伪造 MIME、TTL 清理、单文件最小权限、精确文件夹和权限拒绝测试；阶段 2 专项合计 25 tests passed。
- `agent.artifacts` schema 已升为 v2 且继续验证 v1 行；旧 artifact 清理不会误删未提交 v2 草稿。
- 完整 desktop typecheck 通过。

### 阶段 3：Renderer 与 IPC 引用化

- **状态：** complete
- Composer、选择、剪贴板、拖放、乐观消息和发送 IPC 已统一切换为 AttachmentRef。
- 主进程在发送时解析可信 staged refs，turn 确定后 commit，并仅在旧 SDK 最终边界临时读取受控字节。
- Renderer Agent 链路搜索不再包含原图 ArrayBuffer、Uint8Array、File.arrayBuffer、Blob URL、data URL 或 Base64。
- Composer 68 tests、阶段 3 综合 243 tests（修复最后一项 legacy 路径回归后）和完整 desktop typecheck 通过。

### 阶段 4：Provider 能力画像与发送前预检

- **状态：** complete
- Anthropic 官方保留文档能力画像；其它用户选择的 Provider/模型统一允许保守内联，不再使用模型名白名单，自定义完整覆盖仍可显式关闭视觉。
- 已实现冻结的 inline / overview-and-tools / reject 派发计划和四类稳定错误。
- 预检在 commit 与 Provider 接收前执行；当前不做不安全的自动重试。
- 移除模型名白名单后，Provider 能力专项 12 tests、Agent 核心 198 tests、desktop typecheck、hard constraints 与 diff check 通过。

### 阶段 5：大批量图片按需读取

- **状态：** complete
- 已实现进程内 `synapse_attachments` MCP：`attachment_list` 只返回无路径 manifest，`attachment_read` 只接受本轮 attachmentId 且每批最多 4 张。
- Router 大批量策略只物化最多 4 张编号概览；系统运行时指令要求“全部检查”时读取并核对完整 manifest。
- SessionManager 用 turn+attachment IDs 隔离 MCP live session，跨轮与下一普通轮都会关闭旧 transport。
- 生产暂存通过 Electron nativeImage 生成 1568 预览和 256 缩略图；读取校验所有权、MIME、SHA、像素和累计字节。
- 阶段 5 最终 193 tests 与完整 desktop typecheck 通过。

### 阶段 6：文件与文件夹最小权限

- **状态：** complete
- 单文件通过 no-follow 文件句柄流式复制到 attachmentId 独占目录，只把该目录加入 SDK 授权，不暴露原父目录。
- 文件夹只授权用户选择的精确目录；暂存与每次发送前均检查祖先/内部 symlink、深度、条目数和可读性。
- 500 MiB 以上普通文件在复制前拒绝；暂存后被替换或加入 symlink 的目录在 materialize 时拒绝。
- 阶段 6 专项 57 tests 与完整 desktop typecheck 通过。

### 阶段 7：50 图交互与性能

- **状态：** complete
- Composer 在既有附件条显示图片数与图片总大小，50 个缩略图使用 lazy/async 解码且从不挂载 preview/original URL。
- 用户消息气泡只渲染前 8 张，第 8 格显示剩余数量；完整 50 张 manifest 仍可在只挂载 active image 的灯箱中导航。
- 按 Impeccable 产品 UI register 复用现有 shadcn/Radix、主题 token 与单层结构，未新增颜色、CSS 或依赖。
- 阶段 7 UI 专项 98 tests 与完整 desktop typecheck 通过。

### 阶段 8：故障恢复、迁移与可观测性

- **状态：** complete
- 保持 schema v1/v2 兼容，启动后台清理 staged/orphan；会话删除覆盖 committed v2 独占目录。
- Planner 结构化记录 count/bytes/strategy/estimated bytes/duration/error category，不记录附件 ID、名称、路径或内容。
- 新增默认开启的 references 开关与显式 legacy-inline 开关；回退只收紧为最多 8 图内联，不恢复 raw bytes IPC。
- 设计文档与 runtime security 写明灰度、回滚、日志脱敏和内部 MCP 非公开 capability 边界。
- 阶段 8 专项 87 tests 与完整 desktop typecheck 通过。

### 阶段 9：全链路验证与发布准备

- **状态：** in_progress
- 数量、体积、入口、格式、安全、生命周期、Provider 策略、回退和无原始字节持久化矩阵均有自动化覆盖。
- 发布说明、设计和 runtime security 指南已同步；本次无打包资源或公开 capability 注册变化。
- desktop 全量 859 files / 7971 tests、typecheck、hard constraints 与 git diff --check 全部通过。
- 真实 Provider 人工验收尚未完成：当前运行的是已打包旧版本，本机 Anthropic 配置已归档，启动当前工作树开发应用和产生付费调用均需用户明确授权。

## 测试结果

| 测试 | 输入 | 预期结果 | 实际结果 | 状态 |
|------|------|----------|----------|------|
| planning diff 格式 | 三份重置后的 Markdown 文件 | 无空白和补丁格式错误 | git diff --check 通过 | passed |
| 产品测试 | 无 | 本次不运行 | 未运行 | not_run |
| 暂存服务红灯 | 50 图暂存与 staged → committed | 阶段 2 实现前失败 | 缺少 `attachment-staging-service` 模块 | expected_fail |
| 暂存服务实现 | 50 图暂存与 staged → committed | 全部通过 | 2 tests passed | passed |
| 阶段 2 专项 | 暂存、artifact v1/v2、schema | 全部通过 | 25 tests passed | passed |
| desktop typecheck | Renderer/Electron/preload/tests | 通过 | exit 0 | passed |
| 阶段 3 综合专项 | Composer/Renderer/IPC/staging/router | 全部通过 | 243 项基线中最后一项修复后相关 65 项复跑通过 | passed |
| 阶段 3 desktop typecheck | 全部 TypeScript target | 通过 | exit 0 | passed |
| 阶段 5 专项 | MCP/SDK/session/router/staging/schema/provider | 全部通过 | 193 tests passed | passed |
| 阶段 5 desktop typecheck | 全部 TypeScript target | 通过 | exit 0 | passed |
| 阶段 6 专项 | staging/attachments/session | 全部通过 | 57 tests passed | passed |
| 阶段 6 desktop typecheck | 全部 TypeScript target | 通过 | exit 0 | passed |
| 阶段 7 UI 专项 | Composer/附件条/气泡/历史 | 全部通过 | 98 tests passed | passed |
| 阶段 7 desktop typecheck | 全部 TypeScript target | 通过 | exit 0 | passed |
| 阶段 8 专项 | flags/artifact/staging/router | 全部通过 | 87 tests passed | passed |
| 阶段 8 desktop typecheck | 全部 TypeScript target | 通过 | exit 0 | passed |
| 阶段 9 Agent 核心专项 | staging/provider/MCP/SDK/session/router | 全部通过 | 198 tests passed | passed |
| 阶段 9 IPC 契约回归 | 引用发送与原始字节/路径拒绝 | 全部通过 | 22 tests passed | passed |
| 阶段 9 desktop 全量测试 | 全仓库测试 | 全部通过 | 859 files、7971 tests passed | passed |
| 阶段 9 desktop typecheck | Renderer/Electron/preload/tests | 通过 | exit 0 | passed |
| 阶段 9 hard constraints | Phase 0 架构边界 | 通过 | All hard-constraint checks passed | passed |
| 阶段 9 diff check | 全部工作树变更 | 无 whitespace/patch 错误 | exit 0 | passed |
| packaged asar | 打包资源边界 | 本次无打包资源变更 | 不适用 | not_applicable |
| Provider 模型白名单移除 | 百炼任意模型、未知自定义端点、显式关闭覆盖 | 默认保守内联且覆盖仍生效 | Agent 核心 198 tests passed | passed |

## 错误日志

| 时间戳 | 错误 | 尝试次数 | 解决方案 |
|--------|------|----------|----------|
| 2026-08-25 | 首次读取误用了不存在的 `desktop/electron/modules/agent/__tests__/ipc-messages.test.ts` | 1 | 已用 `rg --files` 定位实际 `ipc.test.ts` |
| 2026-08-25 | 一次性契约/文档补丁因末段上下文顺序不匹配而未应用 | 1 | 改用分文件、小上下文补丁 |
| 2026-08-25 | artifact schema v2 补丁未匹配现有 `isSha256Hex` 校验表达式 | 1 | 改为读取精确块后整体替换 |
| 2026-08-25 | 首次 typecheck 发现 v2 image validator 未窄化可选 `mimeType` | 1 | 已增加字符串窄化，待复跑 |
| 2026-08-25 | 第二次 typecheck 发现测试未窄化 directory union | 1 | 已增加受控文件类型断言，待复跑 |
| 2026-08-25 | artifact-store 测试采用 v1/v2 union 后未窄化可选路径 | 1 | 已增加显式测试断言，待复跑 |
| 2026-08-25 | 引用化附件补丁对同一文件同时使用 Delete/Add，被 apply_patch 拒绝 | 1 | 改为单一 Update File 补丁，不重复该写法 |
| 2026-08-25 | 阶段 3 首次 typecheck：附件测试仍传 `bytes`，hook 依赖数组残留 Blob URL 清理函数 | 1 | 将测试改用 preview/thumbnail/sha ref，并清除残留引用 |
| 2026-08-25 | 阶段 3 第二次 typecheck：附件条与 chat hook 测试仍断言 Blob URL/旧 image data | 1 | 更新为 `synapse-agent-artifact://` URL 和 `{ attachmentId, order }` |
| 2026-08-25 | 图片路径识别补丁因测试标题上下文不匹配未应用 | 1 | 拆分生产/测试补丁并使用实际标题锚点 |
| 2026-08-25 | 阶段 3 专项首轮 120 tests：4 个旧 UI/发送断言失败 | 1 | 按 ref URL、文件名正文、ID/order payload 更新断言；116 项已通过 |
| 2026-08-25 | Agent IPC 55 tests：14 项旧 raw path/bytes 发送测试失败 | 1 | 迁移为 staging 安全测试与引用 IPC 契约测试，不恢复旧字节 schema |
| 2026-08-25 | Composer 68 tests：18 项及 6 个异步错误由缺少 projectId/旧候选 fixture 引起 | 1 | 测试统一注入项目与 staged ref bridge，保留生产严格上下文要求 |
| 2026-08-25 | Composer fixture 升级后仍有 13 失败及 6 个 missing bridge 异步错误 | 1 | 每项默认安装 bridge，并更新旧 blob/path/custom candidate 断言 |
| 2026-08-25 | 阶段 3 最终专项 242/243，legacy 空正文路径附件发送了空字符串 | 1 | 修正 live content override 仅服务 prompt command，不覆盖普通路径可读正文 |
| 2026-08-25 | 阶段 4 typecheck：能力规划传入了可选 conversation.providerId | 1 | 增加 active provider fallback 与无 provider 错误 |
| 2026-08-25 | 阶段 5 首次 typecheck 使用了不存在的 `fs.read` 权限动作 | 1 | 复用现有 `content.read`，不扩展硬编码权限枚举 |
| 2026-08-25 | 阶段 5 首轮 168 tests 有 Buffer 类型断言与 plain turn MCP factory 两项失败 | 1 | 改为字节数组比较，并仅在 attachment transport key 存在时解析 MCP |
| 2026-08-25 | nativeImage 衍生器补丁首次命中相邻 Provider factory | 1 | 立即移除并精确注入 AttachmentStagingService |
| 2026-08-25 | 阶段 9 全量测试首次有 4 项旧 raw bytes/path IPC schema 用例失败 | 1 | 迁移为 attachmentId/order 正向契约和 raw payload 负向契约；全量 7971 项复跑通过 |
| 2026-08-25 | 阶段 9 最终 typecheck 有 3 个测试 union/unknown 窄化错误 | 1 | 在测试边界增加最小类型断言和统一字节数组 helper，生产接口保持不变 |
| 2026-08-25 | IPC 测试窄化补丁首次命中同文件较早断言 | 1 | 立即移除误改并以目标 `const parsed` 块精确重打补丁 |
| 2026-08-25 | 最终规划补丁遇到并发任务已切换当前阶段 | 1 | 不覆盖 Drive MDXEditor 插入修复状态，只更新附件阶段 9 自身清单 |

## 五问重启检查

| 问题 | 答案 |
|------|------|
| 我在哪里？ | 附件阶段 0–8 完成；阶段 9 自动化完成，真实 Provider 人工验收待授权；另有并发插入修复任务进行中 |
| 我要去哪里？ | 在不覆盖并发任务的前提下，等待是否授权启动当前工作树应用并产生两次真实 Provider 调用 |
| 目标是什么？ | 稳定支持单轮最多 50 张图片及安全的文件/文件夹处理 |
| 我学到了什么？ | 大批量图片必须通过受控引用、预算化总览和 turn-scoped 按需读取组合实现；见 findings.md |
| 我做了什么？ | 完成契约、暂存、IPC、Provider 策略、内部 MCP、安全、UI、恢复、文档和全部自动化门禁 |

---

每个阶段完成后或遇到错误时更新本文件。
### 2026-08-25 阶段 10 实施记录

- 一次测试补丁因同一文件在单个 patch 中出现两条 Update 操作而被工具拒绝；未产生文件修改，已拆分为单文件单 Update 重试。
- 安全规则批量替换因现有条目措辞与预期上下文不完全一致而失败；未产生文件修改，改为读取精确行后逐段替换。
- 设计文档改名的首次 `apply_patch` 因 Move 操作没有内容 hunk 被拒绝；未产生文件修改，已用带标题上下文的 Move 重试。
- 已删除 Provider/model 能力画像、Anthropic 特化预算、overview-and-tools 与附件 MCP，新增 Provider 无关的 inline/inline-batches v2 计划。
- 已实现使用当前所选 Provider/模型的隔离图片批次查询，逐批加载原图、收集结果并向主会话注入完整批次摘要；模型不支持图片时透传其原生错误。
- 已移除附件 turn 导致的主会话重建；批次加载通过 project/conversation/turn/attachmentId 所有权校验。
- 定向 4 个测试文件共 109 项通过；desktop typecheck 通过。
- 已补充 Provider 环境复用、批次隔离配置、原生错误、取消和失败后重试回归；扩展定向 175 项通过。
- 完整 Agent 范围 84 个测试文件、1152 项通过；`check:hard-constraints` 通过。测试输出仅包含既有 Electron app mock 与 React act 警告，退出码为 0。
- 活跃设计、安全规则、发布说明和任务总纲已改为百炼 Kimi/Qwen 优先的通用 Provider 架构；旧 Claude 专属可执行计划已替换。
- 最终 desktop typecheck、`check:hard-constraints` 与 `git diff --check` 均通过；设计文档与实施计划已改用通用 Provider 文件名。
- 图片标签映射收尾后，ClaudeSDKSession/dispatch 73 项复跑通过，electron/test TypeScript 配置单独复核通过；活动代码与文档中旧能力画像、overview/MCP、legacy flag 引用为 0。

### 2026-08-25 阶段 11 实测记录

- **状态：** in_progress
- 用户授权在当前 Synapse / Claude Agent SDK 链路中分别实测百炼 Kimi、Qwen 的 Read 图片工具结果兼容性。
- 已恢复 planning-with-files 现场并冻结验收标准；下一步准备合成夹具并操作本机 Synapse 完成两次真实调用。
- 已生成并目视确认无敏感信息的 PNG 夹具，路径为 `/tmp/synapse-read-tool-test.png`，等待分别交给 Kimi 与 Qwen 的 Read 工具链。
- 首次以窗口标题 `Synapse AI Studio` 请求应用状态返回 `Invalid app`；未进行任何界面写操作，改用实际应用注册名继续。
- `Synapse` 注册名读取发生一次 Computer Use 超时；进程核对确认当前工作树开发版 Electron 已由用户环境启动，下一步以 `Electron` 应用名连接现有窗口。
- 已通过 `Electron` 应用名连接当前工作树窗口并取得可访问性树与截图，尚未发送测试消息或改变现有会话。
- 尝试 bundle id 时发现多个 Electron.app 冲突；已锁定当前仓库 Electron.app 的完整路径，避免误操作其它开发应用。
- 已在 `Synapse` 项目创建独立 Kimi 测试草稿，输入框聚焦；夹具放在 Agent 当前项目工作目录内以隔离权限变量。
- 首次向旧可访问性索引写入提示时，Computer Use 检测到界面刚完成新会话切换并拒绝动作；未发送消息。刷新后取得新输入框索引 78。
- 已向百炼 `kimi-k2.6` 发送路径-only 请求；12 秒时出现真实 `Read` 工具调用并成功返回图片预览，正在等待模型最终视觉答案。
- 百炼 `kimi-k2.6` 实测通过：Read 调用与图片结果可见，最终三项视觉答案全部正确；下一步切换独立 Qwen 会话复测。
- 已创建独立 Qwen 测试草稿“新对话 16:05”，尚未发送；正在操作顶部模型选择器。
- 顶部模型标签不可点击；源码核对确定正确入口是 `Synapse` 项目更多菜单中的自定义新建对话。未发送错误模型请求。
- 自定义模型选择器确认本机百炼槽位没有 Qwen；正在从仓库现有百炼模型资料中确定可用的视觉 Qwen ID，再做可恢复的临时配置。
- 已确定真实测试型号为百炼 `qwen3.5-plus`；下一步临时把一个未用于当前会话的百炼槽位改为该模型，测试完成后恢复原值。
- 关闭自定义对话框时 Provider 列表异步刷新使旧索引失效；动作未执行，但刷新后对话框已关闭，未创建额外会话或改变模型。
- 已进入“模型与供应商”设置并定位百炼编辑入口；准备把 #2 从 `deepseek-v4-pro` 临时改为 `qwen3.5-plus`，完成测试后恢复。
- 临时 Qwen 映射已保存成功；下一步从自定义对话选择百炼 #2 并发送同一条 Read 测试。
- 返回“对话”时第一次点击因保存提示异步刷新被拒绝；刷新后再次点击已聚焦按钮但界面尚未跳转，继续等待并复核状态，不重复改配置。
- 路由随后正常返回对话页；已再次进入自定义新建对话并确认 Qwen #2 可选。
- 已选择百炼 #2 并成功创建 `qwen3.5-plus` 独立会话，准备发送与 Kimi 完全相同的路径-only Read 请求。
- 百炼 `qwen3.5-plus` 已真实调用 Read 并收到图片预览；颜色和形状正确，测试码多识别一个 `0`（`READ-0824`）。传输契约通过，视觉精度本轮未完全通过。
- 已导出 Qwen 调试包作为可复核证据；开始恢复百炼 #2 原模型映射。
- 已返回百炼供应商设置，当前 #2 仍显示临时 `qwen3.5-plus`，准备恢复为记录的原值 `deepseek-v4-pro`。
- 已恢复并核对百炼 #2 原值；调试包结构与 SDK 流证据复核通过，Qwen 该轮汇总成本为 $0.621978。
- **状态：** complete
- Kimi/Qwen 的 Read 图片工具结果传输契约均通过；Kimi 视觉答案全对，Qwen 发生一次 `READ-824` → `READ-0824` OCR 误差。
- 已删除仓库根目录测试 PNG；Qwen 调试包保留图片与完整事件证据。`git diff --check` 通过，工作树未新增测试图片或产品代码改动。
- 测试完成后的 Synapse 开发进程已不在运行；误启动的 Electron 默认进程已精确清理，没有重启开发服务。

### 2026-08-25 阶段 12 图片附件路径化重构

- **状态：** complete
- 用户已锁定 9 阶段重构方案：所有图片统一发送受控原图路径，由当前模型在唯一主会话中自行调用 Read。
- 已确认删除范围是 DispatchPlan、Base64 SDK 图片块、隔离批次 query 与摘要回灌；附件 UI、受控暂存、引用化 IPC、缩略图、历史和清理继续保留。
- 已锁定不做模型白名单、能力探测、读完检查、自动补读或强制循环；显式 Persona 工具策略仍保持权威。
- 工作树包含附件任务和 Drive MDXeditor 等既有未提交改动；本阶段只做可追溯的外科手术式修改。
- 首次 desktop typecheck 已通过生产 target，测试 target 仅剩 `agent-attachment.test.ts` 引用已删除 DispatchPlan 版本常量；按新契约迁移该测试，不恢复旧类型。
- 已删除 DispatchPlan、图片字节运行时、Base64 SDK 图片组包、批次 loader、隔离 query、摘要回灌和批次取消分支；生产代码搜索无旧符号残留。
- Renderer 发送只保留用户实际正文与有序 attachmentId；图片、文件和文件夹的结构化展示及 50 图 UI 保持不变。
- 主进程只解析受控原图路径和精确草稿根目录；新建与复用会话均在发送前完成 additionalDirectories 授权，不授权图片或单文件的原始父目录。
- SDK 主 query 每轮只收到一个运行时附件清单；模型自行决定 Read 次数，Synapse 不补读、不判断模型能力。
- 受控路径已从 history diagnostics、tool use、权限事件和流式 input JSON 展示中投影；实际 SDK 工具输入保持原路径。
- 附件专项 337 项通过；新增 Kimi、Qwen、自定义 Provider 完全相同附件消息和目录设置的回归。
- Desktop 全量 857 个测试文件、7969 项通过；完整 typecheck、`check:hard-constraints`、production build 和 `git diff --check` 通过。
- `check:packaged-asar` 已运行，但当前 `release/` 没有现成 `app.asar`；未生成正式安装包，使用完整 production build 完成最小构建边界验证。
- 复用阶段 11 的真实百炼证据：`kimi-k2.6` 与 `qwen3.5-plus` 都完成 Read → 图片工具结果 → 最终回答闭环；Qwen 的一次 OCR 偏差不影响传输结论。

### 2026-08-25 阶段 13 多图消息缩略图密度

- **状态：** complete
- 消息内多图预览从最多 8 格调整为最多 9 格，超过 9 张时由第 9 格显示剩余数量。
- 多图网格使用现有 `max-w-sm` 尺寸类收窄，单图展示保持原样；发送上限、历史附件和灯箱完整图片集合未改变。
- 50 图回归确认渲染 9 个缩略图、显示 `+41`，点击第 9 格后灯箱定位为 `9 / 50`。
- Agent 消息与时间线 2 个测试文件、84 项通过；Desktop typecheck 与 `git diff --check` 通过。
- 按仓库规则未启动应用、开发服务器或浏览器。

### 2026-08-25 阶段 14 Agent 顶栏实时上下文占用

- **状态：** complete
- 已读取 Agent Runtime、Renderer、IPC、UI 与测试规则，并核对 Claude Agent SDK 的 usage、iterations、modelUsage 和 compact boundary 契约。
- 阶段 11 气泡内边距已由当前任务独立完成；本阶段只追加实时上下文占用相关修改，不覆盖附件与 Drive 既有改动。
- 已完成主线程上下文聚合：iterations 最后一项优先、缓存分项回退求和、message delta 输出更新、compact post_tokens 降低占用、子智能体隔离与模型窗口可靠匹配。
- 已完成 assistant/stream/compactBoundary 实时事件、result metadata 持久化、IPC 校验、历史恢复和切换会话即时清空。
- 已新增共享顶栏指示器，完整宽度与窄 container query 展示、精确 Tooltip、未知窗口降级和 0–100% 进度限制均通过测试；累计用量卡未改动。
- Agent 相关 10 个测试文件、271 项通过；Desktop 全量 859 个测试文件、7,994 项通过。
- Desktop typecheck、production build、`check:hard-constraints`、UI 静态纪律检查和 `git diff --check` 全部通过。

### 2026-08-25 阶段 15 用户消息气泡内边距

- **状态：** complete
- 用户消息气泡外层由水平 20px、垂直 12px 调整为四边统一 16px；图片与正文之间的内容间距保持不变。
- 同步更新 2025、2026 两份 Agent 时间线气泡设计规范，避免旧 `px-5 py-3` 基线回流。
- 新增等距内边距回归；气泡、消息行与时间线 3 个测试文件、86 项通过。
- Desktop typecheck 与 `git diff --check` 通过；按仓库规则未启动应用、开发服务器或浏览器。

### 2026-08-25 百炼模型上下文压缩方案评估

- **状态：** complete
- 核对本地 Agent SDK 0.2.138 类型、内置 Claude Code 2.1.138 runtime 字符串契约、Synapse session/resume 与 compact boundary 接入。
- 核对 Anthropic、阿里云百炼和 OpenAI 官方文档，区分 Claude 服务端 compaction、Claude Code 客户端压缩与 Codex/Responses opaque compaction。
- 结论：百炼模型可以复用 SDK/runtime 客户端自动压缩；当前架构已具备 session、边界事件和历史分层基础，但应显式锁定开启策略、避免模型名白名单，并补真实百炼长上下文验收。
- 本轮只做可行性研究并记录结论，未修改产品代码、未启动应用、未调用付费模型。

### 2026-08-25 SDK/runtime 客户端自动压缩实施分析

- **状态：** complete
- 逐点核对自动压缩设置透传、live session 复用、SDK transcript resume、compact boundary、上下文占用持久化、原生 slash 路由与 SessionStore 耐久边界。
- 形成两阶段建议：第一阶段显式启用 runtime auto compact、沿用 SDK 自动窗口并完成百炼真实闭环；第二阶段按产品需要增加窗口配置、手动压缩与完整 transcript 镜像。
- 确认第一阶段不需要自定义摘要器、新 IPC、模型名白名单或 Anthropic 服务端 `context_management`。
- 本轮只更新研究记录，未修改产品代码、未启动应用、未进行付费模型调用。

### 2026-08-25 `/compress` 报错诊断

- **状态：** complete
- 确认错误来自 Synapse 未实现的 `/compress` 宿主占位路径，请求未进入 Claude Code runtime，也未调用百炼。
- 确认 SDK 原生命令为 `/compact`，但普通项目尚未加入 native slash 放行链路。
- 确认截图中的重复错误来自同一错误事件双发，不是 Provider 重试。
- 本轮只做只读诊断并更新研究记录，未修改产品代码。

### 2026-08-25 GitHub Tool Search Issue 复核

- **状态：** complete
- 检索 Anthropic Claude Code、MoonshotAI Kimi、Qwen Code、SGLang、vLLM 与 CC Switch 的公开 Issue。
- Anthropic 协作者明确说明：第三方 Base URL 默认关闭 Tool Search，强制开启代表调用方保证端点完整支持 `tool_reference`；不支持时应关闭，不能从普通工具调用能力推断兼容。
- Kimi 与 Qwen 相关 Issue 均存在真实 400/500 或会话污染复现，与百炼 `qwen3.7-plus` 无 ToolSearch 事件、仍全量加载 Schema 的实测方向一致。
- 本轮只补充研究记录，未修改产品代码、Provider 配置或运行中的应用。

### 2026-08-25 OpenCode MCP 工具压缩方案复核

- **状态：** complete
- 读取 `anomalyco/opencode` 当前 `dev` 分支的 MCP tool assembly、ToolRegistry、Code Mode runtime、目录搜索、实验开关、测试及相关 Issue/PR。
- 确认默认旧路径仍全量发送 MCP Schema；Code Mode 开启后改为一个普通 `execute` 工具、约 2K token 的预算目录和受限运行时内 `$codemode.search`，不使用 Anthropic `tool_reference`。
- 确认 v1 通过 `OPENCODE_EXPERIMENTAL_CODE_MODE=true` 开启；项目协作者称 v2 已将其作为默认体验，但文档仍在完善。
- 结论：OpenCode 选择 Provider 无关的客户端级工具虚拟化，Qwen/Kimi 只需普通工具调用能力；可作为 Synapse 通用降 Schema token 的重要参考。
- 本轮只补充研究记录，未修改产品代码、Provider 配置或运行中的应用。

### 2026-08-25 Claude Agent SDK Tool Search / Invoke 方案评估

- **状态：** complete
- 重新读取 Anthropic Agent SDK 官方 custom tools、tool search、permissions 文档，阿里云 Anthropic-compatible Messages 工具调用文档，以及当前安装 SDK 0.2.138 类型与随包 Claude Code 2.1.138 参数行为。
- 审计 Synapse `ClaudeSDKSession`、`SessionManager`、MCP installer、公开 HTTP MCP、capability registry、action router、权限回调、Persona/子代理 policy 与 Knowledge Base 长期规则。
- 用当前依赖完成无模型调用的进程内 MCP 最小原型，确认 `tool_search`、带通用对象参数的 `tool_invoke` 可注册、列出和调用。
- 实测当前 MCP 目录仍为 223 工具、203,397 字符；两个包装定义约 913 字符，全部 name+description 降级目录为 59,722 字符。
- 结论：会话级 router + `disallowedTools: ['mcp__synapse-mcp__*']` 技术可行且潜在收益显著；单纯新增包装工具无收益，改公开 `/mcp` 或启用 `strictMcpConfig` 均不可取。
- 识别出四项必须先解决的产品风险：Persona/子代理 allowlist 映射、权限与事件展示保真、中文到英文目录的检索质量、Knowledge Base 禁止 MCP 隔离/程序化注入的规则冲突。
- 本轮只做只读文档/代码审计和临时内存原型；未修改产品代码、Provider 配置、运行中应用，也未发起额外付费模型请求。

### 2026-08-25 `/compact` 手动压缩修复

- **状态：** complete
- 将 Agent 内置入口从未实现的 `/compress` 替换为 SDK 官方 `/compact`，并直接路由到现有 native slash 发送链。
- 删除宿主占位压缩回调与错误常量；旧 `/compress` 现在只返回一次“不支持的命令”，不再出现截图中的重复错误。
- 回归覆盖原样发送、当前 SDK session 复用语义、`compact_boundary` 上下文下降、历史保留、SDK 错误和旧命令拒绝。
- Agent runtime/SDK/context 专项 8 个测试文件、286 项通过；Desktop typecheck、`check:hard-constraints` 和 `git diff --check` 通过。
- 未接入自动压缩设置，未修改 `agent.compress_state`，未启动应用或进行真实百炼付费调用。
- 已补删 Renderer 静态定义中的 `/compress`；菜单现在只保留 `/compact`。相关 4 个测试文件、42 项通过，Desktop typecheck、hard constraints 与 `git diff --check` 通过。

### 2026-08-25 `/compact` 真实结果与顶栏 416 诊断

- **状态：** complete
- 读取用户导出的完整调试包、SDK transcript 与当前上下文计数器实现。
- 确认压缩成功，90,848-token 压缩前活动上下文生成了 416-token 续写摘要；压缩调用自身使用 4,785 输入、851 输出，成本 $0.0452。
- 确认顶栏 416 不正确：它只来自 `compact_metadata.post_tokens`，漏掉压缩后重新注入的系统提示、工具、MCP Schema、Skills 和规则。
- 本轮只做只读诊断并更新研究记录，未修改产品代码、未启动应用、未进行额外模型调用。

### 2026-08-25 `/compact` 后顶栏上下文修复

- **状态：** complete
- 修复目标：压缩边界不再把续写摘要 `post_tokens` 当成完整上下文，改由同一 SDK Query 的 `getContextUsage()` 返回完整统计。
- 失败降级：上下文统计查询失败不影响压缩命令，只清空顶栏未知状态，不显示摘要 token。
- 首轮红灯验证：context usage 与 ClaudeSDKSession 两个专项共 75 项，73 项通过；失败准确复现 `post_tokens=416/60` 被直接发布的问题。
- 修复后 5 个专项测试文件、190 项通过；首次 Desktop typecheck 发现新增 helper 缺少 `AgentContextUsage` 类型导入，硬约束已通过，已补导入后待复跑。
- 压缩边界现在通过当前 SDK Query 的 `getContextUsage()` 发布完整 `totalTokens/maxTokens/model`；`post_tokens` 只保留在原始压缩事件中，不参与顶栏统计。
- SDK control request 缺失、失败或返回无效数字时，压缩命令继续完成，Renderer 清空旧快照并等待下一份可靠 usage。
- 最终 5 个专项测试文件、190 项通过；Desktop typecheck、`check:hard-constraints` 和 `git diff --check` 通过。测试中的 Electron app path 兼容日志为既有 mock 环境提示，退出码为 0。
### 2026-08-25 阶段 15 今日全量回归

- **状态：** in_progress
- 已读取 planning-with-files、Computer Use 与 Impeccable harden/product 规则，以及仓库 execution/testing/UI 规范。
- 已确认本地服务由用户启动，本轮不会启动或重启开发服务。
- 已盘点今日 5 个提交与当前工作树：125 个文件、6509 行新增、4331 行删除，拆为六个测试主题。
- 已制定 370+ 自动化用例预算，并计划对 Agent、Git、Drive 可到达页面执行真实桌面操作。
- Computer Use 首次用 `Synapse` 连接超时，随后发现开发版实际运行于仓库 Electron.app；`com.github.Electron` 因本机多个 Electron 冲突不可直接使用，已改用当前仓库 Electron.app 绝对路径并成功读取窗口。
- 当前开发窗口位于 Agent 对话页，热更新生效；后续 UI 测试将新建隔离草稿，避免发送付费请求或改动已有会话。
- 首轮受影响自动化全部通过：Desktop Agent/Git 103 个测试文件、1413 项；Server Drive 3 个文件、45 项；Dashboard Markdown/MDX/Mermaid 5 个文件、129 项。合计 111 个文件、1587 项，已超过 200 项最低目标。
- Desktop 输出中的 Electron app path 兼容日志、SQLite experimental warning 与既有 React act 提示均未导致失败；三组退出码均为 0。
- 真实打开“验证百炼 MCP Tool Search”历史会话，顶栏从持久化结果恢复为 `91.6K / 200K · 46%`，进度条 ARIA 为“上下文占用 46%”；标题、模型、占用和三个操作按钮在当前窗口宽度下无重叠或截断。
- 将窗口收窄后，顶栏按设计切换为 `上下文 46%`，进度条和复制/导出/新窗口按钮仍完整可操作，未出现溢出或碰撞。
- 真实输入 `/` 打开完整斜杠菜单；“其它命令”包含 `/compact`，未出现已废弃 `/compress`。清空输入后菜单关闭，未触发发送。
- 真实附件菜单正确显示“附加文件/附加文件夹”。通过 macOS 文件选择器选择仓库 PNG 后，Composer 显示 `1 张图片 · 7 KB`、文件名、类型/大小和删除按钮；发送按钮因已有附件按预期启用。
- 点击缩略图打开灯箱，标题、图片、关闭、缩放、适合窗口和 1:1 控件完整可见，窄窗口下未裁剪。
- 删除图片附件后，附件条消失且发送按钮重新禁用；未发送消息。
- 文件夹选择器选择 `desktop/src/assets` 后，Composer 显示 `1 个附件 · 0 B`、目录名和“文件夹”，发送按钮启用；移除后恢复空状态。
- 首次在 macOS “前往文件夹”面板使用 paste 时检测到用户正在操作同一应用，Computer Use 阻止粘贴；未覆盖用户内容。改用刷新 AX 状态后 `set_value`，文件和文件夹选择均完成。
- 通过 Agent Composer 的 Git 菜单进入真实 Synapse Git 工作台；89 个工作区改动正常加载，首个文件显示新旧行号和行内差异。
- 将差异从统一切换到分栏并开启自动换行，视觉与 AX 状态均更新；窄窗口下工具栏、文件列表和双栏 diff 未重叠。
- 切换到历史标签并打开今日 `feat(git)` 提交，12 个变更文件逐项可选；分栏/换行偏好从工作区 diff 保持到历史 diff，切换到新增 `git-diff-viewer.tsx` 后内容同步更新。
- Chrome 新标签访问本地 `127.0.0.1:3000/drive` 后被重定向到本地登录页；当前浏览器只持有生产环境会话，未向本地环境输入或复制凭据。Drive Markdown 的真实登录后编辑路径因此不可安全到达，改由 129 项 Dashboard 组件测试与 45 项 Server projection/lifecycle 测试作为同层证据。
- 边界审计发现上下文已用量超过窗口上限时 tooltip 会显示负数剩余 token。首次红灯被缺失的 jsdom `ResizeObserver` 阻断，补齐既有测试环境 mock 后，回归准确得到 `剩余 -10,000 token`。
- 已将剩余量下限收敛为 0，并补用户可见 tooltip 回归；专项 5/5 通过，发布说明已同步。
- 真实打开同一会话的独立 Agent 窗口，确认顶栏同样恢复 `91.6K / 200K · 46%`，标题、模型、进度条、复制/导出与输入区无重叠；随后关闭测试窗口并清空未发送草稿，主窗口恢复正常。
- 双轴审查定位 4 个 Spec 偏差并全部补红灯：受控草稿根路径投影、失败/取消附件回滚、失败 Skill 发送返回值、子智能体 result 上下文隔离。首轮 4 个测试文件准确得到 4 个失败；修复后连同 ConversationRouter 共 5 个文件、204 项通过。
- Standards 审查发现 Git diff 第三方 CSS 带硬编码色板、附件 IPC/Renderer bridge 边界和清理错误吞没。Git diff 已改为仅使用主题 token 的本地语义渲染并移除依赖；附件 bridge 已提取到 hook，剪贴板物化已提取为主进程服务，IPC 新增空剪贴板/无效请求/服务失败/释放失败覆盖，清理失败改为结构化告警。
- Git 工作台专项 34/34、Composer 68/68、Agent IPC 58/58、附件/清理组合回归 184/184 通过；首次 Desktop typecheck 暴露 3 个测试 mock 类型问题，已修正后待最终复跑。
- 修复后的最终受影响回归全部通过：Desktop 103 个文件、1420 项；Server Drive 3 个文件、45 项；Dashboard 3 个文件、119 项。Desktop typecheck、Server typecheck、Dashboard typecheck、Desktop hard constraints、IPC codegen、Desktop renderer build 与 Dashboard build 均通过。
- 首次并发执行完整 Desktop 回归时，Claude input stream 的单例在系统同时构建负载下用时 5.9 秒，超过默认 5 秒；单文件重跑 69/69，随后串行重跑完整 Desktop 103 个文件、1420 项全部通过，确认是资源竞争型超时而非产品失败。
- 热更新后再次通过 Computer Use 打开真实 Git 工作台：统一视图、分栏视图、自动换行、旧/新行号、增删内容和行内差异均正常；新本地渲染器使用应用主题 token，布局切换后已恢复统一视图与关闭换行。
- 最终静态检查未发现 `@git-diff-view/react` 残留引用或 Git diff 文件中的字面颜色；`git diff --check` 通过。本轮未启动/重启服务、未发送 Agent 消息、未修改 Provider 凭据或用户历史数据。

### 2026-08-25 阶段 16 Synapse MCP 工具按需加载

- **状态：** complete
- 已复核 SDK 0.2.138、Agent Runtime、公共 MCP action router、设置与 Conversation v1 存储边界；确认采用 discovery 后 strict MCP 重建，无法证明配置或权限等价时回退完整 MCP。
- 已实现全局实验配置、设置页“实验功能”分类与开关，以及 Conversation v1 可选快照字段；只有新建主会话、侧会话和显式创建会话读取开关，已有会话继续沿用创建时快照。
- 配置、设置、Conversation schema、SessionRepository 与 ConversationRouter 专项回归共 154 项通过；测试日志中的 Electron app path 告警为既有 jsdom/Node 环境兼容日志，不影响断言。
- 修复实验功能设置项在宽窗口下仍纵向堆叠的问题：为通用 SettingsGroup 恢复 Field 响应式布局依赖的命名容器，并新增组件级回归测试。
- 设置布局专项 3 个文件、9 项通过；Desktop typecheck、Renderer production build 与 `git diff --check` 通过，构建 CSS 已确认包含 `field-group` 命名容器及 28rem 响应式规则。
- 用户复核发现实验开关、基础设置重置项和账户服务器状态的右栏仍错位；进一步定位为通用 SettingsFieldRow 把说明放入控件列，且三个调用点的右对齐规则不一致。
- 已按 make-interfaces-feel-better 的信息层级与光学对齐原则，将说明归回左侧标题列，右侧只保留控件/状态，并统一实验开关、重置按钮和连接状态的右缘对齐；未新增颜色、样式文件或界面层级。
- 新增通用设置行、实验开关、重置应用和服务器连接布局回归；设置专项 6 个文件、16 项通过，Desktop typecheck、Renderer production build 与 `git diff --check` 通过。
- 尝试使用 Computer Use 复核当前已运行的 Synapse 窗口，但截图接口只返回空白 Electron 壳层、AX 树也没有 Renderer 内容；未重启应用，也未把该结果误记为视觉通过。

### 2026-08-25 阶段 18–22 主流模型能力目录与真实上下文窗口

- **状态：** complete
- 新增单一构建期模型能力目录，共 116 条记录：百炼中国区文本生成 93 条、九类官方直连 23 条；所有记录按 Provider scope 隔离并带官方来源、核验日期、窗口、限制、模态、能力、别名和状态。
- `qwen3.7-plus` 与快照分别记录 1,000,000 总窗口、991,808 最大输入、131,072 最大输出、983,616 推理最大输入和 262,144 最大思维链，并同步图片/文本/视频输入模态。
- 新增离线 `--check`、公开文档更新和 Browser Skill 原始响应导入；支持稳定排序、分组展开、别名冲突、正整数/窗口关系、来源完整性、少于 40 条和一次下降超过 30% 的拒绝门禁，校验成功后原子替换。
- Provider 只按规范化 Base URL + 精确模型 ID/官方别名匹配；不做模糊、家族或版本截断猜测。用户显式 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 优先，未知模型和未登记聚合平台不注入。
- Claude Agent SDK 升级到 0.3.245，官方 SDK peer 升级到 0.93.0；目录派生配置参与 live session 复用键，变化时重建新会话。
- 上下文事件、IPC、历史 metadata 与 Tooltip 已扩展；顶栏百分比和分母始终只使用 SDK 实际窗口，SDK 200K/官方 1M 时会并列展示，SDK 未返回窗口时不计算百分比。
- 目录/Runtime/IPC/历史/UI 7 个专项文件 209 项通过；Desktop 全量首次 8,060/8,063，定位到旧备份测试遗漏新增默认开关字段，修复后三处兼容断言并串行复跑 865 个文件、8,063 项全部通过。
- Desktop typecheck、hard constraints、IPC codegen、renderer/electron production build、目录离线检查与 `git diff --check` 全部通过；Electron 构建产物包含目录 JSON。
- 生成并签名本地 macOS arm64 正式包；`check:packaged-asar`、packaged script runtime、深度 codesign 均通过，实物为 26,913 个 packed、1,591 个 unpacked 文件。包内目录仍为 116 条，当前平台 Claude 二进制可执行；本地环境缺少 notarize 选项，因此构建明确跳过公证，未发布任何产物。
- Computer Use 复用用户已运行的 Synapse 开发版，新建最小百炼 `qwen3.7-plus` 会话并发送“只回复 OK”；返回 OK 后顶栏实际显示 `93.3K / 1M · 9%`，真实配置链路通过。未重启应用、未修改 Provider 凭据；保留该最小测试会话，未擅自永久删除。

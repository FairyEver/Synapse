# Agent 图片附件路径化重构

## 目标

所有 Provider 使用同一条“受控原图路径 + Read”链路。删除图片 Base64、派发计划、隐藏批次 query 和摘要回灌；不维护模型白名单或能力判断。

## 当前状态

- 当前阶段：22 / 22
- 状态：complete
- 最后更新：2026-08-25

## 成功标准

- Renderer 只发送用户原文和有序 `attachmentId`。
- 主进程只解析路径和目录，不读取图片字节。
- 一次用户发送只投递一次既有主 query。
- 1、4、20、50 张图片使用相同有序路径清单。
- Kimi、Qwen、自定义 Provider 没有分支、画像或白名单。
- 历史、时间线、日志、导出、Renderer IPC 不出现受控路径、Base64 或原图字节。
- 既有 50 图 UI、灯箱、暂存、清理和旧历史兼容能力保持通过。

## 十一阶段执行

- [x] 1. 重写附件设计文档和规划文件，废止 inline、batch 和 Provider 能力判断。
- [x] 2. 保留附件选择、粘贴、拖拽、50 图、缩略图、灯箱、暂存、清理和历史恢复。
- [x] 3. Renderer `content` 只保存用户实际输入，IPC 继续只传有序引用。
- [x] 4. 新增主进程路径型运行时附件，校验所有权并返回原图路径及受控根目录。
- [x] 5. 精确授权草稿受控根目录；明确文件夹授权原路径，文件和图片不授权原父目录。
- [x] 6. 主 query 接收运行时专用路径清单和不可信附件说明，历史不保存清单。
- [x] 7. 删除 DispatchPlan、Base64、批次阈值、BatchLoader、隔离 query、摘要和批次状态。
- [x] 8. 历史只保存正文和附件元数据；对受控 Read 路径做时间线与事件投影。
- [x] 9. 更新并运行全部回归、类型、硬约束和打包边界门禁。
- [x] 10. 将消息内多图预览收敛为紧凑九宫格，最多渲染 9 个缩略图，灯箱继续包含全部图片。
- [x] 11. 统一用户消息气泡四边内边距，并同步气泡视觉规范与回归测试。
- [x] 12. 在 Agent 顶栏增加主线程实时上下文占用，覆盖 SDK 聚合、历史恢复、双窗口展示、文档与完整验证。
- [x] 13. 真实验证百炼是否支持 Claude Code MCP Tool Search，并比较开启前后的工具调用与上下文用量。
- [x] 14. 修复 `/compact` 后顶栏把摘要 token 当成完整上下文的问题，改用 SDK 权威上下文统计。
- [x] 15. 审计并真实回归 2026-08-25 全部代码变化，运行不少于 200 项自动化用例和本地桌面关键路径，发现问题即补回归并修复。
- [x] 16. 实现默认关闭的 Synapse MCP 工具按需加载实验功能，覆盖设置、新对话快照、第三方 Provider 路由、权限与事件投影、降级、文档和完整验证。
- [x] 17. 根据真实百炼日志优化 Synapse MCP 工具搜索排序，覆盖中英文自然语言、通用与具体工具消歧及完整验证。
- [x] 18. 获取并固化百炼全部文本生成模型与主流官方直连模型能力目录，建立确定性校验和更新入口。
- [x] 19. 实现 Provider Base URL + 模型精确匹配、用户环境变量优先和 Agent SDK 窗口配置。
- [x] 20. 扩展上下文事件与顶栏 Tooltip，严格区分 SDK 实际窗口和目录官方上限。
- [x] 21. 同步 AGENTS 路由、维护说明、上下文设计边界和发布说明。
- [x] 22. 完成专项、全量、类型、硬约束、构建与打包边界验证，并在可用开发版上做百炼冒烟。

## 阶段 18–22 验收标准

- [x] 单一 JSON 目录覆盖百炼 TG 与 Anthropic、Gemini、DeepSeek、Kimi、GLM、MiniMax、StepFun、MiMo 官方直连代表模型，并保留可追溯官方来源。
- [x] 更新脚本支持 `--check`、百炼分组响应展开、稳定排序、别名冲突与数量骤降门禁，不保存凭据或账户数据。
- [x] 只有 Base URL 与模型精确命中时注入上下文窗口；显式 `CLAUDE_CODE_MAX_CONTEXT_TOKENS` 优先，目录变化使 live session 重建。
- [x] 顶栏分母只使用 SDK 实际 `contextWindowTokens`；目录上限只作为配置与 Tooltip 参考，差异同时展示。
- [x] `qwen3.7-plus` 固定为 1,000,000 总窗口与 991,808 最大输入，避免把两个概念混淆。
- [x] Agent 专项、Desktop 全量、typecheck、hard constraints、production build、packaged-asar 可用边界与 `git diff --check` 完成并如实记录。

## 阶段 17 验收标准

- [x] `list files drive` 将 `app_drive_item_list` 从第 3 提升到第 1。
- [x] “查看云盘文件列表”同样优先返回 `app_drive_item_list`，不依赖模型或 Provider 特判。
- [x] 精确名称、中文 domain、schema 字段、稳定排序、空结果和 limit 校验保持通过。
- [x] 专项测试、Desktop typecheck、hard constraints 与 `git diff --check` 通过。

## 阶段 16 验收标准

- [x] 系统设置新增“实验功能”分类，开关默认关闭且只固化到新建对话。
- [x] 第三方 Anthropic-compatible Provider 的实验对话只向模型暴露 `search`、`invoke` 和其它非 Synapse MCP；Anthropic 官方 Provider 保持现状。
- [x] 搜索覆盖完整 Synapse MCP 注册表，执行复用现有 action router、PermissionGuard、AuditSink 和公共 MCP 结果语义。
- [x] Persona、权限请求、时间线、历史和导出投影为真实 Synapse 工具；无法保持配置或权限语义时整会话回退完整 MCP并只提示一次。
- [x] 设置、会话、路由、权限、事件专项测试、typecheck、hard constraints、IPC codegen、production build 与 diff 检查通过；packaged-asar 已执行，因工作区没有现成 `release/app.asar` 按脚本设计退出，未擅自生成安装包。

## 阶段 15 测试任务

- [x] 建立今日 5 个提交与当前未提交改动的生产代码、测试和风险清单。
- [x] Drive 生命周期：大目录移入回收站、事务边界、失败与审计回归。
- [x] Git 工作台：工作区/历史 diff、统一/分栏、换行、重命名、二进制、空/截断/解析失败、主题和键盘交互。
- [x] Agent 附件：选择/粘贴/拖放、1/4/9/20/50 图、文件/文件夹、配额/格式/权限/生命周期、IPC、历史/导出脱敏、灯箱与失败降级。
- [x] Agent 上下文：SDK 聚合、历史恢复、双窗口、窄宽顶栏、`/compact` 成功和统计失败降级。
- [x] Drive Markdown：MDX/CommonMark 多级列表、评论 projection、Mermaid 横向布局与编辑/预览一致性。
- [x] 运行受影响源码的类型检查、硬约束、IPC codegen 和 diff 检查。
- [x] 通过 Computer Use 操作已运行的 Synapse 开发版，不启动或重启服务。
- [x] 对每个真实缺陷先记录复现，再补自动化回归、聚焦修复并复测。

## 阶段 15 验收标准

- [x] 自动化实际通过数量不少于 200，且覆盖今日六个功能主题。
- [x] 真实桌面交互覆盖 Agent、Git 和可到达的 Drive 页面；不可到达项以同层组件/服务自动化证据替代并明确记录。
- [x] 不产生付费 Agent 调用，不改 Provider 凭据，不破坏用户现有会话或数据。
- [x] 最终所有新增回归、受影响专项、typecheck、hard constraints 与 `git diff --check` 通过。

## 阶段 14 验收标准

- [x] `compact_boundary.post_tokens` 不再直接更新顶栏。
- [x] 压缩完成后通过当前 SDK Query 的 `getContextUsage()` 刷新 `totalTokens/maxTokens/model`。
- [x] SDK 上下文查询失败时不影响 `/compact` 完成，顶栏清空为未知且不保留 416 或旧快照。
- [x] ClaudeSDKSession、context usage、Renderer 事件链专项测试与 Desktop typecheck、硬约束、diff 检查通过。

## 阶段 13 验收标准

- [x] 百炼 Provider 显式设置 `ENABLE_TOOL_SEARCH=true` 后完成真实新会话测试，并确定当前 Qwen 模型被 Claude Code 模型门禁禁用 Tool Search。
- [x] SDK 调试包证明 ToolSearch/tool_reference 事件为 0，目标 MCP 工具调用 1 次且成功，不只依据最终回答推断。
- [x] 记录开启后的上下文与 Usage，并与既有全量加载基线区分。
- [x] 测试后恢复 Provider 原配置，不泄露 API 密钥，不修改产品代码。

## 阶段 13 结论

- 当前百炼 `qwen3.7-plus` + Claude Code 2.1.138 不能实际开启 MCP Tool Search。
- `ENABLE_TOOL_SEARCH=true` 已持久化并进入新会话配置，但运行时因模型不属于 Sonnet 4+/Opus 4+ 而禁用 `tool_reference`；目标 MCP 工具仍从全量 Schema 直接调用。
- 开启前上下文 90.2K，测试会话结束 91.6K；不存在预期的 token 降幅。
- 百炼 Provider 已恢复到不含 `ENABLE_TOOL_SEARCH` 的原始配置。

## 阶段 11 验证进度

- [x] 用户消息气泡由 `px-5 py-3` 改为四边统一的 `p-4`。
- [x] 两份 Agent 气泡设计规范同步为四边 16px。
- [x] 气泡、消息行与时间线回归：3 个测试文件、86 项通过。
- [x] Desktop typecheck。
- [x] `git diff --check`。

## 阶段 12 验收标准

- [x] 只按主线程 SDK 事件计算当前上下文，流式输出和压缩边界可实时增减。
- [x] `result.metadata.contextUsage` 可持久化，切换会话时清空并从最近结果恢复。
- [x] 主界面与独立窗口共用同一顶栏指示器；未知窗口不猜测上限。
- [x] 累计 Usage 卡口径与展示保持不变。
- [x] Agent 专项、Desktop 全量、typecheck、production build、硬约束与 diff 检查通过。

## 阶段 10 验证进度

- [x] 50 张图片只渲染 9 个消息缩略图，第 9 格显示剩余 41 张。
- [x] 第 9 格可打开完整灯箱并定位到 `9 / 50`。
- [x] Agent 消息与时间线回归：2 个测试文件、84 项通过。
- [x] Desktop typecheck。
- [x] `git diff --check`。

## 阶段 9 验证进度

- [x] 核心 runtime 附件回归：202 项。
- [x] Renderer 附件与会话回归：134 项。
- [x] 路径清单覆盖 1、4、20、50 图及混合附件顺序。
- [x] 主会话复用、动态目录授权、单 query 与取消语义。
- [x] 受控路径 tool use 和流式输入投影。
- [x] Desktop 全量测试：857 个测试文件、7969 项通过。
- [x] Desktop typecheck。
- [x] `check:hard-constraints`。
- [x] 最小打包边界检查：生产 build 通过；`release/` 无现成 `app.asar`，检查脚本已明确报告无可检查产物。
- [x] 最终旧符号、路径泄露和 diff 审计。

## 锁定决策

| 决策 | 原因 |
|---|---|
| 原图路径是唯一图片输入 | Read 已能把本地图片结果交给兼容模型，避免二次派发体系 |
| 不判断模型能力 | 模型由用户选择，Provider 的能力和限制不应由 Synapse 白名单定义 |
| 不追踪是否读完 | 读取顺序和次数属于模型行为，不是宿主完成条件 |
| 只保留一个主 query | 工具往返由 SDK 自然产生，无需隐藏会话和摘要回灌 |
| 受控路径仅运行时存在 | 历史和导出只需要用户正文与结构化附件元数据 |
| Persona 策略优先 | 用户显式禁用 Read 时 Synapse 不越权开启 |

## 错误记录

| 时间 | 问题 | 处理 |
|---|---|---|
| 2026-08-25 | 首次 typecheck 仍有契约测试导入已删除的 DispatchPlan 常量 | 改为仅验证保留的 AttachmentRef v2 |
| 2026-08-25 | 首轮核心回归 6 个旧派发/路径断言失败 | 修正测试，并移除附件诊断中的受控路径 |
| 2026-08-25 | Renderer 两个测试仍期望自动生成图片标签和路径正文 | 改为断言只发送用户原文与 attachmentId |
| 2026-08-25 | 首次全量 typecheck 读取到并发时间线改动的中间状态 | 未覆盖该改动；待其配套签名落盘后复跑，全量 typecheck 通过 |
| 2026-08-25 | `check:packaged-asar` 找不到 `release/app.asar` | 未伪造打包产物；改跑完整 Desktop production build，构建通过并记录环境限制 |
| 2026-08-25 | 阶段 14 红灯测试仍收到 compact `post_tokens` | 回归准确复现顶栏误报，继续改用 SDK `getContextUsage()` |
| 2026-08-25 | 阶段 14 首次 typecheck 缺少 `AgentContextUsage` 类型导入 | 补充现有 runtime 类型导入后复跑，不改变行为 |
| 2026-08-25 | 最终行号检索的双引号命令包含反引号，shell 尝试执行 `/compact` | 未修改文件；改用不含反引号的安全检索表达式，不重复该命令 |
| 2026-08-25 | 阶段 10 新回归首次运行仍只渲染 8 个缩略图 | 已确认测试准确复现旧行为，继续修改消息附件组件 |
| 2026-08-25 | 阶段 11 新回归确认气泡仍输出 `px-5 py-3` | 已复现非等距内边距，继续替换为统一 `p-4` |
| 2026-08-25 | 首次通过 Computer Use 写入 Provider JSON 时应用状态被外部刷新 | 未发生写入；重新获取完整 AX 树后使用新元素索引继续 |
| 2026-08-25 | 恢复配置时首次设置页点击也遇到界面状态刷新 | 未发生点击；重新获取完整 AX 树后进入设置 |
| 2026-08-25 | 调试包 `shasum` 受继承的无效 `C.UTF-8` locale 影响而失败 | 其它 JSON 证据与 diff 检查已完成；改用显式 `LC_ALL=C LANG=C` 计算摘要 |

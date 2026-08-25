# 发现与决策

## 需求

- Synapse Agent 对话需要稳定支持用户一次选择、粘贴或拖入最多 50 张图片。
- 同一能力还要正确处理普通文件和文件夹。
- 方案以稳定可用、功能正常和多 Provider 兼容为优先，不以改动最少为目标。
- 用户认为全量 Base64 方案不合理，需要结合 Claude Agent SDK、Codex 行为和当前代码重新设计。
- 当前请求只要求重置规划状态并编写实施计划，不要求立即修改产品代码。

## 当前实现

- 当前 Composer 会把粘贴或拖入的图片 File 转成 ArrayBuffer 并保存在草稿中。
- 系统文件选择器会在主进程读取图片字节，再把 ArrayBuffer 返回 Renderer。
- 发送 IPC 再把完整图片字节传回主进程。
- Agent runtime 的 buildClaudeUserMessageContent 会把本轮每张图片转换成 Claude SDK Base64 image block。
- 当前限制为最多 8 张、单张 10 MiB、图片总量 20 MiB。
- 文件和文件夹不作为字节块发送，而是加入路径上下文并通过 additionalDirectories 授权。
- 对单个外部文件，当前实现会授权它的父目录，权限范围大于用户明确选择的文件。

## 已完成任务的影响

- “增强聊天气泡图片显示”任务已经完成，并通过 250 项附件专项测试、desktop typecheck、hard constraints 和 diff 检查。
- 它已经实现用户图片持久化、结构化历史附件、1–8 图宫格、灯箱、失败回退、文件与文件夹打开、删除清理和孤儿重试。
- 历史中只保存图片 artifact 元数据和安全 URL，不保存 Base64 或原始字节。
- 这项修改是新方案的基础，不需要重新建设聊天气泡和持久化展示。
- 它没有修改 Claude SDK 模型输入方式，因此不解决 50 图的请求体、内存和 Provider 兼容问题。

## 为什么不能直接提高到 50 张

- 原始字节在 File、ArrayBuffer、IPC 序列化、主进程对象和 Base64 字符串之间可能同时存在。
- Base64 通常会比原始二进制增加约三分之一体积，还会产生额外字符串内存。
- 50 张图片会把 Renderer 和主进程内存峰值、IPC 拷贝和模型请求体同时放大。
- Anthropic 官方、百炼兼容端点和自定义兼容端点的图片数量与请求体限制并不一致。
- 单纯依赖发送失败后重试，会出现 0 秒失败、草稿丢失或不确定请求是否已被接收的问题。

## Base64 的正确边界

- Base64 不是错误格式；对于本地图片直接进入 Claude 消息，它仍是通用且合法的最终传输格式。
- 错误的是让 Base64 或完整图片字节贯穿 UI、IPC、历史和大批量单次请求。
- 正确做法是选择时受控落盘，内部只流转附件引用，只在最终 SDK 组包时为小批量或单个工具结果临时编码。
- URL 和 Provider Files API 可以作为未来的可选策略，但不适合作为多 Provider 基础架构。

## Claude Agent SDK 相关能力

- SDK 支持在用户消息内容中传入 Base64 image blocks。
- SDK 支持 additionalDirectories，使 Claude 内置 Read、Glob 和 Grep 可以访问额外路径。
- SDK 支持 createSdkMcpServer 和进程内工具，MCP 工具结果可以返回图片内容。
- 因此可以建立只读、会话绑定的附件服务，让模型按 attachmentId 分批取图。
- 需要用当前安装版本的类型与集成测试再次确认图片型工具结果在各 Provider 下的真实兼容性。

## 推荐架构

### 1. 受控暂存

- 选择、粘贴和拖拽统一进入主进程 AttachmentStagingService。
- 主进程流式读取、校验、原子写入，并生成 SHA-256、缩略图和模型预览图。
- Renderer 只拿 AttachmentRef 和受控预览 URL。
- 原始图片不进入会话历史、日志、导出或配置备份。

### 2. 生命周期

- staged：属于草稿，可移除、可超时清理。
- committed：消息成功入队和历史提交后归属于 conversation/turn。
- orphaned：提交中断或删除失败，进入可重试清理。
- 应用启动时进行有界恢复，不阻塞主窗口。

### 3. 自适应派发

- 小批量：根据 Provider 安全预算直接 inline。
- 大批量：发送编号总览图与 manifest，模型通过 attachment_read 分批获取预览或原图。
- 不支持视觉或工具图片结果：在发送前降级或拒绝，保留草稿。
- Base64 只在最终组包或单次工具结果中短暂出现。

### 4. 总览图

- 使用 Electron nativeImage 或已有能力在本地生成一个或多个编号总览图。
- 总览图只用于定位和全局理解，不能替代原图细节分析。
- 每张原图都有稳定编号，manifest、总览图和 attachmentId 一一对应。
- 用户要求检查全部时，系统提示 Agent 必须按批次读取全部编号。

### 5. 内部附件工具

- attachment_list 只返回当前用户轮次的可信 manifest。
- attachment_read 只接收 attachmentId、detail 和有界 ID 列表。
- 工具不接受任意本地路径。
- 每次调用限制图片数、像素、解码后字节和响应体。
- 会话、conversation、turn、MIME、哈希和所有权全部由主进程校验。

### 6. 文件与文件夹

- 单文件复制到受控存储后再让 Agent 读取，避免授权原父目录。
- 明确选择的文件夹继续走精确 additionalDirectories。
- 文件夹不递归复制，避免大目录磁盘和耗时风险。
- 普通文件优先交给 Claude Read 等工具，不统一转 Base64。

## Provider 能力画像

建议字段：

- vision
- inlineImage
- imageToolResult
- urlImage
- providerFileId
- maxInlineImages
- maxInlineImageBytes
- maxRequestBytes
- preferredBatchImages
- preferredPreviewPixels
- verifiedAt
- source

未知或自定义 Provider 使用保守默认值。能力画像必须能区分“文档声明”“契约测试通过”和“用户手动覆盖”。

## 配额建议

- 产品数量上限：50 张。
- 初始单张上限：沿用现有 10 MiB。
- 单轮暂存总量必须允许 50 张达到单张上限，即至少 500 MiB 级别，但实现必须流式处理，不能一次载入内存。
- 单次模型读取批次远小于单轮存储配额，具体值由 Provider 契约和压测确定。
- 还需要会话级和全局磁盘配额、LRU 或过期清理以及清晰的用户错误。
- 数量上限与字节上限同时生效；“支持 50 张”不代表支持任意尺寸或 RAW 格式。

## 安全结论

- 用户明确附加某个文件，等价于授权读取该附件本身，不等价于授权其父目录。
- 内部附件读取是消息输入基础设施，不应成为任意文件系统工具。
- 内部 artifact 路径不进入模型提示、日志、历史或导出。
- 必须防御路径穿越、符号链接逃逸、TOCTOU、伪造 MIME、跨会话 attachmentId 和已删除附件复用。
- 外部读取、受控写入、删除和工具访问均需经过 PermissionGuard 与 AuditSink。

## 失败与重试

- 预检失败：不入队、不创建模型轮次、保留草稿。
- 暂存失败：只标记失败附件，允许移除或重新选择。
- Provider 明确拒绝且可确认未接收：允许重新规划一次。
- Provider 状态不确定：禁止自动重发，避免重复用户轮次。
- 工具读取失败：返回结构化错误和失败 ID，不把路径或二进制写入日志。

## 代码范围

- Renderer：Agent composer、连接 hook、消息附件和类型。
- IPC：Agent message schema、shared contract、tools 与 preload bridge。
- Runtime：artifact store、attachments、conversation router、Claude SDK session、session manager。
- Provider：preset、store、schema、能力画像和错误归一化。
- Persistence：Agent artifact schema v2、迁移、引用和清理。
- Docs：附件设计、runtime security、knowledge base、Agent 指南、必要的 capability 说明和发布说明。

## 当前工作区注意事项

- 工作区已有大量未提交改动，包括已完成的 Agent 附件 UI/持久化和无关的 Drive MDXEditor 修改。
- 后续实现必须以当前附件改动为基线，逐阶段做聚焦 diff。
- 不得覆盖或回退用户及其它 Codex 任务的现有修改。
- 当前规划文件已按用户要求重置，旧规划历史不再保留在这三份活动文件中。

## 待验证问题

- 百炼当前所选 Kimi 模型对图片数量、单图大小、总请求体和图片型 tool result 的官方限制。
- 自定义 Anthropic-compatible 端点能否可靠处理 MCP 图片工具结果。
- Electron nativeImage 对项目需要支持的 HEIC、GIF 和超大图片的解码行为。
- 50 张典型手机照片暂存、生成缩略图和恢复历史时的实际内存峰值。
- 内部 MCP 工具是否需要在现有 Persona 工具策略中单独声明基础设施豁免。

## 资料

- Claude Agent SDK streaming input：https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- Claude Agent SDK TypeScript：https://code.claude.com/docs/en/agent-sdk/typescript
- Claude Code tools reference：https://code.claude.com/docs/en/tools-reference
- Claude vision：https://platform.claude.com/docs/en/build-with-claude/vision
- 本地附件设计：docs/superpowers/specs/2026-06-09-agent-attachments-claude-code-aligned-design.md
- 图片 artifact 计划：docs/superpowers/plans/2026-07-03-agent-image-artifacts.md

## 遇到的问题

| 问题 | 解决方案 |
|------|----------|
| 旧规划文件混入多个已结束任务 | 按用户要求重置三份活动规划文件，只保留本任务 |
| 当前任务尚未核实百炼最新限制 | 在阶段 1 使用官方资料与契约测试确认，不在计划中编造数值 |

---

每执行两次查看、浏览器或搜索操作后更新本文件。

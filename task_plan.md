# 任务计划：Agent 大批量图片与附件稳定处理

## 目标

让 Synapse Agent 对话稳定支持单轮选择、粘贴或拖入最多 50 张普通图片，并正确处理文件与文件夹；图片不再以完整字节贯穿 Renderer、IPC、历史和日志，而是在受控存储中暂存，由运行时根据 Provider 能力以内联、总览图或按需读取方式交给模型。

## 当前阶段

阶段 1：契约冻结与基线测试（待执行）

## 产品成功标准

- 单轮允许选择最多 50 张图片；图片数量限制和字节配额分别校验。
- 选择、粘贴、拖拽和系统文件选择器使用同一套附件规则。
- Renderer 草稿、发送 IPC、会话历史、导出和日志均不保存图片原始字节或 Base64。
- 发送前完成 MIME、大小、Provider 视觉能力和请求体预算预检，不再出现可预判的 0 秒发送失败。
- 小批量图片保持低延迟；大批量图片不会一次性进入模型请求，而是通过总览与按需读取完成分析。
- 用户要求检查全部图片时，Agent 能分批读取并核对全部附件，而不是只分析前几张。
- 重启应用后附件预览、继续对话、导出隔离和会话删除均正常。
- 单个文件不会导致 Agent 获得其整个父目录权限；只有用户明确选择的文件夹才授权该精确目录。
- Anthropic 官方端点、百炼兼容端点和自定义 Anthropic-compatible 端点均有明确能力画像、兼容行为和失败提示。
- 新链路可以通过功能开关退回现有最多 8 张的直接内联模式。

## 非目标

- 不自动把用户附件上传到 OSS、CDN 或第三方文件服务。
- 不把内部 artifact 目录作为普通文件夹整体授权给 Agent。
- 不依赖某一家 Provider 专有的 Files API 作为基础能力。
- 不在本任务中重构无关的 Agent、Drive、MDXEditor 或 Provider 代码。
- 未经用户明确批准不新增图片处理依赖；优先使用 Electron nativeImage 和现有能力。

## 目标架构

选择、粘贴或拖入
→ 主进程流式校验并受控暂存
→ Renderer 和 IPC 只持有 attachmentId 与缩略图 URL
→ 发送前能力预检
→ AttachmentDispatchPlanner
→ 小批量直接内联 / 大批量总览图加按需读取 / 不兼容时发送前阻止
→ 发送成功后从 staged 原子转为 committed

## 各阶段

### 阶段 0：规划状态重置与方案建立

- [x] 复核已完成的聊天气泡附件任务及其验证结果
- [x] 审计当前选择、IPC、artifact、历史、Claude SDK 和 Provider 链路
- [x] 确认 Base64 的问题边界和 50 图目标架构
- [x] 重置 task_plan.md、findings.md 和 progress.md
- [x] 写入完整实施计划、研究结论和验收门禁
- **状态：** complete

### 阶段 1：契约冻结与基线测试

- [ ] 更新附件设计文档，修订当前“图片全部直接 SDK image block”和“最多 8 张”的硬规则
- [ ] 定义 AttachmentRef、StagedAttachment、CommittedAttachment 和 DispatchPlan 的版本化契约
- [ ] 明确图片、单文件和文件夹三种不同的权限与生命周期
- [ ] 核实当前 Anthropic、百炼 Kimi 和自定义 Provider 的官方限制，不凭经验硬编码
- [ ] 采集 1、8、20、50 张典型图片的 Renderer、主进程和请求体内存基线
- [ ] 先补充红灯测试，锁定“发送 IPC 不含图片字节”和“50 张可暂存”的目标行为
- [ ] 更新 Agent runtime/security 文档中的长期边界
- **退出条件：** 契约、限制来源、失败行为、迁移方式和红灯测试全部明确
- **状态：** pending

### 阶段 2：附件暂存与生命周期

- [ ] 新增 AttachmentStagingService，通过主进程统一处理选择、粘贴和拖拽图片
- [ ] 使用临时文件加原子 rename 落盘，完成魔数 MIME 检查、大小检查和 SHA-256
- [ ] 保存原始文件，并生成模型预览衍生图和 UI 缩略图；不覆盖原件
- [ ] Artifact schema 升级为版本 2，记录 draftScopeId、状态、尺寸、衍生物和引用关系
- [ ] 实现 staged → committed 原子提交、移除引用、废弃草稿 TTL、崩溃恢复和孤儿重试
- [ ] 设置每张、每轮、每会话和全局磁盘配额；初始产品上限保持单张 10 MiB、最多 50 张，单轮总量需覆盖 50 张上限
- [ ] 所有外部文件读取、受控写入和清理接入 PermissionGuard 与 AuditSink
- **退出条件：** 暂存链路可独立通过并发、崩溃、配额和清理测试
- **状态：** pending

### 阶段 3：Renderer 与 IPC 引用化

- [ ] Composer draft 从 ArrayBuffer 改为稳定 AttachmentRef
- [ ] 文件选择器只返回引用和预览元数据，不把完整图片返回 Renderer
- [ ] 粘贴和拖拽通过窄而类型化的 preload bridge 调用暂存服务
- [ ] 发送 IPC 只传 attachmentId、顺序和用户可见元数据
- [ ] 乐观消息直接使用受控缩略图 URL，持久化后复用同一附件身份
- [ ] 删除附件、取消发送和暂存失败时正确释放引用并保留正文
- [ ] 保持旧历史和已经完成的结构化附件气泡兼容
- **退出条件：** Renderer 和发送 IPC 中不存在原图 ArrayBuffer、Uint8Array、data URL 或 Base64
- **状态：** pending

### 阶段 4：Provider 能力画像与发送前预检

- [ ] 新增版本化 ProviderAttachmentCapabilities
- [ ] 描述 vision、inline image、tool image result、URL/file ID、图片数、单图大小和请求体预算
- [ ] 为内置 Anthropic 与百炼预设提供经官方资料和契约测试确认的能力画像
- [ ] 自定义 Provider 使用保守默认值；必要时提供高级覆盖项并进行边界校验
- [ ] 新增 AttachmentDispatchPlanner，根据图片数量、预览大小、Provider 和模型生成不可变派发计划
- [ ] 把 Base64 编码限制在最终 SDK 组包阶段，并在请求完成或失败后立即释放
- [ ] 统一 payload_too_large、vision_not_supported、unsupported_media 和 tool_image_unsupported 错误
- [ ] 只有能确认请求未被 Provider 接收时才允许自动重新规划一次，避免重复用户消息
- **退出条件：** 所有可预判不兼容在入队前返回稳定错误，草稿保持可重试
- **状态：** pending

### 阶段 5：大批量图片按需读取

- [ ] 使用 Claude Agent SDK createSdkMcpServer 创建进程内只读附件服务
- [ ] 实现 attachment_list，返回本轮可信 manifest
- [ ] 实现 attachment_read，按 ID 返回预览或原图视觉内容
- [ ] 每次读取限制图片数量、解码后字节、像素和总响应体，默认小批次读取
- [ ] 工具严格校验会话、conversation、turn、attachmentId、MIME、哈希和所有权
- [ ] 禁止路径参数、路径穿越、符号链接逃逸和跨会话读取
- [ ] 将工具定义为用户明确附加内容的内部传输能力，不暴露一般文件系统读取
- [ ] 为大批量生成一个或多个带编号的本地总览图，帮助模型建立全局索引
- [ ] 在系统上下文中明确：用户要求“全部检查”时必须按 manifest 读取全部图片
- [ ] Provider 不支持图片工具结果时，根据能力画像改用安全内联或在发送前明确拒绝
- **退出条件：** 50 图请求的初始模型请求体保持有界，模型仍能逐批访问全部原图
- **状态：** pending

### 阶段 6：文件与文件夹最小权限

- [ ] 单独选择的文件复制到受控附件目录，Agent 读取受控副本
- [ ] 保留原始名称、来源和大小用于 UI，但内部路径不进入日志和导出
- [ ] 用户明确选择文件夹时只把该精确目录加入 additionalDirectories
- [ ] 对文件夹执行真实路径、符号链接和权限检查，不扩大到父目录
- [ ] 文件与文件夹继续优先使用 Claude Read、Glob 和 Grep，不把任意文件全部 Base64 化
- [ ] 明确超大文件、不可读文件、包目录和权限撤销的错误行为
- **退出条件：** 选一个文件无法读取其相邻文件；选定文件夹能正常搜索和读取
- **状态：** pending

### 阶段 7：50 图交互与性能

- [ ] Composer 图片数量上限提升到 50，三个入口共用限制与错误文案
- [ ] 只渲染缩略图引用，避免同时解码原图
- [ ] 发送前显示图片数量和总大小，不展示实现细节
- [ ] 超过 8 张时气泡显示前 8 张和剩余数量
- [ ] 灯箱和附件列表使用懒加载或虚拟化，避免同时挂载 50 张原图
- [ ] 保持现有 shadcn/Radix、主题 token 和单层视觉结构，不新增自定义颜色或依赖
- [ ] 保持 attachment-only、失败回退、文件打开和旧历史行为
- **退出条件：** 50 图选择、移除、发送、历史恢复和灯箱操作流畅且内存有界
- **状态：** pending

### 阶段 8：故障恢复、迁移与可观测性

- [ ] 兼容 schema v1 artifact 和现有历史元数据
- [ ] 应用启动时恢复或清理未完成 staged 记录，不阻塞主窗口
- [ ] 会话删除、历史清理和存储配额淘汰保持引用一致
- [ ] 日志与遥测只记录计数、字节数、策略、耗时和错误类别
- [ ] 对附件 ID、路径、文件名和工具结果执行现有敏感信息脱敏
- [ ] 增加新链路功能开关和旧 8 图 inline 回退开关
- [ ] 设计灰度启用和回滚流程，不迁移或重写用户原始附件
- **退出条件：** 崩溃、重启、回滚和旧数据场景均有自动化验证
- **状态：** pending

### 阶段 9：全链路验证与发布准备

- [ ] 覆盖 1、4、8、9、20、50 张图片及不同总字节场景
- [ ] 覆盖选择、粘贴、拖拽、删除、取消、重试、断网和 Provider 拒绝
- [ ] 覆盖 JPEG、PNG、WebP、GIF、伪造扩展名、损坏文件和不可解码图片
- [ ] 覆盖路径穿越、符号链接、TOCTOU、跨会话读取和越权 attachmentId
- [ ] 验证历史、日志、导出、配置备份和错误报告不含原始字节/Base64
- [ ] 使用假 Provider 端点做能力契约测试，不依赖付费调用作为自动化门禁
- [ ] 对官方 Anthropic 和百炼各做一次受控人工验收
- [ ] 运行 Agent 专项测试、desktop typecheck、check:hard-constraints 和 git diff --check
- [ ] 涉及打包资源时额外运行 check:packaged-asar
- [ ] 更新设计文档、Agent 指南、必要的 capability 说明和 RELEASE_NOTES_PENDING.md
- **退出条件：** 所有自动化门禁通过，50 图真实验收成功，回退开关验证有效
- **状态：** pending

## 测试矩阵

| 维度 | 必测场景 |
|------|----------|
| 数量 | 0、1、4、8、9、20、50、51 张 |
| 体积 | 小图、单张临界值、单轮临界值、超过配额 |
| 入口 | 文件选择器、粘贴、拖拽、混合附件 |
| Provider | Anthropic、百炼 Kimi、自定义兼容端点、无视觉模型 |
| 策略 | 直接内联、总览加按需读取、预检拒绝、旧链路回退 |
| 生命周期 | 暂存、移除、发送、失败、重启、删除会话、孤儿清理 |
| 安全 | MIME 欺骗、路径穿越、符号链接、跨会话 ID、日志脱敏 |
| UI | 乐观消息、历史恢复、超过 8 张、灯箱懒加载、图片失败 |

## 已做决策

| 决策 | 理由 |
|------|------|
| 不简单把 8 改成 50 | 当前链路会制造多份字节和 Base64 副本，稳定性不可接受 |
| 选择时落盘，业务链路只传引用 | 控制内存、统一入口、支持恢复和清理 |
| Base64 只存在于最终 SDK 边界 | Base64 本身是合法传输格式，问题在于范围和批量 |
| 小批量内联，大批量总览加按需读取 | 兼顾延迟、兼容性、细节能力和请求体上限 |
| 使用进程内只读附件 MCP | 不依赖公开 URL，不开放内部目录，可做精确授权和审计 |
| 单文件受控复制，文件夹精确授权 | 避免因一个文件放开整个父目录 |
| Provider 能力画像必须版本化 | 不同兼容端点的限制和支持范围不同 |
| 先保持旧 8 图模式作为回退 | 便于分阶段交付和快速止损 |

## 主要代码范围

- desktop/electron/modules/agent/ipc-messages.ts
- desktop/electron/modules/agent/ipc-shared.ts
- desktop/electron/modules/agent/ipc-tools.ts
- desktop/src/types/bridge.ts
- desktop/src/types/agent.ts
- desktop/src/modules/agent/components/agent-composer.tsx
- desktop/src/modules/agent/components/agent-message-attachments.tsx
- desktop/src/modules/agent/hooks/use-chat-connection.ts
- desktop/electron/services/agent-runtime/artifact-store.ts
- desktop/electron/services/agent-runtime/attachments.ts
- desktop/electron/services/agent-runtime/claude-sdk-session.ts
- desktop/electron/services/agent-runtime/conversation-router.ts
- desktop/electron/services/agent-runtime/types.ts
- Provider preset、store、schema 与测试
- DataRepository artifact schema、迁移与测试
- Agent 附件、安全、能力和发布说明文档

## 风险与控制

| 风险 | 控制 |
|------|------|
| 第三方 Provider 声称兼容但不支持图片工具结果 | 能力画像、假端点契约测试、发送前预检和旧模式回退 |
| 50 张原图造成内存峰值 | 流式落盘、引用化、缩略图、批次读取和像素预算 |
| Agent 未读取全部图片 | manifest、编号总览、系统规则和已读数量验证 |
| 草稿或崩溃留下大量文件 | staged TTL、引用计数、启动恢复、配额和孤儿重试 |
| 单文件授权扩大目录权限 | 复制受控副本，不授权原父目录 |
| 自动重试产生重复用户轮次 | 仅在确认请求未被接收时重规划一次 |
| 与当前未提交附件 UI 改动冲突 | 以现有 artifact 与历史实现为基线，逐阶段小 diff，不覆盖无关改动 |

## 遇到的错误

| 错误 | 尝试次数 | 解决方案 |
|------|----------|----------|
| 暂无 | 0 | 后续发生时立即记录 |

## 备注

- 每完成一个阶段同步更新 task_plan.md 与 progress.md。
- 每两次查看、浏览器或搜索操作后，把可信结论写入 findings.md。
- 重大决策前重新读取本计划。
- 当前只完成计划编写，尚未授权实施产品代码。

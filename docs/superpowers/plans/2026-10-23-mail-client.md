# 本机邮箱客户端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 SY 桌面提供阿里邮箱优先的本机邮件客户端，并向 Agent 提供同等业务能力的 MCP 与 Skill。

**Architecture:** 本机 DataRepository 元数据索引配合受控文件资产，正文/附件按需读取；每账号同步队列与持久操作状态机处理网络不确定性。核心服务放入 mail 能力包，Renderer 和 MCP 仅作为入口；本机通知不走云账号消息中心。

**Tech Stack:** Electron 41、React 19、TypeScript 6、shadcn/Radix、DataRepository；ImapFlow、Nodemailer、MailParser、Tiptap、DOMPurify。

**Spec:** `docs/superpowers/specs/2026-10-23-mail-client-design.md`（用户已确认）。前置计划：`docs/superpowers/plans/2026-10-23-mail-internal-rename.md`。

## Global Constraints

- 先完成前置计划 R1–R4；不保留旧站内信兼容入口。不新增手机/Web 邮箱、云代收、专用 Workflow 节点或 Automation Action。
- 默认当前仓库、当前分支；未经明确授权不得新建分支/worktree。按任务完成局部验证和本地中文提交，不自动 push / CI / 发版 / 部署。
- 编写时无关未提交文件为 `desktop/electron/services/agent-runtime/synapse-tool-router.ts`、`desktop/synapse-capabilities/shared/naming.ts`。执行前检查最新 diff，不覆盖或混入。
- App `mail`，namespace `mail`，服务 `core.mail`，协议 `synapse://mail/<id>`；外部 ID 固定 `em_` + UUID，不接受旧内部信件 ID。
- 账号、缓存和秘密只在当前电脑，按当前 SY 身份隔离；不进入云同步、导出备份或诊断上传。密钥用 encrypted-json，不能降级明文。
- 配置、数据和资产通过 DataRepository 及其受控资产扩展；无业务裸 fs 写入、裸 IPC、业务端口绑定、业务单例导出。
- 首屏 50 条，历史批次 100 条，最多两个账号并行补历史；无 IDLE 轮询 60 秒，其他文件夹 5 分钟校对；缓存 1 GiB；草稿防抖 1 秒；预览有效期 10 分钟；批量操作最多 100 个显式 ID。
- 通知默认每账号开启，首次历史不提醒；SY 进程运行才收信，关闭邮箱窗口不停同步，退出/睡眠后恢复补同步。
- UI 复用现有壳、组件和 token；三栏阅读、右上写信、右侧编辑面板。不得复用临时 HTML 原型的 execCommand 或样式实现。
- 使用 Skill 的授权规则：明确授权且内容清晰时预览后发送，不增加固定的人为二次确认；unknown 不能自动重发。
- 所有新 capability / System App / Deep Link 注册当次同步清单、计数、Skill 和发布说明；不为规划预填已实现能力。

## Review Focus

1. SMTP 已接受但进程在持久回执前崩溃；再次点击或 Agent 换请求键也不能悄悄重发同一草稿修订。（C9）
2. UIDVALIDITY 重置后旧 UID 被新信复用；旧链接、下载和整理请求必须失效，不能误读误删。（C4、C7、C11）
3. 同时在 UI 与 MCP 编辑草稿，远端草稿也有变化；保护双方内容，关闭面板或退出前保存失败可见。（C8、C13）
4. HTML/CID、重定向、DNS 重绑定和含路径的附件名；读信不执行脚本、不访问内网、不跨账号取资产。（C2、C6、C12）
5. 混合语言标题/地址、很大邮箱和中途取消的正文扫描；返回实际覆盖范围、可续查，不假称零命中即无邮件。（C5）

## 文件结构与测试约定

表中的新文件均在对应任务创建；`M/` 表示 `desktop/app-capabilities/mail/`，`U/` 表示 `desktop/src/modules/mail/`，`D/` 表示 `desktop/electron/runtime/data-repo/`。这三个缩写只用于本文，不创建别名目录。

| 文件组 | 职责 |
| --- | --- |
| `M/shared/{types,schema,capability,manifest,limits}.ts` | DTO / schema / 44 个公开动作 / 稳定身份与限额 |
| `M/main/{service,context,repository,assets,accounts}.ts` | 核心编排、当前身份、持久化、资产归属和账号生命周期 |
| `M/main/protocol/{types,imap,smtp,aliyun-policy}.ts` | 协议边界和阿里语义，不暴露库对象给 UI |
| `M/main/{sync,search,mime,mutations,drafts,draft-sync,send,send-reconcile}.ts` | 可独立测试的业务状态机 |
| `M/main/{notifications,notification-adapter,dispatcher,ipc,protocol-handler,body-resources}.ts` | 受控入口和本机呈现 |
| `M/renderer/{sanitize-body,compose-document}.ts` | 安全阅读投影与富文本序列化，不处理网络/存储 |
| `U/{index,layout,navigation,message-list,message-detail,compose,account-dialog,settings}.tsx` | 已确认桌面交互 |
| `U/{use-mail,use-compose,use-mail-accounts}.ts` | preload 请求和状态隔离 |
| `D/{assets.ts,schemas/mail.ts}` | 通用受控资产 IO、mail namespace 注册 |

每任务的测试放在相应目录的 `__tests__/`；协议使用 scripted fake 适配器和脱敏 MIME fixture，不连真实邮箱。C3 创建 `M/main/__tests__/helpers.ts` 的 `createMailTestRig()`：内存/临时目录 repo、可控时钟、身份 generation、IMAP/SMTP fake、权限与审计 spy；后续复用，不各自重写一套 harness。新建测试的 fixture 变量在测试文件中定义，本文断言展示行为，不要求照搬内部对象结构。

`pnpm --filter @synapse/desktop test <路径>` 使用已有一次性 Vitest 流程；每任务先失败、后通过。不得把未执行的真机/真实协议测试记为 PASS。

## 契约与固定取值

### 共享类型（C1 定义）

`MailAccountId` / `MailFolderId` / `MailAssetId` / `MailDraftId` / `MailJobId` / `MailOperationId` 是带前缀 UUID 的不透明字符串；Message ID 为 `em_<uuid>`。ownerId 仅在主进程上下文，不在公开输入中。

`MailContext = { ownerId: string; generation: number; signal: AbortSignal; actor: 'ui'|'mcp'|'sync' }` 由当前已登录的 SY 账号会话构造；ownerId 是 AccountService 当前账号的服务端用户 ID，不是 user-identity-service 生成的本机安装身份。所有异步提交、事件发布、通知和下载前复验 generation。`Page<T> = { items: T[]; nextCursor: string|null }`，默认 50、最大 100；cursor 绑定 owner / account / filter / sort / generation，变更任一查询条件需重新分页。

`MessageLocator = { accountId; folderId; uidValidity: string; uid: number }`；`MailSummary` 含本机 id、locator、From/To/Cc、subject、snippet、date、read/star、附件数量、bodyState、revision。Bcc 仅对本机草稿/发送快照及服务端实际提供的自身 Sent 数据可见，不从引用推断。

`Coverage = { metadataComplete: boolean; serverHistoryComplete: boolean|null; indexedCount: number; bodyScannedCount: number; bodyPendingCount: number|null; reason: string|null }`。所有 count/search 都携带 coverage；未确认远端历史完整时为 null。

`DraftInput = { accountId; to: Address[]; cc: Address[]; bcc: Address[]; subject: string; html: string; text: string; assetIds: MailAssetId[]; inlineImages: {assetId,cid}[] }`；`Address = { address: string; name?: string }`，拒绝 CR/LF/header injection。`Draft` 增加 id、revision、state、source relation、remote locator、保存/同步状态；正文在资产，DTO 按需限额返回。

`SendReceipt` 含 operationId、state、accepted/rejected 地址分组、messageId、sentCopyState、可重试的阶段、error code。状态为 prepared/submitting/accepted/partial/failed/unknown。`MailInputs`、`MailResults` 从下表每项 Zod schema 推导，后续服务签名以 `MailInputs['draft.update']` 等引用，避免重复定义。`MailAction=keyof MailInputs`；AccountAction/SearchAction/DraftAction 分别是 account.*/search.*/draft.* 键的 Extract 联合，FolderMutation 是 folder.* 除 list，MessageMutation 是 message.update/move/delete/restore。AccountConfig、AccountSummary、Folder、MailAsset、DraftSyncResult 和 InboxDelta 在 C1 的 types.ts 按对应表项及设计定义，不在不同任务私自复制。

### 公开能力清单：44 项

完整 capability 为 `app.mail.<下列键>`；MCP 为点换下划线。所有 object strict；修改类返回新 revision 或逐项回执。所有列表使用上述 Page；table 中“账号”即显式 accountId。get 可使用 ID 或完整 reference（二选一）并由服务解析所属账号。读操作不隐式设已读。

| 键（工具 suffix） | 输入与结果 |
| --- | --- |
| account.list | 可选 cursor/limit → 账号摘要 Page |
| account.get | accountId → 脱敏配置、状态、可用能力 |
| account.open | 可选 accountId → 打开本机添加/编辑配置入口的结果，不接收秘密 |
| account.update | accountId、expectedRevision、非敏感 patch → 新配置；协议端点改动进入待重验证 |
| account.inspect | accountId → 分别测试 IMAP/SMTP 认证，不发信 |
| account.pause | accountId → 暂停状态 |
| account.resume | accountId → 同步 jobId |
| account.delete | accountId、expectedRevision、discardLocalDrafts、acknowledgeUnknownOperations → 本机移除回执；后两项默认 false，存在对应影响则阻断并返回影响计数 |
| folder.list | 账号、cursor/limit → Folder Page |
| folder.create | 账号、name、可选 parentFolderId → Folder |
| folder.rename | 账号、folderId、name → Folder |
| folder.delete | 账号、folderId → 仅空普通文件夹删除回执 |
| folder.update | 账号、folderId、role、expectedAccountRevision → 映射；role 为 drafts/sent/trash/junk/none |
| sync.start | 账号、可选 folderId → jobId |
| sync.get | jobId → 进度、coverage、诊断 |
| sync.cancel | jobId → 取消当前补历史，不关闭账号长期收信 |
| message.list | 账号、可选 folderId、cursor/limit、unreadOnly/starredOnly、日期范围 → Summary Page + coverage；folderId 缺省表示该账号全部已索引文件夹 |
| message.get | messageId 或 reference → 详情元数据、附件引用、bodyRef；不自动下载全部正文 |
| message.count | 账号、可选 folderId → 已索引/未读/远端报告计数分别返回 + coverage |
| message.update | 账号、1–100 个 messageIds、read/star patch → BatchResult |
| message.move | 账号、1–100 个 messageIds、targetFolderId、clientRequestId → BatchResult |
| message.delete | 账号、1–100 个 messageIds、permanent=false、clientRequestId → BatchResult |
| message.restore | 账号、1–100 个 Trash messageIds、可选 targetFolderId、clientRequestId → BatchResult；默认 Inbox |
| search.start | 账号、query、范围/日期/标记、fields=metadata或body → jobId |
| search.get | jobId、cursor/limit → 已找到的 Summary Page + coverage + 是否可继续；不驱动网络 |
| search.resume | jobId → 继续一个预算批次的回执 |
| search.cancel | jobId → 保留已找到结果并取消后续抓取 |
| draft.list | 账号、cursor/limit → 草稿摘要 Page |
| draft.get | draftId → Draft |
| draft.create | DraftInput 或 sourceMessageId + mode(reply/reply_all/forward) + forwardMode(inline/eml) → Draft |
| draft.update | draftId、expectedRevision、DraftInput patch → Draft |
| draft.delete | draftId、expectedRevision → 本地及精确关联远端草稿处理结果 |
| attachment.import_local | 账号、filePath → 已落盘 MailAsset 元数据 |
| attachment.list | messageId 或 draftId 二选一、cursor/limit → 附件元数据 Page |
| attachment.get | assetId 或 messageId+attachmentId 二选一 → 类型/大小/CID/hash 等元数据 |
| attachment.download_file | 资产或邮件附件引用、outputPath → 下载字节数/hash/本机路径 |
| attachment.delete | assetId → 仅未被引用的本地暂存资产可删，不能改服务端信件 |
| message.extract_to_file | messageId、outputPath → EML 导出回执 |
| body.read_chunk | messageId、可选 bodyRef/cursor → 有界 HTML/文本块、nextCursor、截断/完整状态；按需加载 |
| send.preview | draftId、expectedRevision → 冻结预览、previewId、expiresAt、内容/附件摘要 |
| message.send | previewId、clientRequestId、confirmed → SendReceipt |
| operation.list | 账号、cursor/limit、可选 state → SendReceipt Page |
| operation.get | operationId → SendReceipt，可触发有界只读对账，不自动 SMTP 重发 |
| cache.clear | 账号 → 清理可重取缓存的回执，不清草稿/待发/unknown |

上表顺序即注册核对清单。星标邮件是 `message.list` 不带 folderId 且 `starredOnly=true` 的账号级查询视图，不伪造服务端文件夹 ID；普通 Inbox 等导航始终传实际 folderId。账号 open、检查、同步、搜索和下载有副作用，不能仅按后缀推断风险。定义逐项权限元数据；永久删除、本机账号移除使用高风险权限；读取内容不构成发送授权。原站内信 17 项另计，共 61 项，实际全局总数以仓库注册测试重算。

### 执行时固定的资源预算

除设计原值外，为防止无界输入，本计划选择：单附件/EML 最大 100 MiB、单图 10 MiB、写信正文 5 MiB UTF-8、最多 100 个附件；发送编码后的 MIME 上限 100 MiB，服务端限制更小时提前失败。正文分块最大 64 KiB；正文搜索每次 resume 最多 100 封/20 MiB/30 秒，任一到达即停并可续查；元数据搜索每批最多读取 1000 条。超限显式返回错误，不静默裁剪附件或发送正文。缓存 1 GiB 是当前 SY 身份下所有账号的总可淘汰预算。

### 依赖基线（仅查询元数据，尚未安装）

2026-10-23 查询 npm registry 的候选精确版本如下；库 API 与运行时兼容仍需 C3/C13 实际检查，不能把 registry 声明当验证通过。依赖固定版本，不直接装 latest。

| 包 | 候选版本 | 许可证 / 约束 |
| --- | --- | --- |
| imapflow | 2.9.1 | MIT；Node >=20；包自身约 1.83 MiB |
| nodemailer | 10.2.1 | MIT-0；Node >=20；约 1.67 MiB |
| mailparser | 3.12.4 | MIT；Node >=20；约 0.22 MiB |
| dompurify | 3.4.17 | MPL-2.0 OR Apache-2.0；选择 Apache-2.0；约 1.54 MiB |
| @tiptap/core、pm、react、starter-kit、extension-image、extension-text-style | 统一 3.32.0 | MIT；React peer 支持 19；这六包自身合计约 4.25 MiB |
| @types/nodemailer、@types/mailparser | 8.0.2、3.9.0 | MIT；仅无自带类型时增加，前者与 runtime 主版本不同，须验证实际使用 API |

来源：[ImapFlow registry](https://registry.npmjs.org/imapflow/2.9.1)、[Nodemailer registry](https://registry.npmjs.org/nodemailer/10.2.1)、[MailParser registry](https://registry.npmjs.org/mailparser/3.12.4)、[DOMPurify registry](https://registry.npmjs.org/dompurify/3.4.17)、[Tiptap React registry](https://registry.npmjs.org/@tiptap%2freact/3.32.0)。表中体积不含传递依赖和构建压缩；C14 记录实际安装/包体差值。

## 任务依赖

`C1 → C2 → C3 → C4 → C5/C6 → C7 → C8 → C9 → C10 → C11 → C12 → C13 → C14`。这是推荐的顺序验收路径，不授权并行代理或新分支。每任务交付可测服务或入口；C11 前不把未实现动作注册到公开 MCP。

### C1：契约、命名与能力 schema

**Files:** Create `M/shared/{types.ts,schema.ts,capability.ts,manifest.ts,limits.ts}`、`M/shared/__tests__/{schema.test.ts,manifest.test.ts}`；Modify `desktop/config.ts`（集中运行配置）。

**Interfaces:** 导出上述 MailInputs/MailResults、MailContext、所有 DTO、`MAIL_ACTIONS`（44 项）、`MAIL_SERVICE_ID='core.mail'`、`parseMailReference(reference: string): string|null`。schema 只定义，不接入公共注册。

- [ ] 写失败测试：44 动作严格 schema、old internal send payload 拒绝、101 IDs 拒绝、cursor/引用二选一、secret/ownerId 额外字段拒绝；`expect(parseMailReference('synapse://mail/cuid-old')).toBeNull()`；`expect(MAIL_ACTIONS).toHaveLength(44)`。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/shared/__tests__`，确认缺实现导致失败。
- [ ] 实现 schema 和常量；内外 ID 分开；状态枚举为业务状态而非扩展能力清单，公开动作复用现有 CapabilityAction，不增加 naming.ts 枚举。每项明确 mutations/风险/权限。
- [ ] 重跑同一测试 PASS；提交 `feat: 定义外部邮箱契约和严格输入边界`。

### C2：本机元数据、文件资产与备份排除

**Files:** Create `D/assets.ts`、`D/schemas/mail.ts`、`D/__tests__/{assets.test.ts,mail-schema.test.ts}`、`M/main/{repository.ts,assets.ts}`、`M/main/__tests__/repository.test.ts`；Modify `D/{types.ts,repository.ts,index.ts,schemas/index.ts}` 及其既有测试、`desktop/electron/services/__tests__/config-backup-service.test.ts`、`docs/agents/{repository-guide.md,workflow-and-capabilities.md}`。

**Interfaces:** `MailRepository` 提供带 owner 的 get/page、CAS revision 和受限原子批次；`MailAssets.put(ctx, stream, metadata): Promise<MailAsset>`、`open(ctx, assetId): Promise<Readable>`、`remove(ctx, assetId): Promise<void>`。底层 `ManagedAssetStore` 只操作指定根下随机 ID，不知道 mail 业务；main/assets 负责归属、权限、引用计数和缓存策略。

- [ ] 写失败测试：非 owner 禁读；失败写盘保留旧内容；临时文件不成为 ready；路径穿越/符号链接拒绝；1024³ 字节缓存边界且 pinned 草稿资产不淘汰。`expect((await repo.exportAll({includeSecrets:true})).namespaces.some(n=>n.name.startsWith('app.mail.'))).toBe(false)`；伪造导入不得覆盖 mail namespace。
- [ ] 运行 `pnpm --filter @synapse/desktop test electron/runtime/data-repo/__tests__/assets.test.ts electron/runtime/data-repo/__tests__/mail-schema.test.ts app-capabilities/mail/main/__tests__/repository.test.ts`，确认失败。
- [ ] 注册 schemaVersion=1 的 accounts、credentials、folders、messages、drafts、operations、sync-state、assets、search-tasks、search-results、previews 共 11 个 namespace；credentials encrypted-json，其余列表 SQLite，声明 owner/account/排序等索引与字节预算。query 每次 ≤100 行，原子批次 ≤128 项/256 KiB；大正文仅资产引用。C5 每批扫描 1000 条须拆为最多十次范围分页，不扩宽单次 query 上限。新建 `transferPolicy: 'portable'|'local-only'` schema 可选元数据，默认 portable 保持旧行为；mail 全部 local-only，export/import 都拦截，不能只靠调用方忘记传 excludeNamespaces。
- [ ] 实现资产 staged→ready→delete-pending 流程；先落文件再提交引用，孤儿/失败删除分批恢复，不吞错；1 GiB LRU 只淘汰可重取资源。清理任务延迟到窗口创建后，不导入 Agent artifact-store。审计记录 ID/结果/大小，不记录正文或路径。
- [ ] 重跑目标测试和 DataRepository repository/atomic 现有测试 PASS；提交 `feat: 增加邮箱本机存储和受控资产缓存`。

### C3：账号配置、身份隔离与协议连接

**Files:** Create `M/main/{context.ts,accounts.ts}`、`M/main/protocol/{types.ts,imap.ts,smtp.ts,aliyun-policy.ts}`、`M/main/__tests__/{helpers.ts,accounts.test.ts,protocol.test.ts}`；Modify `desktop/package.json`、`pnpm-lock.yaml`。

**Interfaces:** `MailAccounts.execute<K extends AccountAction>(ctx, action: K, input: MailInputs[K]): Promise<MailResults[K]>`；仅 UI 的 `configure(ctx, input: AccountConfig & {credential:string}): Promise<AccountSummary>`。`MailImapSession` 提供 listFolders、select、fetchHeaders、fetchBodyStructure、fetchPart、fetchFlags、searchUids、idle、copy、move、append、storeFlags、uidExpunge、close；每项接受 signal，返回 UIDVALIDITY 和可用 UID 映射。`MailSmtp.submit(snapshot, signal): Promise<SmtpReceipt>` / `verify(signal)`。`MailContextProvider.current(actor)` / `assertCurrent(ctx)`。

- [ ] 写失败测试：阿里 TLS 993/465、无 TLS 降级、IMAP 与 SMTP 单独错误；检查连接没有发信；认证失败停止自动重试；切换身份后旧 connect 成功也不得落盘/广播；secret 永不进入 AccountSummary 或日志。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/accounts.test.ts app-capabilities/mail/main/__tests__/protocol.test.ts`，确认失败。
- [ ] 安装上表三个协议库固定版本，检查本机 Electron 实际 Node 版本满足 >=20；只在需要时装类型包并验证使用方法，不能靠 any 掩盖接口差异。生产协议 wrapper 内统一 PermissionGuard、AuditSink、错误脱敏、握手/命令/取消超时，严禁原始协议日志。
- [ ] 实现 account lifecycle：身份+generation 隔离，secret 凭据仅主进程使用；协议端点改动要重新验证，账号移除先显示草稿/unknown 数量并校验两项影响声明，再停止队列、本地清理；存在未确认影响时拒绝。移除不调用 IMAP delete；保留脱敏操作 tombstone 供诊断，不能保留可继续发送的作业。阿里策略 `copyActsAsMove=true`、`serverSavesSent=true`、`remoteTextSearchReliable=false`；通用策略不继承。
- [ ] 重跑两组测试 PASS；提交 `feat: 支持本机阿里邮箱配置和受控协议连接`。

### C4：元数据索引、后台增量和删除校对

**Files:** Create `M/main/sync.ts`、`M/main/__tests__/{sync.test.ts,locator.test.ts}`。

**Interfaces:** `MailSync.start(ctx,input:MailInputs['sync.start']): Promise<{jobId:MailJobId}>`、`get` / `cancel` 对应契约；`startAccount(ctx,accountId)` / `stopAccount(accountId)` 管理后台生命周期。输出 `mail.changed` 事件只带 owner 作用域、账号/对象 ID 和 revision，不带正文/秘密。

- [ ] 写失败测试：首屏 50、后台 100、最大两个账号；60 秒/5 分钟虚拟时钟；IDLE 重复事件不重复插入；不完整 UID 查询不能删本地记录。`expect(oldRefAfterUidValidityChange.code).toBe('STALE_TARGET')`；相同新 UID 不继承旧 em ID。补历史过程中到达新 UID 必须作为新邮件。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/sync.test.ts app-capabilities/mail/main/__tests__/locator.test.ts`，确认失败。
- [ ] 实现每账号最多一条 IDLE 和一条工作连接，工作连接串行 mailbox lock；基线持久化后补历史，增量 checkpoint 仅随成功批次推进；周期 UID/flags 校对，UIDVALIDITY 改变使旧 locator stale。日期无效的信件可列表但显示未知时间，排序用稳定接收索引，不能令整批失败。
- [ ] 实现断网退避（1 秒起、最多 5 分钟、±20% 抖动）、认证失败暂停、sleep/wake 和身份取消；所有后台任务异步启动，不阻塞窗口。
- [ ] 重跑测试 PASS；提交 `feat: 建立邮箱索引和可恢复的后台同步`。

### C5：分页搜索和真实覆盖范围

**Files:** Create `M/main/search.ts`、`M/main/__tests__/search.test.ts`。

**Interfaces:** `MailSearch.execute<K extends SearchAction>(ctx,action,input): Promise<MailResults[K]>`；`listMessages(ctx,input:MailInputs['message.list'])`、`countMessages(ctx,input:MailInputs['message.count'])`。消耗 C2 索引和 C4 的 coverage；正文扫描通过注入 C6 的 `readSearchText` 端口，单元测试先用 fake。

- [ ] 写失败测试：中文/英文大小写与 Unicode NFKC 匹配、不同账号/筛选 cursor 拒绝、恶意服务端 HEADER 空结果不能覆盖本地命中；未完整扫描时 `expect(result.coverage.serverHistoryComplete).toBeNull()`；零命中仍保留 incomplete 原因；取消时保留已找到项。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/search.test.ts`，确认失败。
- [ ] 元数据按索引有界遍历，在共享纯匹配器做归一化；不为全文搜索绕过 DataRepository 写业务 SQL。search job 保存条件摘要、扫描位置、结果 ID 与 coverage；get 只分页已产生结果，resume 才继续预算批次。已缓存正文先查，远端仅取文本 MIME part，不下载所有附件。
- [ ] 对任务和 cursor 使用 24 小时 TTL；任务过期明确报 CURSOR_EXPIRED。扫描中数据变化标明 coverage 已变化，不能伪称快照；列表稳定键 date+id，不深 OFFSET。
- [ ] 重跑测试 PASS；提交 `feat: 增加有界邮箱搜索并报告索引覆盖范围`。

### C6：MIME、正文、附件与安全资源加载

**Files:** Create `M/main/{mime.ts,body-resources.ts}`、`M/renderer/sanitize-body.ts`、`M/main/__tests__/{mime.test.ts,body-resources.test.ts}`、`M/renderer/__tests__/sanitize-body.test.ts`、`M/main/__tests__/fixtures/*.eml`；Modify `desktop/package.json`、`pnpm-lock.yaml`。

**Interfaces:** `MailContent.readChunk(ctx,input:MailInputs['body.read_chunk'])`、`readSearchText(ctx,locator,budget):Promise<{text:string;complete:boolean}>`；`executeAttachment(ctx,action,input)` 处理 attachment.* 和 message.extract_to_file。`sanitizeMailHtml(html,resources): {html:string;links:ExternalLink[];blockedImages:number}` 输出 CSP 隔离文档；资源只允许当前消息 asset token。

- [ ] 写失败测试：encoded words、多层 multipart、GB18030/UTF-8、缺 Subject/Date、重复 CID、相同 Message-ID 的两封信、损坏 MIME 不拖垮列表；附件 bytes/hash 往返一致；超限明确错误；C6 安全 fixture 含 script、SVG、CSS url、file://、危险 scheme、重定向内网和跨账号 CID。断言网络请求数在未授权图片时为 0。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/mime.test.ts app-capabilities/mail/main/__tests__/body-resources.test.ts app-capabilities/mail/renderer/__tests__/sanitize-body.test.ts`，确认失败。
- [ ] 安装固定 DOMPurify；MailParser 流式解析，IMAP BODYSTRUCTURE 定位正文/附件 part，列表不触发全 MIME 下载。下载到 outputPath 使用受控资产流和路径权限，拒绝覆盖已有文件；源文件读取前后复验身份。
- [ ] renderer 白名单清洗；64 KiB 正文块只能拼接到有总大小限制的完整 HTML 文档后统一清洗，未完成正文使用纯文本回退，不将任意半标签块直接插入 DOM。sandbox iframe 不包含 allow-scripts / allow-same-origin / allow-forms / allow-top-navigation，CSP default-src none。本机 CID 经窄 token 资源接口供给，令牌绑定 owner/generation/message；远程图片由主进程受控下载，限制 HTTP(S)、解析 IP 并固定连接地址、每次重定向再校验、最大 3 跳/10 MiB，无 cookies/认证头。不能让裸 fetch 重解析绕过 DNS 检查。
- [ ] 重跑测试 PASS；提交 `feat: 安全解析邮件正文和按需读取附件`。

### C7：文件夹和可恢复的邮件整理

**Files:** Create `M/main/mutations.ts`、`M/main/__tests__/mutations.test.ts`；Modify `M/main/protocol/aliyun-policy.ts`。

**Interfaces:** `MailMutations.execute<K extends FolderMutation|MessageMutation>(ctx,action,input):Promise<MailResults[K]>`；`listFolders(ctx:MailContext,input:MailInputs['folder.list']):Promise<MailResults['folder.list']>` 读取 C4 持久化的文件夹索引，返回映射和可用能力；`BatchResult={items:{id,status:'succeeded'|'failed'|'unknown',code?,newRevision?}[]}`。每个 clientRequestId 绑定 owner/account/action/完整目标集，进入 operations 的类型化整理记录，不混入发送 receipt 查询。

- [ ] 写失败测试：阿里 copy 实际移动后绝不 storeDeleted；通用有 MOVE 时只 MOVE；无 UID EXPUNGE 禁止永久删除；非空/系统文件夹不能删除；UIDVALIDITY 改变、跨账号、101 IDs 全部拒绝；移动超时不重放，已知 UID 映射保留 em ID。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/mutations.test.ts`，确认失败。
- [ ] 普通文件夹映射读取服务器属性；缺少系统角色要求用户选映射。移动只按 provider 策略执行，阿里用 copy API 后核验源/目标且不追加删除；无可靠映射标 unknown。Seen/Flagged 写后复验；删除到 Trash，restore 默认 Inbox；精确 UID 永久删除禁止裸 EXPUNGE。改名保留文件夹本机 ID 并更新所有 locator path。
- [ ] 操作写入 intent 后触网，重试先根据回执和 locator 核验；完成后更新索引再发布事件，批量每项独立回执。
- [ ] 重跑测试 PASS；提交 `feat: 支持文件夹管理和阿里邮箱安全整理`。

### C8：富文本草稿、回复构造与远端草稿同步

**Files:** Create `M/main/{drafts.ts,draft-sync.ts}`、`M/renderer/compose-document.ts`、`M/main/__tests__/{drafts.test.ts,draft-sync.test.ts}`。

**Interfaces:** `MailDrafts.execute<K extends DraftAction>(ctx,action,input):Promise<MailResults[K]>`；`MailDraftSync.sync(ctx,draftId):Promise<DraftSyncResult>`。草稿 revision CAS、资产 pin 与远端 locator 属同一个可恢复业务流程。create 支持直接内容和 reply/reply_all/forward 输入互斥 schema。

- [ ] 写失败测试：两次 expectedRevision 相同只有一次成功；远端更改保留冲突副本；APPEND 未知不再次追加；新 APPEND 确认前不删旧草稿；Reply-To 优先、回复全部排除自身与重复邮箱、不泄露 Bcc、转发附件按两种模式正确携带。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/drafts.test.ts app-capabilities/mail/main/__tests__/draft-sync.test.ts`，确认失败。
- [ ] 本机正文存资产并 CAS 更新引用，UI 和 MCP 一律走同接口。保存成功返回 localSaved，服务端同步单独状态；离线只存草稿不自动发送。固定每个远端草稿修订的 Message-ID/hash，APPENDUID 或唯一证据核验后才替换旧 UID，未知保留两者。
- [ ] 构造引用、In-Reply-To / References、CID 附件与 EML 转发；草稿新增图片必须来自当前账号受控资产，不能将任意远程 URL 在后台下载到发送内容。远端草稿首次索引按原文创建本机编辑快照，保持来源 revision。
- [ ] 重跑测试 PASS；提交 `feat: 支持可恢复草稿和回复转发内容构造`。

### C9：发送预览、持久幂等与不确定结果

**Files:** Create `M/main/{send.ts,send-reconcile.ts}`、`M/main/__tests__/{send.test.ts,send-reconcile.test.ts}`。

**Interfaces:** `MailSend.preview(ctx,input:MailInputs['send.preview'])`、`submit(ctx,input:MailInputs['message.send'])`；`MailSendOperations.list/get` 对应 operation.*；`reconcile(ctx,operationId):Promise<SendReceipt>`。所有返回值是 C1 schema，不泄露原始 SMTP transcript。

- [ ] 写失败测试：同 key 同内容不再 submit；同 key 异内容拒绝；两个不同 key 对同 draft revision 也只产生一个发送操作；10 分钟预览过期；SMTP 已接受后崩溃恢复 unknown；partial 不重试 accepted 收件人；client Sent APPEND 失败只修保存不重发。`expect(smtp.submit).toHaveBeenCalledTimes(1)`，`expect(recovered.state).toBe('unknown')`，`expect(aliyunAppendSent).not.toHaveBeenCalled()`。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/send.test.ts app-capabilities/mail/main/__tests__/send-reconcile.test.ts`，确认失败。
- [ ] 预览冻结完整内容和附件 hash，生成稳定 Message-ID；定义 owner/account/clientRequestId 唯一键及 draftId+revision 消费唯一约束，CAS 先写 submitting 再调用 SMTP。预览显示 Bcc 给发送者但 MIME 不泄露 Bcc header。部分 SMTP RCPT 失败仍如实记录 accepted/rejected。
- [ ] 提交超时/断线/进程恢复转 unknown；有界查 Sent：Message-ID 加自身地址、时间/大小与内容指纹必须形成唯一证据，不能只查同 Message-ID。缺席不能证明未发。operation.get 每次最多核验一批；不自动重复 SMTP。首期 From 仅允许已认证主地址，不提供未经验证的别名发信入口；自身别名配置仅用于回复全部的地址排除。
- [ ] 成功/partial 将草稿置只读已消费，保留审计快照；仅明确新建草稿/重发操作生成新的幂等身份。SMTP 接受与 Sent 保存状态分别返回；失败时保留正文和资产。
- [ ] 重跑测试 PASS；提交 `feat: 增加邮件发送幂等和未知结果核验`。

### C10：本机新邮件提醒

**Files:** Create `M/main/{notifications.ts,notification-adapter.ts}`、`M/main/__tests__/notifications.test.ts`；复用参考 `desktop/app-capabilities/system-notifier/main/adapter.ts`、现有 Terminal 可点击通知实现，不改变其公开契约。

**Interfaces:** `MailNotifications.accept(ctx,change:InboxDelta):Promise<void>`；`MailNotificationAdapter.show({title,body,accountId,messageId,onClick}):void`，adapter 注入 Electron Notification，不使用公开 System Notifier trigger。

- [ ] 写失败测试：历史 baseline 不通知，新到 UID 通知一次，重连/重复 IDLE 不重复；账号关闭提醒无显示但仍同步；身份变化后旧点击无效；无 OS 权限失败只留本机诊断。`expect(accountNotificationApi).not.toHaveBeenCalled()`。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/notifications.test.ts`，确认失败。
- [ ] 先持久去重键再呈现；5 秒窗口同账号聚合，单封带 messageId、多封定位该账号 Inbox。标题为账号显示名、正文只显示发件人/主题的有界安全摘要。点击重新校验当前身份与 locator，不暴露秘密。后台权限与诊断复用现有基础设施，构造 native 对象仅在适配器。
- [ ] 重跑测试 PASS；提交 `feat: 增加仅当前电脑显示的新邮件提醒`。

### C11：服务组装、公开 MCP、窄 IPC 和深链

**Files:** Create `M/main/{service.ts,dispatcher.ts,ipc.ts,protocol-handler.ts}`、`M/main/__tests__/{dispatcher.test.ts,ipc.test.ts,protocol-handler.test.ts,lifecycle.test.ts}`；Modify `desktop/electron/{bootstrap/descriptors.ts,bootstrap/app-ready.ts,bootstrap/ipc-registry.ts,capabilities/action-router.ts}`、`desktop/synapse-capabilities/shared/registry.ts`、`desktop/app-capabilities/mail/shared/manifest.ts` 及对应 registry 测试。

**Interfaces:** `MailService.execute<K extends MailAction>(ctx,action:K,input:MailInputs[K]):Promise<MailResults[K]>` 仅编排 C3–C10；注入 `resolveContext(actor)`，调用者不能自带 owner。主进程私有配置 IPC `app.mail.account.configure` 不进入公开 catalog，credential 只用于写入；公开 `account.open` 打开同一 UI。`createMailProtocolHandlers` 严格解析 `em_<uuid>` 后先校验存在和身份再打开 App。

- [ ] 写失败测试：44 schema/权限/dispatch 对齐；UI 与 MCP 共用服务 spy；旧内部信件输入拒绝且无写入；伪造 owner/credential 参数拒绝；所有分页工具 description 有 cursor 句式；无效链接不聚焦窗口；identity generation 变化后资源/事件/下载结果均失效。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/dispatcher.test.ts app-capabilities/mail/main/__tests__/ipc.test.ts app-capabilities/mail/main/__tests__/protocol-handler.test.ts app-capabilities/mail/main/__tests__/lifecycle.test.ts`，确认失败。
- [ ] 注册 core.mail 及 after-window 后台启动 integration；注入 repo、security、account identity、EventBus 和 adapter。pause/remove/logout/quit 关闭连接与计时器。接入 44 动作，保留 mail_internal 独立路由；公开 HTTP capability 入口沿项目统一 action router/权限，不另开端口或邮箱 HTTP 服务；凭据 configure 仅 IPC，不允许 search/invoke/HTTP 调用。
- [ ] 运行 generate:ipc、check:ipc-codegen、typecheck、hard-constraints 与目标测试，全部 PASS。更新 capability-registry 当前 MCP 数/协议路由与例外、Skill 最小可执行说明，不把 configure 计入公开 44 项。
- [ ] 提交 `feat: 接入邮箱核心服务及 MCP IPC 深链入口`。

### C12：三栏阅读、账号导航与安全正文

**Files:** Create `U/{app-definition.ts,app-manifest.ts,index.tsx,layout.tsx,navigation.tsx,message-list.tsx,message-detail.tsx,use-mail.ts}`、`U/assets/icon.png`、`U/__tests__/{mail-reading.test.tsx,mail-navigation.test.tsx}`；Modify `desktop/src/modules/apps/{types.ts,definitions.ts,registry.ts,components/system-app-content.tsx}`、`desktop/electron/services/system-app-window-service.ts`；适配已有 UI 跟踪边界。

**Interfaces:** `useMail(accountId)` 返回 list/detail/search/sync 状态及类型化 commands；`MailLayout` 接收 view model，不直接触 IPC。`MailDetail` 使用 C6 sanitized projection；Renderer 的账户键和请求 generation 隔离迟到结果。

- [ ] 写用户行为测试：账号切换不显示旧详情、邮件选择触发显式 read 更新而 MCP get 不变、搜索 incomplete 显示覆盖提示、批量最多100、回收站恢复/删除逐项结果；窄桌面能从详情回列表。恶意正文无活动资源，iframe sandbox/CSP 固定。
- [ ] 运行 `pnpm --filter @synapse/desktop test src/modules/mail/__tests__/mail-reading.test.tsx src/modules/mail/__tests__/mail-navigation.test.tsx`，确认失败。
- [ ] 按已确认草图实现三栏和 empty/loading/error 状态，复用现有组件和单 App header；新增邮箱不默认固定 Dock。列表虚拟/有界加载，详情按需读取正文及附件，复制完整 synapse 链接。账号设置/写信按钮接 C13 面板，不实现第二套请求。
- [ ] 阅读外链经现有受控 open 能力：隔离 iframe 内不直接开 top 窗口，清洗投影提供外链清单供受控按钮打开；将该可用回退作为验收基线。若增加正文原位链接点击，必须由主进程验证实际用户导航并拦截，不开放脚本或 same-origin 权限。远程图片显示明确加载操作。
- [ ] 重跑测试 PASS，运行 check:ui-tracking-coverage；提交 `feat: 增加邮箱三栏阅读与账号导航界面`。

### C13：连接向导、设置与写信面板

**Files:** Create `U/{compose.tsx,account-dialog.tsx,settings.tsx,use-compose.ts,use-mail-accounts.ts}`、`U/__tests__/{compose.test.tsx,account-dialog.test.tsx}`；Modify C8 的 compose-document helper、`desktop/package.json`、`pnpm-lock.yaml`。

**Interfaces:** `useCompose(draftId)` 包含 `save(expectedRevision)` / `preparePreview()` / `send(previewId,clientRequestId)`，不在组件里组 MIME。Tiptap 文档只包含白名单段落/样式/列表/链接/图片节点，图片只保存 assetId+CID 引用。

- [ ] 写失败测试：添加阿里只需必要字段、advanced 值可配置；连接检查不发送；secret 输入提交后清除且不出日志；暂停/移除有状态。编辑停止1秒保存、保存失败关闭时留内容、远端冲突保留本地；双击发送只一次；partial/unknown 区分且无自动重试；To/Cc/Bcc、正文样式、粘贴图片和普通附件可预览。
- [ ] 运行 `pnpm --filter @synapse/desktop test src/modules/mail/__tests__/compose.test.tsx src/modules/mail/__tests__/account-dialog.test.tsx`，确认失败。
- [ ] 安装统一版本 Tiptap 六包，核对 starter-kit 已有扩展避免重复注册。用 shadcn Sheet 构建右侧写信，常用字号/粗斜下划线/列表/链接/撤销；Paste 走安全文档转换，图像转受控资产，附件拖入与文件选择共用 C6。UI 由用户点发送表示授权，内部必须固定预览快照后提交，无歧义不再强制弹确认。
- [ ] 账号向导支持阿里和通用 TLS/STARTTLS、Sent策略、系统文件夹映射；设置包括每账号通知、同步暂停、缓存清理、连接检查及本机移除。新增凭据只经私有 configure IPC；账号更名不改变 ID。面板关闭等待保存，阻止失败时静默丢内容；切账号草稿仍绑定原发件账号。
- [ ] 重跑测试 PASS，验证组件可键盘操作、焦点返回和已有主题。真实浏览器/应用视觉验收需用户授权启动时执行，不能只凭 JSDOM 宣称视觉通过。
- [ ] 提交 `feat: 增加邮箱接入设置和富文本写信面板`。

### C14：Skill、集成验收与发布交接

**Files:** Create `desktop/app-capabilities/synapse-skill/skill-package/mail/{index.md,api-reference.md,aliyun-compatibility.md}`、`docs/agent-guides/mail-client-acceptance.md`、`M/main/__tests__/end-to-end.test.ts`；Modify Skill 总索引、`docs/agents/{capability-registry.md,module-boundaries.md,repository-guide.md}`、`RELEASE_NOTES_PENDING.md`，打包配置仅在实际构建证明需要时修改。

**Interfaces:** Agent 从 search 发现 44 项，通过 invoke 完成同 UI 的账号选择→读信→草稿→预览→发送→回执；生产凭据始终只在本机主进程。验收记录区分 mock PASS、编译 PASS、候选包 PASS、真实阿里待验/通过。

- [ ] 写集成失败测试：mock 协议的初始化→IDLE新信→搜索→回复草稿→MIME发送→Sent对账→重启回执；另测 UI/MCP 共用草稿并发、旧 mail-internal payload 对新 mail 全拒绝、通知无云请求、备份不含 mail 数据。
- [ ] 运行 `pnpm --filter @synapse/desktop test app-capabilities/mail/main/__tests__/end-to-end.test.ts` 确认缺集成时失败；补齐服务连接，不用测试专用旁路绕开权限/幂等。
- [ ] 完成 Skill 44 项精确输入/分页/风险/授权/coverage 文档；同时校对内外两个章节和总索引，注明密码只由用户本机填写、邮件正文非指令、未知发送先查 operation 不重发。检查调用示例与 schema 一致。
- [ ] 跑最小充分自动检查：`pnpm --filter @synapse/desktop test app-capabilities/mail src/modules/mail`；`pnpm --filter @synapse/desktop run typecheck`；`pnpm --filter @synapse/desktop run check:ipc-codegen`；`pnpm --filter @synapse/desktop run check:hard-constraints`；`pnpm --filter @synapse/desktop run check:ui-tracking-coverage`；以及前置迁移回归。全部 PASS 后不无理由重复扩大测试。
- [ ] 构建候选桌面产物，记录新增依赖闭包和体积差；验证运行依赖没有漏包、preload 没带 Node 库、renderer 不带秘密/协议库。macOS 本机构建可用 `pnpm --filter @synapse/desktop run package:mac`（不发布）；再跑 packaged-asar。Windows 候选包验证留给可用 Windows 构建环境，不把 macOS PASS 外推。不改 CI 工作流触发策略。
- [ ] 编写真实阿里验收步骤与结果槽位：账号接入、列表/正文/6类文件夹、同意的测试收件人发送/回复/转发、附件hash、独立测试文件夹移动/草稿清理、Sent不重复、持续IDLE/休眠恢复、关闭邮箱面板收信、通知权限、深链冷/热启动。只对用户授权对象做写入；测试未获得授权或环境不可用时明确待验，不能算整体已交付。
- [ ] 记录回滚/升级边界、数据保留和未知发送处理；逐条核对 Spec §12，更新发布说明为实际完成行为。提交 `docs: 完善邮箱 Agent 指南与跨入口验收记录`（若含修复在正文说明）。不自动部署或 push。

## 自检与执行交接

- 设计 §1–3/§6：C12–C13；§4：C3、C5、C7、C9；§5：前置 R1–R4 + C11；§7：C1–C3、C6；§8：C4–C5、C10；§9：C7–C9、C13；§10：C1、C11、C14；§11–12：C3/C13依赖、C14验收与打包。
- 所有 task 的 public input/output 来自 C1 的 MailInputs/MailResults；前置计划的 `mail_internal` 不参与本计划的新类型。相同 action 的 UI 和 MCP 不另建语义。
- Review Focus 五类各有对应失败断言；新附件/多账号/大邮箱边界不依赖真实敏感样本。
- 推荐按任务实现并逐任务独立审阅：迁移与发信状态机错误代价较高，适合把问题限制在当前任务；如用户选择主 Agent 顺序执行，则保持同样任务顺序和验收标准。
- 2026-10-23 已完成自检，补齐账号级星标视图、folder.list 的服务接口、正文分块到安全渲染的边界、查询批次限制和 App definitions 注册位置。两份计划共有 18 个任务；R1–R4、C1–C14 均未开始。
- 当前仅完成计划；实现、自动测试、包体验证及真实邮箱验收均未执行。两份计划评审并选择执行方式后，先执行 R1–R4，再开始 C1。

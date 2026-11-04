# Synapse Skill Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现只有团队资产的 Skill Hub，打通 AI 查询本人团队、检查打包、发布、更新、结果查验，以及网页登录后的商店、安装和管理员治理。

**Architecture:** 服务端保存团队资产、不可变发布包和写入回执，统一判断团队资格与维护权。桌面能力包通过当前 AccountService 调用 HTTP，给 AI 暴露现有 search/invoke 下的十项 Hub 能力，安装接入现有 Skill 安装器。Web 使用 HeroUI v3，使用相同服务端契约，管理员身份保持独立。

**Tech Stack:** pnpm 12.16.1、TypeScript 6、NestJS 11、Prisma 6/PostgreSQL、Electron 44、React 19、HeroUI 3.2.7、Tailwind 4、Vitest/Supertest。复用现有 PizZip、archiver、cos-nodejs-sdk-v5、pg、zod，不新增依赖。

**Spec:** [Synapse Skill Hub 首版设计](../specs/2026-11-04-snap-skill-hub-design.md)。用户已要求进入下一步；本轮编制计划，不执行下列实现任务。

## Global Constraints

- 只在 `/Users/liyang/Documents/code/github/Synapse` 的当前 `main` 开发；不得新建/切换分支、worktree、克隆副本。执行方式待用户选择，文首推荐不构成代理开发授权。
- 只做团队资产；零团队不能上传，一个团队自动确定，多个团队须明确选择一个；没有个人 owner、visibility 或跨团队共享。
- 创建者与维护者分开。创建者离职/禁用不隐藏资产；当前维护者仍须是有效团队成员；仅既有平台管理员可指派维护者及恢复。
- 单 Markdown/ZIP 上传，本地另收目录；完整重传才产生包版本；商店名称/介绍可编辑，包内 name/description 只读取新包，不能被商店资料替换。
- 只展示/下载/安装最新版。内部发布记录保留，无历史列表、选装、回滚、单版本删除或自动更新。
- 软删除保留条目、包、当前图标和内部版本；普通用户不可恢复；不提供永久删除或自动到期清除资产。
- 主文件最多 1 MiB，单附件最多 10 MiB，合计最多 50 MiB，最多 100 个附件，目录深度最多 8；上传压缩文件最多 50 MiB。准备句柄 30 分钟，未绑定云上传 24 小时，写回执至少保留 24 小时。
- 沿用隐藏项、运行 `.env` 与符号链接排除，根 `.env.example` 为例外；正文 token/Authorization 示例或 `.pem/.key` 文件名不构成发布硬阻断。
- `SKILL_HUB_COS_*` 与旧 Skill、Drive、Platform Media、Mail、Backup 桶分离，前缀 `skill-hub/`；备份必须覆盖实际对象字节。
- Web 只新增一个 Skill Hub 左侧菜单；内容区定制商店布局，控件/浮层保持 HeroUI 及现有浅色主题。桌面仍为 shadcn；System App、Dock、Workflow、Automation 不新增。
- 只公开 search/invoke；新 Hub 预计十项 capability/MCP 索引、一条声明式协议，另有 UI 私有安装操作和交接事件，须记入能力例外说明。
- 不启动开发服务、浏览器/Playwright、用户桌面应用、远端 CI、部署或生产数据库操作。实施后的本地隔离数据库/浏览器验收须取得明确授权；只用根命令启动应用。
- 每个实现任务按风险做回归，检查 diff 后用中文本地提交，只包含本任务文件，不 push。产品行为在实际实现时同步 RELEASE_NOTES_PENDING.md。

## Review Focus

1. 团队列表第一页只有一条但用户实际有多个团队：必须返回 multiple，不默认选中；Task 2、12 验证。
2. 用户在上传期间离队、被停用或被换下维护者：旧请求不能继续发布，团队资产不消失；Task 4、6、12 验证。
3. 数据库 dump 与图标替换/孤儿回收并发：备份引用的旧对象仍须有字节可恢复，软删除对象不被当孤儿；Task 3、5、12 验证。
4. 请求已提交但客户端断开，随后准备句柄过期或账号切换：原回执可查，不能换键重复创建或用新账号推断原请求失败；Task 4、6、7、12 验证。
5. 新包改变 name，原安装目录又有本地配置或存在同名其他来源：只对当前目标做可恢复切换，不遗留双份有效安装或覆盖其他来源；Task 8、12 验证。

## 文件边界与依赖

以下 Create 路径均为拟新增；Modify 路径已按当前源码核对。不要把文中拟新增符号误当成现有函数。

| 单元 | 位置与职责 | 任务 |
| --- | --- | --- |
| 公共契约/纯校验 | `shared/src/skill-hub-contracts.ts` 与独立 Node 包校验入口；浏览器入口不得引入 Node IO | 1 |
| 团队/数据模型 | `server/prisma/`、`server/src/skill-hub/`，资产归属、成员判断和团队选择 | 2 |
| 上传存储 | Hub 专属 storage/upload/maintenance，COS 配置、请求体与代理预算 | 3 |
| 领域操作 | Hub repository/service/controller，提交、回执、权限、指派、恢复 | 4 |
| 可恢复性 | `server/src/backup/`、Hub 对象恢复脚本和旧域退役隔离 | 5 |
| 本地准备与云客户端 | `desktop/app-capabilities/skill-hub/main/`，受管快照、账号隔离、HTTP 封装 | 6 |
| MCP/系统指南 | 同能力包 shared/dispatcher，既有 capability registry 与 Synapse Skill | 7 |
| 安装入口 | Hub prepared provider、声明式协议、现有 skill-installer 与原子安装核心 | 8 |
| 商店展示 | `dashboard/src/features/skill-hub/`、用户路由和左侧导航 | 9 |
| Web 维护 | 同功能目录的上传、资料、删除与结果恢复 | 10 |
| 管理端 | 团队详情内的资产区，指派和恢复 | 11 |
| 交付验证 | 隔离真实数据库/HTTP、三端链路、规则与发布说明 | 12 |

顺序：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12。三端依赖相同事务和契约，作为一个闭环计划执行，不拆成互不相干的项目。

---

### Task 1: 固定共享契约、包规范和双模块入口

**Files:** Create `shared/src/skill-hub-contracts.ts`、`shared/src/skill-hub-package-node.ts`、`shared/src/skill-hub-frontmatter.ts`、`shared/src/archive-package-node.ts`、`shared/scripts/build-skill-hub-contracts.mjs`、`shared/src/skill-hub-contracts.test.ts`、`shared/src/skill-hub-package-node.test.ts`。Modify `shared/package.json`、`shared/tsconfig.json`、`shared/src/index.ts`、`shared/src/package-entrypoint.test.ts`、`desktop/electron/services/install-package-utils.ts`。

**Interfaces:**

- 纯契约入口 `@synapse/shared/skill-hub-contracts` 导出 zod schema、`SKILL_HUB_LIMITS` 及所有 HTTP/桌面 DTO；Node 入口 `@synapse/shared/skill-hub-package-node` 导出包解析，不能从根 index 导出 Node 实现。
- `SkillHubTeamPage = {items: {id:string;name:string}[]; nextCursor:string|null; selectionState:'none'|'single'|'multiple'; defaultTeamId:string|null}`。
- `SkillHubDetail` 固定包含 `id,team:{id,name},displayName,displayDescription,iconUrl:string|null,package:{name,description},currentVersion:{id,number,contentFingerprint,archiveSha256},revision,createdBy,maintainer,permissions:{canEditMetadata,canPublishVersion,canDelete}`；iconUrl 仅为服务端构造的鉴权 API 地址，无图标时为 null，由 UI 显示统一默认图标。不含 storageKey 或凭据。
- `SkillHubCreateInput = {teamId,packageUploadId,iconUploadId?,displayName,displayDescription,requestId}`；`SkillHubPublishInput = {packageUploadId,expectedVersionId,requestId}`；`SkillHubUpdateInput = {expectedRevision,requestId,displayName?,displayDescription?,iconUploadId?:string|null}`；删除/治理使用 `{expectedRevision,requestId}`，指派另含 `maintainerUserId`。
- `SkillHubReceipt` 固定为 action/requestId/status/resultAccessible/有权时的 result，status 只用 committed/not_found；outcome 使用 created/published/unchanged/updated/deleted。
- `SkillHubListInput = {teamId?,createdByMe?,query?,cursor?,limit?}`，`SkillHubPage = {items:SkillHubDetail[];nextCursor:string|null}`（列表可投影为不含长介绍的 summary，但字段来源和权限不变）；`SkillHubRevisionInput = {expectedRevision:number;requestId:string}`；`SkillHubReceiptInput = {action:四种写入 action;requestId:string}`。
- `SkillHubWriteResult = {skill:SkillHubDetail;outcome:'created'|'published'|'unchanged'|'updated'}`；`SkillHubDeleteResult = {id:string;revision:number;deletedAt:string;outcome:'deleted'}`。`SkillHubPreparedSource = {preparedSourceId:string;team:{id,name};expiresAt:string;package:{name,description};manifest:{path,size,sha256}[];contentFingerprint:string;summary:检查/排除结果}`，不含文件字节。
- `SkillHubAdminRow` 为 `{id,team:{id,name},displayName,packageName,createdBy,maintainer,currentVersionNumber,revision,deletedAt:string|null}`，不含正文/对象 key；`SkillHubAdminPage = {items:SkillHubAdminRow[];nextCursor:string|null}`。createdBy/maintainer 的公共人员结构统一为 `{id:string|null;displayName:string}`，maintainer 另含 `isActiveMember:boolean`。
- `SkillHubMcpCreateInput = {teamId,preparedSourceId,displayName?,displayDescription?,iconPath?,requestId}`；`SkillHubMcpPublishInput = {skillId,preparedSourceId,expectedVersionId,requestId}`。MCP 资料更新以 iconPath 替代云端 iconUploadId，其他字段同 SkillHubUpdateInput；客户端负责转换为 HTTP 契约，不让 AI 猜 uploadId。
- 同名导出 `skillHubTeamPageSchema / skillHubDetailSchema / skillHubCreateInputSchema / skillHubPublishInputSchema / skillHubUpdateInputSchema / skillHubRevisionInputSchema / skillHubReceiptSchema / skillHubPreparedSourceSchema`，其余输入/结果按相同规则命名。标识符与字段均为拟新增契约，时间用 UTC ISO 字符串，版本/修订号为正安全整数。
- `inspectHubSkillPackage(input:{format:'markdown'|'zip';bytes:Uint8Array}): SkillHubInspectedPackage`；返回包内名称/介绍、最终文件字节/清单、主文件、内容指纹及排除摘要，内部字节不进入 HTTP DTO。`fingerprintHubFiles(files):string` 使用 UTF-8 路径字节顺序，对 `[path,size,sha256]` 数组 JSON 求 SHA-256，前缀 `sha256:`。

- [ ] **Step 1 — 写失败断言。** 合法中文商店名称与包名共存，旧 visibility/teamIds/ownerId 被 strict schema 拒绝；同内容不同 ZIP 顺序/时间戳得到相同指纹，附件一字节变化则不同。覆盖单 Markdown、单外包目录、100/101 个附件、1/10/50 MiB 边界、重复/穿越/大小写/Unicode 等价路径、符号链接、非 UTF-8 和加密包。
  ```ts
  expect(inspectHubSkillPackage(zipA).contentFingerprint).toBe(inspectHubSkillPackage(zipB).contentFingerprint)
  expect(() => inspectHubSkillPackage(zipWithTraversal)).toThrow()
  expect(skillHubCreateInputSchema.safeParse({...validCreate, visibility:'public'}).success).toBe(false)
  ```
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/shared test src/skill-hub-contracts.test.ts src/skill-hub-package-node.test.ts`；预期新契约/函数尚未存在导致失败。
- [ ] **Step 3 — 实现接口。** 显示名称 1–100 个 Unicode 码点、商店介绍 1–2000，按现有 Skill 名称规则校验包名（1–64、小写字母/数字/连字符、拒绝 Windows 保留名），不静默 slugify。主文件只解析顶层 name/description，支持现有单/双引号及折叠/字面多行形式，其他 frontmatter 原字节保留；重复关键字段或无法可靠读取的关键类型明确拒绝。仅将 install-package-utils 的通用解析函数移到独立 archive-package-node 入口并在旧文件重导出，旧 materializeEntries 及调用签名/调用者 budgets 保留；工作流不能依赖 Hub 业务校验。Hub wrapper 识别目录条目但不物化，使用 2000 条目/200 目录/8 层/10 秒解析预算。CJS 构建沿用共享包既有的相对 import 重写模式，覆盖 contracts、frontmatter、archive、Hub codec 四个节点，新入口与 d.cts 均实际生成；不得让服务端 require ESM，也不得将整个旧安装工具链重构。
- [ ] **Step 4 — 运行绿灯。** 上述共享测试、`pnpm --filter @synapse/shared typecheck`；另跑 `pnpm --filter @synapse/desktop test electron/services/__tests__/workflow-package-service.test.ts`，确认提取通用 ZIP 代码没有改变旧调用行为。entrypoint 测试分别 import/require 新入口，纯契约不含 node: 导入。
- [ ] **Step 5 — 提交。** 只暂存本任务文件，中文摘要 `feat: 定义团队 Skill Hub 契约和安全包校验`。

### Task 2: 团队资产模型与“本人团队”接口

**Files:** Create `server/prisma/migrations/20261104010000_skill_hub/migration.sql`、`server/src/skill-hub/skill-hub.module.ts`、`skill-hub.repository.ts`、`skill-hub-team.service.ts`、`skill-hub-team.controller.ts`、`skill-hub-team.service.spec.ts`、`skill-hub-schema.spec.ts`（后六项均在 `server/src/skill-hub/`）、`server/src/team/team-resource-lock.ts`。Modify `server/prisma/schema.prisma`、`server/src/team/team.module.ts`、`server/src/team/team.service.ts`、`server/src/team/team.service.spec.ts`、`server/src/app.module.ts`、`server/src/app.module.spec.ts`。

**Interfaces:** `SkillHubTeamService.listForUser(userId,{cursor?,limit?}):Promise<SkillHubTeamPage>`；`resolveUploadTeam(userId,requestedTeamId?):Promise<{id,name}>`；`withTeamResourceLock(tx,teamId):Promise<void>`，供成员移除、团队删除和所有 Hub 写入共用。

- [ ] **Step 1 — 写失败断言。** 夹具含零团队用户、单团队用户、同时属于两团队的用户及一个无关团队。`limit:1` 仍得 multiple/defaultTeamId:null；其他用户团队不返回；单团队自动目标；多团队不指定报选择错误。模型断言禁止个人 owner/visibility，User 删除不级联资产，Team 外键 RESTRICT（包括软删除资产）。
  ```ts
  const page = await teams.listForUser(twoTeamUserId,{limit:1})
  expect(page.items).toHaveLength(1)
  expect(page.selectionState).toBe('multiple')
  expect(page.defaultTeamId).toBeNull()
  ```
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/server test src/skill-hub/skill-hub-team.service.spec.ts src/skill-hub/skill-hub-schema.spec.ts`。
- [ ] **Step 3 — 实现接口。** 新建 SkillHubSkill、SkillHubVersion、SkillHubUpload、SkillHubObject、SkillHubWriteReceipt 五类表；teamId 不可空，User 引用 SET NULL 并留贡献者显示快照。Skill 的当前版本指针须通过组合约束保证版本属于自身，编号 `(skillId,number)` 唯一。Upload 记录上传者/团队/用途/过期/ready/bound 状态，Object 逐项记录受管 key、大小、hash 和清理重试；回执按不可变 actorKey/action/requestId 唯一，actorKey 不因 User 引用失效改变。创建/发布回执与资产关联并保留其唯一请求标识，不能在 24 小时后清理而允许重复创建；其他写回执至少保留 24 小时。查询直接按 TeamMembership.userId 过滤，同一一致性读取产生当前页与零/单/多分类，不借管理员或站内信接口。UserAuthGuard 保护新 GET teams；普通团队查询不返回邮箱/成员。团队删除先取得团队资源锁并检查所有 Hub 资产，存在即明确拒绝，不新增资产迁移功能；成员移除参与同一锁，保持其他团队功能语义。
- [ ] **Step 4 — 运行绿灯。** 上述测试及 `pnpm --filter @synapse/server test src/team/team.service.spec.ts src/app.module.spec.ts`；`pnpm --filter @synapse/server exec prisma validate` 和 `prisma:generate`。迁移的真实 FK/删除验证留 Task 12 的隔离库，不对当前业务库运行 migrate。
- [ ] **Step 5 — 提交。** `feat: 建立团队 Skill 资产模型并提供本人团队查询`。

### Task 3: 完整上传、独立存储与有界回收

**Files:** Create `server/src/skill-hub/skill-hub-storage.ts`、`skill-hub-upload.service.ts`、`skill-hub-upload.controller.ts`、`skill-hub-maintenance.service.ts`、`skill-hub-log.ts`、`skill-hub-origin.ts` 及各自 `.spec.ts`。Modify `server/src/config/env.ts`、`env.spec.ts`、`server/.env.example`、`server/compose.yml`、`server/src/common/http-body-parser.ts`、其 spec、`server/nginx.conf`、`server/src/app.module.ts`、`server/src/deploy-config.spec.ts`、`server/README.md`、本模块装配。

**Interfaces:** `SkillHubStoragePort.put(key,bytes,contentType)`、`open(key):Promise<{stream,size}>`、`head(key):Promise<{size,sha256}|null>`、`remove(key)`；`SkillHubUploadService.stage(userId,{teamId,purpose:'package'|'icon',format?,fileName?,requestId},stream,signal):Promise<{uploadId,expiresAt,packageInfo?}>`。生产 COS、测试/本地独立根实现同一 port，不复用 Drive 目录/配额。`pruneUnboundUploads(now):Promise<{processed,retried}>` 不扫描或删除 bound 上传。

`assertHubWriteOrigin(request,appPublicUrl):void` 仅在 UserAuthGuard 已成功之后调用；合法 Bearer 沿桌面请求，不要求浏览器 Origin，Cookie 写请求须精确匹配可信 Origin。上传和 Task 4 的所有普通写入共用，不改变其他模块认证。

- [ ] **Step 1 — 写失败断言。** 缺失/谎报 Content-Length、流中途断开、实际超 50 MiB、伪扩展名、跨账号/团队上传、部分 COS 写入失败；PNG 尺寸正确但 chunk/CRC/解压结构损坏仍拒绝。Cookie 跨站上传拒绝；路由大小写变体同样执行鉴权/限额/日志保护。新旧业务桶相同拒绝；软删除/内部版本引用的对象永不进入清理；回收失败保留 key 以重试。测试 `keeps_bound_soft_deleted_objects` 的断言为 `expect(await storage.head(boundObjectKey)).not.toBeNull()`。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/server test src/skill-hub/skill-hub-upload.service.spec.ts src/skill-hub/skill-hub-storage.spec.ts src/skill-hub/skill-hub-maintenance.service.spec.ts src/skill-hub/skill-hub-origin.spec.ts src/skill-hub/skill-hub-log.spec.ts`。
- [ ] **Step 3 — 实现接口。** POST uploads 使用原始流、teamId/purpose/format 等受校验元数据，不用大 JSON/Base64。先认证、Cookie 同源检查并校验团队，再按已读字节计费和取消；拒绝非 identity Content-Encoding，上传硬截止 120 秒，包校验在可终止 worker 中，最多两个同时校验任务、最多 16 个等待任务，满时返回可重试忙状态。用 Task 1 解析后，现有 archiver 输出标准 ZIP，存 archive/main 派生对象及 manifest，上传全部完成才 ready；预登记每个将写 key，失败保留可回收记录。图标入口按下文实现细化接受客户端规范化 PNG。只为 Hub uploads 配置 50 MiB Nginx 接收预算，JSON 仍为原有 1 MiB；日志只记固定路由/结果，不含查询、正文、包名、凭据，路径分类与反代规则覆盖 Express 实际接受的大小写变体。SKILL_HUB_COS 四项完整校验并与所有旧/现有业务桶隔离；生产缺失阻止就绪，不读旧桶兜底。未绑定上传 24 小时过期，后台有界批次只回收无引用对象并重试失败。
- [ ] **Step 4 — 运行绿灯。** 重跑 Step 2 五项专项，再运行 `pnpm --filter @synapse/server test src/config/env.spec.ts src/common/http-body-parser.spec.ts src/deploy-config.spec.ts`；实际代理配置与 parser 限制都断言，不只测试 Service。
- [ ] **Step 5 — 提交。** `feat: 支持团队 Skill 完整包上传和独立存储回收`。

### Task 4: 发布事务、维护权限、回执和管理员治理 API

**Files:** Create `server/src/skill-hub/skill-hub.service.ts`、`skill-hub.controller.ts`、`skill-hub-admin.service.ts`、`skill-hub-admin.controller.ts` 及对应 `.spec.ts`。Modify `server/src/skill-hub/skill-hub.repository.ts`、`server/src/skill-hub/skill-hub.module.ts`、`server/src/team/team-resource-lock.ts`；沿 Task 3 的同源 helper，不另造一套。既有账号停用更新天然取得 User 行写锁，Hub 在自身事务中锁定并复验该行，不为本任务改造全局管理员服务。

**Interfaces:** 身份始终由 guard 传 userId，不接受外部 owner。以下为 `SkillHubService` 的拟新增签名：

```ts
list(userId:string, input:SkillHubListInput):Promise<SkillHubPage>
get(userId:string, skillId:string):Promise<SkillHubDetail>
create(userId:string, input:SkillHubCreateInput):Promise<SkillHubWriteResult>
publish(userId:string, skillId:string, input:SkillHubPublishInput):Promise<SkillHubWriteResult>
update(userId:string, skillId:string, input:SkillHubUpdateInput):Promise<SkillHubWriteResult>
softDelete(userId:string, skillId:string, input:SkillHubRevisionInput):Promise<SkillHubDeleteResult>
getReceipt(userId:string, input:SkillHubReceiptInput):Promise<SkillHubReceipt>
openLatest(userId:string, skillId:string, expectedVersionId?:string):Promise<{stream:NodeJS.ReadableStream;size:number;sha256:string;versionId:string}>
openMain(userId:string, skillId:string, expectedVersionId?:string):Promise<{content:string;versionId:string}>
openIcon(userId:string, skillId:string):Promise<{stream:NodeJS.ReadableStream;size:number;contentType:'image/png'}>
```

`SkillHubAdminService.list({teamId,deleted,cursor?,limit?}):Promise<SkillHubAdminPage>`；`assignMaintainer(adminActor,skillId,{maintainerUserId,expectedRevision,requestId}):Promise<SkillHubAdminRow>`、`restore(adminActor,skillId,{expectedRevision,requestId}):Promise<SkillHubAdminRow>`。用户 API 和三条管理员 API 与规格 §9 一致；不存在 GET versions 或旧包路径。

- [ ] **Step 1 — 写失败断言。** v1 创建/v2 完整更新、相同包 unchanged、同键不同摘要冲突、相同键结果复用；成员只能读、维护者才能写。Cookie 写入的跨站/缺少 Origin 被拒，可信同源通过，合法桌面 Bearer 不要求浏览器 Origin。维护者离队/停用时资产仍可见；管理员指派本团队成员后新维护者可写、旧维护者不可写。软删除拒绝普通读，管理员恢复保持原 ID/当前包，当前包字节损坏时恢复失败。准备句柄已失效也能用 requestId 查已提交回执；回执无权展开时不返回资料。
  ```ts
  expect(await hub.get(memberId,skillId)).toMatchObject({team:{id:teamId}})
  await expect(hub.publish(formerMaintainerId,skillId,input)).rejects.toMatchObject({code:'HUB_NOT_AVAILABLE'})
  expect(await hub.getReceipt(originalActorId,receiptInput)).toMatchObject({status:'committed'})
  ```
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/server test src/skill-hub/skill-hub.service.spec.ts src/skill-hub/skill-hub.controller.spec.ts src/skill-hub/skill-hub-admin.service.spec.ts src/skill-hub/skill-hub-admin.controller.spec.ts`。
- [ ] **Step 3 — 实现接口。** 上传/对象 IO 不放进提交事务；短事务按统一团队→有效用户→Skill 顺序锁定，最终重验成员/维护者/版本并消费 ready 上传，更新指针及回执原子完成。发布只改包相关字段和 revision，不能覆盖其他资料；包 name 变化允许。账号状态在提交前重验并通过用户行锁协调停用。读取加入成员条件并在分页前过滤，不能按创建者状态过滤。softDelete 只标记且保留引用；restore 先在事务外按保存 hash 实际校验所需字节，再以原 revision 提交，不能仅凭对象存在就称完整；不恢复离队维护者写权。openLatest 的 expectedVersionId 仅能匹配 current，不接受历史选择。not_found 回执不宣称操作失败，幂等重放不能再次删除已恢复条目。Hub Cookie 写入口对 APP_PUBLIC_URL 的精确 Origin 做同源保护（上传也适用），跨站/缺失拒绝；先正确区分已验证 Bearer 与 Cookie，不扩大其他模块。AdminAuthGuard 独立，管理员仅治理，不派生包下载/MCP 权限。
- [ ] **Step 4 — 运行绿灯。** 上述测试加 `pnpm --filter @synapse/server typecheck`；Task 12 再以真实 PostgreSQL 检验并发事务，不能把 mock 锁写成已验证竞态。
- [ ] **Step 5 — 提交。** `feat: 实现团队 Skill 发布、维护交接与可恢复软删除接口`。

### Task 5: 新域字节备份、恢复工具与退役隔离

**Files:** Create `server/src/skill-hub/skill-hub-backup.service.ts`、`skill-hub-gc-fence.ts` 及其 `.spec.ts`、`server/scripts/restore-skill-hub-objects.cjs`。Modify `server/src/backup/backup-package.ts`、`backup.service.ts`、`backup.module.ts`、`backup.service.spec.ts`、Task 3 maintenance、`server/scripts/retire-cloud-skills.cjs`、`server/src/cloud-skills-retirement.spec.ts`、`server/src/deploy-config.spec.ts`、`deploy.sh`、`server/README.md`、`docs/agents/repository-guide.md`。

**Interfaces:** `SkillHubBackupService.withObjectRetention<T>(job:()=>Promise<T>):Promise<T>`、`exportObjects(directory,signal):Promise<{manifestPath,objectDirectory}>`；共享 GC fence 在数据库 dump 前取得，在字节复制后释放。恢复 CLI 读取 Hub manifest，支持 `--dry-run`，仅允许 `skill-hub/` key 和归档内部相对路径；不支持删除目标桶。

- [ ] **Step 1 — 写失败断言。** 备份包含正常/软删除/内部版本的真实对象字节；图标在 dump 后被替换，原对象仍能随备份恢复；损坏 hash、缺字节、越界路径/桶拒绝恢复。旧 v1 无 Hub 备份仍可识别；旧退役脚本配置为新桶时在任何删除前拒绝。测试 `restores_icon_replaced_during_dump` 使用真实临时文件，断言 `expect(await readFile(restoredIconPath)).toEqual(originalIconBytes)`。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/server test src/skill-hub/skill-hub-backup.service.spec.ts src/skill-hub/skill-hub-gc-fence.spec.ts src/backup/backup.service.spec.ts src/cloud-skills-retirement.spec.ts`。
- [ ] **Step 3 — 实现接口。** 在现有 tar 内增加 Hub manifest 和对象字节目录，manifest schema v2 明确 Hub objectsIncluded，继续标明旧 Drive/Media 只有清单，不改变它们的保真承诺。GC 与备份共用受超时/取消约束的数据库锁：备份先围住物理回收，再 dump，枚举并复制所有已完整写入的 ready/bound/delete-pending 对象（包括期间解除引用的旧图标），最后释放；临时不完整对象不备份，发布可继续。这样 dump 引用对象不会被并发 GC 删掉；GC 不在锁外偷偷删除。恢复逐对象校验 sha/size，先确认字节再恢复业务可用状态。新 COS env 透传部署且旧清理只作用旧前缀；为 Hub 桶加入旧清理排除保护。只修改脚本，不执行部署或旧数据清理。
- [ ] **Step 4 — 运行绿灯。** 上述测试及 `pnpm --filter @synapse/server test src/deploy-config.spec.ts`。用临时目录/注入存储做字节往返，不连接真实 COS；生产跨桶恢复验收留到另行授权发布阶段。
- [ ] **Step 5 — 提交。** `feat: 为团队 Skill 包提供字节备份和安全恢复边界`。

### Task 6: 桌面云客户端、账号隔离和受管准备快照

**Files:** Create `desktop/app-capabilities/skill-hub/main/cloud-client.ts`、`package-service.ts`、`package-worker.ts`、`service.ts`、`icon-source.ts` 及 `main/__tests__/cloud-client.test.ts`、`package-service.test.ts`、`service.test.ts`、`icon-source.test.ts`；Create `desktop/electron/runtime/data-repo/schemas/skill-hub.ts`。Modify schema index 与 `desktop/electron/bootstrap/descriptors.ts`。

**Interfaces:** `SkillHubCloudClient` 封装 Task 4 全部普通 API，构造注入 `AccountService.fetchAuthenticated/getState/onBeforeIdentityChange`，每次实际请求使用同一 accountScope。`HubPackageService.prepare(input:{sourcePath,teamId?},context):Promise<SkillHubPreparedSource>`、`readPrepared(id,context)`、`release(id,context)`；`SkillHubService.create/publish` 将 preparedSourceId 变成 uploads→发布，不向模型透传文件字节。`getReceipt(action,requestId,context)` 不依赖准备句柄。

- [ ] **Step 1 — 写失败断言。** 零团队/未选多团队时没有文件读取；单团队自动绑定；源目录准备后变化不影响快照，重新准备才反映变化。账号切换发生在认证刷新/上传中时取消并失效句柄，不用新账号重发；未知结果重启后仍可查原账号回执。实例保留 `.env`，发布快照排除 `.env`，且未读取排除文件正文。测试 `does_not_read_source_without_team` 对注入的来源读取 spy 断言 `expect(readSource).not.toHaveBeenCalled()`。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/desktop test app-capabilities/skill-hub/main/__tests__/cloud-client.test.ts app-capabilities/skill-hub/main/__tests__/package-service.test.ts app-capabilities/skill-hub/main/__tests__/service.test.ts`。
- [ ] **Step 3 — 实现接口。** 用户路径经 existing externalAssetPath/openExternalAsset 等基础设施、PermissionGuard 和 AuditSink，保留 MCP actor。使用 Task 1 校验器及现有 PizZip 在 Worker 中打包；临时快照用 ManagedAssetStore，`app.skill-hub.prepared-sources` 和必要的写入意图记录用 DataRepository、schemaVersion 1、local-only。准备记录只存 assetKey/清单/指纹/账号代次/团队/调用者/30 分钟过期；启动后后台回收，不阻塞窗口。写入意图保留 action/requestId 与目标，未知结果仅查回执，不自动重新发布。上传有硬取消，超时与服务端冲突返回结构化错误。默认服务端基址来自 AccountService，不收任意 URL/token。图标用 Electron nativeImage 真正解码/规范化，见实现细化。
- [ ] **Step 4 — 运行绿灯。** 上述测试及 `pnpm --filter @synapse/desktop test electron/runtime/data-repo/__tests__/schemas.test.ts app-capabilities/skill-hub/main/__tests__/icon-source.test.ts`；检查无新业务 fs.writeFile、导出单例、原始 webContents.send 或网络绑定。
- [ ] **Step 5 — 提交。** `feat: 支持 AI 在本地准备团队 Skill 并安全上传`。

### Task 7: 十项 MCP、工具发现和完整系统 Skill 指南

**Files:** Create `desktop/app-capabilities/skill-hub/shared/capability.ts`、`desktop/app-capabilities/skill-hub/shared/schema.ts`、`desktop/app-capabilities/skill-hub/shared/ipc-result.ts`、`desktop/app-capabilities/skill-hub/main/dispatcher.ts`、`desktop/app-capabilities/skill-hub/main/__tests__/dispatcher.test.ts`、`desktop/app-capabilities/skill-hub/shared/__tests__/capability.test.ts`、`desktop/app-capabilities/synapse-skill/skill-package/skill-hub/index.md`、`desktop/app-capabilities/synapse-skill/skill-package/skill-hub/api-reference.md`。Modify `desktop/synapse-capabilities/shared/registry.ts`、`desktop/synapse-capabilities/shared/__tests__/registry.test.ts`、`desktop/electron/capabilities/action-router.ts`、`desktop/electron/bootstrap/descriptors.ts`、`desktop/app-capabilities/synapse-skill/skill-package/SKILL.md`、`docs/agents/capability-registry.md`、`docs/agents/module-boundaries.md`。

**Interfaces:** `SKILL_HUB_DOMAIN`、`SKILL_HUB_MCP_TOOL_ACTIONS`、`buildSkillHubTools()`、`createSkillHubCapabilityDispatcher({service,permissionGuard,auditSink})`；只发布规格的十个 canonical action，不新增 MCP server 或第三个 tools/list 工具。既有 `app_account_state_get/app_account_login_start` 直接复用。

- [ ] **Step 1 — 写失败断言。** search 可找到本人团队/上传/回执等意图；十项 schema 顶层均普通对象、分页字段与返回契约一致；invoke 的 actor/accountScope 不丢失，普通用户不能调用管理员指派/恢复，也不接受 ownerId、visibility、teamIds 或 token。测试 `exposes_exactly_ten_hub_tools` 断言 `expect(buildSkillHubTools()).toHaveLength(10)`，另检查逐项 inputSchema.type 为 object。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/desktop test app-capabilities/skill-hub/main/__tests__/dispatcher.test.ts app-capabilities/skill-hub/shared/__tests__/capability.test.ts synapse-capabilities/shared/__tests__/registry.test.ts`。
- [ ] **Step 3 — 实现接口。** 在既有 Action Router 声明式 domain 分发及 ServiceRegistry 中接入；不要在 runtime 基础设施引入业务服务。十项工具名称/输入只从 shared 单一语义源生成。系统指南写清 search→账号→团队分页分类→准备→发布→结果/回执→后续更新，逐步骤给参数/返回和无团队/多团队/旧端/网络未知的处理；不能建议读取账号库、拿管理员凭据或 curl 私有 token。新包名/介绍只读，商店字段可维护。同步数量和团队资产长期边界，保留旧云 Skill 域不兼容说明。
- [ ] **Step 4 — 运行绿灯。** 上述测试与 `pnpm --filter @synapse/desktop run check:hard-constraints`；实测 buildAllMcpTools 与索引增量恰为 10，公开 MCP 工具仍只有 search/invoke。
- [ ] **Step 5 — 提交。** `feat: 为 AI 提供团队 Skill Hub 完整 MCP 操作链路`。

### Task 8: 网页唤醒、Hub 安装来源及名称变更的安全重装

**Files:** Create `desktop/app-capabilities/skill-hub/shared/manifest.ts`、`desktop/app-capabilities/skill-hub/main/prepared-source-provider.ts`、`desktop/app-capabilities/skill-hub/main/ipc.ts`、`desktop/electron/bootstrap/skill-hub-protocol-handlers.ts` 及对应 `__tests__`；Create `desktop/app-capabilities/skill-installer/renderer/hub-source-input.tsx`。Modify `desktop/app-capabilities/manifest-registry.ts`、`desktop/electron/bootstrap/app-ready.ts`、`desktop/electron/bootstrap/ipc-registry.ts`、`desktop/electron/modules/apps/ipc.ts`、`desktop/electron/services/system-app-window-service.ts`、`desktop/electron/preload.ts`、`desktop/src/types/bridge.ts`、`desktop/src/modules/apps/types.ts`、`desktop/src/modules/apps/system-app-window-app.tsx`、`desktop/src/modules/apps/components/system-app-content.tsx`、`desktop/app-capabilities/skill-installer/renderer/index.tsx`、`desktop/src/types/installers.ts`、`desktop/electron/services/editor-install-service.ts`、`desktop/electron/services/editor-install-core.ts`、`desktop/electron/services/editor-install-status-service.ts`、`desktop/electron/services/editor-adapters/skill-identity.ts`、`desktop/src/modules/installers/shared/shared-installer-flow.tsx`、注册表说明。

**Interfaces:** `HubInstallOpenRequest = {requestId:string;skillId:string}` 只能交给已有 skill-installer；manifest 只解析 `synapse://skill-hub/install?skillId=<id>`。`prepareLatestInstallSource({skillId},context):Promise<SynapseSkillInstallerSource>` 和 `releaseInstallSource({preparedSourceId},context)` 为 UI 私有 IPC，不增加 MCP；prepared provider 实现现有 PreparedContentInstallSourceProvider。来源身份 `skill-hub:<受信服务端标识>:<skillId>`，sourceFingerprint 映射云 contentFingerprint，repositoryVersion 映射 versionId。

- [ ] **Step 1 — 写失败断言。** 冷/热启动、未登录登录后重验、不同账号、离队、未知 Skill、重复参数/fragment/任意 URL/目标路径/旧版参数均覆盖。安装原包 name/description 与商店中文资料不同，实际写入必须来自包；伪造安装表单覆盖调用名称/介绍也被主进程拒绝。name 变化时原目录只替换当前选定目标，冲突/备份失败/切换失败恢复原目录，不留双份；其他安装位置和来源不动。测试 `moves_only_selected_same_identity_installation` 在切换后断言 `expect(existsSync(oldPath)).toBe(false)`，并实际读取新目录的 SKILL.md 确认新 name 与原始 description。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/desktop test app-capabilities/skill-hub/main/__tests__/prepared-source-provider.test.ts electron/bootstrap/__tests__/skill-hub-protocol-handlers.test.ts electron/services/__tests__/editor-install-core-installer-source.test.ts`。
- [ ] **Step 3 — 实现接口。** 通过声明式 protocolRoutes/mainHandlerId 打开现有 skill-installer，扩展既有系统窗口 open options 和 UI 私有交接事件，不创建新 System App。冷启动参数消费后移除，待处理目标仅内存；账号变更取消旧准备。Renderer 的 HubSourceInput 只读 ID、调用窄 IPC 并将来源交 SharedInstallerFlow，不做网络/FS。Hub 来源的调用名称/介绍只读，主进程也拒绝安装表单把它们覆盖成其他值，其他安装来源的既有行为不变。新安装身份允许明确 Hub kind，旧 `.synapse.repository.json` 仍排除。UI 展示已安装/本次版本；同版本重装、不同版本内容相同、来源未知及同名冲突沿用既有流程。包名变化要在现有安装核心集中做目标选择、受控备份、写入验证和切换；不能新建并行安装器或改写商店字段到包内。网络与包准备失败保持现有安装，不执行 Skill 脚本。
- [ ] **Step 4 — 运行绿灯。** 上述测试及 `pnpm --filter @synapse/desktop test electron/services/__tests__/editor-install-service-path-security.test.ts electron/services/__tests__/editor-install-service-security.test.ts electron/services/__tests__/editor-install-status-service.test.ts src/modules/installers/shared/__tests__/shared-installer-flow.test.tsx`；运行 `generate:ipc`、`check:ipc-codegen`、`typecheck`、`check:hard-constraints`。需要正式包验证时运行既有 check:packaged-asar；若缺正式产物如实记录，不能为检查擅自发版。
- [ ] **Step 5 — 提交。** `feat: 支持从团队 Skill Hub 唤醒现有安装器并安全重装`。

### Task 9: HeroUI 商店目录、只读详情与左侧入口

**Files:** Create `dashboard/src/features/skill-hub/skill-hub-api.ts`、`use-skill-hub.ts`、`index.tsx`、`skill-detail.tsx`、`skill-catalog-item.tsx`、`skill-main-view.tsx`、`skill-catalog.test.tsx`、`skill-detail.test.tsx`；Create `dashboard/src/routes/_authenticated/skill-hub/index.tsx`、`$skillId.tsx`。Modify `dashboard/src/components/layout/navigation.ts`、`dashboard/src/components/layout/navigation.test.ts`、`dashboard/src/routeTree.gen.ts`（由既有路由生成器生成）、`dashboard/DESIGN.md`、`dashboard/CLAUDE.md`（仅 Hub 定制边界）。旧路径回归使用现有 `dashboard/src/routes/-retired-content-routes.test.ts`，不无故改写。

**Interfaces:** `skillHubApi` 通过唯一 api-client.requestJson 调 teams/list/get/main/download/receipt；HTTP 文件请求同样复用集中客户端认证和错误，不在组件散落 fetch。`useSkillHubCatalog({teamId?,createdByMe?,query,cursor?})`、`useSkillHubDetail(skillId)` 的缓存键包含登录会话和团队/筛选，返回只读 DTO 及必要状态。

- [ ] **Step 1 — 写失败断言。** 沿现有 cloud-table-dialogs.test.tsx 的 jsdom/React act 测试方式，不增加测试库。左侧只有一个 Skill Hub、详情路径选中、登录回跳和返回保留筛选；多团队聚合只显示本人团队、离队/换号晚响应不回填。详情分别展示商店资料与只读包内信息，无版本管理/私有公开控件；发出协议请求只能显示“已尝试打开 Synapse”，不能显示安装成功。测试 `keeps_latest_only_detail` 断言 `expect(root.textContent).not.toContain('历史版本')` 并检查只有说明/文件两个页签。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/dashboard test src/components/layout/navigation.test.ts src/features/skill-hub/skill-catalog.test.tsx src/features/skill-hub/skill-detail.test.tsx`。
- [ ] **Step 3 — 实现接口。** 先读取 heroui-react 组件文档并核对本地 3.2.7；保持现有浅色主题、Inter、标准组件尺寸和语义 token。目录为轻分隔图文条目、宽屏两至三列/中屏减列/窄屏单列，独立名称链接与安装按钮。页首为标题/团队筛选/搜索/上传，“我上传的”只过滤创建者。详情为商店头部、当前版本/团队/贡献及维护信息、说明/文件；安全只读 Markdown 不启动 MDX 或外部图片请求。加载 Skeleton、无团队/空/错状态各自准确，不加入营销、榜单或装饰色。
- [ ] **Step 4 — 运行绿灯。** 上述测试、`pnpm --filter @synapse/dashboard run check:ui`；先以 `pnpm --filter @synapse/dashboard exec vite build` 运行现有 Router 插件生成新 routeTree，再运行 `pnpm --filter @synapse/dashboard run tsc`，避免先 tsc 时新路径尚未生成。运行 `pnpm --filter @synapse/dashboard test src/routes/-retired-content-routes.test.ts` 确认旧云路径仍退役。此步只断言交互和结构，不声称视觉验收已完成。
- [ ] **Step 5 — 提交。** `feat: 新增 HeroUI 团队 Skill Hub 商店和只读详情`。

### Task 10: Web 上传、资料维护、软删除与未知结果恢复

**Files:** Create `dashboard/src/features/skill-hub/skill-upload-dialog.tsx`、`skill-metadata-dialog.tsx`、`use-skill-publish.ts`、`skill-icon-input.tsx`、`skill-upload.test.tsx`、`skill-metadata.test.tsx`；Modify Task 9 API/hooks/详情。

**Interfaces:** `useSkillPublish({skillId?})` 统一管理团队选择、uploads→create/publish、稳定 requestId、版本/资料冲突和回执查验；`normalizeSkillHubIcon(file:File):Promise<Blob>` 输出受限 PNG；普通元数据只接受商店字段，不接受 teamId/name/description 的改写。

- [ ] **Step 1 — 写失败断言。** 零团队禁用、唯一团队回填、多团队明确选择；已有 Skill 更新不能改团队。伪装扩展名由服务器错误反馈，失败保留用户资料和同 requestId；网络未知查回执而非重复发。资料编辑不改包名称/介绍，软删除后没有用户恢复按钮；指令复制包含准确 Skill 引用/团队/当前版本但不含凭据或本地猜测路径。测试 `retains_publish_key_after_unknown_result` 捕获发布调用，断言 `expect(new Set(publishRequestIds).size).toBe(1)`。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/dashboard test src/features/skill-hub/skill-upload.test.tsx src/features/skill-hub/skill-metadata.test.tsx`。
- [ ] **Step 3 — 实现接口。** Modal/Header/Body/Footer 与团队 Select 沿 HeroUI 标准组合，长内容自然滚动。首次上传仅 MD/ZIP，图标按实现细化规范化；source bytes 与展示资料分开保存。上传新版使用原 versionId，不用刷新后的后台值覆盖正在编辑的草稿；冲突由用户重新读取。删除调用软删除契约，回执成功后读服务端列表；后续读取失败不把旧回执当最新状态插回列表。更新指令视商店文字为数据，不拼成高优先级指令。
- [ ] **Step 4 — 运行绿灯。** 上述测试及 `pnpm --filter @synapse/dashboard run check:ui`、`pnpm --filter @synapse/dashboard run build`；浏览器展开状态留 Task 12。
- [ ] **Step 5 — 提交。** `feat: 支持网页上传团队 Skill 和维护商店资料`。

### Task 11: 管理员指派与软删除恢复界面

**Files:** Create `dashboard/src/features/teams/team-skills.tsx`、`team-skill-maintainer-dialog.tsx`、`team-skills.test.tsx`。Modify `dashboard/src/features/teams/team-detail.tsx`、`dashboard/src/lib/api.ts`、相关团队页面测试。

**Interfaces:** adminApi 新增 `listTeamSkills(teamId,{deleted,cursor?})`、`assignSkillMaintainer(skillId,input)`、`restoreSkill(skillId,input)`，仅调用三条管理员端 API；候选来自已有管理员 listTeamMembers 的全部必要分页，筛选有效成员。

- [ ] **Step 1 — 写失败断言。** 候选不能只取第一页导致遗漏，禁用/非团队成员不可选；指派后当前维护者刷新、旧 revision 失败保留草稿；软删除条目可恢复，缺文件失败不消除删除标识；无资产团队删除仍保留原行为，有资产时报明确业务错误。测试 `loads_active_candidates_across_pages` 对已展开指派 dialog 断言 `expect(dialog.textContent).toContain(secondPageActiveHandle)`，禁用成员不在候选中。
- [ ] **Step 2 — 运行红灯。** `pnpm --filter @synapse/dashboard test src/features/teams/team-skills.test.tsx src/features/teams/teams-page.test.tsx`。
- [ ] **Step 3 — 实现接口。** 在既有团队详情添加资产区，不新增管理员左侧菜单。使用标准管理表格/表单，展示当前版本和删除状态，无正文读取/在线编辑/历史包功能；维护者与创建者分开。指派/恢复保持请求键、原 revision、加载和冲突语义；团队删除提示与服务端新保护一致，不替用户清理资产。
- [ ] **Step 4 — 运行绿灯。** 上述测试及 Dashboard check:ui/tsc；普通用户 API 客户端不得调用管理域，反向同样不拿管理员身份下载团队包。
- [ ] **Step 5 — 提交。** `feat: 支持管理员交接团队 Skill 维护权和恢复软删除资产`。

### Task 12: 完整链路、视觉验收、规则同步和交付

**Files:** Create `server/test/skill-hub.e2e.spec.ts`、`server/test/run-skill-hub-e2e.mjs`、`dashboard/src/features/skill-hub/skill-hub.browser.tsx`、`docs/testing/2026-11-04-skill-hub-validation.md`。Modify `server/package.json`、必要的既有 e2e 配置、`docs/agents/capability-registry.md`、`module-boundaries.md`、`repository-guide.md`、`docs/reference/editor-integration-matrix.md`（仅确有 Hub 来源/包名切换边界变化）、系统 Hub 指南及 `RELEASE_NOTES_PENDING.md`。

**Interfaces:** 在 server/package.json 新增 `test:skill-hub:e2e = node test/run-skill-hub-e2e.mjs`。runner 复用 `server/test/e2e-database-guard.mjs`，仅接收本机且库名以 `_e2e` 结尾的 `SKILL_HUB_E2E_DATABASE_URL`，拒绝业务库/远端 URL；Nest TestingModule + Supertest 临时测试实例使用真实 Prisma 事务及合成账号，不启动用户应用，不使用生产凭据。Web browser 测试复用既有 vitest.browser.config，不创建新的启动方式。

- [ ] **Step 1 — 写集成断言。** 真实 PostgreSQL 覆盖两次并发发布只成功一次、成员移除/停用/指派与发布串行、软删除恢复保留文件、team FK 保护、幂等唯一键/回执。测试 `serializes_two_updates_from_v1` 用 Promise.allSettled 发两次更新，断言成功结果长度为 1，`expect(await prisma.skillHubVersion.count({where:{skillId}})).toBe(2)`。AI 序列覆盖账号→团队（分页一条但多团队）→准备/上传/发布→回执→后续更新，正常请求真实通过 HTTP；不能把替代云存储、浏览器接口夹具或管理员认证夹具称为生产端到端实测。
- [ ] **Step 2 — 运行新增集成测试。** 仅在授权隔离本地数据库后，使用专用环境变量运行 `pnpm --filter @synapse/server run test:skill-hub:e2e`，保留发现的装配/行为失败再修复；若前面实现已使断言直接通过，如实记录，不人为制造失败。未获授权时保留此任务待验收，不改用当前业务库。测试数据库创建/迁移/清理都限 runner 自己的 `_e2e` 资源。
- [ ] **Step 3 — 补齐集成与验收。** 修复契约/装配差异，实测十项 MCP 可被 search/invoke 正确发现与执行；确认回执不是新任务队列，旧协议/工具仍不可用。用户明确允许启动和浏览器验收后，应用仅由根 `pnpm dev:server` / `pnpm dev:desktop` 启动，复用已运行实例；浏览器优先 bsk，无法满足时说明原因再用既有 Playwright 夹具。隔离页面夹具的自动验收命令为 `pnpm --filter @synapse/dashboard run test:browser src/features/skill-hub/skill-hub.browser.tsx`，按夹具测试如实归类。覆盖宽屏、平板、320px 的列表/详情、上传/团队选择/资料/删除/管理指派/恢复实际展开状态，记录截图和焦点/溢出。真实客户端冷/热深链及编辑器写入只用授权测试目录，不能覆盖用户真实全局 Skill；测试结束只清本次资源。
- [ ] **Step 4 — 运行最终最小充分验证。** shared test/typecheck；server Hub/Team/Backup/Env/退役专项、typecheck、build；desktop Hub/安装/注册表专项、typecheck、check:ipc-codegen、check:hard-constraints、build:electron；Dashboard Hub/团队/导航专项、check:ui、build。Node-only 新入口进入正式打包时还验 check:packaged-asar，缺产物不能标为通过。已有绿色检查无新变动不重复跑。报告逐项区分源码、单元、真实数据库/HTTP、浏览器、真实安装及未验收内容。
- [ ] **Step 5 — 提交与交付。** 发布说明写团队 Skill 发布/安装/资产交接等用户收益，不写路径和实现流水。核对 capability/MCP 实际增量 10、System App/Dock 无新增、1 条协议和 UI 私有 IPC/事件例外，规则与系统指南一致。最终本地提交只含本任务；不 push、不发版、不部署。交付总改动、验证证据、剩余验收、提交列表；回滚保留新数据/桶，不能通过删表或删对象回退。

## 实现细化及执行前提

1. 图标选择端接收 PNG/JPEG/WebP，浏览器/Electron 真正解码后统一成 256×256 PNG（原始文件最多 2 MiB，规范化后最多 1 MiB）。服务端 purpose=icon 只收 PNG，并独立校验签名、尺寸、PNG chunk/CRC 和有界解压结构，防止把任意文件当图片；复用现有头像/图片规则的可用部分，不新增图片解码依赖。原始输入格式与云端标准格式要在规格/API 文档中同时写清。
2. Task 1 的目录、ZIP 解析和 codec 类型不允许进入浏览器根入口；Task 3/6 分别用现有 archiver/PizZip 生成包，内容指纹相同不要求压缩字节相同。共享 CJS 生成脚本的测试要走真实 require，不能只看 tsc。
3. 纯本地准备句柄过期不妨碍回执查询；写入意图记录不保存文件正文/凭据，也不变成离线自动上传队列。更换账号或团队不得复用原操作身份重新发布。
4. 不在本轮调用任何实现测试命令、创建数据库/桶、执行迁移、启动应用或打开浏览器；本轮只交付计划。实施需要的本地隔离测试/真实 UI 操作授权与生产发布授权分开，已明确取得的授权不重复询问。

## 计划自查

- 规格 §1–4 → Tasks 1/2/4/11；§5 → 1/3/6；§6 → 4/6/12；§7 → 6/7/8/10；§8 → 9/10/11；§9 → 1/2/4/7；§10 → 3/4/5；§11–12 → 5/7/8/12。
- Review Focus 五项分别落实在所属任务及真实集成测试，未用源码断言代替并发/备份恢复/视觉验证。
- 共用 DTO、账号/团队绑定、版本指纹映射和十项 MCP 以 Task 1 与规格为单一来源；管理员与普通身份不互换。
- 本计划的代码片段是待编写的断言，不代表已运行或已通过。任务 checkbox 全部待执行。

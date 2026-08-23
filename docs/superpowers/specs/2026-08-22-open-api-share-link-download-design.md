# 开放 API 云盘分享链接临时下载设计

Date: 2026-08-22

Scope: `server/`、`dashboard/`、`document/`、`docs/agents/module-boundaries.md`、`RELEASE_NOTES_PENDING.md`

## 目标

基于现有用户 API 密钥提供第一个稳定的开放 API：调用方提交完整的 Synapse Drive 分享 URL，服务端返回一个十分钟有效的下载地址。

调用方不需要理解分享目标是文件、文件夹、网页、Drive Site 还是公开素材。服务端把不同目标统一转换为可下载制品：

- 单一文件目标下载原始文件；
- 包含多个文件的目标统一下载 ZIP；
- 文件夹始终按集合处理并下载 ZIP；
- Drive Site 页面包含 HTML 及其依赖资源，下载完整站点 ZIP；
- Site 中的单一非 HTML asset 和单一公开素材下载原始文件。

开放 API 的基础路径、版本、认证、scope、临时下载授权和扩展规则在本期固定，后续新增其它开放接口不迁移本接口。

## 已确认决策

- 对外基础路径固定为 `/api/open/v1`。
- 创建临时下载地址使用 `POST /api/open/v1/drive/share-links/downloads`。
- 返回的临时下载地址由服务端生成，调用方不得自行构造。
- 临时下载授权固定十分钟有效；该 Open API grant TTL 独立于普通 Drive 对象下载 TTL。
- 下载在过期前开始后允许继续完成；过期后不能开始新的下载。
- 临时下载 URL 是 bearer credential，下载时不再要求 API key header。
- API key、分享密码和临时下载 token 均不落明文、不进入日志和审计。
- 临时授权持久化到 PostgreSQL，服务重启不能导致有效地址提前失效。
- 返回统一 Synapse 下载地址，不把 COS presigned URL 固化为公开契约。
- API key 撤销、移除当前下载权限、用户禁用、分享/Site 停用或源资源删除会立即使临时地址不可用。
- 开发密钥创建时由用户显式勾选开放 API 权限；既有密钥不自动扩权。
- grant 在十分钟有效期内不限制下载次数，POST 和 GET 都不做 API key、IP、次数或频率限流。
- 每次有效的创建授权和下载请求持久化一条固定字段用量日志，ZIP 不逐文件记录。
- Synapse 分享链接保持现有 live view 语义；POST 创建 grant 时固定当时的当前文件版本，不固定分享创建时版本，也不提供历史版本选择器。
- 返回 opaque `snapshotId` 供审核结果关联本次输入快照，不暴露 DriveFileVersion id、版本号或 storage key。
- v1 不承诺 Range、断点续传、单次下载或下载完成确认。
- 制品形态遵循单一规则：单个物理文件返回原文件，多个文件或集合型目标返回 ZIP。
- 旧 `/api/drive/link-intake/*` 保持内部路径，不作为公开 alias。
- 本期不开放生产 CORS；长期 API key 只用于服务端、CLI 和自动化客户端。

## 链接类型与制品映射

制品类型先按目标基数判断：单个物理文件返回原文件；需要交付多个文件时统一返回 ZIP。文件夹属于稳定的集合语义，即使创建 grant 时只有一个文件或为空，也保持 ZIP，避免相同链接的响应类型随文件夹内容变化，并保留目录层级与空目录。Drive Site 页面需要同时交付 HTML 和同一 deployment 的依赖资源，因此也返回 ZIP。

| 输入链接 | 识别条件 | 下载制品 | 文件名 | `entryPath` |
|---|---|---|---|---|
| `/share/<shareId>` | 根目标是文件 | 原始文件 | 原文件名 | `null` |
| `/share/<shareId>` | 根目标是文件夹 | 根文件夹 ZIP | `<文件夹名>.zip` | `null` |
| `/share/<shareId>/items/<itemId>` | 指定目标是文件 | 原始文件 | 原文件名 | `null` |
| `/share/<shareId>/items/<itemId>` | 指定目标是文件夹 | 子文件夹 ZIP | `<文件夹名>.zip` | `null` |
| 独立 HTML 文件分享 | 普通 `/share` 文件 | 原始 HTML 文件 | 原文件名 | `null` |
| `/sites/<siteId>/` | Site 根 | 当前完整 deployment ZIP | `<站点名>.zip` | deployment 入口 HTML |
| `/sites/<siteId>/<path>` | 路径解析为 HTML | 当前完整 deployment ZIP | `<站点名>.zip` | 请求对应 HTML path |
| `/sites/<siteId>/<path>` | 路径解析为图片、CSS、JS 等非 HTML asset | 原始 asset | path basename | `null` |
| `/files/<assetId>` | 公开素材 | 原始文件 | 素材文件名 | `null` |

### HTML 处理原则

普通分享中的独立 HTML 文件按原始文件下载。该分享语义只承诺一个文件；接口不能猜测或附带未被分享的相邻资源。

Drive Site 的 HTML 页面按完整站点 ZIP 下载。HTML 通常依赖同 deployment 中的 CSS、JS、图片和其它页面，只下载 HTML 会得到不可用的离线内容。`entryPath` 告诉调用方解压后首先打开哪个页面。

Site 中明确指向非 HTML asset 的链接只下载该 asset，不打包整个站点。

### Markdown 处理原则

普通分享中的单个 Markdown 文件按原始文件下载，保留云盘原文件名，不仅因为扩展名是 `.md` 就额外套一层 ZIP。若 Markdown 需要连同相对图片或其它依赖交付，调用方应提交包含文档与资源的文件夹分享链接；文件夹按集合语义返回 ZIP，并保留原始目录层级和条目名。接口不得猜测或附带未被分享的相邻资源。

### 文件夹处理原则

文件夹在创建 grant 时完成归档预检并保存一份不可变 manifest，内容包括相对路径、目录项、对象引用和对象字节大小，不包含密码。下载时按 manifest 流式生成 ZIP，因此：

- 文件夹即使只有一个文件或为空也保持 ZIP；
- ZIP 条目使用云盘原始名称和目录层级，不为仅大小写不同的名称或同名文件/文件夹追加消歧后缀；
- entries 使用规范化相对路径按字典序稳定排序后分配 ordinal，保证 snapshotId 不受数据库返回顺序影响；
- grant 对应创建时看到的文件夹内容；
- 后续新增文件不会进入已有 grant；
- 归档不需要预先生成临时 ZIP 文件；
- 任一对象已不可用时，本次下载中断，不会把缺少文件的 ZIP 标记为成功；客户端必须丢弃截断文件。

空文件夹和空子目录必须保留在 ZIP 中。

ZIP 格式可以区分仅大小写不同的条目以及同 basename 的文件和目录。调用方若要完整落盘这类归档，必须使用能够区分这些路径的目标文件系统或直接按 ZIP entry 处理；服务端不得为了适配大小写不敏感文件系统而改写用户文件名。

## 与现有文件历史版本的关系

实际代码中的 `DriveShare` 只绑定 `DriveItem.itemId`，没有 `versionId`。现有分享读取与下载每次通过 `resolveShareBrowserCurrent` 找到 active DriveItem，再读取它当前的 `storageKey`。所以：

- 分享链接是实时入口，文档更新后重新访问分享会看到新版本；
- 分享创建时间不决定下载版本；
- Open API 不提供“选择某个历史版本下载”的能力。

`DriveFileVersion` 是 Synapse 文档历史版本表。`DriveItem.storageKey` 指向当前对象，`findCurrentDriveFileVersionId` 可以找到与该 storageKey 对应的当前 version。开放 API 在 POST 时执行一次固定：

1. 按现有分享规则解析当前 DriveItem；
2. 读取当时的 `storageKey`；
3. 查找匹配的 `DriveFileVersion`；若旧数据缺失记录，复用 `ensureCurrentDriveFileVersion` 补齐后再查询；
4. 把具体 version 与对象信息写入 grant entry；
5. 计算公开的 opaque `snapshotId`。

因此，一个 grant 下载的是“创建 grant 瞬间的当前版本”。之后文档继续编辑不会改变该 grant；重新 POST 会解析新的当前版本，并得到新的 snapshotId。

Site 不使用 DriveFileVersion 固定下载内容。发布时文件已复制到 deployment 专属 storageKey，grant 直接绑定 POST 时的 `currentDeploymentId` 和 deployment assets。公开素材绑定 POST 时的当前 storageKey 与 etag；替换后的旧对象由 PublicAssetRevision 保留。

## 当前可复用能力

现有仓库已经提供：

- `DriveService.openShareBrowserItemDownload`：分享文件流和文件夹 ZIP entries；
- `sendDriveZip`：使用 `archiver` 流式生成 ZIP；
- `DriveSiteService.resolvePublicSite`、`listPublicSiteAssets`：Site access 与 deployment 资产；
- `DrivePublicAssetService.resolvePublicAsset`：公开素材解析；
- `DriveStoragePort.getObjectStream`：本地存储和 COS 的统一对象流；
- `DriveStoragePort.createDownloadUrl`：单对象短期 URL，但不能统一处理 ZIP。

开放 API 复用 Drive 的 URL 同源检查、密码、过期、停用、删除、生命周期和对象存在性规则。不得复制或弱化这些判断。

`DriveLinkIntakeService.openDownload` 当前只允许具体文件，遇到文件夹 ZIP 会拒绝，因此本期需要新增“准备下载制品”的领域入口，而不是直接使用该窄方法。

现有 `createFolderZipEntries` 在 GET 时惰性遍历活动子树并读取每个 DriveItem 的当前 storageKey，只能继续服务现有浏览器下载；开放 API 不能直接把它当作快照 manifest，必须在 POST 时生成规范化 grant entries。

## 非目标

- 不解析 Synapse 之外的网盘或任意互联网 URL。
- 不返回正文、Base64 文件内容、文件树或资源分析结果。
- 不为同一请求返回多个下载地址。
- 不新增分享访问模式，不绕过密码、有效期或停用状态。
- 不返回 owner、协作者、storage key、COS bucket、内部数据库记录或密码材料。
- 不允许 API key 访问 `/api/console/*`、`/api/drive/*` 或其它内部业务接口。
- 不在本期做计费、套餐、自定义 TTL、自定义归档上限或永久链接。
- 不提供下载任务队列、异步轮询、预生成 ZIP 或归档缓存。
- 不发布 Swagger UI 或在线调试控制台。

## 路径与版本规则

基础地址：

```text
https://synapse.d2.pub/api/open/v1
```

公开路径结构：

```text
/api/open/<version>/<domain>/<resource>/<subresource?>
```

首个业务接口：

```text
POST /api/open/v1/drive/share-links/downloads
```

临时下载入口：

```text
GET /api/open/v1/downloads/<grantId>?token=<secret>
```

调用方只构造 POST 请求。GET 地址必须原样使用接口响应值，`grantId` 和 token 都不属于可复用业务身份。

后续示例仅说明路径扩展方式，不代表本期实现：

```text
POST /api/open/v1/drive/share-links/text-reads
GET  /api/open/v1/skills
POST /api/open/v1/workflows/<workflowId>/runs
```

v1 可以新增端点和明确可选字段；删除/重命名字段、改变类型或状态码、扩大 scope 含义、改变认证或资源路径必须使用 v2。

## API key 认证与 scope

### 创建下载地址

POST 请求使用：

```http
Authorization: Bearer syn_sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

不支持 Cookie、用户 JWT、`X-API-Key`、query API key 或请求体 API key。

新增 `OpenApiKeyGuard`，只挂载 `/api/open/*` 的业务 controller：

1. 严格读取单个 Bearer token；
2. 校验 `syn_sk_` 格式和长度；
3. 计算 SHA-256，仅用摘要查询 `UserApiKey.keyHash`；
4. 要求 key 未撤销且所属用户为 `active`；
5. 建立最小 `OpenApiPrincipal`：`userId`、`apiKeyId`、`scopes`。

缺失、未知、撤销和禁用统一返回 `401 INVALID_API_KEY`。

### Scope

首期 scope：

```text
drive.share_link.download
```

`UserApiKey` 增加：

```prisma
scopes     String[]  @default([])
lastUsedAt DateTime?
```

迁移时现有 key 的 scopes 保持空数组，不自动获得下载权限。用户可以在 Console 中为已有密钥显式添加权限。未来新增开放接口也不得自动给旧 key 增加权限。

新增服务端权威权限目录：

```http
GET /api/console/api-key-capabilities
```

本期返回：

```json
[
  {
    "scope": "drive.share_link.download",
    "name": "获取分享链接文件",
    "description": "允许通过开放接口下载分享文件、文件夹、站点和公开素材。"
  }
]
```

创建密钥请求改为：

```json
{
  "name": "自动化下载",
  "scopes": ["drive.share_link.download"]
}
```

Server 使用 strict Zod schema，要求 scopes 非空、无重复且全部来自权限目录。Dashboard 创建弹窗根据权限目录渲染“API 权限”复选框，默认不勾选，至少选择一项才能创建。

已有密钥通过以下接口原地修改权限，不修改名称或轮换密钥：

```http
PATCH /api/console/api-keys/<id>
Content-Type: application/json
```

```json
{
  "scopes": []
}
```

更新请求同样使用 strict Zod schema，要求 scopes 无重复且全部来自权限目录，但允许空数组用于停用全部开放接口权限。查询、创建、更新和撤销都绑定当前用户；更新只作用于未撤销密钥，返回更新后的密钥 DTO，并以 `api_key.update` 审计变更前后的 scopes，不记录完整密钥、摘要或其它可还原材料。

Console 列表响应增加 `scopes` 和 `lastUsedAt`，管理页显示已授权能力和最后使用时间。创建和编辑弹窗共用单列权限列表，展示服务端名称与说明；列表可滚动，并处理加载、失败重试和无可用权限状态。

scope 不匹配返回 `403 INSUFFICIENT_SCOPE`。

临时 GET 下载不再读取 API key header，但会通过 grant 关联重新检查原 API key 和用户状态。

## 创建临时下载地址

### 请求

```http
POST /api/open/v1/drive/share-links/downloads
Content-Type: application/json
Authorization: Bearer syn_sk_...
```

```json
{
  "url": "https://synapse.d2.pub/share/shr_xxx?password=optional"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `url` | string | 是 | 最大 2048 字符的完整绝对 HTTP(S) URL；只允许当前 `APP_PUBLIC_URL` 同源的 `/share`、`/sites`、`/files`，受密码保护时由 URL 自带 `password` query |

请求对象使用 strict Zod schema，未知字段返回 `400 INVALID_REQUEST`。

### 成功响应

状态码：`201 Created`

```json
{
  "requestId": "req_01k3...",
  "data": {
    "sourceType": "share",
    "artifact": {
      "type": "file",
      "fileName": "需求说明.md",
      "mimeType": "text/markdown",
      "size": "12000",
      "entryPath": null,
      "snapshotId": "snap_xxx"
    },
    "download": {
      "method": "GET",
      "url": "https://synapse.d2.pub/api/open/v1/downloads/dlg_xxx?token=secret",
      "expiresAt": "2026-08-22T09:10:00.000Z"
    }
  }
}
```

公开类型：

```ts
type OpenApiDownloadSourceType =
  | "share"
  | "share_item"
  | "site"
  | "site_path"
  | "public_asset"

type OpenApiDownloadArtifact = {
  readonly type: "file" | "archive"
  readonly fileName: string
  readonly mimeType: string
  readonly size: string | null
  readonly entryPath: string | null
  readonly snapshotId: string
}
```

字段规则：

- 原始文件 `type` 为 `file`，`size` 为十进制字节数字符串。
- ZIP `type` 为 `archive`，`mimeType` 固定 `application/zip`。
- 流式 ZIP 的最终压缩大小未知，`size` 返回 `null`。
- `entryPath` 只用于 Site ZIP；其它情况返回 `null`。
- `snapshotId` 是服务端根据规范化 grant 内容计算的 opaque 标识，用于把自动化审核报告关联到本次输入快照；它不是内部版本 id。
- 响应不返回输入 URL、密码、内部 id、storage key 或 token hash。

### 文件夹示例

```json
{
  "requestId": "req_01k3...",
  "data": {
    "sourceType": "share",
    "artifact": {
      "type": "archive",
      "fileName": "项目交付材料.zip",
      "mimeType": "application/zip",
      "size": null,
      "entryPath": null,
      "snapshotId": "snap_xxx"
    },
    "download": {
      "method": "GET",
      "url": "https://synapse.d2.pub/api/open/v1/downloads/dlg_xxx?token=secret",
      "expiresAt": "2026-08-22T09:10:00.000Z"
    }
  }
}
```

### Site 页面示例

```json
{
  "requestId": "req_01k3...",
  "data": {
    "sourceType": "site_path",
    "artifact": {
      "type": "archive",
      "fileName": "产品原型.zip",
      "mimeType": "application/zip",
      "size": null,
      "entryPath": "docs/start.html",
      "snapshotId": "snap_xxx"
    },
    "download": {
      "method": "GET",
      "url": "https://synapse.d2.pub/api/open/v1/downloads/dlg_xxx?token=secret",
      "expiresAt": "2026-08-22T09:10:00.000Z"
    }
  }
}
```

## 临时下载授权

### 数据模型

新增独立 Prisma 模型，名称建议为 `OpenApiDownloadGrant`：

```prisma
model OpenApiDownloadGrant {
  id                String   @id @default(cuid())
  tokenHash         String   @unique @db.VarChar(64)
  apiKeyId          String
  userId            String
  sourceType        String   @db.VarChar(32)
  artifactType      String   @db.VarChar(16)
  planVersion       Int      @default(1)
  snapshotId        String   @db.VarChar(64)
  fileName          String   @db.VarChar(255)
  mimeType          String   @db.VarChar(255)
  size              BigInt?
  entryPath         String?  @db.VarChar(1024)
  target            Json
  expiresAt         DateTime
  leaseUntil        DateTime
  createdAt         DateTime @default(now())
  entries           OpenApiDownloadGrantEntry[]

  @@index([apiKeyId, expiresAt])
  @@index([expiresAt])
  @@index([leaseUntil])
}

model OpenApiDownloadGrantEntry {
  id                 String   @id @default(cuid())
  grantId            String
  grant              OpenApiDownloadGrant @relation(fields: [grantId], references: [id], onDelete: Cascade)
  ordinal            Int
  entryType          String   @db.VarChar(16)
  relativePath       String?  @db.VarChar(1024)
  storageKey         String?
  driveFileVersionId String?
  driveFileVersion   DriveFileVersion? @relation(fields: [driveFileVersionId], references: [id], onDelete: Restrict)
  size               BigInt?
  mimeType           String?  @db.VarChar(255)
  etag               String?
  sha256             String?  @db.VarChar(64)

  @@unique([grantId, ordinal])
  @@index([driveFileVersionId, grantId])
}
```

实际实现添加到 `UserApiKey`、`User` 和 `DriveFileVersion` 的反向关系字段。API key 当前只撤销不物理删除，grant 到期后由清理任务删除。

`target` 只保存重新校验分享/Site/公开素材状态所需的源引用，并由 `planVersion` 标识 JSON 结构。具体文件和目录清单全部进入规范化 entries，不把最多 1000 项 manifest 塞进单个 JSON：

- Drive 单文件/文件夹：target 保存 share 状态引用；每个文件 entry 绑定 POST 时匹配当前 storageKey 的 `DriveFileVersion`；
- Site ZIP/Site asset：target 保存 Site 与 deployment id；entry 绑定 deployment 专属 storageKey、size 和 sha256；
- 公开素材：target 保存素材状态引用；entry 固定 POST 时的 storageKey、size 和 etag；
- 目录 entry 的 storageKey 为空，仅用于保留 ZIP 空目录。

`snapshotId` 由服务端对规范化 snapshot descriptor 计算 SHA-256 后编码为 `snap_...`。descriptor 包含 sourceType、artifactType、entryPath，以及按 ordinal 排序后的 entryType、relativePath、不可变 version/object 标识、size 和 integrity 元数据。响应只返回摘要，不返回 descriptor 或内部 id。

下载时不得重新解析条目的当前版本。对象版本、size 或 etag/sha256 与 plan 不一致时终止下载，避免一个 ZIP 混入不同时间的内容。滚动发布必须继续读取当前版本和上一版本 plan，十分钟兼容窗口结束后才能删除旧 decoder。

### DriveFileVersion 临时租约

现有历史版本清理只保护当前 storageKey 和手动 pinned 版本。grant 固定的 current version 在文档随后更新后会变成历史版本，因此必须扩展实际清理规则：

- POST 创建 grant 与 entries 时，要求 DriveFileVersion `deletedAt = null`、`deletePending = false`，并设置 `grant.leaseUntil = expiresAt`；
- `listCleanupCandidateVersions` 排除任何被 `leaseUntil > now` 的 grant entry 引用的 version；
- `deleteFileVersion` 先返回“版本正在被临时下载使用”，最终 claim 条件也必须排除有效租约，防止检查后的竞态；
- grant entry 创建与清理的 deletePending claim 必须使用数据库条件避免竞态，不能先查后无条件更新；
- GET 开始后把 grant leaseUntil 延长到短期安全窗口，并在 ZIP 流期间定时续租；只更新 grant 一行，不逐 entry 心跳；
- 客户端断开、成功或失败后停止续租，租约自动到期；进程崩溃也不会永久 pin 历史版本；
- grant 到期只禁止新下载，已经开始且持续续租的下载仍可完成。

这不是让用户“保留历史版本”，也不改变历史版本页面的 pin 状态；它只是保证十分钟下载授权和已开始的流不会被后台清理破坏。

`target` 严禁保存分享密码、API key、明文 token、下载 URL、Cookie 或 Authorization。

### Token

- 使用至少 32 个随机字节生成 Base64URL secret。
- 数据库只保存 SHA-256 `tokenHash`。
- 下载 URL path 使用非敏感 grant id，secret 放入名为 `token` 的 query，沿用日志敏感 query 脱敏。
- token 只在创建响应中出现一次。
- grant id 单独泄露不能下载；token 单独没有 grant id 也不能定位目标。

### 生命周期

- `expiresAt = createdAt + 10 分钟`。
- `leaseUntil` 初始等于 expiresAt；活跃下载通过短租约心跳延长对象保护。
- grant 在有效期内可重复使用，不记录或限制下载次数。
- 到期、API key 撤销、缺少当前下载权限、用户禁用、源分享/Site/素材不可用时统一拒绝。
- 下载开始后不因十分钟到期而中断正在传输的 stream。
- grant 到期 24 小时后由后台清理任务物理删除；Open API 用量日志独立保留 30 天。

## 临时 GET 下载行为

```http
GET /api/open/v1/downloads/<grantId>?token=<secret>
```

该请求不要求 Authorization header。下载服务执行：

1. 读取 grant id 和 token，计算摘要并做固定失败响应；
2. 检查 grant 未过期并按 `planVersion` 解码下载 plan；
3. 检查关联 API key 未撤销、仍有 `drive.share_link.download` 权限且用户为 active；
4. 先创建一条 `started` 用量日志，写入失败则返回 503 且不发送 header；
5. 检查分享、Site 或公开素材仍然启用且未删除/过期；
6. 验证不可变对象版本、大小和 etag/sha256；
7. 文件通过 `DriveStoragePort.getObjectStream` 发送；
8. archive 按 grant entries 的 ordinal 通过共享 ZIP helper 流式发送，并在传输期间刷新 grant lease；
9. 根据 response finish/close/error 更新同一条日志为 succeeded、aborted 或 failed，并记录实际字节数。

响应 header：

```http
Content-Disposition: attachment; filename*=UTF-8''...
Content-Type: <artifact mimeType>
Cache-Control: private, no-store
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
```

原始文件可以设置已知 `Content-Length`。ZIP 不设置 `Content-Length`。

v1 不处理 `Range`，也不宣称断点续传。调用方需要重试时重新执行完整 GET；地址过期后重新调用 POST 创建 grant。

流开始前失败返回稳定 JSON 错误。header 已发送后的对象读取或 ZIP 失败只能终止连接，客户端会得到不可用的截断文件，必须丢弃后重试；服务端不得把它记录为成功，也不得声称可以完全避免发送部分字节。

## 密码行为

- 受密码保护的分享必须把 `?password=` 保留在完整 URL 中提交。
- 请求体只允许 `url`；独立 `password` 字段按未知字段返回 `400 INVALID_REQUEST`。
- 密码只在 POST 创建 grant 时参与访问校验。
- 缺失和错误统一返回 `403 LINK_PASSWORD_REQUIRED_OR_INVALID`。
- grant 和临时 URL 不包含分享密码。
- GET 下载以有效 grant 作为短期授权证明，不再次要求密码。

## 归档支持边界与限流决策

### 归档上限

文件夹和 Site ZIP 统一限制：

- 最多 1000 个文件；
- 未压缩文件总字节最多 200 MiB；
- 目录深度和相对路径继续使用现有 Drive 校验边界；
- 超限在创建 grant 时返回 `413 ARCHIVE_TOO_LARGE`，不创建部分 grant。

这与现有 Drive Site 发布上限一致。ZIP 生成过程中不因压缩后大小不同放宽限制。

### 不做业务限流

POST 创建 grant 和临时 GET 下载都使用 `@SkipThrottle()`，显式绕过全局 Throttler。本功能不实现 API key、IP、grant 次数、请求频率、并发数或传输字节配额，也不返回 `429 RATE_LIMITED`。

十分钟过期是 bearer 授权生命周期；1000 文件/200 MiB 是同步流式归档的支持边界，二者都不描述为流量限额。密钥管理接口已有的创建保护保持不变。

实现仍必须遵守 Node stream backpressure，在客户端断开时立即 destroy ZIP 和底层对象 streams，避免无接收方时继续读取、压缩或写日志内容。这属于资源释放正确性，不是面向用户的限流。

## 错误契约

### POST 错误

```json
{
  "requestId": "req_01k3...",
  "error": {
    "code": "LINK_NOT_FOUND",
    "message": "分享链接不存在或已失效。"
  }
}
```

| HTTP | code | 场景 |
|---:|---|---|
| 400 | `INVALID_REQUEST` | JSON、字段、Content-Type 或未知字段不合法 |
| 401 | `INVALID_API_KEY` | key 缺失、无效、撤销或用户禁用 |
| 403 | `INSUFFICIENT_SCOPE` | 缺少 `drive.share_link.download` |
| 403 | `LINK_PASSWORD_REQUIRED_OR_INVALID` | 分享密码缺失或错误 |
| 404 | `LINK_NOT_FOUND` | 链接不存在、过期、停用、目标删除或对象缺失 |
| 413 | `ARCHIVE_TOO_LARGE` | 文件夹/Site 超过归档上限 |
| 422 | `UNSUPPORTED_LINK` | 非当前 Synapse origin 或不支持的 Drive 路径 |
| 503 | `USAGE_LOG_UNAVAILABLE` | 必需的用量日志无法写入，未创建 grant |
| 500 | `INTERNAL_ERROR` | 未预期服务端错误 |

### GET 错误

| HTTP | code | 场景 |
|---:|---|---|
| 400 | `INVALID_DOWNLOAD_TOKEN` | token 缺失或格式错误 |
| 404 | `DOWNLOAD_NOT_FOUND` | grant id/token 不匹配或 grant 不存在 |
| 410 | `DOWNLOAD_UNAVAILABLE` | 到期、API key 撤销、用户禁用、源失效、版本不一致或对象缺失 |
| 503 | `USAGE_LOG_UNAVAILABLE` | 必需的下载开始日志无法写入，未发送文件 header |
| 500 | `INTERNAL_ERROR` | stream 开始前的未预期错误 |

公开 controller 使用独立 exception filter，不能把内部异常、Prisma 错误、具体失效原因或 stack 暴露为 v1 契约。

POST JSON 响应和 GET 错误响应都包含 `requestId`、`X-Request-Id` 与 `Cache-Control: no-store`。

## 服务端架构

新增模块：

```text
server/src/open-api/
├── open-api.module.ts
├── open-api.controller.ts
├── open-api-download.controller.ts
├── open-api-usage.controller.ts
├── open-api-key.guard.ts
├── open-api-share-link-download.service.ts
├── open-api-download-grant.service.ts
├── open-api-usage-log.service.ts
├── open-api-exception.filter.ts
└── open-api.types.ts

server/src/api-keys/
└── api-key-capabilities.ts
```

依赖方向：

```text
POST OpenApiController
  -> @SkipThrottle / OpenApiKeyGuard / scope
  -> OpenApiUsageLogService.start(grant_create)
  -> OpenApiShareLinkDownloadService
  -> DriveLinkIntakeService.prepareDownloadArtifact
  -> Drive services
  -> OpenApiDownloadGrantService.create
  -> OpenApiUsageLogService.finish

GET OpenApiDownloadController
  -> @SkipThrottle / OpenApiDownloadGrantService.resolve
  -> Drive source revalidation
  -> OpenApiUsageLogService.start(download)
  -> DriveStoragePort / shared ZIP stream helper
  -> response lifecycle updates the same usage row
```

职责：

- controller 只做 strict 输入校验、header 和公开 envelope。
- `DriveLinkIntakeService.prepareDownloadArtifact` 解析 URL、验证密码和源状态，并产生服务端内部下载 plan。
- Drive service 负责把当时 current storageKey 映射为具体 `DriveFileVersion`、生成 grant entries，并让版本清理/手动删除识别 grant lease；Site service 负责绑定 deployment assets 的 entries。
- Open API service 负责 scope 上下文、公开制品映射和 grant 创建。
- grant service 负责 token、planVersion、持久化、生命周期和清理。
- `api-key-capabilities.ts` 是可选 scope、名称、说明和校验的唯一权威目录，Controller、Service 和 Dashboard 响应都从该目录派生。
- usage log service 只接受固定字段 DTO，不接受任意 detail、请求 body、文件名或 manifest。
- 共享 ZIP helper 从 `drive.controller.ts` 提取到 Drive 领域 helper，内部浏览下载和开放下载共同使用。
- Open API controller 不直接查询 Drive Prisma 表，不读取 storage key。

`OpenApiModule` 导入 `ApiKeyModule`、`DriveModule` 和 `PrismaModule`，由 `AppModule` 注册。

## 使用日志与审计

### API key 最近使用

POST 认证成功后 best-effort 更新 `UserApiKey.lastUsedAt`，同一 key 最多每五分钟写一次。失败只记录脱敏告警，不改变响应。

### 控制面 AuditLog

密钥创建和撤销继续使用现有 AuditLog：

```text
action: api_key.create / api_key.revoke
targetType: api_key
targetId: <apiKeyId>
```

创建 detail 可以包含已选择的 scope 字符串数组；不得包含 secret、keyHash 或请求中的文件信息。

### 数据面 OpenApiUsageLog

开放 API 不把高频请求混入全平台 AuditLog。新增：

```prisma
model OpenApiUsageLog {
  id             String    @id @default(cuid())
  userId         String
  apiKeyId       String
  grantId        String?
  requestId      String    @unique @db.VarChar(64)
  operation      String    @db.VarChar(32)
  scope          String    @db.VarChar(120)
  status         String    @db.VarChar(16)
  httpStatus     Int?
  errorCode      String?   @db.VarChar(64)
  sourceType     String?   @db.VarChar(32)
  artifactType   String?   @db.VarChar(16)
  durationMs     Int?
  responseBytes  BigInt?
  ipAddress      String    @db.VarChar(64)
  startedAt      DateTime  @default(now())
  completedAt    DateTime?

  @@index([apiKeyId, startedAt])
  @@index([userId, startedAt])
  @@index([startedAt])
}
```

实际实现添加 User 和 UserApiKey 关系。`grantId` 只保存 id 字符串，不建立阻止 grant 清理的外键。

固定枚举：

```text
operation: grant_create | download
status: started | succeeded | failed | aborted
```

记录规则：

- API key 认证成功后，每个 POST 创建一条 `grant_create` 记录；准备和创建完成后更新同一行，失败只保存公开 errorCode。
- grant id/token 有效且关联 key 可识别后，每个 GET 创建一条 `download` 记录；后续源失效和版本不一致也更新该行。无效 token 不创建无法归属的数据库记录。
- 下载 header 发送前必须成功写入 `started`；失败返回 `503 USAGE_LOG_UNAVAILABLE`。
- response `finish` 更新为 succeeded；客户端断开更新为 aborted；对象流或 ZIP 失败更新为 failed。
- 每个 HTTP 请求最多一行，ZIP 中 1–1000 个文件都不能产生逐文件日志。
- 日志保留 30 天，由每日清理任务删除；清理失败只写脱敏运行日志，下次继续。
- 查询端点 `GET /api/console/api-keys/<apiKeyId>/usage-logs` 只允许密钥所属用户访问，采用现有分页契约并按 startedAt 倒序。

Dashboard 的密钥列表增加“使用记录”操作，展示时间、操作、状态、HTTP 状态、制品类型、传输字节和 requestId；不展示文件名、分享 URL、路径或内容。

禁止写入两类日志的字段：输入 URL、密码、Authorization、API key/keyHash、token/tokenHash、文件名、相对路径、storage key、对象版本引用、manifest、文件内容、请求 body、响应 body、Cookie、Referer 和 User-Agent。`responseBytes` 只记录计数值。

流结束状态更新失败时不能追回已发送字节；保留 started 行，同时用只含 requestId、usageLogId 和固定错误分类的 Pino warning 告警。

## 安全与隐私

- 只接受当前 `APP_PUBLIC_URL` 同源的 `/share`、`/sites`、`/files`，阻止 SSRF。
- API key 仅在 POST Open API controller 生效，不能扩展 `UserAuthGuard`。
- 分享密码不持久化、不缓存、不回传。
- grant token 是下载 bearer credential，只返回一次并只保存摘要。
- request logger 必须脱敏 Authorization 和 `token` query；不得记录 POST body 中可能包含分享密码的 `url`。
- 日志和审计不记录完整分享 URL，因为 URL 可能包含密码和不可公开 public id。
- 反向代理、CDN 和 Pino 三层都必须对 `token` query 脱敏；临时下载响应不得重定向到第三方地址。
- GET 每次重查 key、用户和源状态，支持即时撤销。
- archive manifest 只存在服务端数据库，不进入公开响应和审计。
- 所有下载强制 attachment、`nosniff`、`no-store` 和 `no-referrer`。
- token 比较使用固定安全失败路径，不暴露 grant 是否存在或哪个状态检查失败。
- 到期清理不删除任何 Drive 原始对象，只删除 Open API grant。

## 文档站

实现完成并通过生产验证后新增：

```text
document/open-api/index.md
document/open-api/api/share-link-download.md
```

VitePress 顶部导航“开放接口”指向 `/open-api/`。开放接口文档使用独立左侧导航，第一项为“概览”，其下为展开的“API”分组；当前分组内只有“获取分享链接文件”，不创建未来接口占位。

页面内容顺序：

1. 基础地址；
2. 创建 API 密钥；
3. Bearer 认证；
4. `POST /drive/share-links/downloads`；
5. 请求字段与 cURL；
6. 文件、文件夹、Site 和公开素材的制品映射；
7. 临时下载地址与十分钟有效期；
8. 错误码、归档支持边界与无业务限流说明；
9. 密钥和临时 URL 安全提示。

文档把 GET 地址描述为 POST 返回的 opaque 临时链接，不要求用户自行拼接。示例 key、链接、密码、grant id 和 token 均使用虚构值。

接口未部署前不能把页面写成已可用状态。文档与接口同批发布。

## 实现影响范围

### Server

- 新增 `server/src/open-api/` 模块、controllers、services 和测试。
- Prisma 新增 `OpenApiDownloadGrant`、`OpenApiDownloadGrantEntry`、`OpenApiUsageLog` migration；`UserApiKey` 和 `DriveFileVersion` 增加关系，旧密钥 scopes 保持空数组。
- `ApiKeyService` 增加权限目录、create/update scopes 校验、API key verify、scope 和 last-used 支持。
- `DriveLinkIntakeService` 增加 prepare-download plan。
- `DriveService` 增加 current storageKey → DriveFileVersion 固定、规范化 grant entries、lease-aware 历史版本清理和手动删除保护。
- `DriveSiteService` 增加绑定不可变 deployment assets 的 archive manifest 能力。
- 提取共享 ZIP streaming helper。
- `AppModule` 注册 Open API module。
- Open API POST/GET 显式 `@SkipThrottle()`；不新增 rate-limit guard 或 429 契约。
- 增加临时 grant 与 30 天用量日志清理任务、反向代理/Pino token 脱敏检查和日志字段 canary 测试。

### Dashboard

- API key DTO 增加 scopes、lastUsedAt。
- 新增带说明的权限目录查询；创建 DTO 为 `{ name, scopes }`，更新 DTO 为 `{ scopes }`。
- 创建和编辑弹窗共用现有 Checkbox 权限列表；创建默认不选且至少选择一项，编辑允许清空。
- 列表显示已授权能力和最后使用时间；旧密钥显示“无开放接口权限”。
- 每个未撤销密钥提供“编辑权限”入口，保存成功后原地更新列表。
- 增加每个密钥的“使用记录”入口，只显示固定摘要字段，不显示文件信息。

### Documentation

- 新增 `document/open-api/index.md` 和顶部导航。
- 更新 `docs/agents/module-boundaries.md`，记录 API key 只授权本开放接口和临时 grant 边界。
- 更新 `RELEASE_NOTES_PENDING.md`。

## 发布顺序

1. 新增 Prisma migration：旧 key scopes 为空，增加 grant 与 usage log，不自动扩权。
2. 实现权限目录、创建时 scopes 校验、Dashboard 复选框和使用记录查询。
3. 实现 current version 固定、grant entries、snapshotId、版本租约和共享 ZIP helper。
4. 实现 Open API key guard、grant、usage log、无 Throttler 的 POST 与 GET。
5. 验证现有 Console key、密钥创建保护和内部 Drive 下载不回归。
6. 验证所有链接类型、密码、撤销、过期、重复下载、归档边界、截断失败和日志脱敏。
7. 发布文档站页面、模块边界和发布说明。
8. 生产环境新建并勾选 download scope 的密钥，完成端到端下载和日志验收。

无需迁移或重定向现有 `/api/drive/link-intake/*`、浏览器分享下载或公开素材路由。

## 测试

### API key

- 权限目录只返回受支持的固定 scope、产品名称与说明。
- 创建请求必须显式传非空、无重复、受支持的 scopes；未知 scope 返回 400。
- 创建弹窗默认不勾选，未选择权限不能提交；选择结果原样进入 create DTO。
- 旧 key 迁移后 scopes 为空且调用下载 API 返回 403，不发生静默扩权。
- PATCH 只更新当前用户未撤销密钥的 scopes，允许清空，拒绝重复、未知 scope 和额外字段，且不会轮换密钥。
- 移除下载 scope 后，新 POST 返回 403，尚未开始的已有临时下载返回 410；已经开始的 stream 不强制中断。
- 有效 key 建立 principal；无效、撤销和禁用统一 401。
- scope 缺失返回 403。
- API key 不能访问非 `/api/open/*` 业务接口。
- lastUsedAt 五分钟内合并写入且失败不影响业务。

### 制品准备

- 分享文件、分享内文件返回原始文件 plan。
- 分享文件夹、分享内文件夹返回有界不可变 ZIP manifest。
- 分享创建后文件发生变化时，POST 固定调用瞬间的 current DriveFileVersion，而不是分享创建时版本。
- 同一分享在内容未变化时得到相同 snapshotId；current version 或文件夹结构变化后得到不同 snapshotId。
- 文件夹 entries 按规范化相对路径稳定排序；数据库返回顺序变化不能改变 snapshotId 或 ZIP 顺序。
- 文件夹 entries 保留原始名称；仅大小写不同的文件以及同名文件/文件夹不得被改写为带 ` (2)` 的名称。
- legacy current storageKey 缺少 DriveFileVersion 时，prepare 通过现有 helper 补齐后再创建 grant。
- 任一新增的多文件分享形态必须返回 ZIP，不得返回文件数组或多个下载地址。
- 只有一个文件的文件夹仍返回 ZIP，空文件夹仍能生成包含目录信息的 ZIP。
- 独立 HTML 分享返回原始 HTML。
- Site 根和 HTML path 返回完整 deployment ZIP 和正确 entryPath。
- Site 非 HTML asset 和公开素材返回原始文件。
- 空文件夹和空目录进入 manifest。
- 1001 文件或超过 200 MiB 返回 413，且不创建 grant。

### 密码与源状态

- 完整 URL 内的密码可用，独立 `password` 字段返回 400。
- 密码缺失/错误统一 403。
- 不存在、过期、停用、删除和对象缺失统一 404。
- 外部 origin 和不支持路径返回 422。

### Grant

- 只保存 token hash，不保存明文 token/password/API key。
- planVersion 可解码当前与上一版本 grant；未知版本在发送 header 前失败。
- grant entries 按 ordinal 固定单文件、目录和 ZIP 内容；不在 target JSON 保存大 manifest。
- Drive entry 绑定 POST 时的 current DriveFileVersion；Site 和公开素材 entry 绑定各自不可变对象，并校验 size 与 etag/sha256。
- snapshotId 不暴露内部 id，且能稳定标识同一规范化 grant 内容。
- active grant lease 会阻止 `listCleanupCandidateVersions` 和手动历史版本删除选中所引用的 DriveFileVersion。
- GET 期间 grant lease 心跳保护惰性打开的 ZIP entries；停止心跳后自动释放，不永久 pin 历史版本。
- 服务重启后 grant 仍有效。
- 十分钟内可下载，过期返回 410。
- 十分钟内同一 URL 可重复下载，不记录或判断下载次数。
- API key 撤销、用户禁用、分享/Site/素材失效后返回 410。
- 到期清理只删除 grant，不删除 Drive 对象。

### 下载

- 文件 header、文件名、MIME、Content-Length 和字节一致。
- 文件夹 ZIP 路径、空目录与对象字节一致。
- Site ZIP 保留 deployment 相对路径，entryPath 存在。
- ZIP 不设置错误 Content-Length。
- v1 Range 请求不被误当成已支持断点续传。
- stream 开始前错误返回公开 envelope；开始后错误终止连接。
- stream 中途失败得到截断文件，日志状态不是 succeeded，客户端重试可以重新执行完整 GET。
- 客户端断开会 destroy ZIP 和所有底层对象 streams。

### 安全与审计

- Authorization、分享密码、输入 URL、download token/tokenHash、storage key canary 不进入日志、审计或 JSON 响应。
- token query 在 request log 中被脱敏。
- Open API POST/GET 均带 `@SkipThrottle()`，不会继承全局 600 次/分钟限制，也没有 429 契约。
- 每个有效 POST/GET 最多创建一条 OpenApiUsageLog；ZIP 不按文件写日志。
- started 日志写入失败时返回 503 且不产生 grant/不发送文件；完成状态更新失败保留 started 行并写脱敏告警。
- usage log 固定列和测试 canary 阻止 URL、密码、token、文件名、路径、manifest、请求/响应 body 与文件内容落库。
- 用户只能查询自己密钥的 usage logs；30 天外记录被清理。

### 文档

- VitePress build 通过。
- 顶部“开放接口”指向 `/open-api/`。
- “概览”记录基础地址、API 密钥和认证方式；“API”分组记录已部署的 POST 接口和它返回的 opaque GET 地址。
- 示例全部使用虚构凭证与链接。

## 验收标准

- 使用 Console 创建的 API key 可以调用 `POST /api/open/v1/drive/share-links/downloads`。
- 任一受支持链接都返回统一的十分钟下载地址与制品信息。
- 单一文件和单一素材下载原始字节；多个文件或集合型目标下载 ZIP；文件夹始终下载 ZIP；Site 页面下载完整站点 ZIP。
- 密码只在创建 grant 时使用，不进入临时 URL、数据库、日志或审计。
- grant 在服务重启后仍有效，并能因 API key 撤销、权限移除或源状态变化立即失效。
- Synapse 分享保持 live view；每次 POST 固定调用瞬间的 current version，后续编辑不改变已有 grant。
- 响应中的 snapshotId 可以与自动化审核报告关联，但不暴露历史版本 id 或 storage key。
- 开发密钥只有在当前 scopes 包含“获取分享链接文件”时才能调用；既有密钥默认无权限，可在 Console 中显式授权。
- 每次创建授权和实际下载都有一条不含文件信息的持久化用量记录，并可由密钥所属用户查询。
- 开放 API 不做请求、IP、密钥、次数或频率限流；临时 URL 在十分钟内可重复下载。
- 文件夹/Site 归档受 1000 文件、200 MiB 上限保护。
- 开放接口文档包含“概览”和“API”分组，API 分组当前只有“获取分享链接文件”，契约与生产行为一致。
- 未来接口可以直接加入 `/api/open/v1/<domain>/<resource>`，无需改变本接口路径或认证边界。

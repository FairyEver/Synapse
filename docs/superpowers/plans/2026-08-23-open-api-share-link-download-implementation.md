# 开放 API 分享链接下载实施记录

> 状态：已完成
>
> 完成日期：2026-08-23
>
> 设计文档：[开放 API 分享链接下载设计](../specs/2026-08-22-open-api-share-link-download-design.md)

## 交付结果

Synapse 已实现首个公开开放接口。用户可以在 Console 创建带开放 API 权限的开发密钥，使用密钥提交完整的 Synapse 云盘分享 URL，并获得十分钟有效的下载地址。单个物理文件按原文件下载；多个文件和集合型目标统一下载为 ZIP。

本次同时完成了 API 密钥权限、不可变下载快照、临时授权、下载流、使用日志、Dashboard 管理和文档站开放接口页面。实施未整理工作区中既有的 Desktop、文档站迁移及其他无关改动。

## 产品目标

- 复用用户开发密钥完成开放 API 身份认证。
- 接受可能带访问密码的 Synapse 云盘分享链接。
- 支持分享文件、分享文件夹、分享内条目、Drive Site 页面及公开素材。
- 让自动化审核工具能够稳定取得实际文件，而不是只读取元数据。
- 为后续新增开放接口保留稳定、可横向扩展的版本化路径。
- 记录密钥获取文件的使用情况，但不记录文件内容、文件清单和敏感凭证。

## 最终接口契约

### 创建下载制品

```http
POST /api/open/v1/drive/share-links/downloads
Authorization: Bearer syn_sk_...
Content-Type: application/json
```

请求体只包含完整分享 URL `url`。受密码保护时，调用方原样保留 URL 自带的 `?password=`；独立 `password` 字段按未知字段拒绝。密码不会进入响应或持久化日志。

成功响应提供：

- `artifact`：制品类型、文件名、MIME、大小和可选站点入口路径。
- `snapshotId`：关联本次审核输入快照的 opaque 标识，不是历史版本 ID。
- `download.url`：十分钟有效的 Synapse bearer 下载地址。
- `download.expiresAt`：下载地址过期时间。
- `requestId`：排查单次调用的高熵请求标识。

### 下载制品

```http
GET /api/open/v1/downloads/<grantId>?token=<secret>
```

下载地址本身是 bearer credential，不再要求 API key。地址在十分钟内可以重复使用；本功能不增加 API key、IP、grant 次数或下载频率限流。下载必须在过期前开始，开始后允许继续传输完成。

## 内容类型处理

| 分享目标 | 下载制品 |
|---|---|
| 单个 Drive 文件（包括 Markdown） | 原始文件 |
| Drive 文件夹或分享内文件夹 | ZIP；即使为空或只有一个文件也保持 ZIP |
| Drive Site 根或 HTML 页面 | 完整站点 ZIP，并返回 `entryPath` |
| Drive Site 非 HTML 资源 | 原始文件 |
| 公开素材 | 原始文件 |

普通 Drive 文件夹和 Drive Site 归档均在创建授权时做支持边界预检：最多 1000 个文件、总字节最多 200 MiB。该边界用于控制可支持的归档规模，不作为流量配额。

原始文件名和 ZIP 条目路径均来自云盘中的原始名称。Open API ZIP 不会为仅大小写不同的名称或同名文件/文件夹追加 ` (2)`；调用方在大小写不敏感的文件系统落盘时需自行处理路径兼容。单个 Markdown 文件不额外套 ZIP；需要连同相对图片等资源交付时，使用包含文档与资源的文件夹分享，由集合规则生成 ZIP。

## API 密钥与权限

- 开放 API 使用独立 guard，只接受 `Authorization: Bearer syn_sk_...`。
- 首期权限为 `drive.share_link.download`，Console 展示为“获取分享链接文件”。
- 创建密钥时必须显式勾选至少一个权限。
- 权限创建后不可原地修改；需要变更时撤销并重建密钥。
- 迁移前创建的密钥 scopes 默认为空，不会自动获得开放 API 权限。
- 服务端提供权威权限目录，Dashboard 根据目录渲染权限选项，便于未来横向扩展。
- API key 不会因此获得 Console API 或内部 Drive API 的访问能力。

## 快照、版本与临时授权

- 分享链接是当前内容的 live view，不对应分享创建时的历史版本。
- 创建下载授权时，服务端固定当时的 `DriveItem.storageKey` 及对应 `DriveFileVersion`。
- 单文件和集合目标都通过规范化 grant entries 保存不可变对象清单。
- 文件夹条目按规范化相对路径稳定排序，确保数据库返回顺序不会改变 ZIP 顺序或 `snapshotId`。
- Site 授权绑定创建时的 current deployment；公开素材绑定创建时的对象版本和完整性信息。
- `snapshotId` 根据规范化 grant 内容计算，用于审核结果关联，不暴露 versionId、storageKey 或历史版本号。
- 活跃 grant 对 `DriveFileVersion` 建立临时租约，版本清理和手动删除不能移除仍被有效授权引用的版本。
- grant 持久化到 PostgreSQL，只保存随机 token 的摘要；`planVersion` 用于兼容滚动发布期间尚未过期的授权。
- 下载开始前重新检查 API key、所属用户和源分享状态；撤销密钥、停用分享或删除源内容会使授权失效。

## 下载执行

- 原文件通过现有对象流传输。
- 文件夹和站点通过共享 ZIP helper 流式生成，不预先在服务器落盘准备完整 ZIP。
- 客户端断连时显式销毁 archive、计数流和已打开的对象流，释放底层资源。
- v1 不承诺 Range 或断点续传，客户端按一次完整 GET 处理。
- ZIP 流中途失败会终止连接，不会生成可接受的“成功但缺文件”ZIP；调用方必须丢弃截断文件并重新创建下载地址。

## 日志与安全

- 密钥创建和撤销继续写入控制面 `AuditLog`。
- 开放 API POST 和实际下载 GET 写入独立、固定列的 `OpenApiUsageLog`。
- 每次请求最多一条记录；ZIP 不按文件逐条记录。
- 日志可以保存 requestId、apiKeyId、userId、scope、sourceType、artifactType、结果码、耗时和响应字节数。
- 日志禁止保存输入 URL、密码、token、文件名、路径、storage key、对象引用、文件清单或文件内容。
- 有效请求在业务生效或发送响应头前先创建用量记录；首次写入失败时返回 `503 USAGE_LOG_UNAVAILABLE`。
- 流结束、中断或失败更新同一条记录；更新失败只写脱敏运行日志，不能追回已经发送的字节。
- 用量日志按 30 天固定保留期清理。
- Open API 使用独立稳定错误 envelope，成功和错误响应均带 `requestId` 与 `Cache-Control: no-store`。
- 临时 GET 的 Nginx location 关闭 access log 和 buffering，避免 token query 落盘并保持流式 backpressure。
- 公开 500 日志只记录固定分类和异常类型，避免底层对象存储错误泄露 storage key。
- POST 和 GET 显式使用 `@SkipThrottle()`；密钥创建接口既有的 10 次/分钟控制保持不变。

## 实现范围

主要新增或修改内容包括：

- `server/prisma/migrations/20260823090000_open_api_share_link_downloads/migration.sql`
- `server/src/open-api/`
- `server/src/drive/drive-open-api-download.ts`
- `server/src/drive/drive-download-stream.ts`
- `dashboard/src/features/settings/api-keys-settings.tsx`
- `document/open-api/index.md`
- `docs/agents/module-boundaries.md`
- `RELEASE_NOTES_PENDING.md`

数据库变更覆盖 API key scopes/lastUsedAt、下载 grant、规范化 grant entries、DriveFileVersion 租约关系和 Open API 用量日志。

## 实施阶段

1. 恢复仓库规则、既有设计和脏工作区边界。
2. 调研 API key、分享解析、文件版本、Site、公开素材、日志、限流和文档站现状。
3. 完成版本化公开路径、独立 guard、scope、临时下载制品和稳定错误契约设计。
4. 增加 API key 权限目录、显式 scopes、旧密钥零权限迁移和最近使用时间。
5. 实现不可变下载计划、grant entries、`snapshotId` 和 DriveFileVersion 临时租约。
6. 实现 Open API POST/GET、原文件流、ZIP 流、用量日志和清理任务。
7. 完成 Dashboard 权限勾选、使用记录和文档站开放接口页面。
8. 完成服务端、Dashboard、文档站、Prisma、安全与交付验证。

## 验证结果

| 检查 | 结果 |
|---|---|
| Prisma | format、generate、validate 通过；旧密钥 scopes 默认空数组 |
| Server 全量测试 | 94 个测试文件、1138 个测试通过 |
| Server 类型与构建 | typecheck、Nest build 通过 |
| Dashboard | 34 个目标测试及生产构建通过 |
| Document | VitePress 生产构建通过 |
| 安全检查 | token query 脱敏、Nginx access log 关闭、异常日志 canary、`@SkipThrottle()` 通过 |
| 交付检查 | 契约一致性扫描及 `git diff --check` 通过 |
| 规划完成检查 | 18 个阶段均为 complete，`check-complete.sh` 通过 |

## 重要问题与处理

| 问题 | 处理 |
|---|---|
| 默认 Pino request id 在进程重启后可能重复 | Open API 生成并在单次请求内复用独立高熵 requestId |
| 文件夹原有 GET 下载读取实时树，不满足快照语义 | 创建 grant 时持久化稳定排序的不可变 entries |
| 历史版本清理可能删除有效 grant 引用的对象 | 增加 grant 租约关系和活跃下载心跳保护 |
| ZIP 客户端断连可能遗留内部对象流 | 显式销毁 archive、计数流和已打开对象流 |
| 对象存储异常可能在日志中泄露路径 | 公开 500 日志仅保留固定分类和异常类型 |
| 反向代理可能记录下载 token query | 临时下载 location 关闭 access log |
| Prisma 本地校验缺少 `DATABASE_URL` | 使用一次性合法 URL 完成纯 schema 校验，未连接数据库 |

## 未纳入本次开发验收

本次没有启动开发服务器、浏览器或真实数据库，也没有执行生产迁移。发布流程仍需完成：

1. 在目标环境应用 Prisma migration。
2. 创建显式包含 `drive.share_link.download` 的新密钥。
3. 使用真实无密码分享、密码分享、单文件、文件夹、Site 和公开素材完成端到端下载。
4. 验证密钥撤销、分享失效、授权过期和截断下载的错误行为。
5. 核对用量日志可查询且不含 URL、密码、token、文件名、路径、对象引用或文件内容。

以上属于部署与生产验收，不影响本次源码实施完成状态。

# 发现与决策

## 需求
- 分享链接下载接口只接收完整分享 URL，不再让调用方单独传 password。
- 有效时间调整为 10 分钟。
- 单文件与多文件下载均保留用户云盘中的原始文件名。
- 评估 Markdown 单文件下载是否需要压缩包封装。

## 研究发现
- 权威实现位于 `server/src/open-api/`，已有 controller、service 和 service spec。
- 当前公开文档明确写成“五分钟有效”，请求体包含 `url` 和可选独立 `password`。
- 相关设计文档为 `docs/superpowers/specs/2026-08-22-open-api-share-link-download-design.md`，实施记录为 `docs/superpowers/plans/2026-08-23-open-api-share-link-download-implementation.md`。
- 现有实施记录写明：单个物理文件按原文件下载；多个文件和集合型目标统一下载为 ZIP。
- `docs/agents/module-boundaries.md` 当前也把临时下载地址定义为“五分钟数据库 grant”，因此 TTL 修改属于长期产品边界，必须同步规则文档。
- 既有 Drive 设计强调 Markdown 原始文件和下载内容保持不变；是否压缩不能仅按扩展名决定，还需核对开放 API 对关联资源与单文件 grant 的边界。
- Controller 的 strict Zod schema 当前显式接受 `url` 与可选 `password`；service 也把两者传给 `DriveLinkIntakeService.prepareDownloadArtifact`。
- `DriveLinkIntakeService` 已能从完整 URL 的 `password` query 解析密码，并通过 `driveLinkPassword(input.password, parsed.password)` 合并；因此移除独立字段无需新增 URL 解析器，只需让 OpenAPI 仅传 `url`。
- 临时下载 grant 的实际 TTL 常量是 `OPEN_API_DOWNLOAD_TTL_MS = 5 * 60 * 1000`，`expiresAt` 和初始 `leaseUntil` 都由它计算。另一个 `driveDownloadUrlTtlSeconds` 是普通 Drive 对象下载 TTL，不应顺带修改。
- 当前专用 service spec 只用 mock 的 `expiresAt` 描述“五分钟”，没有直接验证 grant TTL 计算；真正的 TTL 回归测试应落在 `open-api-download-grant.service.spec.ts`。
- 单文件名称链路已保持原名：`prepareOpenApiShareDownload` 把 `current.name` 写入 `artifact.fileName`，grant 持久化该值，GET controller 用 `attachmentContentDisposition(grant.fileName)` 输出响应文件名。
- 多文件名称链路把 Drive 相对路径写入 grant entries，GET controller 原样交给 `sendDriveZip`，后者使用 `archive.append(..., { name: entry.path })`。
- 文件夹本身的下载制品名为云盘文件夹原名加 `.zip`；这不是篡改内部文件名，而是集合制品的必需扩展名。Site ZIP 同理使用 Site 名称加 `.zip`。
- 独立 Markdown 分享当前按单个物理文件处理：下载原始 `.md`，原名、MIME 和内容版本均保持。若产品经理希望图片等依赖一并交付，应分享包含 Markdown 与资源的文件夹，该集合自然返回 ZIP。
- 设计明确禁止接口猜测或附带未被分享的相邻资源；因此“所有 Markdown 一律 ZIP”既无额外内容可装，也会让同一个原文件被无意义套壳。
- 实现后相关 5 个测试文件共 174 个测试通过，覆盖 strict 请求契约、完整 URL 密码、10 分钟 grant、中文 Markdown 单文件名和文件夹 ZIP entry 名。
- 最终审计发现普通浏览 ZIP 会对大小写碰撞或同名文件/文件夹追加 ` (2)`。该行为保留给浏览下载；OpenAPI manifest 已改为精确保留原始 entry 名，并增加同名/大小写碰撞测试。
- 当前分支为 `main`，工作区除本次 OpenAPI 外还包含 Desktop 项目终端、文档站迁移、API 密钥、部署脚本等既有改动；用户已明确要求全部提交。
- `deploy.sh` 是生产部署入口，目标为 `root@120.53.17.64:/www/wwwroot/synapse`，共 19 步：同步生产环境、数据库/Globals/Drive 备份、迁移风险扫描、镜像构建、临时库迁移预演、停服切换、生产迁移、启动与内外网健康检查；失败会回滚服务镜像但不会自动回滚数据库。
- 部署前检查确认 `server/.env.server` 存在、部署脚本 shell 语法有效，且生产服务器 SSH 可达。

## 技术决策
| 决策 | 理由 |
|------|------|
| 优先修改既有 OpenAPI service/controller，不引入新模块 | 已存在清晰的专用实现与测试，符合外科手术式修改要求 |
| 仅调整 OpenAPI grant TTL，不改普通 Drive 下载 URL TTL | 用户指出的是该开放接口的有效时间；两个 TTL 虽当前同为 5 分钟，但属于不同契约 |
| Markdown 单文件继续按原文件下载，不按扩展名强制 ZIP | 保留原名与直接消费体验；关联资源应通过文件夹分享的集合语义显式交付，避免越权猜测相邻文件 |
| OpenAPI ZIP manifest 直接使用云盘原始路径，不调用普通浏览下载的大小写碰撞消歧 helper | 云盘允许仅大小写不同的文件和同名文件/文件夹；追加 ` (2)` 会违反严格原名保真，ZIP 本身能表达这些不同 entry |

## 遇到的问题
| 问题 | 解决方案 |
|------|---------|
| 暂无 | - |

## 资源
- 本地 OpenAPI 页面：`http://localhost:19773/document/open-api/api/share-link-download`

## 视觉/浏览器发现
- 尚未使用浏览器；优先从本地源码与生成文档定位权威定义。

---
*每执行2次查看/浏览器/搜索操作后更新此文件*
*防止视觉信息丢失*

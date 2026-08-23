# 发现与决策

## 全量提交、推送与生产部署（阶段 26）
- 用户明确授权提交当前工作区全部变更、推送远端并执行服务端生产部署。
- 已知正式部署入口为仓库根目录 `deploy.sh`；上一轮使用该入口完成 19 步生产部署和健康检查。
- 提交前需要重新确认当前分支、远端跟踪关系、变更范围、凭证泄漏风险和部署脚本状态，不能仅依赖上一轮结果。
- 当前分支为 `main`，跟踪 `origin/main`，本地已领先 2 个既有提交：`dfcf00abf` 与 `101195880`；本轮新提交推送后会一并发布这 3 个提交。
- 当前工作区有 23 个已跟踪修改、无未跟踪文件，包含 Server、Dashboard、公开文档、设计文档、发布说明和规划记录。
- `origin` 为 `git@github.com:FairyEver/Synapse.git`，本地没有与已知远端状态分叉。
- `deploy.sh` shell 语法检查通过，仍是 19 步生产部署流程，目标为生产服务器；`server/.env.server` 存在。
- 部署脚本包含数据库迁移风险扫描、globals/在线/最终备份、临时库迁移预演、回滚镜像、最终备份恢复验证、生产迁移、容器启动和内外健康检查。
- `git fetch origin` 后仍为 `main...origin/main [ahead 2]`，远端没有新增提交，本地可安全按普通 push 发布，无需合并或变基。
- 本轮未提交源码变更集中在 API 密钥权限编辑、Drive 1000 文件事务边界、Open API grant 权限重校验、Dashboard 卡片界面、文档和发布说明。
- 提交前验证组合确定为：Server 全量测试与类型检查、Dashboard 相关测试与生产构建、VitePress 构建、Desktop hard constraints；覆盖当前未提交变更并复核两个待推送提交的主要边界。
- 首轮并行验证中，Server 全量测试 1146/1147，通过之外唯一失败是新增的 1000 文件边界用例超过 Vitest 默认 5 秒；失败发生在测试时限而非业务断言。
- Dashboard 生产构建、VitePress 构建和 Desktop hard constraints 已通过；Dashboard 构建仅有既有的大 chunk 警告。
- 1000 项边界用例在此前定向运行可通过，但全套并行负载下耗时约 6.1 秒，说明测试需要局部显式超时，不能依赖默认 5 秒。
- 测试用例确实会通过内存 Prisma 执行 1000 项完整准备流程，测试目的包含真实边界数量与事务选项，不应缩小输入规模或改成只验证 mock 调用。
- 仓库没有全局 `testTimeout` 或既有局部长测试模式；本次只为该单个 1000 项边界测试设置 15 秒局部超时，保留默认全局时限和其它用例的超时敏感性。
- 局部超时调整后 Drive 定向测试 139/139 通过，实际耗时约 3.6 秒；Server 类型检查和 Dashboard 两个相关测试文件 37/37 同时通过。
- Server 全量测试单独复跑 94 个文件、1147/1147 通过，1000 文件边界测试在全套中稳定通过。
- 提交前 `git diff --check` 通过；23 个修改文件均在用户要求的“所有代码”范围内，无未跟踪文件。
- 真实 API 密钥不在 diff 中，`server/.env.server` 由 `.gitignore` 的 `.env.*` 规则排除，不会进入提交。
- 全量源码与规划记录已创建提交 `66a7b8243`，提交信息为 `feat: complete open API permissions and reliability`。
- 提交前验证记录另存为 `10f45691a`；`main` 的 4 个本地提交已成功推送到 `origin/main`，远端更新范围为 `31b374e71..10f45691a`。

## 文档网站与代码契约对齐（阶段 23）
- 仓库规则指定的 `docs/agents/document-copy.md` 不存在；需从现存 `.claude/rules/` 与 `document/` 配置定位真实约束。
- 实际文档站规则为 `.claude/rules/document-copy.md`；要求内容专业、克制、基于当前实现，禁止营销文案，并统一使用 Drive、API 密钥等术语。
- 当前公开开放接口文档集中在 `document/open-api/index.md` 与 `document/open-api/api/share-link-download.md`。
- 现有文档已覆盖 Bearer 鉴权、10 分钟临时下载地址、ZIP 上限和主要失效条件；仍需以 controller、guard、DTO/类型、下载授权及测试为准，核对请求校验、支持链接形式、响应字段、下载行为和错误语义。
- 文档首页的英文 tagline `Where ideas connect.` 不符合当前首页“一句话说清产品是什么 + 核心能力”以及禁止营销式空话的规范，需要改为客观产品定位。
- 文档站导航目前只有首页、开放接口；本轮不扩写仓库其它产品能力，避免在没有逐项代码审计时扩大公开承诺。
- 创建授权接口的请求体是 strict Zod object：仅允许一个必填 `url`，必须为 URL 且最长 2048 字符；成功固定返回 201，并在 JSON 与 `X-Request-Id` 中返回同一请求 ID，响应禁止缓存。
- API 密钥认证只接受规范的 `Authorization: Bearer <secret>`；创建下载授权需要 `drive.share_link.download` 权限。创建密钥时至少选择一个权限，之后可编辑为空；撤销不可恢复。
- 下载地址使用独立 `grantId + token`，无需再次发送 API 密钥。文件响应带 `Content-Length`，ZIP 为流式生成；均使用 attachment 文件名、`private, no-store`、`no-referrer` 和 `nosniff`。
- 响应 `sourceType` 的实际枚举为 `share`、`share_item`、`site`、`site_path`、`public_asset`；`artifact.type` 为 `file` 或 `archive`，大小按字符串返回，ZIP 大小为 `null`。
- 临时授权固定 10 分钟，下载前会重新校验密钥撤销、用户状态、权限、源分享或 Site、站点 deployment 条目以及底层对象；失败统一为 410 `DOWNLOAD_UNAVAILABLE`。
- 下载地址在有效期内可重复使用；下载开始后以 lease heartbeat 保护流式传输。公开文档无需暴露数据库 lease 与清理 cron 等内部实现。
- URL 解析只接受当前 `APP_PUBLIC_URL` 同源的 HTTP/HTTPS 地址，密码读取自 `password` query；公开支持的路径族为 `/share/<shareId>`、分享内 item、`/sites/<siteId>[/path]` 与 `/files/<assetId>`。
- `sourceType` 会区分分享根目标与分享内 item、Site 根目标与 Site 子路径；文档应列出枚举，便于调用方稳定分支处理。
- 临时下载 token 缺失或格式非法返回 400；格式正确但授权或 token 不匹配返回 404，以避免泄露授权是否存在。
- 定向测试已覆盖严格请求体、10 分钟到期、稳定错误 envelope、撤权即时失效、快照 ID 与下载地址不可猜测等契约；公开文档应解释可观察结果，不暴露 token 摘要、心跳和清理任务等实现细节。
- `PRODUCT.md` 将 Synapse 定位为跨编辑器 AI capability 管理工具，文档首页应使用这一产品定位替换 `Where ideas connect.`；不应把开放接口错误地写成产品全部能力。
- 文档站随 Server Docker 镜像发布，线上路径是 `/document/`；本轮构建验证可以覆盖 VitePress 路由与 Markdown，但用户未要求重新部署。
- controller 测试确认独立 `password` 字段和任何额外字段都会因 strict schema 返回 400；文档应明确“密码只能放在 URL query 中”，避免调用方沿用旧参数。
- Console 当前支持创建、编辑权限、查看使用记录和永久撤销 API 密钥；旧密钥可能显示“无开放接口权限”。公开概览应说明权限可原地修改、撤销不可恢复、移除权限会使未开始的临时下载失效。
- 设计契约明确不开放生产 CORS，长期 API 密钥只用于服务端、CLI 或自动化客户端；这应作为集成限制直接写入概览。
- 设计契约明确：下载在十分钟内开始后可继续完成；流开始后若对象读取或 ZIP 失败，连接可能只收到截断文件，调用方应丢弃并完整重试。
- 设计契约明确：POST 与下载 GET 都返回 `X-Request-Id`；JSON 错误还包含相同的 `requestId`，可用于 Console 使用记录和问题排查。
- 当前公开页已有正确的制品映射与归档边界；本轮应保留并结构化，避免重新描述成“任何 Site 路径都返回原文件”或“Markdown 自动附带资源”。
- 文档实现已补齐：API key scope 与生命周期、严格 Bearer 格式、无 CORS、同源 URL 形式、密码 query、响应字段、下载 headers、快照、流失败处理和 410 失效条件。
- 首页已改为 `PRODUCT.md` 的跨编辑器 AI capability 管理定位，不再使用无法说明产品能力的英文营销标语。
- 陈旧表述扫描未发现“五分钟”、旧独立密码参数或旧首页标语；命中的 `password` 字段内容是在明确说明该字段会被拒绝。
- VitePress 1.6.4 构建成功，站内开放接口链接已出现在生成页面中；`git diff --check` 通过。
- 修改后的公开文档和发布说明未包含用户提供的真实 API 密钥片段。
- 本轮只调整公开文档与面向用户的发布说明，不改变接口实现或生产部署状态。

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
- 部署 ID `20260823_085857` 在第 10/19 步 Docker 镜像构建阶段被用户叫停；未执行临时库预演、停服、最终备份、生产迁移或容器切换。
- 中止后生产容器仍运行旧镜像 `synapse-server:deploy-20260821_202831` 且 healthy；公开健康检查返回正常。同步前后的 `.env` 哈希相同，本次部署 ID 的备份、临时数据库和镜像标签已精确清除。

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

## API 秘钥权限编辑
- `ApiKeyController` 当前只有 list/create/revoke，创建 schema 要求非空且权限不可重复。
- `UserApiKey.scopes` 已是数组且允许空值，本次不需要 Prisma migration。
- Dashboard 创建弹窗直接渲染单个 Checkbox；权限目录只有 `scope` 和 `name`，缺少可读说明及加载失败状态。
- `OpenApiDownloadGrantService.assertAvailable` 当前只复查 key 撤销和用户状态，没有复查关联 key 的当前 scopes。
- 用户确认编辑时允许清空全部权限，移除权限后下一次下载立即失效，权限项展示名称与说明。
- 工作区已有 API key 操作列居中对齐修改和测试，本次必须保留并在同一操作组增加编辑入口。
- 实现期间并发提交 `101195880` 将操作列最终确定为右对齐，并增加对应回归测试；后续实现按最新提交保留右对齐，不回退该用户改动。
- `UserApiKey.scopes` 更新不涉及 keyHash/keyPrefix，因此可以原地改权且不轮换秘钥。
- 临时 grant 已关联原 API key；只需在 include 中补取 scopes 并检查当前下载 scope，无需新增 grant 字段或数据库迁移。
- 文档中的陈旧边界集中在开放 API 设计、实施记录和模块边界；公开下载文档只需补充移除权限也会使尚未开始的下载失效。

## API 秘钥卡片列表
- 当前表格在窄内容区承载名称、前缀、权限、两个时间和三个操作，横向密度已经超过适合表格的范围。
- 卡片应保持单层：顶部展示名称、前缀与操作，主体展示权限和最后使用/创建时间；不使用嵌套卡片、自定义颜色或装饰阴影。
- 用户截图显示表格操作区已被横向裁切，卡片必须允许操作区换行，并在窄宽度下改为纵向信息流。

## 开放接口全覆盖实测
- 当前公开开放接口只有“获取分享链接文件”，分为创建下载授权和执行临时下载两个阶段。
- POST 入口固定为 `/api/open/v1/drive/share-links/downloads`，只接受 strict JSON `{ url }`；`url` 必须是最长 2048 字符的完整 URL。
- 支持 `/share`、`/sites`、`/files` 三类同源链接；其它来源或路径映射为 `422 UNSUPPORTED_LINK`。
- 下载授权固定十分钟，GET token 是 43 字符 base64url；token 缺失或格式错误为 400，grant/token 不匹配为 404。
- 单文件和公开素材返回原文件；文件夹返回 ZIP；Site 根路径或 HTML 页面返回完整 deployment ZIP，Site 非 HTML asset 返回原文件。
- 下载前会重新校验 API key 状态、scope、用户状态、源分享/站点/公开素材状态和存储对象，因此授权创建后停用源制品应返回 410。
- 文件夹/Site 归档上限为 1000 个文件和 200 MiB 未压缩大小；生产实测会优先覆盖文件数量临界值附近的安全小文件方案，不为测试制造 200 MiB 以上浪费性数据。
- 远程测试数据需放在唯一命名的隔离目录；仅该目录及本次创建的公开制品可执行删除/停用/恢复测试。
- 当前 Synapse MCP 无登录态，`app_drive_folder_create` 直接返回“账号未登录”，因此尚未产生任何云盘测试数据。
- 首轮生产实测确认 API key 有效且具备所需 scope：使用它提交不存在 Site/公开素材得到预期的业务 404，而不是认证或权限错误。
- 不存在分享链接走 `DriveService.resolvePublicShareAccess` 时会抛 Nest `NotFoundException`；`prepareOpenApiShareDownload` 没有把该异常转成 `status: not_found`，Open API service 最终映射为 `500 INTERNAL_ERROR`。这与公开文档的 `404 LINK_NOT_FOUND` 冲突。
- 用真实生成规则对应的标准长度（`shr_` 后 32 个 base64url 字符）复核后仍为 500，已排除非法 shareId 形状导致的误判。
- Authorization guard 对 `Bearer` 大小写和单空格严格匹配；lowercase、双空格和 Basic 均正确返回 401。
- 下载 token 缺失、空、长度错误或字符集错误均返回 400；合法形状但未知 grant/token 返回 404，符合隐藏授权存在性的设计。
- 重启正式包并登录后，Synapse MCP 登录态恢复；隔离目录与普通/密码分享、公开/密码站点、公开素材均已创建。
- 文件夹上传 MCP 在本地预检时会对 1001 个文件给出明确“最多上传 1000 个”错误；但恰好 1000 个文件进入服务端准备阶段后返回数据库操作失败 500，说明公开上限与可执行上限不一致。
- 同一个 Drive 文件夹允许分两次 500 和 501 文件合并，最终 1001 个文件全部上传成功；这为 Open API 归档 1000/1001 临界测试提供了真实数据。
- 普通文件下载完整验证通过：201 envelope、约 600 秒 TTL、原始 Unicode 文件名、Content-Length、`private, no-store`、`no-referrer`、`nosniff`、原字节、重复/Range/并发行为均符合文档。
- 文件夹 ZIP 精确保留 11 个条目，包括 `Case.txt`/`case.txt`、同名文件 `同名` 与目录 `同名/`、空目录和中文空格路径。
- Site 根路径和 HTML path 都返回完整 deployment ZIP，并正确设置 `entryPath`；非 HTML asset 返回原文件。密码 Site 的缺失/错误/正确路径为 403/403/201。
- 同一 grant URL 可重复和并发下载；两个 grant 的 token 交叉组合均为 404。重复 token query 被拒绝为 400，额外无关 query 不影响下载。
- Drive 同 itemId 覆盖新版本后，已创建 grant 保持旧版本不可变快照，新 grant 获取新版本且 snapshotId 变化。
- 精确 1000 文件分享可创建授权并下载 1000-entry ZIP；添加第 1001 文件后新授权返回 413，但此前 1000 文件 grant 继续下载原快照。
- 未对 200 MiB 总大小做生产写入实测：达到该边界至少需实际上传约 200 MiB 数据，会显著占用用户配额；该分支已有常量和单元测试证据，最终报告需明确区分。
- 真实时间边界通过：签发时 TTL 约 600 秒，立即下载成功；等待到期后同一 URL 返回 410 `DOWNLOAD_UNAVAILABLE`，并保留稳定 requestId/no-store envelope。
- 源状态重新校验通过：测试分享和测试站点在 grant 创建后被 MCP 停用，尚未开始的下载均立即 410；测试站点随后恢复 active。
- 最终生产实测为 66 个独立 Open API 用例，65 通过、1 失败；失败集中为不存在普通分享的 500/404 契约偏差。
- 不能安全在本次生产实测中制造的分支：API key scope 移除/撤销、用户停用、使用日志持久化故障，以及 200 MiB+ 实际上传。前三者会改变用户凭证、账号或基础设施状态，后者会显著占用配额。

## 缺陷修复与重新部署
- 修复范围仅包含上一轮确认的两个缺陷，不顺带重构 Drive 或 Open API 相邻逻辑。
- 生产复测需复用既有隔离数据，且不得把 API key、分享密码或临时下载 token 写入仓库、日志或报告。
- 不存在普通分享的根因是 `resolvePublicShareAccess` 直接抛出 `NotFoundException`，而 `prepareOpenApiShareDownload` 只处理后续 item 解析阶段的 NotFound；补齐同一领域入口的异常归一化即可恢复 404 `LINK_NOT_FOUND`。
- 单次 1000 文件上传准备会在一个 Prisma 交互事务中为每个文件串行查重、创建 item、更新 storage key、创建 session 并预留空间；默认 5 秒事务在正式 PostgreSQL 上越过边界，Prisma P2028 类错误被全局过滤器统一显示为“数据库操作失败”。
- 保持批次准备的原子事务和既有回滚语义，为已明确最多 1000 文件的文件夹准备事务设置 10 秒获取等待与 30 秒执行时限；500 文件可在默认 5 秒内成功，30 秒为当前边界保留充分余量且仍是有界等待。
- 新增红绿回归覆盖：不存在分享由抛 404 异常改为领域 `not_found`；恰好 1000 文件生成全部 1000 个 session 且使用专用有界事务配置。定向 Drive service 测试 139/139 通过。
- 能力审计确认无需修改 MCP 契约：`app_drive_folder_upload` 的实现、schema 和 dispatcher 共用同一能力，内置 Drive Skill/API reference 已明确“超过 1,000”才拒绝，1000 应支持；开放 API 公开文档和设计已明确不存在/失效链接为 404 `LINK_NOT_FOUND`。
- 正式部署 `20260823_105738` 完成全部 19 步：环境与数据库认证、57 个远端已应用迁移核对、Globals/在线/最终数据库备份、候选镜像、回滚镜像、临时库迁移预演、最终备份恢复验证、无待执行生产迁移、新容器启动及内外健康检查全部通过。
- 部署后 MCP 单次上传恰好 1000 个 1 字节文件完整成功，`uploadedFiles=1000`、`failures=0`；说明修复覆盖真实 PostgreSQL 准备事务、COS 直传和 1000 次完成确认全链路。
- 部署后合法格式不存在分享返回 404 `LINK_NOT_FOUND`。开放 API 核心矩阵到真实到期前为 58/58：认证语法、strict schema、同源/路径、缺失/停用链接、分享/Site 密码、文件/文件夹/Site/asset、ZIP、下载头与重复/Range、token 负向、8 路并发、1001 归档上限均通过。
- 新建隔离文件分享后先签发 grant 再用 MCP 停用分享，未开始的下载再次返回 410 `DOWNLOAD_UNAVAILABLE`；测试分享保持停用，不影响用户既有数据。
- 真实十分钟到期复测通过：测试进程只在内存保存 bearer URL，按服务端 `expiresAt` 等待并额外延后 1.5 秒，同一 URL 返回 410 `DOWNLOAD_UNAVAILABLE`。生产开放 API 核心矩阵最终 59/59 通过。
- 本轮复测合计可单独计数的核心检查为 61/61：开放 API 59 项、单次 1000 文件 MCP 上传 1 项、grant 后源分享停用重校验 1 项。
- 本地 1000 文件目录、两份临时测试脚本和失效测试源文件已精确删除；远程 `retest-1000-after-deploy` 文件夹与 `retest-source-invalidation-20260823.txt` 保留在既有 E2E 隔离目录，后者的新测试分享保持停用。

---
*每执行2次查看/浏览器/搜索操作后更新此文件*
*防止视觉信息丢失*

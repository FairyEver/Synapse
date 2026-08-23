# 进度日志

## 会话：2026-08-23

### 阶段 30：公共链接资源命名兼容迁移
- **状态：** in_progress
- 用户要求只修复“资源名称与实际能力不一致”，其它成熟度建议本轮不实施。
- 采用兼容迁移假设：新增 canonical `public-links` 路径和准确 scope，同时保留已发布旧路径/旧 scope，避免现有调用立即失效。
- 当前工作区已有 `RELEASE_NOTES_PENDING.md`、文档配置和 README 的未提交修改；这些变更视为用户既有内容，后续只在与本任务直接重叠时做窄修改。
- 已补充 canonical route/scope、旧 scope 运行兼容和 API key 投影回归断言。
- 红灯验证得到 5 个测试文件中 11 个预期失败，覆盖路径元数据、权限目录、新 scope 校验、旧 scope 规范化和 grant scope 校验；既有无关断言仍通过。
- 已实现 canonical `drive.public_link.download`、`/drive/public-links/downloads` 和权限名称“获取公共链接文件”。
- 已同步公开文档、导航、模块边界、设计记录和待发布说明；旧名称仅保留在兼容说明、兼容入口与兼容测试中。
- 最终验证：Server 相关测试 10 个文件 36/36、Dashboard 测试 2 个文件 38/38、Server/Dashboard 类型检查、Dashboard 生产构建、VitePress 构建和 `git diff --check` 全部通过；Dashboard 构建仅输出既有大 chunk 警告。
- 阶段 30 已完成；未修改限流、密钥生命周期、OpenAPI 规范或其它成熟度问题。
- 旧路径继续注册为同一 controller alias；数据库旧 scope 在 API key DTO/principal 中规范化为新 scope，grant 运行校验仍接受旧 scope，无需数据迁移。
- Server 定向绿灯：7 个测试文件、32 个测试全部通过。

### 阶段 29：开放接口产品成熟度评估
- **状态：** complete
- 用户授权在 Synapse MCP 不支持 `/document/...` 路由后，改用当前仓库中的文档源码和接口实现进行评估。
- 本轮只做只读评审；规划文件用于记录证据，不修改产品代码或公开文档。
- 已完成文档、设计、controller、guard、grant、下载流、API key、usage log、Nginx 和测试证据交叉核对。
- 结论：下载能力本身已生产可用，但开放平台治理尚不成熟；优先修正资源/scope 命名、限流、机器契约和 HTTP 合同测试。

### 阶段 26：提交前审计与验证
- **状态：** in_progress
- 用户要求提交当前工作区全部代码、推送当前分支并部署生产服务端。
- 已恢复阶段 1–25 的实现、测试、生产复测和公开文档上下文；本轮将先验证，再提交、推送、部署。
- 已确认 `main` 比 `origin/main` 领先 2 个提交，当前另有 23 个已跟踪修改且无未跟踪文件。
- 已确认正式部署脚本语法有效、生产环境文件存在，部署仍包含完整备份、迁移预演、回滚与健康检查。
- 已刷新远端，确认 `origin/main` 未前进且本地无分叉。
- 已根据各 workspace 实际 scripts 确定提交前验证命令，准备并行执行。
- 首轮提交前验证完成：Server 全量测试因 1000 文件测试超时出现 1 个失败；Dashboard 构建、文档构建、Desktop hard constraints 通过。
- 已暂停提交，先修正该边界测试的稳定性并重跑验证。
- 已读取测试规则与失败用例，确认采用局部 15 秒时限，不改变业务代码或全局测试配置。
- 已为单个 1000 文件边界用例设置 15 秒局部超时。
- 定向 Drive 测试 139/139、Server 类型检查、Dashboard 定向测试 37/37 全部通过。
- Server 全量测试复跑 1147/1147 通过。
- 完成 diff 空白、变更范围、真实 API 密钥和生产环境文件忽略规则审计；阶段 26 通过，进入全量提交与推送。
- 已执行 `git add -A` 并创建提交 `66a7b8243`，23 个文件全部纳入提交。
- 已创建验证记录提交 `10f45691a`，并将本地领先的 4 个提交成功推送到 `origin/main`。
- 阶段 27 完成，进入生产服务端部署。
- 部署前基线：旧镜像 `synapse-server:deploy-20260823_105738` healthy，公开健康检查正常。
- `bash deploy.sh` 以部署 ID `20260823_115548` 完成全部 19 步，数据库备份、迁移预演、生产迁移、容器切换和内外健康检查通过。
- 新容器运行 `synapse-server:deploy-20260823_115548` 且 healthy；公开健康接口和新版文档内容独立复核通过。
- 阶段 28 完成，未发生回滚或残留失败步骤。

### 阶段 23：公开文档契约审计
- **状态：** in_progress
- 已恢复既有规划上下文，没有覆盖此前已完成的开放接口修复、生产部署与复测记录。
- 已确认公开文档主要位于 `document/open-api/`。
- 发现仓库规则引用的 `docs/agents/document-copy.md` 缺失；实际规则位于 `.claude/rules/document-copy.md`，已完整读取。
- 已读取 VitePress 配置、首页、开放接口概览和现有 API 参考，开始逐项对照服务端契约。
- 已核对 POST/GET controller、API key guard、异常包装、下载授权、Drive 链接入口与制品类型，形成首轮字段及响应行为清单。
- 已核对 URL 解析器和 Open API 定向测试索引，确认同源限制、支持路径族、密码 query 与稳定错误边界。
- 已读取产品定位与文档站 README，确认首页需要去除营销式英文 tagline，且本轮不需要部署文档站。
- 已从 controller 测试确认请求体拒绝独立 `password` 和其它额外字段。
- 已核对 Console 密钥管理界面、API key controller、发布说明和 Open API 设计硬约束；阶段 23 审计结论已完整。
- 已完成首页、开放接口概览、接口参考与发布说明修改。
- 首轮 diff 复核与陈旧文案扫描通过，准备执行 VitePress 构建。
- `pnpm --filter @synapse/document run build` 通过，VitePress 已成功构建客户端、服务端 bundle 并渲染全部页面。
- 最终检查通过：无 diff 空白错误，无真实 API 密钥泄漏，生成页面包含开放接口概览与 API 参考链接。
- 本轮未部署、未提交；保留工作区中此前的服务端、Dashboard 和设计文档改动。

### 阶段 18：缺陷修复、部署与复测
- **状态：** in_progress
- 用户要求修复上一轮实测发现的两个缺陷，重新部署生产并完整复测。
- 修复目标限定为：不存在分享链接的 500/404 映射、单次 1000 文件 MCP 上传数据库 500。
- 成功标准：先有可复现红灯，修复后本地验证通过；生产部署健康；生产同用例转绿且原有核心矩阵无回归。

### 阶段 14：开放接口全覆盖实测
- **状态：** in_progress
- 执行的操作：
  - 用户提供开放接口秘钥并授权用 MCP 在其云盘创建目录和上传测试文件。
  - 读取 `synapse-skill` Drive 领域规范与文件规划规范；确认所有远程写入使用专用 MCP 工具。
  - 读取公开接口文档、POST/GET controller、API key guard、grant service 和制品准备错误映射。
  - 确认当前只有分享链接下载能力，入口为 `POST /api/open/v1/drive/share-links/downloads`，下载为响应返回的临时 GET URL。
  - 确认报告与本地规划文件不得保存 API key、download token、签名 URL 或分享密码。
  - 首次 MCP 创建测试目录失败：当前 Synapse MCP 返回“账号未登录”；未执行任何远程写入，也未改用非 MCP 上传。
  - 完成首轮 20 个认证/schema/来源/错误契约用例：19 个通过，1 个失败；16 路并发请求均未出现 429，requestId 全部唯一。
  - 失败项为不存在 `/share` 链接返回 `500 INTERNAL_ERROR`，而 `/sites` 与 `/files` 不存在链接正确返回 404。
  - 补充 8 个认证头与下载 token 负向用例，全部通过：scheme 大小写/空格、Basic、token 缺失/空/短/非法字符、未知 grant。
  - 使用标准 `shr_` + 32 字符 ID 复核不存在分享链接，仍稳定返回 500，排除测试 ID 格式干扰。
  - 用户重启正式包并登录后，Drive MCP 登录态恢复。
  - MCP 创建唯一隔离目录，上传普通文件、密码文件、嵌套集合、站点目录和公开素材；集合含空目录、大小写不同文件、同名文件与文件夹。
  - MCP 创建普通文件分享、密码分享、文件夹分享、公开站点和密码站点。
  - MCP 正确拒绝一次上传 1001 文件；但一次上传文档允许上限 1000 文件时服务端返回数据库操作失败。
  - 改用 500 + 501 两批同名文件夹合并，成功构造 1001 个 1 字节文件的归档边界夹具；当前临时移出 overflow 文件，使分享目标精确为 1000 文件。

### 阶段 15：MCP 测试数据准备
- **状态：** complete
- 远程隔离目录：`Codex-OpenAPI-E2E-20260823-01a02c53`
- 所有夹具均由 `app_drive_*` MCP 创建或上传，未使用 HTTP 管理接口替代。
- 未覆盖或修改用户既有文件。

### 阶段 16：开放接口端到端测试
- **状态：** complete
- 主功能矩阵 18/18 通过：单文件、响应头、重复/Range/并发、token 交叉、密码分享、文件夹与子项、空目录、站点、密码站点、公开素材、1000 文件 ZIP。
- 不可变快照通过：MCP 原 itemId 覆盖 v1→v2 后，旧 grant 仍返回 v1，新 grant 返回 v2，snapshotId 改变。
- 归档临界迁移通过：1000 文件时授权与 ZIP 下载成功；补回第 1001 文件后，新授权返回 413，旧 1000 文件授权仍能下载原快照。
- URL 边界 9/9 通过：2048/2049、fragment、主机大小写、默认 443 端口、尾点域名、FTP、重复 password 顺序。
- 补充矩阵 6/6 通过：8 路有效授权并发、额外 query、重复 token、fragment token、文件夹/Site ZIP 响应头。
- 已启动真实 10 分钟过期计时：初始 TTL 约 600 秒且立即下载成功，正在等待到期后的 410 结果。
- 真实等待约 10 分钟后，同一下载 URL 返回 410 `DOWNLOAD_UNAVAILABLE`，requestId 与 no-store 均正确。
- 源失效实测通过：分别在签发 grant 后用 MCP 停用本次创建的普通分享和公开站点，两个旧 grant 均立即返回 410；站点随后已恢复 active。
- Open API 独立用例最终 66 项：65 通过，1 失败。唯一失败为不存在普通分享返回 500 而不是 404。

### 阶段 17：清理与报告
- **状态：** complete
- 已精确删除本次 `/tmp` 测试目录，不可恢复；所有内容均为本次生成且远程已有对应测试夹具。
- 云盘隔离目录及公开素材未删除，因为用户只明确授权创建与上传，未授权远程删除。
- 普通文件分享已因源失效测试停用；公开站点完成停用测试后已恢复 active。其余本次创建的分享、站点与公开素材仍存在。
- 200 MiB 归档总大小未做生产写入实测；API key scope 移除/撤销、用户停用、使用日志数据库故障也未人为制造，以避免影响用户凭证、账号或生产基础设施。

### 阶段 13：API 秘钥卡片列表改造
- **状态：** complete
- 执行的操作：
  - 用户要求取消 API 秘钥表格，改用定制化卡片 UI。
  - 确定使用现有 shadcn Card、Badge、Button 和主题 token，保持单层结构并复用已有权限编辑流程。
  - 先将布局回归测试改为“无 table、每个秘钥为 Card 且操作归属同一卡片”；红灯确认当前仍渲染表格。
  - 卡片按名称/前缀、管理操作、权限与时间元数据分组，窄窗口下切换为纵向信息流并允许操作换行。
  - Dashboard 组件测试 6/6、TypeScript 检查和生产构建通过；`git diff --check` 通过。


### 阶段 9：API 秘钥权限编辑与选择器优化
- **状态：** complete
- 执行的操作：
  - 读取当前规划、进度和发现文件，确认上一任务已经完成。
  - 核对现有 API key controller/service、Dashboard 设置页、权限目录和临时下载 grant 校验。
  - 确认现有设计明确禁止原地改权限，与用户新需求冲突，后续将同步修订长期边界。
  - 锁定 PATCH 契约、允许空权限、即时失效和名称加说明的权限列表方案。
  - 先补充 Server、Open API、Dashboard API 和 Dashboard 交互回归测试。
  - 红灯结果符合预期：Server 6 个用例因缺少 update/description 失败；Dashboard 4 个用例因缺少 PATCH 客户端、编辑 UI、说明和错误状态失败；grant 权限失效用例已经通过现有统一 410 分支。

### 阶段 10：服务端与 Dashboard 实现
- **状态：** complete
- 执行的操作：
  - 实现服务端权限目录 description 和 strict PATCH 权限更新接口。
  - 实现当前用户未撤销秘钥的事务更新、前后 scopes 审计和服务层防御校验。
  - 临时下载 grant 读取当前 key scopes，并在权限移除后复用 410 失效响应。
  - Dashboard API 增加 PATCH 客户端，设置页增加权限编辑状态、缓存更新和成功提示。
  - 创建和编辑弹窗共用带说明、整行点击、内部滚动、加载/错误/空状态的权限选择器。
  - 检测到并发提交 `101195880` 将操作列正式调整为右对齐；保留最新提交，仅在同一右对齐操作组新增“编辑权限”。
  - 绿灯测试：Server 19/19，Dashboard 37/37。

### 阶段 11：文档与发布说明同步
- **状态：** complete
- 执行的操作：
  - 修订开放 API 设计、实施记录、模块边界、公开概览和下载接口文档。
  - 删除“权限只读/撤销重建”的陈旧约束，补充 PATCH、空权限、审计和临时下载即时失效语义。
  - 更新待发布说明，同时保留并发提交已有的操作列对齐条目。

### 阶段 12：验证与交付
- **状态：** complete
- 执行的操作：
  - Server typecheck 通过。
  - Dashboard TypeScript 检查通过。
  - `git diff --check` 通过。
  - Server 定向测试复跑 20/20 通过，新增 scope 保留/移除两条明确路径。
  - Dashboard 生产构建通过；仅出现仓库既有的大 chunk 警告。
  - 文档站 VitePress 构建通过。
  - 最终陈旧约束扫描未发现“权限只读/撤销重建”等旧表述，工作区仅包含本次实现及规划记录。


### 阶段 1：需求与现状调查
- **状态：** complete
- 执行的操作：
  - 确认无旧规划文件或未同步会话。
  - 读取 `planning-with-files-zh` 与 `karpathy-guidelines` 约束。
  - 建立本次任务的计划、发现和进度文件。
  - 定位 OpenAPI controller、service、测试、公开文档及专用设计/实施文档。
  - 确认当前契约为 `url` + 可选独立 `password`，TTL 为 5 分钟。
  - 阅读专用设计、实施记录、controller、service、grant service 与 Drive 链接解析链路。
  - 确认完整 URL 已支持内嵌密码；OpenAPI 层移除独立字段即可复用现有安全解析。
  - 追踪单文件 Content-Disposition 与多文件 ZIP entry 路径，确认均来自云盘原始名称。
  - 根据现有单文件/集合边界形成 Markdown 策略：单 `.md` 原样下载，带资源交付使用文件夹分享 ZIP。
- 创建/修改的文件：
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### 阶段 2：技术方案与测试设计
- **状态：** complete
- 执行的操作：
  - 确定 strict 请求体只允许完整 `url`，独立 `password` 字段应返回 `INVALID_REQUEST`。
  - 确定仅修改 OpenAPI grant TTL 为 10 分钟。
  - 确定单文件命名无需重构，并验证 ZIP 碰撞场景是否改名。
  - 确定 Markdown 单文件原样下载、文件夹集合 ZIP 的产品策略。
- 创建/修改的文件：
  - `task_plan.md`
  - `findings.md`
  - `progress.md`

### 阶段 3：实现
- **状态：** complete
- 执行的操作：
  - 先编写 controller、grant TTL 和文件名回归断言。
  - 运行红灯测试，确认独立 `password` 仍被接受且 grant 仍为 5 分钟。
  - 移除 OpenAPI controller、service 和 Drive 制品准备入口的独立密码参数。
  - 将 OpenAPI grant TTL 调整为 10 分钟。
  - 同步公开文档、设计、实施记录、模块边界和待发布说明。
  - 修正 OpenAPI ZIP 大小写碰撞与同名文件/文件夹的 ` (2)` 改名行为。
- 创建/修改的文件：
  - `server/src/open-api/open-api.controller.spec.ts`
  - `server/src/open-api/open-api-download-grant.service.spec.ts`
  - `server/src/open-api/open-api-share-link-download.service.spec.ts`
  - `server/src/drive/drive.service.spec.ts`
  - `server/src/open-api/open-api.controller.ts`
  - `server/src/open-api/open-api-share-link-download.service.ts`
  - `server/src/open-api/open-api-download-grant.service.ts`
  - `server/src/drive/drive-link-intake.service.ts`
  - `server/src/drive/drive-link-intake.service.spec.ts`
  - `server/src/drive/drive.service.ts`
  - `document/open-api/api/share-link-download.md`
  - `docs/agents/module-boundaries.md`
  - `docs/superpowers/specs/2026-08-22-open-api-share-link-download-design.md`
  - `docs/superpowers/plans/2026-08-23-open-api-share-link-download-implementation.md`
  - `RELEASE_NOTES_PENDING.md`

### 阶段 4：测试与验证
- **状态：** complete
- 执行的操作：
  - 运行 5 个相关测试文件，174/174 通过。
  - 运行 server 类型检查，通过。
  - 运行 VitePress 文档构建，通过。
  - 运行完整 server 测试，最终 1139/1139 通过。
  - 审查文件名 manifest，补齐大小写碰撞和同名文件/文件夹原名保证。

### 阶段 5：交付
- **状态：** complete
- 执行的操作：
  - 完成陈旧契约扫描、空白检查和需求逐项审计。
  - 准备交付摘要、验证结果与 Markdown 策略结论。

### 阶段 6：全量提交
- **状态：** complete
- 执行的操作：
  - 读取仓库部署规则和完整 `deploy.sh`。
  - 确认当前分支为 `main`，远程为 `origin`。
  - 确认用户要求覆盖当前工作区全部既有改动。
  - 复核 109 个已跟踪变更和 48 个未跟踪文件，提交范围包含文档站迁移、OpenAPI、API 密钥、Desktop 项目终端和部署增强。
  - 使用 `git add -A` 提交全部 154 个文件，提交为 `dfcf00abf`。
  - 首次提交后工作区又出现 API 密钥操作列对齐修复；按“提交所有代码”的要求保留该变更，并通过 Dashboard TypeScript 检查后单独提交。

### 阶段 7：服务端部署
- **状态：** complete（用户取消部署，未切换生产）
- 执行的操作：
  - 确认 `server/.env.server` 存在。
  - `bash -n deploy.sh` 通过。
  - 生产服务器 `root@120.53.17.64` SSH 连通性检查通过。
  - 部署执行到第 10/19 步 Docker 镜像构建；用户要求停止后立即中断，未进入临时库迁移预演、停服、生产迁移或新服务切换。

### 阶段 8：部署验证与收尾
- **状态：** complete
- 执行的操作：
  - 确认生产服务始终运行旧镜像 `synapse-server:deploy-20260821_202831`，容器状态为 healthy。
  - 确认同步前后的生产 `.env` 哈希一致，无需回滚配置。
  - 精确删除部署 ID `20260823_085857` 对应的环境、Globals、在线数据库备份和可能的最终/Drive 备份、候选镜像、回滚镜像及临时数据库。
  - 复核上述临时资源均不存在；公开 `https://synapse.d2.pub/healthz` 返回 `{"status":"ok"}`。

## 测试结果
| 测试 | 输入 | 预期结果 | 实际结果 | 状态 |
|------|------|---------|---------|------|
| 尚未执行 | - | - | - | pending |
| 修复前生产开放接口全覆盖 | MCP 创建的隔离测试数据 | 当前全部公开能力与安全边界 | 65/66 通过，发现 1 个缺陷 | investigated |
| 认证与请求 schema | 无认证、假 key、空/错/超长/额外字段、错误来源 | 稳定错误 envelope | 13/13 通过 | pass |
| 不存在链接 | `/share`、`/sites`、`/files` | 404 `LINK_NOT_FOUND` | Site/asset 通过；share 返回 500 | fail |
| 并发错误请求 | 16 路并发 | 无 429，requestId 唯一 | 16 个唯一 requestId，无 429 | pass |
| Authorization 语法 | lowercase bearer、双空格、Basic | 401 `INVALID_API_KEY` | 3/3 通过 | pass |
| 下载 token 负向边界 | 缺失、空、短、非法字符、未知 grant | 400/404 稳定错误码 | 5/5 通过 | pass |
| MCP 文件夹上传上限 | 1001 / 1000 / 500+501 个 1 字节文件 | 1001 客户端拒绝；1000 应可上传 | 1001 正确拒绝；1000 返回数据库 500；拆批成功 | fail |
| 主功能矩阵 | 真实分享、站点、公开素材与 ZIP | 全部制品与响应契约正确 | 18/18 通过 | pass |
| 不可变快照 | v1 grant 后原 itemId 覆盖为 v2 | 旧 grant=v1，新 grant=v2 | 通过 | pass |
| 归档文件数临界 | 1000→1001 文件 | 201/200→413，旧 grant 不变 | 通过 | pass |
| URL 精确边界 | 2048/2049、origin、query/password | 与解析契约一致 | 9/9 通过 | pass |
| 有效并发与下载 query | 8 路授权、token/query、ZIP header | 无 429、唯一授权、稳定 header | 6/6 通过 | pass |
| 真实过期 | 10 分钟 grant | 到期后 410 | 410 `DOWNLOAD_UNAVAILABLE` | pass |
| 源分享/站点停用 | 签发 grant 后 MCP 停用测试源 | 旧 grant 立即 410 | 2/2 通过；站点已恢复 | pass |
| 修复前 Open API 总计 | 66 个独立生产实测用例 | 稳定公开契约 | 65 通过，1 失败 | investigated |
| 修复后生产 Open API 核心复测 | 认证、schema、三类链接、密码、制品、token、并发、1001 上限、真实过期 | 全部通过 | 59/59 通过 | pass |
| 修复后 MCP 1000 文件边界 | 单次 1000 个 1 字节文件 | 1000 成功、0 失败 | 1000/1000 成功 | pass |
| 修复后源失效重校验 | grant 创建后 MCP 停用新测试分享 | 旧 grant 立即 410 | 410 `DOWNLOAD_UNAVAILABLE` | pass |
| 红灯：请求契约 | 请求体含独立 `password` | `400 INVALID_REQUEST` | 当前仍返回 201 | expected-fail |
| 红灯：grant TTL | `now=09:00` | `expiresAt=09:10` | 当前为 `09:05` | expected-fail |
| 文件名回归 | 中文 Markdown 单文件与文件夹 ZIP | 原名保留 | 141 个相关测试通过 | pass |
| 绿灯：OpenAPI 与 Drive 相关测试 | 5 个测试文件 | 全部通过 | 174/174 通过 | pass |
| Server 类型检查 | server TypeScript | 无类型错误 | 通过 | pass |
| API 秘钥权限编辑定向测试 | Server 3 个文件、Dashboard 2 个文件 | 全部通过 | Server 20/20；Dashboard 37/37 | pass |
| Dashboard 生产构建 | Dashboard TypeScript 与 Vite | 构建成功 | 通过，存在既有 chunk 大小警告 | pass |
| API 秘钥卡片布局 | Dashboard 组件测试 | 不再渲染 table，操作归属对应 Card | 6/6 通过 | pass |
| 权限编辑文档构建 | VitePress | 构建成功 | 通过 | pass |
| 文档站构建 | VitePress | 构建成功 | 通过 | pass |
| Server 完整测试（首次） | 全部 server 单测 | 全部通过 | 1138 通过，1 个无关 `ECONNRESET` | investigated |
| 无关失败隔离复跑 | problem-feedback HTTP | 全部通过 | 8/8 通过 | pass |
| Server 完整测试（复跑） | 全部 server 单测 | 全部通过 | 1139/1139 通过 | pass |
| ZIP 原名碰撞红灯 | 大小写不同文件、同名文件/文件夹 | 不追加 ` (2)` | 当前追加 ` (2)` | expected-fail |
| ZIP 原名碰撞绿灯 | 同上 | 精确保留原名 | 通过 | pass |
| Dashboard TypeScript | API 密钥操作列对齐修复 | 无类型错误 | 通过 | pass |

## 错误日志
| 时间戳 | 错误 | 尝试次数 | 解决方案 |
|--------|------|---------|---------|
| 2026-08-23 08:30 | 首轮测试补丁误匹配相邻 Drive 测试夹具，出现 3 个非预期失败 | 1 | 精确修复受影响的夹具；保留 controller 与 TTL 两个预期红灯 |
| 2026-08-23 08:34 | 搜索表达式中的反引号触发 shell 命令替换 | 1 | 改用无反引号的固定模式；本次无写入副作用 |
| 2026-08-23 08:35 | 完整 server 测试 1138/1139 通过，`problem-feedback` 大请求用例 `ECONNRESET` | 1 | 隔离复跑；不修改无关模块 |
| 2026-08-23 08:36 | 更新规划文件的补丁上下文不匹配 | 1 | 重新读取后用精确上下文完成更新 |
| 2026-08-23 08:38 | 文件名边缘审计文档补丁再次遇到上下文不匹配 | 2 | 拆分文档与规划补丁，按精确片段更新 |
| 2026-08-23 09:00 | 用户在第 10/19 步要求停止部署 | 1 | 立即中断镜像构建，按部署 ID 清理临时资源，并验证旧生产服务与公开健康检查正常 |
| 2026-08-23 09:04 | 规划完整性脚本直接执行时报 permission denied | 1 | 使用 `bash scripts/check-complete.sh` 方式重新执行 |
| 2026-08-23 09:08 | 新增权限编辑回归测试出现 10 个预期红灯 | 1 | 失败点均对应尚未实现的接口、权限说明和 Dashboard 状态；进入实现阶段，不重复运行未修改代码 |
| 2026-08-23 09:10 | 首个实现补丁在 grant 条件上下文处不匹配，整批补丁未应用 | 1 | 改为按子系统拆分窄补丁，并先读取精确条件片段 |
| 2026-08-23 09:14 | 陈旧约束扫描无匹配时 `rg` 以状态 1 结束，并使后续 `&&` 查询未执行 | 1 | 将第二个查询单独执行；确认无陈旧只读约束，不再用 `&&` 串联“无匹配即成功”的审计搜索 |
| 2026-08-23 09:27 | 卡片布局回归测试按预期因现有 table 渲染失败 | 1 | 红灯证据成立，进入卡片实现，不重复运行未修改代码 |
| 2026-08-23 本次 | Drive MCP 返回“账号未登录” | 1 | 停止重复 MCP 写入；继续无夹具测试，等待登录态恢复 |
| 2026-08-23 本次 | 不存在 `/share` 链接返回 500 | 1 | 对照源码确认 NotFoundException 未进入 `DriveOpenApiDownloadPreparationError` 映射，准备标准长度 ID 复核 |
| 2026-08-23 本次 | 标准长度不存在 shareId 仍返回 500 | 2 | 已确认是生产缺陷，不再重复相同请求；记录复现契约并等待后续修复授权 |
| 2026-08-23 本次 | MCP 单次 1000 文件上传返回数据库操作失败 | 1 | 改为 500+501 两批合并；保留为独立缺陷，不重复相同批次 |
| 2026-08-23 本次 | 本地拆批 A 因 `seq -w 1 500` 只生成三位序号而复制失败 | 1 | 从原 1000 文件列表排序后复制前 500 个，重新核对数量 |
| 2026-08-23 11:04 | 404 复测 shell 使用 zsh 只读变量 `status` | 1 | 改用 `http_status` 立即复跑，得到 404 `LINK_NOT_FOUND`；凭证未输出或落盘 |

### 阶段 18：缺陷根因与修复边界
- **状态：** complete
- 执行的操作：
  - 读取 Drive、开放 API、模块边界、测试和完整生产部署脚本规则。
  - 确认不存在分享的 NotFound 异常未在 Open API 制品准备入口归一化。
  - 确认 1000 文件准备在默认 5 秒 Prisma 交互事务中执行约 6,000 次串行数据库操作，正式响应属于 Prisma 已知数据库错误。
  - 审计 MCP capability/schema/dispatcher、内置 Drive Skill/API reference 与公开 Open API 文档，确认现有契约已正确声明 1000 和 404 边界。

### 阶段 19：回归测试与修复
- **状态：** complete
- 执行的操作：
  - 先运行两个新增回归测试，确认分别因缺少事务参数和抛出 NotFoundException 失败。
  - 为文件夹上传准备事务增加 10 秒 maxWait 和 30 秒 timeout，保留单批原子准备与失败回滚。
  - 在 Open API 分享制品准备入口把 NotFoundException 归一化为 `status: not_found`。
  - 更新待发布说明；定向 Drive service 测试 139/139 通过。

### 阶段 20：本地验证
- **状态：** complete
- 执行的操作：
  - Server typecheck 通过，Server 完整测试 94 个文件、1147 个测试全部通过。
  - Server、Dashboard、文档站生产构建全部通过；Dashboard 仅有既有大 chunk 警告。
  - Dashboard API 秘钥相关 2 个测试文件 37/37 通过，部署脚本 shell 语法通过。
  - `git diff --check` 通过；确认部署会包含当前未发布的开放 API、API 秘钥权限编辑/卡片和文档站变更，以及本次两个缺陷修复。

### 阶段 21：生产部署
- **状态：** complete
- 执行的操作：
  - 运行 `bash deploy.sh`，部署 ID `20260823_105738`，19/19 步全部完成，总耗时 135 秒。
  - 备份生产环境、Postgres globals、在线数据库和最终切换数据库；COS 已配置，因此按脚本跳过本地 Drive fallback 备份。
  - 候选镜像构建、回滚镜像标记、临时数据库迁移预演、最终备份恢复验证全部通过；生产无待执行 migration。
  - 新容器启动后第 3 次健康检查全部通过，公开桌面更新页和文档站通过。

### 阶段 22：生产复测与收尾
- **状态：** complete
- 执行的操作：
  - MCP 单次上传 1000 个 1 字节文件成功，1000/1000 上传完成、0 失败。
  - 合法格式不存在分享返回 404 `LINK_NOT_FOUND`。
  - 开放 API 到真实过期等待前的核心矩阵 58/58 通过；真实十分钟过期后最终 59/59 通过。
  - 新测试分享签发 grant 后用 MCP 停用，旧 grant 返回 410 `DOWNLOAD_UNAVAILABLE`。
  - 再次确认生产容器运行 `synapse-server:deploy-20260823_105738` 且 healthy，远端源码包含两处修复。
  - 精确删除本地 1000 文件目录、临时测试脚本和源文件；远程隔离测试数据按授权边界保留。

## 五问重启检查
| 问题 | 答案 |
|------|------|
| 我在哪里？ | 阶段 22 已完成修复、部署和生产复测 |
| 我要去哪里？ | 输出最终修复、部署、验证与残留数据报告 |
| 目标是什么？ | 验证当前开放接口全部功能和边界条件，不泄露凭证，不影响用户既有数据 |
| 我学到了什么？ | 见 findings.md 的“开放接口全覆盖实测”章节 |
| 我做了什么？ | 修复两个缺陷，完成 19 步部署，生产核心复测 59/59、1000 文件 1000/1000、源失效 410 均通过 |

---
*每个阶段完成后或遇到错误时更新此文件*

### 阶段 32：环境相关链接只读审计
- 用户要求先不修改实现，只检查 DEV 与生产环境下所有相关链接的解析方式，重点包含 Console API 密钥权限的文档跳转和 OpenAPI 契约地址。
- 本轮产品代码与公开文档保持只读；仅在既有规划文件记录审计过程和结论。
- **状态：** complete
- 已核对 Dashboard 3000、Server 3001、Document 19773 的本地拓扑，以及生产 Nginx 将 `/api`、`/console`、`/document` 合并到同一 origin 的部署拓扑。
- 已确认 API key capability 的相对文档地址在 DEV 会错误落到 Dashboard 3000；Dashboard Vite proxy 当前没有 `/document` 转发。
- 已确认 OpenAPI 相对 `servers` 是正确模式，但相对 `externalDocs`、文档页硬编码机器契约/API/cURL URL 都需要独立环境地址来源。
- 已把地址分为 P0/P1/P2，并确认 Dashboard 相对 API、Server `APP_PUBLIC_URL` 业务链接、Desktop 生成式 deployment config 和固定 release CDN 不需要改变现有模式。
- 未修改任何产品代码、公开文档、环境文件或部署配置，未启动服务；本轮仅更新任务规划记录。

### 阶段 33：环境链接契约与回归测试
- **状态：** complete
- 用户已授权实施阶段 32 的环境链接治理结论。
- 范围限定为文档相关运行时/构建时链接及其集中配置，不修改已正确的 Dashboard 相对 API、Desktop deployment config 或固定发布 CDN。
- 已新增 Server 文档 URL helper、API capability、OpenAPI externalDocs、env/schema、DEV 脚本、Docker/compose 和文档 Markdown 替换回归测试。
- 首轮红灯符合预期：Server 76 项中 71 项通过、5 项因实现缺失失败，另有 2 个测试文件因新 helper/factory 尚不存在无法加载；Node 脚本 6 项中 4 项通过、2 项因文档 helper 与 DEV 默认值缺失失败。
- 已实现 Server 文档 URL resolver、绝对 API capability 文档地址、动态 OpenAPI externalDocs、DEV 文档地址注入、env/schema、compose runtime 和 Docker build arg。
- 文档站已使用集中占位符替换应用根地址，页面渲染与复制 Markdown 共用同一替换函数；开放接口概览和接口页已移除操作性生产域名硬编码。
- 首轮绿灯：Server 6 个目标测试文件 86/86，Node 开发/文档脚本测试 9/9。
- 已同步 Server 配置示例与 README、Document README、模块长期边界、Open API 设计/实施记录、Dashboard 绝对链接交互夹具和待发布说明。
- 阶段 34 完成，进入类型检查、Dashboard 测试与三端构建验证。

### 阶段 35：环境链接验证与交付
- **状态：** complete
- Server 目标测试 86/86、文档/开发脚本测试 9/9、Dashboard 相关测试 38/38 通过。
- Server 完整回归 96 个测试文件、1164/1164 通过；Server typecheck 通过；额外覆盖 Compose 空 `DOCUMENT_PUBLIC_URL` 会按未配置处理并回退派生地址。
- Server、Dashboard 与 Document 构建全部通过；Document 分别验证 localhost 开发根地址和自定义生产根地址，生成页面与复制 Markdown 均无占位符或跨环境地址残留。
- Docker Compose 配置检查、生产构建参数契约和 `git diff --check` 全部通过。
- 最终环境边界：DEV 文档为 `http://localhost:19773/document`、DEV 应用/API 为 `http://localhost:3000`；生产由 `DOCUMENT_PUBLIC_URL` 与 `APP_PUBLIC_URL` 配置，前者为空时从后者派生 `/document`。

### 阶段 31：开放 API 机器可读契约
- 用户要求实施机器可读契约；范围限定为当前开放 API 的 OpenAPI 3.x 描述、稳定访问入口与验证，不扩展其它成熟度能力。
- 开始前已重新读取 `planning-with-files-zh` 与 `karpathy-guidelines`，并完成会话恢复检查。
- 已新增机器契约回归测试，首轮按预期因 `open-api-contract` 模块尚不存在而失败；红灯覆盖发现入口、三条路径、兼容端点弃用标记、共享 strict 请求 schema、响应 envelope 和两种 bearer 认证描述。
- 已实现 OpenAPI 3.1 权威文档、`GET /api/open/openapi.json` 发现 controller 和模块注册；canonical POST、deprecated 旧 POST、临时下载 GET、认证、请求/响应 schema、错误状态和下载 headers 均已描述。
- 运行时创建下载 controller 已改为复用契约模块导出的路径数组和 Zod strict 请求 schema；首轮绿灯为 2 个测试文件 6/6 通过。
- 增加真实 Nest HTTP 回归后，契约测试与 controller 测试合计 7/7 通过，响应 media type、缓存头和 JSON body 均已验证；Server typecheck 通过。
- 已同步开放接口概览、模块长期边界、原设计与实施记录、待发布说明；明确不维护第二份静态 JSON，后续开放接口变更必须同批更新契约测试。
- 最终验证：Open API/API key 相关测试 11 个文件 42/42、Server typecheck、Server 生产构建、VitePress 生产构建和 `git diff --check` 全部通过；契约测试同时验证真实 HTTP 返回、JSON 序列化和全部内部 `$ref` 可解析。
- 阶段 31 已完成；未新增依赖，未修改限流、密钥生命周期或其它开放 API 成熟度事项。

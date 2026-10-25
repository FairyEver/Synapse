# 仓库结构与工程运行规则

本文件承载原根 `AGENTS.md` 中与仓库结构、运行命令、配置、存储、打包和发布相关的详细约束。根 `AGENTS.md` 的每次任务硬规则仍优先。

## 技术栈与目录

- Electron 44 + Vite 8 + React 19 + TypeScript 6；macOS 最低支持 13。
- shadcn/ui（`radix-nova`）+ Tailwind CSS 4。
- pnpm monorepo：`@synapse/desktop`、`@synapse/document`、`@synapse/server`、`@synapse/pdf-renderer`、`@synapse/auto`、`@synapse/auto-web`。
- Git 管理内容，SQLite / DataRepository 管理业务数据。

```text
desktop/
├── electron/           # 主进程：runtime / bootstrap / services / database
├── app-capabilities/   # App 能力包
├── workflow-nodes/     # Workflow 节点全局注册
└── src/
    ├── app-shell/      # 壳层与共享编排
    ├── modules/        # Renderer 业务模块
    ├── components/ui/  # shadcn 组件
    ├── hooks/          # 共享 hooks
    ├── lib/            # 共享纯工具
    └── types/          # Renderer 全局类型
document/               # VitePress 文档站
server/                 # 服务端与管理后台
pdf-renderer/           # 隔离的 Markdown PDF Chromium 渲染服务
```

新增 renderer 业务模块必须放在 `desktop/src/modules/`。创建目录前先检查现有模块，不得引入 `desktop/src/features/` 等并行架构。`desktop/src/App.tsx` 只负责 app-shell 组合和顶层编排。

## 启动与验证

- `pnpm dev`：通过 mprocs 分栏启动 desktop、server、document；按 `q` 退出并停止本次启动的进程。
- `pnpm dev:prod`：同一面板启动，桌面端使用生产站点 URL。
- `pnpm dev:desktop`：仅桌面端。
- `pnpm dev:server`：服务端 API、dashboard、Postgres 和 PDF 渲染器；控制台自动打开 `http://localhost:19700/console/`，使用双栈监听；API 为 `19701`，PDF 宿主机映射为 `19702`。`pnpm dev` 和 `pnpm dev:prod` 共用该入口。
- `pnpm dev:document`：文档站。
- 对应停止命令为 `pnpm quit`、`pnpm quit:desktop`、`pnpm quit:server`、`pnpm quit:document`。

本机 HTTP 开发端口保留 `19700–19799`，Brick Lab 使用 `19800–19899`。完整分配与生产边界见 `.claude/rules/workspace-dev-ports.md`；数据库和生产映射不随开发 HTTP 端口修改。

只启动任务需要的最小范围。只改 `desktop/` 不要启动全栈；服务已经运行且热更新覆盖改动时不要重启。除非用户明确要求，不要为了验证主动启动 dev server、浏览器、应用窗口、DevTools、Playwright 或 MCP 页面检查。

本地服务停止统一使用根命令 `pnpm quit:server` / `pnpm quit`。Docker Compose 的本地默认变量经 Node 子进程 env 传递，不依赖 shell 变量赋值；Windows 的嵌套 pnpm 调用通过当前 pnpm 提供的 JavaScript 启动器或独立 pnpm.exe 执行，避免直接 spawn `.cmd` 或插入 shell 命令。独立执行内部脚本不属于受支持入口。

## 配置规则

- `desktop/config.ts` 集中放置桌面端全局配置常量；每个常量必须有中文注释说明用途和影响范围。
- `.env`、`.env.example`、`*.env.*` 必须按职责分组，并为每组、每项添加中文注释，说明用途、影响范围或单位。
- 示例配置不得包含密码、token、secret、私钥或真实连接串。
- 新增配置时同步更新校验、示例、部署/初始化脚本和相关 README。
- Dock 的一次性升级调整只在 `desktop/src/modules/apps/dock.ts` 的 `DOCK_MIGRATIONS` 清单末尾追加稳定且唯一的 ID，不修改或删除已发布条目，不绑定每次变化的应用版本。主进程加载或恢复配置时执行未完成条目，布局与 `global.dockMigrationIds` 同时原子落盘，成功后才更新缓存；用户移除、排序和恢复默认不清除完成记录。新安装预先标记当前清单；恢复历史备份时按备份携带的记录判断待执行迁移。

## 对象存储与数据归属

服务端 COS 按业务域隔离，不得因为“都是文件”混用 bucket：

- `DRIVE_COS_*`：用户云盘文件、版本、Drive 公开素材和 Drive Sites 资源；受 Drive 权限、生命周期和容量统计约束。
- `SKILL_REPOSITORY_COS_*`：云端 Skill 仓库文件、安装包和分发产物；不提供本地 fallback。
- `PLATFORM_MEDIA_COS_*`：用户/智能体头像、系统图标、模板/分享封面、模型图标，以及浏览器文档正文、文末留言和回复编辑产生的平台托管图片。默认私有读写，客户端不直接接触 COS bucket/key；文档图片使用 `document-images/` 前缀，由服务端 `/object/<objectId>` 代理公开读取。生产环境必须完整配置该组变量。
- `BACKUP_COS_*`：服务端灾备归档，当前 key 前缀为 `backups/`，不得承载运行时业务文件。

新增存储用途前先判断语义、权限、生命周期、计费归属和备份策略是否属于现有域。若不同，应新增明确的 storage domain，并同步 `server/src/config/env.ts`、测试、`server/compose.yml`、示例配置、部署脚本、README 和规则文档。COS 域配置必须完整校验 `SECRET_ID`、`SECRET_KEY`、`BUCKET`、`REGION`。

数据库只保存对象元数据和引用，例如 `storageKey`、`assetId`、`mimeType`、`size`、`sha256`、归属、状态和版本；不得把图片或大文件字节写入 PostgreSQL、SQLite 或 DataRepository。删除、替换、回滚和孤儿清理必须显式设计，底层删除失败不得静默丢失元数据。

桌面 `DataRepository` 的历史数据维护必须在主窗口创建后由独立 Worker 分批执行，主进程启动链不得等待扫描、清理或空间回收。SQLite 清理只处理已声明的冗余/孤儿记录并保留待处理数据；审计 JSONL 保持 append-only，活动文件达到 64 MiB 后无损轮转，历史分段继续参与读取和诊断导出，不得以轮转为由删除审计历史。

DataRepository 的原子批次与索引范围查询仅用于 schema 显式声明字段、索引和记录字节预算的 SQLite 集合。批次最多 128 项（含 CAS 前置条件）及 256 KiB，只允许同一连接同步提交；artifact IO、SDK 和权限等待不得放进事务。冲突必须显式返回，提交成功后才发布 ID 通知。范围读取使用声明索引的等值前缀与下一字段边界，最多 101 行，不允许业务 SQL 或深 OFFSET。原有 namespace 不自动切换通知或存储语义；Agent V2 切换仍须完成消费者、迁移及备份验收。

当前轻量 Backup 包含数据库和 Drive COS 对象清单，不包含 Drive、Skill Repository 或 Platform Media 的对象字节。需要可恢复的新域必须同步设计 manifest、复制和恢复流程。

## 服务端 Node 安全基线

- 服务端镜像安装 Alpine 系统包时保留签名校验，APK 网络超时设为 30 秒，首轮安装总超时 90 秒；默认 CDN 失败后回退到 `mirrors.aliyun.com` 的同版本 Alpine 镜像，总超时 180 秒，终止宽限 5 秒。软件包列表和 Alpine 版本不变，不跳过签名校验。

- API 镜像固定 Node `22.23.4-alpine`，PDF 构建阶段固定 `22.23.4-bookworm-slim`；PDF 最终运行阶段保留 Playwright 的 Chromium 与系统依赖，使用 `24.22.1-bookworm-slim` 提供的 Node 二进制替换 `/usr/bin/node`。不能只更新 PDF 的构建阶段。
- 两个最终镜像都运行 `scripts/deploy/check-node-runtime.mjs`，仅接受 Node 22（至少 `22.23.4`）或 Node 24（至少 `24.22.1`）。更新安全基线时同步调整 Dockerfile、检查器及测试。
- 部署构建使用 `--pull`，切换前在候选镜像中再次执行运行时检查；上线后核对实际容器版本和 API/PDF 请求，不能以宿主机 Node 版本或旧容器健康代替验证。

## 桌面更新与发布

- 服务端桌面更新凭证使用独立 `DESKTOP_UPDATE_INTENT_SECRET`；生产必须使用至少 32 个随机字节生成的未填充 Base64URL 高熵值，不得与管理员或用户 JWT 密钥相同。
- 签发只接受与 `APP_PUBLIC_URL` 精确相同的 Origin；凭证表达更新到当前最新版，120 秒过期、不落库，签发与验证接口独立严格限流并返回 `Cache-Control: no-store`。
- 日志不得记录原始 token、完整更新深链或验证请求体。
- GitHub Release 正文固定使用 `https://synapse.d2.pub/desktop/update`，不得写入 `synapse://`、目标版本或 query；本地 macOS 与 CI 使用同一生成逻辑。
- 生产部署必须确认稳定 URL 返回 2xx 独立更新页。macOS/Windows 正式包必须通过协议注册、冷启动和热启动 smoke。
- 用户可感知改动和发版风险必须即时写入 `RELEASE_NOTES_PENDING.md`，不要等发版时从提交记录补猜。
- `Desktop update acceptance` 工作流仅接受手动触发，在 GitHub 托管 Windows 2022 运行器的临时目录安装旧版并执行真实 NSIS 跨版本升级、窗口启动、PTY 和脚本运行时检查，不发布或部署。入口为 `desktop/scripts/checks/windows-update-acceptance.mjs`；它拒绝在本机或持久化运行器安装。Windows 加密兼容检查只使用合成夹具，实际用户凭据只在本机验收；无人值守安装使用原生静默模式，不能据此宣称安装向导的人机交互已验收。
- Windows 安装与升级验收会先检查进程和可执行文件版本观察能力。`mode=observer` 仅诊断观察器，不构建或安装；`mode=previous-startup` 只安装并验证旧版窗口和真实 Renderer IPC，不构建候选或执行更新；`mode=candidate-runtime` 独立构建候选目录并运行打包脚本检查，不安装或升级。诊断模式都不能作为跨版本验收成功的依据，只有 `mode=full` 且完整证据通过才能放行。
- Windows 验收以普通 GUI 方式启动已安装应用，不设置隐藏窗口启动标志；证据制品名包含提交和运行尝试号，重跑时必须核对对应尝试的制品，不能读取前次同提交的旧结果。

## Electron 打包边界

- Electron 固定 `44.9.3`；macOS 安装包 `minimumSystemVersion` 为 `13.0.0`，更新元数据 `latest-mac.yml` 的同名字段为 Darwin `22.0.0`。打包 wrapper 在 builder 全部结束后写入、发布准备再次严格校验，不能混用两种版本号或把门槛加到 Windows 元数据。
- `check:packaged-asar` 对完整候选包执行实际 Electron 运行时与网络探针，并将原生代码 section 指纹与 `desktop/scripts/checks/electron-security-baseline.json` 中核对过官方校验和的产物比较；签名和资源变化不应改变该代码 section。仅显式 `--resources-only` 可做零散 resources 结构检查，不代表完整安装包验收。升级 Electron 时必须重新审查并更新指纹，不允许仅放宽版本比较。
- Electron 的 Brotli 使用 Chromium 实现，不能直接套用服务端 Node 版本门槛。44.9.3 包含 Brotli 和 eMudhra 修复，但未包含全部 Node 24.22.1 修复；剩余风险和发布验收见 `docs/superpowers/specs/2026-10-23-desktop-electron-security-upgrade.md`。
- Electron 44 剪贴板原生 API 异步执行：工作流等待读写完成再返回和审计；图片走 ClipboardItem 的 PNG Blob；敏感格式走 osclipboard MIME，探测失败不采集，停止后或旧轮次的异步结果不能进入同步历史。业务 IPC、MCP 与 Workflow 输入输出不变。
- `app.asar` 是启动关键路径。改动 `desktop/package.json` 的 `files`、`asarUnpack`、`extraResources`，或新增/移动 worker、原生模块、可执行文件、运行时资源时，必须检查 sourcemap、packed 与 unpacked 文件不会错位。
- Claude SDK native binary 必须实际落在目标平台的 `app.asar.unpacked`；只有 `asarUnpack` 声明不足以作为证明。
- macOS Terminal 的 `node-pty` 保持在 `app.asar.unpacked`，`spawn-helper` 通过 macOS `extraFiles` 放在 `Contents/Frameworks/node-pty-spawn-helper`，由补丁通过 `SYNAPSE_NODE_PTY_SPAWN_HELPER` 使用；不得回退到 `Contents/Resources`。
- `sandbox: true` 的 Electron preload 必须由 `build:preload` 构建为不含相对 `require()` 的单文件，所有窗口复用该产物。
- 相关改动完成前运行 `pnpm --filter @synapse/desktop run check:packaged-asar`；若重新打包，优先验证新生成的 `desktop/release` 产物。

## 工程边界

- 通用版本迁移器子入口 `@synapse/shared/versioned-data-migrator` 按 `import` / `require` 分流 ESM / CommonJS 及类型声明；两种产物均由 `shared/src/versioned-data-migrator.ts` 构建，Renderer 不得加载 `.cjs`。
- 共享通知常量只在 `shared/src/notifications.ts` 定义；`@synapse/shared` 的构建同时生成 ESM 与 Electron CommonJS 产物。通知子入口按 `import` / `require` 分流运行时文件与类型声明，浏览器 ESM 依赖链不得导入 `.cjs`；不要手工维护第二份常量。
- 云盘搜索纯规则 `shared/src/drive-search.ts` 通过 `@synapse/shared/drive-search` 子入口向 ESM / CommonJS 分别导出 `.js` / `.cjs` 及对应类型；Electron 静态依赖使用该子入口，不能因此加载 ESM 根入口。新增规则必须通过共享包构建生成两种产物。
- 云盘同步常量子入口同样按 `import` / `require` 分流：`shared/src/drive-sync-constants.ts` 是该子入口的源码，构建生成 Electron 所需的 `.cjs` 和 `.d.cts`；批量读取上限只在此处定义，Renderer 和共享包 ESM 根入口均不得引用 CommonJS 产物。
- 严格保持 renderer、preload、主进程边界。
- Renderer 只通过 `window.synapse.*` 使用特权能力，不暴露原始 `ipcRenderer`、`window.require` 或宽泛 Electron API。
- 文件系统、Git、安装、下载、dialog、updater 和 OS 逻辑属于主进程。
- 新代码先复用，避免跨文件复制；组件、hook 或 service 过大时再按职责拆分。
- 不新增依赖，除非用户明确要求或已批准的设计明确需要。
- 生产代码使用结构化日志；禁止空 `catch` 和静默吞错。

## 本机邮箱存储

`app.mail.*` 的 11 个命名空间标记 `transferPolicy: local-only`，不进入 DataRepository 导出（包括 includeSecrets），导入包含这些命名空间时在任何写入前拒绝。未声明策略的现有域保持 portable。邮件凭据走 encrypted-json，元数据走有条件和上限的 SQLite 索引，正文/附件通过 DataRepository 的 ManagedAssetStore 管理文件字节；业务层不裸写文件。资产元数据先 staged 再 ready，删除先持久 delete-pending；后台有界维护仅在窗口创建后执行，已引用的草稿和发送资产不参与缓存淘汰。

邮箱本机附件的导入和导出使用资产基础设施的有界流接口；业务层先对规范化绝对路径执行权限检查。导入拒绝最终符号链接，导出用独占创建且不覆盖已有文件；失败时只清理本次新建的输出。远程邮件图片默认阻断，仅在当前邮件明确允许后解析并固定公共 IP 连接，每次重定向重新校验，禁止认证头、cookies 和内网目标。

更换 IMAP 端点或认证用户名会持久标记索引重建，阻止旧定位信息用于新连接；新连接使用新的文件夹和邮件 ID，即使服务器复用相同 UIDVALIDITY/UID。中断后必须先完成重建恢复再启用协议操作；原有本机内容保留，关联旧服务器的远端草稿转为冲突副本。草稿内容版本与存储 CAS 版本独立；草稿、预览、发送作业通过 `pinnedAssetIds` 声明持久引用，启动维护在账号队列内重建引用计数，再执行缓存清理。

发送预览与操作分别持有资产引用；预览过期只释放自己的引用，发送失败或结果未知的内容不能被普通缓存清理。SMTP 提交前持久化 submitting，服务端接受与草稿消费原子保存；中断后只转 unknown，不自动重发。`operation.get` 仅做有界只读 Sent 核验；确认未提交的客户端 Sent 保存失败可由原发送请求重试保存，不重复 SMTP。Sent 副本无法还原丢失的逐收件人 RCPT 结果，此时保留 unknown 和已找到副本的状态。SMTP MIME 不含 Bcc 邮件头，客户端保存的个人 Sent 副本可以保留。

邮箱主进程通过 ServiceRegistry 的 core.mail 组装，独立后台阶段在窗口创建后恢复索引、草稿及发送作业。读取和写信界面共用窄 preload bridge，公开工具共 44 项；密码配置、受控图片字节和文件选择仅私有 IPC。切换 SY 身份，包括同一用户重新登录，必须更新 generation 并取消旧请求；已显示的本机通知关闭，消息中心不收取邮箱内容。

邮箱 API 参考由 `node desktop/scripts/docs/generate-mail-reference.mjs` 生成到权威 Skill 包，schema 修改需同步生成并跑 mail 的 skill-parity 测试。新依赖、Node 协议库和 renderer 编辑器依赖须验证候选 app.asar 的闭包；仅本机候选构建不能代替真实阿里、Windows 或生产签名/更新验收。

邮箱索引中的 MIME 结构使用有界迭代检查（最多1000节点、深度30、结构缓存16KiB）；超限结构延迟到详情处理，不能阻塞其他邮件。索引内容预算48KiB为64KiB记录留出封装空间，异常或过大邮件头降级为明确的 metadataTruncated 条目，保留定位与原文导出，禁止自动据不完整地址构造回复或转发。

邮箱后台每分钟推进有界过期预览和资产维护批次，并保留分页游标；不能只在启动时释放过期预览占用。休眠、身份切换及退出停止维护计时器并等待当前批次，不在清理中重发邮件。

# 仓库结构与工程运行规则

本文件承载原根 `AGENTS.md` 中与仓库结构、运行命令、配置、存储、打包和发布相关的详细约束。根 `AGENTS.md` 的每次任务硬规则仍优先。

## 技术栈与目录

- Electron 41 + Vite 8 + React 19 + TypeScript 6。
- shadcn/ui（`radix-nova`）+ Tailwind CSS 4。
- pnpm monorepo：`@synapse/desktop`、`@synapse/website`、`@synapse/server`、`@synapse/auto`、`@synapse/auto-web`。
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
website/                # VitePress 文档站
server/                 # 服务端与管理后台
```

新增 renderer 业务模块必须放在 `desktop/src/modules/`。创建目录前先检查现有模块，不得引入 `desktop/src/features/` 等并行架构。`desktop/src/App.tsx` 只负责 app-shell 组合和顶层编排。

## 启动与验证

- `pnpm dev`：desktop + server。
- `pnpm dev:desktop`：仅桌面端。
- `pnpm dev:server`：服务端 API、dashboard 和 compose 服务。
- `pnpm dev:website`：官网。
- 对应停止命令为 `pnpm quit`、`pnpm quit:desktop`、`pnpm quit:server`、`pnpm quit:website`。

只启动任务需要的最小范围。只改 `desktop/` 不要启动全栈；服务已经运行且热更新覆盖改动时不要重启。除非用户明确要求，不要为了验证主动启动 dev server、浏览器、应用窗口、DevTools、Playwright 或 MCP 页面检查。

## 配置规则

- `desktop/config.ts` 集中放置桌面端全局配置常量；每个常量必须有中文注释说明用途和影响范围。
- `.env`、`.env.example`、`*.env.*` 必须按职责分组，并为每组、每项添加中文注释，说明用途、影响范围或单位。
- 示例配置不得包含密码、token、secret、私钥或真实连接串。
- 新增配置时同步更新校验、示例、部署/初始化脚本和相关 README。

## 对象存储与数据归属

服务端 COS 按业务域隔离，不得因为“都是文件”混用 bucket：

- `DRIVE_COS_*`：用户云盘文件、版本、Drive 公开素材和 Drive Sites 资源；受 Drive 权限、生命周期和容量统计约束。
- `SKILL_REPOSITORY_COS_*`：云端 Skill 仓库文件、安装包和分发产物；不提供本地 fallback。
- `PLATFORM_MEDIA_COS_*`：用户/智能体/团队头像、系统图标、模板/分享封面、模型图标等平台媒体。默认私有读写，客户端不直接接触 COS bucket/key。
- `BACKUP_COS_*`：服务端灾备归档，当前 key 前缀为 `backups/`，不得承载运行时业务文件。

新增存储用途前先判断语义、权限、生命周期、计费归属和备份策略是否属于现有域。若不同，应新增明确的 storage domain，并同步 `server/src/config/env.ts`、测试、`server/compose.yml`、示例配置、部署脚本、README 和规则文档。COS 域配置必须完整校验 `SECRET_ID`、`SECRET_KEY`、`BUCKET`、`REGION`。

数据库只保存对象元数据和引用，例如 `storageKey`、`assetId`、`mimeType`、`size`、`sha256`、归属、状态和版本；不得把图片或大文件字节写入 PostgreSQL、SQLite 或 DataRepository。删除、替换、回滚和孤儿清理必须显式设计，底层删除失败不得静默丢失元数据。

当前轻量 Backup 包含数据库和 Drive COS 对象清单，不包含 Drive、Skill Repository 或 Platform Media 的对象字节。需要可恢复的新域必须同步设计 manifest、复制和恢复流程。

## 桌面更新与发布

- 服务端桌面更新凭证使用独立 `DESKTOP_UPDATE_INTENT_SECRET`；生产至少 43 字符，不得与管理员或用户 JWT 密钥相同。
- 签发只接受与 `APP_PUBLIC_URL` 精确相同的 Origin；凭证表达更新到当前最新版，120 秒过期、不落库，签发与验证接口独立严格限流并返回 `Cache-Control: no-store`。
- 日志不得记录原始 token、完整更新深链或验证请求体。
- GitHub Release 正文固定使用 `https://synapse.d2.pub/desktop/update`，不得写入 `synapse://`、目标版本或 query；本地 macOS 与 CI 使用同一生成逻辑。
- 生产部署必须确认稳定 URL 返回 2xx 独立更新页。macOS/Windows 正式包必须通过协议注册、冷启动和热启动 smoke。
- 用户可感知改动和发版风险必须即时写入 `RELEASE_NOTES_PENDING.md`，不要等发版时从提交记录补猜。

## Electron 打包边界

- `app.asar` 是启动关键路径。改动 `desktop/package.json` 的 `files`、`asarUnpack`、`extraResources`，或新增/移动 worker、原生模块、可执行文件、运行时资源时，必须检查 sourcemap、packed 与 unpacked 文件不会错位。
- Claude SDK native binary 必须实际落在目标平台的 `app.asar.unpacked`；只有 `asarUnpack` 声明不足以作为证明。
- macOS Terminal 的 `node-pty` 保持在 `app.asar.unpacked`，`spawn-helper` 通过 macOS `extraFiles` 放在 `Contents/Frameworks/node-pty-spawn-helper`，由补丁通过 `SYNAPSE_NODE_PTY_SPAWN_HELPER` 使用；不得回退到 `Contents/Resources`。
- `sandbox: true` 的 Electron preload 必须由 `build:preload` 构建为不含相对 `require()` 的单文件，所有窗口复用该产物。
- 相关改动完成前运行 `pnpm --filter @synapse/desktop run check:packaged-asar`；若重新打包，优先验证新生成的 `desktop/release` 产物。

## 工程边界

- 严格保持 renderer、preload、主进程边界。
- Renderer 只通过 `window.synapse.*` 使用特权能力，不暴露原始 `ipcRenderer`、`window.require` 或宽泛 Electron API。
- 文件系统、Git、安装、下载、dialog、updater 和 OS 逻辑属于主进程。
- 新代码先复用，避免跨文件复制；组件、hook 或 service 过大时再按职责拆分。
- 不新增依赖，除非用户明确要求或已批准的设计明确需要。
- 生产代码使用结构化日志；禁止空 `catch` 和静默吞错。

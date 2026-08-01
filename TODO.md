# 待办

## Database 旧 schema 兼容清理

- 创建时间：2026-04-29
- 当前状态：暂时保留兼容逻辑
- 相关代码：
  - `desktop/electron/database/service.ts`
  - `desktop/electron/database/__tests__/service.test.ts`
  - `desktop/scripts/migrations/import-legacy-database.mjs`

### 背景

Synapse Database 的列元数据从旧的 `_meta_columns.enum_values` schema 升级到了当前的 `kind` / `choices` schema。

早前实现检测到旧 schema 后，会把旧数据库文件备份后创建一个新的空数据库。这会导致内测用户已有的数据表看起来像是丢失了。

当前运行时保留了三类兼容逻辑：

- 旧数据库文件仍是旧 schema：启动时迁移到 `synapse-database.db` 并原地升级 schema。
- 当前数据库为空且存在旧 legacy 备份：恢复最新 legacy 备份后再迁移。
- 手动导入数据库：允许导入旧 schema 备份，并在导入后迁移。

### 删除建议

不要立刻删除这些兼容逻辑。

- 旧 schema 原地迁移：保留到不再支持从修复前内测版本直接升级为止。
- 旧 legacy 备份自动恢复：至少保留到 2026-05-29，并且只有在一个发布周期内没有恢复报告或相关日志后再删除。
- 旧备份导入兼容：建议保留更久，因为用户可能很久以后才导入旧备份文件。

删除前必须用测试确认以下场景仍符合预期：当前 schema 数据库、旧 schema 数据库、legacy 备份恢复、旧备份导入。

## Data Store / 旧 MCP 名兼容清理

- 创建时间：2026-05-03
- 当前状态：暂时保留兼容逻辑
- 相关代码：
  - `desktop/electron/database/service.ts`
  - `desktop/electron/database/mcp-installer.ts`
  - `desktop/database/shared/server-identity.ts`
  - `desktop/electron/modules/config/ipc.ts`
  - `desktop/scripts/migrations/import-legacy-database.mjs`
  - `desktop/electron/database/__tests__/service.test.ts`

### 起因

Synapse 的数据能力从旧命名 `Data Store` / `data-store` / `synapse-data` 统一改为 `Database` / `database`。MCP server 名从历史的 `synapse-data` / `synapse-database` / `synapse-services` 统一到当前的 `synapse-mcp`。

这次改名会影响已经安装过旧版本的用户，因为他们本机可能仍然存在旧数据库文件、旧 WAL/SHM 文件、旧 legacy 备份文件，或者编辑器配置里仍注册着旧 MCP server 名。

### 当前结果

当前运行时保留了以下兼容逻辑：

- 如果用户目录里只有 `synapse-data.db`，启动时自动迁移为 `synapse-database.db`，并同步迁移 `-wal` / `-shm`。
- 如果当前 `synapse-database.db` 为空，会尝试从最新 `synapse-data.db.legacy.<timestamp>` 备份恢复。
- `import-legacy-database.mjs` 继续识别旧备份命名，允许用户手动导入历史备份。
- MCP 自动注册时会清理旧 server 名 `synapse-data` / `synapse-database` / `synapse-services`，再注册当前 server 名 `synapse-mcp`。
- 应用 reset 时同时保留 `synapse-database.db` 和 `synapse-data.db` 前缀，避免迁移前旧数据被误删。

### 删除建议

不要在改名版本刚发布后立刻删除这些兼容逻辑。

最早可以从 2026-06-03 开始评估删除，但必须同时满足：

- 包含 Database 改名的版本已经至少经历一个完整发布周期。
- 最近一个发布周期内没有出现 `Legacy database file name migrated.`、`Empty database detected. Restoring latest legacy backup.`、`Legacy MCP entry removed.` 相关恢复或清理日志。
- 没有用户反馈旧数据库、旧备份或旧 MCP 配置迁移失败。
- 测试仍覆盖当前数据库启动、旧文件名迁移、旧备份恢复、旧 MCP 名清理、reset 数据保护这些场景。

建议分阶段删除：

- 第一阶段：删除 MCP 旧名清理逻辑，仅保留当前 `synapse-mcp` 注册。
- 第二阶段：删除 `synapse-data.db` 自动改名和 reset 保护。
- 第三阶段：删除 legacy 备份自动恢复。
- 最后阶段：再考虑是否删除手动导入旧备份的兼容能力；这部分可以保留更久，因为用户可能很久以后才导入历史备份。

## Console / Dashboard 命名收敛

- 创建时间：2026-06-19
- 当前状态：待专项清理
- 相关范围：
  - `dashboard/` 包目录与 `@synapse/dashboard` 包名
  - dashboard dev / build / Docker / nginx / CI / 测试脚本
  - renderer 与 dashboard 代码里的 `dashboardApi`、dashboard 变量名、测试描述和文档描述
  - 兼容路由 `/dashboard` 与 `/api/dashboard`

### 背景

管理后台当前产品命名与用户可见入口已经统一为 Console，主路由是 `/console`，主 API 路由是 `/api/console`。

项目中仍保留了一批 `dashboard` 命名。部分是历史内部命名，例如 `dashboard/` 包、`@synapse/dashboard`、`dashboardApi`；部分是兼容入口，例如 `/dashboard` 到 `/console` 的重定向，以及 `/api/dashboard` legacy alias。

### 清理建议

不要一刀切删除所有 `dashboard`。

- 可以优先把内部变量、测试描述、脚本描述、文档中的当前语义改为 `console`。
- 可以评估把 `dashboard/` 包目录和 `@synapse/dashboard` 包名改为 Console，但必须同步更新 pnpm workspace、根脚本、Dockerfile、nginx、部署脚本、CI、测试和文档。
- `/dashboard` 和 `/api/dashboard` 暂时保留为 legacy redirect / alias，避免破坏旧书签、旧版本客户端或已有集成；已删除的团队邀请链接不兼容。

### 风险

- 包目录或包名漏改会导致 dev、build、Docker、部署或 CI 失败。
- 直接删除 `/dashboard` 旧入口会让历史链接和书签失效。
- 直接删除 `/api/dashboard` 旧 API alias 可能影响旧客户端或外部集成。
- 审计日志、测试快照、历史数据字段中如果强行重命名，可能影响历史查询和兼容判断。

### 验收建议

专项清理时至少验证：

- `pnpm dev`、`pnpm dev:server`、`pnpm quit:processes` 正常。
- `/console` 和 `/api/console` 是当前主入口。
- `/dashboard` 仍能重定向到 `/console`。
- `/api/dashboard` 兼容 alias 仍按预期工作。
- Docker / nginx / 部署相关测试通过。

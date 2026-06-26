# @synapse/desktop

Synapse 的桌面端子包，基于 Electron + Vite + React + Tailwind CSS + shadcn/ui 构建。

## 开发

推荐从仓库根目录执行：

```bash
pnpm install                                      # 安装全部工作区依赖
pnpm --filter @synapse/desktop run dev           # 启动本地开发环境
pnpm --filter @synapse/desktop run typecheck     # 类型检查
pnpm --filter @synapse/desktop run build         # 渲染端 + 主进程 + database 构建
pnpm --filter @synapse/desktop run package:mac   # 打包 macOS（dmg + zip）
pnpm --filter @synapse/desktop run package:win   # 打包 Windows（nsis）
```

也可以直接在 `desktop/` 下运行不带前缀的版本：

```bash
cd desktop
pnpm dev
pnpm build
pnpm package:mac
```

桌面端登录、Webhook 和 Live 连接使用的服务地址会在构建前生成到桌面包内。默认开发地址是 `http://localhost:3000`；正式打包或发版前设置公开根地址，例如：

```bash
SYNAPSE_DESKTOP_PUBLIC_APP_URL=https://synapse.d2.pub pnpm --filter @synapse/desktop run package:mac
```

## 版本 / 发布

版本号只写在 `desktop/package.json`。在仓库根目录执行：

```bash
pnpm --filter @synapse/desktop run bump:commit:push    # 递增 desktop 子包 patch 版本号并在仓库根提交 + push
pnpm desktop:release:mac                               # 递增版本号、提交并 push，然后本机打包并只发布 macOS 更新
```

`pnpm desktop:release:mac` 会在递增版本号前检查 `SYNAPSE_DESKTOP_PUBLIC_APP_URL`。该变量填写公开根地址，不带 `/api`，例如 `https://synapse.d2.pub`；可以写在仓库根目录 `.env.release.local`，也可以由 shell 环境提供。

`push` 到 `main` 后，`.github/workflows/release.yml` 会自动：

1. 装依赖（`pnpm install --frozen-lockfile`，需要根目录 `pnpm-lock.yaml` 已提交）。
2. 依次执行 `pnpm --filter @synapse/desktop run build:renderer`、`pnpm --filter @synapse/desktop run build:electron`、`pnpm --filter @synapse/desktop run build:database`。
3. 执行 `pnpm --filter @synapse/desktop run package:mac` / `pnpm --filter @synapse/desktop run package:win`。
4. 把 `desktop/release/` 下的产物整理为腾讯云 CDN 发布目录：安装包和 blockmap 归档到 `https://desktop.release.synapse.d2.pub/v<version>/`，`latest.yml` / `latest-windows.yml` / `latest-mac.yml` 上传到 CDN 根目录供应用内更新检查。
5. 刷新 CDN 上的 `latest.yml` / `latest-windows.yml` / `latest-mac.yml`，验证 CDN 可访问后，在 `FairyEver/SynapseAppRelease` 创建只包含下载链接和发版说明的 GitHub Release。
6. 清理腾讯云 COS 根目录下旧的 `v<version>/` 目录：默认保留语义版本号最新的 3 个版本，并额外保留仍被 `latest.yml`、`latest-windows.yml` 或 `latest-mac.yml` 引用的版本，避免某个平台更新链接失效。

GitHub Action 发版会在构建安装包时设置 `SYNAPSE_DESKTOP_PUBLIC_APP_URL=https://synapse.d2.pub`，并强制要求该变量存在，避免正式包写入 CI 测试兜底地址。

本机 macOS 快速发版使用 `pnpm desktop:release:mac`。该命令复用现有版本递增和 macOS 打包流程，只上传 macOS 安装包、blockmap 和 `latest-mac.yml`，不会改动 `latest.yml` 或 `latest-windows.yml`。发布成功后同样会清理旧的 `v<version>/` 目录，但仍会保留三个 `latest*.yml` 当前引用的版本；如需临时跳过清理，可给 `desktop/scripts/release/publish-mac-release.mjs` 传 `--skip-cos-prune`。全量 GitHub Action 发版仍会覆盖三个 updater metadata 文件，让 macOS 和 Windows 重新对齐到同一个版本。

本机发布会自动读取仓库根目录 `.env.release.local`、`.env.local`、`.env`。推荐在 `.env.release.local` 中填写 `SYNAPSE_DESKTOP_PUBLIC_APP_URL`、`TENCENT_CLOUD_SECRET_ID`、`TENCENT_CLOUD_SECRET_KEY`；该文件已被 `.gitignore` 忽略，不会提交。也可以用 `--env-file <path>` 指定其它文件。若 shell 环境已存在同名变量，脚本不会用 env 文件覆盖它。如果没有安装 `tccli`，可先运行 `python -m pip install --user tccli`；COSCLI 会优先使用 `COSCLI_PATH` 或 PATH 中的 `coscli`，缺失时脚本会下载当前平台的 COSCLI 到临时目录。

发布前需要在 GitHub Secrets 中配置 `TENCENT_CLOUD_SECRET_ID`、`TENCENT_CLOUD_SECRET_KEY` 和 `RELEASE_REPO_TOKEN`。腾讯云密钥应限制在 `synapse-desktop-release-1252371654` 的发布前缀读取、写入和删除权限，以及 `desktop.release.synapse.d2.pub` 的 CDN URL 刷新权限。COSCLI 清理旧版本需要 `cos:HeadBucket`、`cos:GetBucket`、`cos:HeadObject`、`cos:DeleteObject`、`cos:DeleteMultipleObjects` 等权限；腾讯云文档说明 [`ls`](https://cloud.tencent.com/document/product/436/63668) 用于列对象，[`rm`](https://cloud.tencent.com/document/product/436/63671) 可递归强制删除目录。

手动本地冒烟：

```bash
pnpm install --frozen-lockfile   # 验证 lockfile 与 CI 行为一致
pnpm --filter @synapse/desktop run build        # 跑完 renderer + electron + database
pnpm --filter @synapse/desktop run package:mac  # 可选：本地验证打包产物
```

## 编辑器集成说明

Synapse 把仓库里的 **规则（Rule）** 和 **技能（Skill）** 按各编辑器的官方约定，写入到本地磁盘上对应的位置，由编辑器自身加载使用。

### 支持的编辑器

| 编辑器 | 支持范围 | 支持内容 |
| --- | --- | --- |
| Claude Code | 全局 / 项目 | 规则、技能 |
| Codex | 全局 / 项目 | 规则、技能 |
| Cursor | 全局（仅技能） / 项目 | 规则、技能 |
| Windsurf | 全局 / 项目 | 规则、技能 |

平台支持：macOS、Linux、Windows。

### 安装路径

下表中 `{contentId}` 为内容的唯一 ID，`{skillName}` 为技能的 `name` 字段（缺少时依次回退为标题 slug、`contentId`），`{projectPath}` 为你在 Synapse 中选中的项目目录。

#### Claude Code

| 类型 | 范围 | 目标路径 |
| --- | --- | --- |
| 规则 | 全局 | `~/.claude/CLAUDE.md` |
| 规则 | 项目 | `{projectPath}/.claude/rules/{name}.md` |
| 技能 | 全局 | `~/.claude/skills/{skillName}/` |
| 技能 | 项目 | `{projectPath}/.claude/skills/{skillName}/` |

项目规则以独立 `.md` 文件写入 `.claude/rules/` 目录，文件名取规则的 `name` 字段。如果规则尚未设置名称，则自动使用 `synapse_{contentId}` 作为文件名。安装时可选填 `paths` frontmatter，限定规则仅在匹配文件进入 context 时加载。

#### Codex

| 类型 | 范围 | 目标路径 |
| --- | --- | --- |
| 规则 | 全局 | `$CODEX_HOME/AGENTS.md`，未设置则为 `~/.codex/AGENTS.md` |
| 规则 | 项目 | `{projectPath}/AGENTS.md` |
| 技能 | 全局 | `~/.agents/skills/{skillName}/` |
| 技能 | 项目 | `{projectPath}/.agents/skills/{skillName}/` |

注意：Codex 全局技能写到 `~/.agents`，而不是 `~/.codex`。

#### Cursor

| 类型 | 范围 | 目标路径 |
| --- | --- | --- |
| 规则 | 全局 | 不支持（Cursor 全局规则只能通过其设置界面管理） |
| 规则 | 项目 | `{projectPath}/.cursor/rules/{contentId}.mdc` |
| 技能 | 全局 | `~/.cursor/skills/{skillName}/` |
| 技能 | 项目 | `{projectPath}/.cursor/skills/{skillName}/` |

#### Windsurf

官方依据：

- [Memories & Rules](https://docs.windsurf.com/windsurf/cascade/memories)：Rules 支持 global / workspace / system；全局规则文件为 `~/.codeium/windsurf/memories/global_rules.md`；workspace 规则位于 `.windsurf/rules/*.md`，通过 frontmatter 的 `trigger` 字段声明激活模式。
- [Cascade Skills](https://docs.windsurf.com/windsurf/cascade/skills)：workspace Skill 位于 `.windsurf/skills/<skill-name>/`；global Skill 位于 `~/.codeium/windsurf/skills/<skill-name>/`；每个 Skill 目录必须包含带 YAML frontmatter 的 `SKILL.md`。
- [AGENTS.md](https://docs.windsurf.com/windsurf/cascade/agents-md)：`AGENTS.md` / `agents.md` 会被 Windsurf 自动发现并进入同一套 Rules 引擎，按文件位置自动作用域；Synapse 当前优先使用 `.windsurf/rules/`，因为它能显式设置激活模式。

| 类型 | 范围 | 目标路径 | 写入策略 |
| --- | --- | --- | --- |
| 规则 | 全局 | `~/.codeium/windsurf/memories/global_rules.md` | 单文件合并写入，用 Synapse 注释块分隔 |
| 规则 | 项目 | `{projectPath}/.windsurf/rules/{name}.md` | 独立 Markdown 文件，写入 `trigger` frontmatter |
| 技能 | 全局 | `~/.codeium/windsurf/skills/{skillName}/` | 目录，包含 `SKILL.md` 与附件 |
| 技能 | 项目 | `{projectPath}/.windsurf/skills/{skillName}/` | 目录，包含 `SKILL.md` 与附件 |

Windsurf 项目规则的 `trigger` 支持：

| `trigger` | 含义 |
| --- | --- |
| `always_on` | 每次消息都加载完整规则 |
| `model_decision` | 先把 `description` 放入上下文，由 Cascade 判断是否读取完整规则 |
| `glob` | 当 Cascade 读取或编辑匹配 `globs` 的文件时加载 |
| `manual` | 不自动注入，需要在 Cascade 输入框里手动 `@rule-name` |

Windsurf 官方还支持目录中的 `AGENTS.md` / `agents.md`。这类文件不使用 frontmatter，根目录文件 always-on，子目录文件按位置自动作用域。Synapse 的规则安装入口暂不写 `AGENTS.md`，避免和 `.windsurf/rules/` 的显式触发模式混用。

### 规则与技能的写入形式

- **规则**：写入单个 Markdown 文件。Claude Code 项目规则写入 `.claude/rules/{name}.md`（独立文件，支持可选的 `paths` frontmatter）；Claude Code 全局规则和 Codex 规则合并写入 `CLAUDE.md` / `AGENTS.md`（用 HTML 注释标记分隔）；Cursor 规则写入 `{contentId}.mdc`（Cursor 原生 MDC 规则格式）；Windsurf 全局规则合并写入 `global_rules.md`，项目规则写入 `.windsurf/rules/{name}.md` 并带 `trigger` frontmatter。
- **技能**：写入一个完整目录，目录中包含 `SKILL.md` 主文件和全部附件（附件保留原文件名）。

所有写入都是原子操作：新内容先写入临时位置，就绪后再整体替换目标；失败会自动回滚，不会留下半坏的文件或目录。

### 安装状态

点击安装时，每个编辑器会先检查路径能否用，分三种结果：

| 状态 | 含义 |
| --- | --- |
| 就绪 | 路径可用，可以直接安装 |
| 不支持 | 该编辑器不支持这种组合（例如 Cursor 全局规则） |
| 不可用 | 编辑器未安装，或项目路径不存在 |

UI 会根据状态启用或禁用安装按钮，并给出相应提示。

---

## IDE 扩展

新增 IDE 的固定目录是：

```text
desktop/src/definitions/editor/<editor-id>/
```

普通 IDE 只需要在这个目录中补齐定义文件。不要手改生成文件，也不要改 `editor-adapters/index.ts`、安装菜单、扫描服务、CLI 检测或 MCP 设置面板。`pnpm --filter @synapse/desktop run typecheck` 会先运行 `generate:definitions-registry`，自动刷新 renderer / Electron 两侧 registry。

### 文件职责

| 文件 | 必需 | 职责 |
| --- | --- | --- |
| `editor.ts` | 是 | IDE 展示元数据：`id`、`label`、`order`、`icon`、支持范围、支持内容类型 |
| `adapter.ts` | 是 | 解析全局 / 项目安装目标，导出 `editorAdapter` |
| `install.ts` | 是 | Rule / Skill 写入策略，导出 `installStrategy` |
| `scan.ts` | 是 | Rule 扫描策略，导出 `scanStrategy` |
| `forms.tsx` | 否 | 项目 Rule 安装前表单；没有额外元数据就不创建 |
| `cli.ts` | 否 | 配套 CLI 检测定义；没有 CLI 就不创建 |
| `mcp.ts` | 否 | MCP 注册定义；没有 MCP 就不创建 |

生成入口：

```text
desktop/scripts/build/generate-definitions-registry.mjs
desktop/src/definitions/generated/renderer-registry.ts
desktop/electron/services/definitions/generated/main-registry.ts
```

`generated/*` 只由脚本维护。

### 新增一个普通 IDE

假设新增 `windsorf`，且它支持 Rule / Skill、没有 CLI、没有 MCP、没有安装前表单：

```text
desktop/src/definitions/editor/windsorf/
  icon.png
  editor.ts
  adapter.ts
  install.ts
  scan.ts
```

`editor.ts` 只放展示与能力元数据：

```ts
import icon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "windsorf",
  label: "Windsorf",
  order: 40,
  icon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
```

`adapter.ts` 必须导出 `editorAdapter`，由统一服务调用：

```ts
import type { EditorAdapter } from "../../main-types"

const windsorfAdapter: EditorAdapter = {
  id: "windsorf",
  label: "Windsorf",
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
  resolveGlobalDirectoryPaths() {
    return { rulesPath: null, skillsPath: null }
  },
  async resolveGlobalTarget(context) {
    // 返回 createReadyTarget / createUnsupportedTarget / createUnavailableTarget
  },
  async resolveProjectTarget(projectPath, context) {
    // 返回项目级 Rule / Skill 的目标文件或目录
  },
  getScanPathConfig() {
    return {
      globalSkillsPath: null,
      globalRulesPath: null,
      rulesSupported: true,
      detectionDir: "",
      projectPaths: (projectPath) => ({
        skillsPath: `${projectPath}/.windsorf/skills`,
        rulesPath: `${projectPath}/.windsorf/rules`,
      }),
    }
  },
}

export const editorAdapter = windsorfAdapter
```

`install.ts` 负责写入格式。普通 Skill 可以复用 Synapse 标准目录写入：

```ts
import type { EditorInstallStrategy } from "../../main-types"
import { writeSynapseSkillDirectory } from "../shared-skill-directory"

export const installStrategy: EditorInstallStrategy = {
  async prepareRuleFileContent({ ruleBody }) {
    return ruleBody
  },
  async prepareSkillDirectory(context) {
    await writeSynapseSkillDirectory(context)
  },
}
```

`scan.ts` 负责把 IDE 的 Rule 文件解析成 `EditorScanRuleItem[]`。如果规则就是独立 Markdown 文件，可以参考 Claude Code；如果是单文件多段规则，可以参考 Codex。

新增后运行：

```bash
pnpm --filter @synapse/desktop run typecheck
```

### 可选能力

有 Agent runtime 能力时，在 `desktop/src/definitions/agent/<id>/agent.ts`
声明 renderer-safe 元数据，并在 `agent-main.ts` 声明主进程 runtime 行为。
本地 CLI 二进制依赖放在 Agent 的 `runtime.binaries` 中，设置页会从
Agent runtime status 派生可用状态。

有 MCP 注册能力时，增加 `mcp.ts`。`mcp.ts` 不导入图标，renderer 会自动使用 `editor.ts` 的 icon：

```ts
import type { SynapseMcpDefinition } from "../../types"

export const mcpDefinition = {
  target: "windsorf",
  label: "Windsorf",
  order: 40,
  settingsPathSegments: [".windsorf", "mcp.json"],
  settingsFormat: "json-mcp-servers",
} as const satisfies SynapseMcpDefinition
```

当前支持的 MCP 写入格式：

| `settingsFormat` | 行为 |
| --- | --- |
| `json-mcp-servers` | 写入 JSON 配置的 `mcpServers.synapse-mcp` |
| `codex-toml` | 写入 Codex TOML 的 `[mcp_servers.synapse-mcp]` |

项目 Rule 安装前需要额外表单时，增加 `forms.tsx`，导出 `installFormDefinition`：

```tsx
import type { SynapseRuleProjectInstallFormProps } from "../../types"

function WindsorfRuleProjectInstallForm(props: SynapseRuleProjectInstallFormProps) {
  // 表单确认后调用 props.onConfirm(values)
}

export const installFormDefinition = {
  RuleProjectInstallForm: WindsorfRuleProjectInstallForm,
} as const
```

对应的 `install.ts` 从 `payload.installFormValues` 读取表单值；如果需要读取目标文件里的旧值，实现 `readRuleProjectFormValues()`。

---

## 数据表能力对比

以下对比的是 Synapse 数据存储模块在 `CLI`、`MCP`、`API` 三条入口上的能力覆盖情况。

### Synapse MCP 安装规则

在设置页的 MCP 中点击注册时，Synapse 会按各编辑器的官方全局配置位置写入 `synapse-mcp` 这个 MCP server。

| 编辑器 | 全局配置文件 | 写入格式 |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` | JSON，写入 `mcpServers.synapse-mcp` |
| Cursor | `~/.cursor/mcp.json` | JSON，写入 `mcpServers.synapse-mcp` |
| Codex | `~/.codex/config.toml` | TOML，写入 `[mcp_servers.synapse-mcp]` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` | JSON，写入 `mcpServers.synapse-mcp` |

写入规则：

- JSON 配置会保留原文件中的其他字段，只增量写入 `mcpServers.synapse-mcp.url`。
- Codex 会在 `~/.codex/config.toml` 中增量更新 `synapse-mcp` 对应的 table，不会覆盖其他如 `model`、`profiles`、审批策略等现有配置。
- "重新注册"只更新 `synapse-mcp` 这一项；"打开文件"打开的也是上述官方全局配置文件。
- Windsurf 的 MCP 配置路径与 JSON 结构依据官方 [Cascade MCP Integration](https://docs.windsurf.com/windsurf/cascade/mcp) 文档。

说明：

- `支持`：有明确的一等命令 / tool / action。
- `部分支持`：能做，但结构化能力不完整。
- `仅 SQL`：没有专门接口，只能通过原始 SQL 完成。
- `不支持`：当前没有提供对应能力。

| 能力 | CLI | MCP | API | 说明 |
| --- | --- | --- | --- | --- |
| 列出数据表 | 支持 | 支持 | 支持 | `database table list` / `database_table_list` / `database.table.list` |
| 新建数据表 | 支持 | 支持 | 支持 | 支持列定义与表描述 |
| 删除数据表 | 支持 | 支持 | 支持 | 删除整张表及其数据 |
| 查看表结构 | 部分支持 | 支持 | 支持 | CLI 当前主要输出列信息，不会完整暴露描述、行数、时间等元数据 |
| 新增列 | 部分支持 | 支持 | 支持 | CLI 当前不支持传默认值；MCP/API 支持 `default` |
| 删除列 | 支持 | 支持 | 支持 | `database column delete` / `database_column_delete` / `database.column.delete` |
| 重命名列 | 支持 | 支持 | 支持 | `database column rename` / `database_column_rename` / `database.column.rename` |
| 修改列类型 / 默认值 | 仅 SQL | 仅 SQL | 仅 SQL | 没有结构化 schema migration 能力 |
| 插入单条数据 | 支持 | 支持 | 支持 | 单行新增 |
| 批量插入数据 | 支持 | 支持 | 支持 | 事务内批量插入 |
| 查询数据 | 支持 | 支持 | 支持 | 三端都支持基础查询 |
| 按条件查询 | 部分支持 | 支持 | 支持 | CLI 仅支持 `--where k=v` 这类等值条件；MCP/API 支持更完整条件表达 |
| 排序查询 | 不支持 | 支持 | 支持 | CLI 没有结构化排序参数 |
| 分页查询 | 部分支持 | 支持 | 支持 | CLI 仅支持 `limit`，没有 `offset` |
| 按 id 更新数据 | 支持 | 支持 | 支持 | 仅支持单条记录局部更新 |
| 按条件批量更新 | 支持 | 支持 | 支持 | `database rows update` / `database_rows_update` / `database.rows.update` |
| 按 id 删除数据 | 支持 | 支持 | 支持 | 仅支持单条删除 |
| 按条件批量删除 | 支持 | 支持 | 支持 | `database rows delete` / `database_rows_delete` / `database.rows.delete` |
| 执行原始 SQL | 支持 | 支持 | 支持 | `database sql execute` / `database_sql_execute` / `database.sql.execute` |

当前结论：

- 三条链路共用同一个底层数据服务，所以重叠能力的实际行为大体一致。
- `MCP` 与 `API` 的结构化能力基本对齐。
- `CLI` 明显更窄，尤其是在条件查询、排序、分页、列默认值、表元数据展示这些方面。
- 如果要做到"数据表能力完全一致"，优先需要补齐 `CLI` 的查询参数和 schema 变更参数，并决定是否把删列、改列、按条件更新/删除升级为正式接口，而不是继续只留给 `database_sql_execute`。

---

## 内容分类

规则、技能、提示词各自拥有独立的分类体系。`value` 为持久化标识，一经写入不可修改。

### 规则分类

| value | label | description |
|-------|-------|-------------|
| `coding` | 编程与工程 | 编码约束、架构规范、实现模式、命名规则 |
| `writing` | 写作与格式 | 输出格式、文风、排版、内容标准 |
| `reasoning` | 推理与决策 | 思考方式、分析框架、判断准则 |
| `quality` | 质量与规范 | 审查标准、测试要求、验收条件 |
| `workflow` | 流程与步骤 | 执行顺序、协作流程、分支策略 |
| `security` | 安全与隐私 | 敏感数据处理、权限约束、合规要求 |
| `interaction` | 角色与风格 | 人设、语气、交互风格、回复长度 |
| `domain` | 领域知识 | 行业术语、专业约束、业务规则 |
| `tooling` | 工具与环境 | 工具使用偏好、环境配置、CLI 约束 |

### 技能分类

| value | label | description |
|-------|-------|-------------|
| `development` | 编程开发 | 编码、调试、重构、测试、代码生成 |
| `automation` | 自动化 | 批处理、脚本编排、定时触发、流水线 |
| `content` | 内容创作 | 写作、改写、翻译、摘要、文案 |
| `data` | 数据与文件 | 数据分析、文件转换、媒体处理、结构化数据 |
| `integration` | 集成连接 | 外部 API、插件、第三方服务对接 |
| `devops` | 运维部署 | CI/CD、部署、监控、基础设施管理 |
| `design` | 设计原型 | UI/UX 设计、原型图、视觉稿 |
| `research` | 调研分析 | 信息检索、竞品分析、技术调研 |
| `productivity` | 效率工具 | 任务管理、日程安排、文档整理 |

### 提示词分类

| value | label | description |
|-------|-------|-------------|
| `coding` | 编程开发 | 代码生成、调试、技术问答、架构设计 |
| `writing` | 写作创作 | 文章、故事、文案、邮件、社媒内容 |
| `analysis` | 分析研究 | 数据分析、调研报告、信息整理 |
| `translation` | 翻译润色 | 多语言翻译、文本润色、本地化 |
| `productivity` | 工作效率 | 任务规划、会议纪要、流程优化 |
| `education` | 学习教育 | 知识讲解、辅导答疑、学习计划 |
| `design` | 设计创意 | UI 设计、头脑风暴、创意构思 |
| `business` | 商业营销 | 营销策划、商业分析、运营方案 |
| `lifestyle` | 生活日常 | 旅行规划、健康建议、日常问答 |

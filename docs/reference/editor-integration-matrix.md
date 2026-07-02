# Editor Integration Matrix

本文只整理当前 Synapse 支持的 3 个编辑器：Claude Code、Codex、Cursor。

标记说明：

- `✅`：Synapse 当前采用的安装方案
- 空白：官方支持，但 Synapse 当前未采用
- `不支持`：Synapse 当前不提供该安装方式

当前 Synapse 的实现基线：

- Skill 目录名优先使用显式 `name`，只有旧数据缺少 `name` 时才回退为标题 slug，再不行才回退到 `contentId`
- 安装 Skill 时，Synapse 会统一写出 `SKILL.md`，并额外写入 `.synapse.json` 作为自身替换追踪文件
- Synapse 当前写出的 `SKILL.md` 一律包含 YAML frontmatter，至少写 `name` 和 `description`
- Skill 附件保留原相对路径，例如 `scripts/deploy.sh`、`references/guide.md`

## Claude Code

### 全局

#### Rule

```text
~/.claude/
├── CLAUDE.md              ✅ Synapse 当前采用
└── rules/
    ├── preferences.md
    └── workflows.md
```

- `~/.claude/CLAUDE.md` 和 `~/.claude/rules/*.md` 都是官方支持的用户级规则入口，可以同时存在。
- Synapse 当前把“全局单条 Rule”安装到 `~/.claude/CLAUDE.md`。
- 如果未来产品要重点支持“多条全局 Rule 并列管理”，`~/.claude/rules/*.md` 会更适合做模块化扩展。

#### Skill

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ✅ | 1 | `~/.claude/skills/<skill-name>/SKILL.md` | `SKILL.md` + 可选附件目录 | 目录名用 `skillName`；`SKILL.md` 写 `name` + `description` frontmatter | 官方文档把 `SKILL.md` 定义为 “YAML frontmatter + Markdown body”；字段层面又说明 all fields optional，`description` recommended |

### 项目

#### Rule

```text
your-project/
├── CLAUDE.md
├── CLAUDE.local.md
└── .claude/
    ├── CLAUDE.md
    └── rules/
        ├── code-style.md      ✅ Synapse 当前采用这类目录规则文件
        ├── testing.md
        ├── security.md
        └── frontend/
            └── components.md
```

- `your-project/CLAUDE.md` 和 `your-project/.claude/CLAUDE.md` 作用等同，二选一即可。
- `CLAUDE.local.md` 适合放不想提交的本地私有内容，例如沙箱地址、测试数据、个人偏好。
- `.claude/rules/**/*.md` 支持递归子目录，也支持 `paths` YAML frontmatter 做 path-specific rules。
- Synapse 当前采用 `{projectPath}/.claude/rules/{ruleName}.md`，因为它最适合“一条 Rule 对应一个独立文件”的自动安装和后续扩展。
- 加载优先级上，用户级规则先加载，项目级规则后加载；项目级优先级更高。

#### Skill

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ✅ | 1 | `{projectPath}/.claude/skills/<skill-name>/SKILL.md` | `SKILL.md` + 可选附件目录 | 目录名用 `skillName`；`SKILL.md` 写 `name` + `description` frontmatter | 适合被仓库提交与共享 |
|  | 2 | `{projectPath}/<subdir>/.claude/skills/<skill-name>/SKILL.md` | `SKILL.md` + 可选附件目录 | 未采用 | 官方支持在子目录下放局部技能，适合 monorepo / package 级能力 |

参考文档：

- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude directory overview](https://code.claude.com/docs/en/claude-directory)

## Codex

### 全局

#### Rule

```text
$CODEX_HOME/ or ~/.codex/
├── AGENTS.md              ✅ Synapse 当前采用
└── AGENTS.override.md
```

- `AGENTS.md` 是官方全局指令主入口。
- `AGENTS.override.md` 优先级更高，更适合人工临时覆盖，不适合作为 Synapse 的默认稳定安装目标。
- Synapse 当前选择 `AGENTS.md`，更利于可预期、可持久的全局规则管理。

#### Skill

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ✅ | 1 | `$HOME/.agents/skills/<skill-name>/SKILL.md` | `SKILL.md` + 可选 scripts/references | 目录名用 `skillName`；`SKILL.md` 写 `name` + `description` frontmatter | 官方明确要求 `SKILL.md` 必须包含 `name` 和 `description` |
|  | 2 | `/etc/codex/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | 官方管理员 / 系统级技能目录，不属于用户级全局安装 |

### 项目

#### Rule

```text
your-project/
├── AGENTS.md              ✅ Synapse 当前采用项目根方案
├── AGENTS.override.md
├── package-a/
│   ├── AGENTS.md
│   └── AGENTS.override.md
└── <fallback filenames>   # 由 project_doc_fallback_filenames 配置
```

- Codex 会从 repo root 到当前工作目录逐层发现规则文件。
- 每一层的查找顺序是：`AGENTS.override.md` -> `AGENTS.md` -> `project_doc_fallback_filenames`。
- Synapse 当前选择项目根 `AGENTS.md`，因为它是最稳定、最容易自动化、也最符合“项目主规则入口”的方案。
- 子目录 `AGENTS.md` 更适合 monorepo / 局部模块约束；如果 Synapse 以后支持“局部安装到子模块”，这会是扩展方向。
- `AGENTS.override.md` 更适合人工覆盖，不适合桌面应用默认写入。
- fallback 文件名依赖用户配置，不够稳定，不适合默认安装。

#### Skill

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ✅ | 1 | `{projectPath}/.agents/skills/<skill-name>/SKILL.md` | `SKILL.md` + 可选 scripts/references | 写入 repo root 下的 `.agents/skills/<skill-name>/` | 这是官方 repo-scope 技能最稳妥的落点 |
|  | 2 | `{projectPath}/<subdir>/.agents/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | 官方会从当前工作目录一路向上扫描到 repo root |

#### 额外说明：Codex 还有一套 `.rules`

这不是项目提示词规则，而是命令审批 / 放权规则：

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
|  | 1 | `~/.codex/rules/*.rules` | `prefix_rule(...)` DSL | 未采用 | 这套不属于 Synapse 当前“安装 Rule 内容到编辑器”的范畴 |

参考文档：

- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Codex config reference](https://developers.openai.com/codex/config-reference)
- [Codex skills](https://developers.openai.com/codex/skills)
- [Codex rules](https://developers.openai.com/codex/rules)

## Cursor

### 全局

#### Rule

```text
Cursor Settings
└── Rules
    └── User Rules         Synapse 当前不安装
```

- Cursor 的全局 Rule 主要通过设置界面管理，官方文档未公布稳定的磁盘文件路径。
- Synapse 当前不做 Cursor 全局 Rule 安装，这个选择是合理的。

#### Skill

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ✅ | 1 | `~/.cursor/skills/<skill-name>/SKILL.md` | `SKILL.md` + YAML frontmatter + Markdown body | 目录名用 `skillName`；`SKILL.md` 写 `name` + `description` frontmatter | Cursor 官方确认支持的全局技能主目录 |
|  | 2 | `~/.agents/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | 官方文档列出，但全局级有已知 bug 不加载，状态不可靠 |
|  | 3 | `~/.claude/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | 兼容目录，官方文档未明确列出，状态不确定 |
|  | 4 | `~/.codex/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | 兼容目录，官方文档未明确列出，状态不确定 |

### 项目

#### Rule

```text
your-project/
├── AGENTS.md
└── .cursor/
    └── rules/
        ├── <rule-id>.mdc   ✅ Synapse 当前采用
        └── <name>.md
```

- `.cursor/rules/*.mdc` 是 Cursor 最原生、最适合自动化的项目规则格式。
- `.cursor/rules/*.md` 也是官方支持方案，但能力更弱，不如 `.mdc` 适合结构化配置。
- `AGENTS.md` 是官方支持的简单替代方案，更适合轻量项目，不如 `.mdc` 适合作为 Synapse 的默认安装目标。
- Synapse 当前采用 `.cursor/rules/{contentId}.mdc`，这是当前最稳妥的项目 Rule 方案。

#### Skill

| 采用 | 方案 | 官方位置 / 发现方式 | 文件格式 | Synapse 当前写法 | 备注 |
| --- | --- | --- | --- | --- | --- |
| ✅ | 1 | `{projectPath}/.cursor/skills/<skill-name>/SKILL.md` | `SKILL.md` + YAML frontmatter + Markdown body | 写入 `.cursor/skills/<skillName>/SKILL.md` | Synapse 当前采用的项目技能方案 |
|  | 2 | `{projectPath}/.agents/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | Cursor 官方同样支持的项目技能目录 |
|  | 3 | `{projectPath}/.claude/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | Cursor 官方兼容目录 |
|  | 4 | `{projectPath}/.codex/skills/<skill-name>/SKILL.md` | 同上 | 未采用 | Cursor 官方兼容目录 |

#### Skill frontmatter 说明

Cursor 官方文档当前的要求：

- 每个 Skill 都定义在带有 YAML frontmatter 的 `SKILL.md` 文件中
- `name` 必填
- `description` 必填

关于 `name` 是否必须和父目录名称一致：官方文档无此强制规定，属于社区建议。Synapse 选择让两者保持一致（`editor-install-service.ts` 中用 `path.basename(target.targetPath)` 作为 frontmatter `name`），这是合理的防御性做法，但不是 Cursor 官方的硬性约束。

参考文档：

- [Cursor rules](https://cursor.com/docs/rules)
- [Cursor skills](https://cursor.com/docs/skills)

## 关于 `SKILL.md` frontmatter 的结论

| 编辑器 | 官方文档口径 | Synapse 当前做法 | 结论 |
| --- | --- | --- | --- |
| Claude Code | 文档把 `SKILL.md` 定义为 “YAML frontmatter + Markdown body”；字段参考页同时写了 “All fields are optional, but description is strongly recommended” | 始终写 `name` + `description` frontmatter | 这是安全超集。官方文档没有把“无 frontmatter 的纯 Markdown `SKILL.md`”写成明确支持格式 |
| Codex | 官方明确写 `SKILL.md` 必须包含 `name` 和 `description` | 始终写 `name` + `description` frontmatter | 符合官方要求 |
| Cursor | 官方明确写 `SKILL.md` 使用 YAML frontmatter；`name`、`description` 必填。目录名等于 `name` 是社区建议，非官方强制 | 始终写 `name` + `description` frontmatter，并让目录名跟随 `skillName` | Synapse 选择保持一致，属于防御性做法 |

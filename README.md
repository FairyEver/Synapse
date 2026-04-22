# Synapse

Where Ideas Connect

## 下载

[github releases](https://github.com/FairyEver/Synapse/releases)

## 常见问题

提示已损坏

```
sudo xattr -dr com.apple.quarantine /Applications/Synapse.app
```

---

## 编辑器集成说明

Synapse 把仓库里的 **规则（Rule）** 和 **技能（Skill）** 按各编辑器的官方约定，写入到本地磁盘上对应的位置，由编辑器自身加载使用。

### 支持的编辑器

| 编辑器 | 支持范围 | 支持内容 |
| --- | --- | --- |
| Claude Code | 全局 / 项目 | 规则、技能 |
| Codex | 全局 / 项目 | 规则、技能 |
| Cursor | 全局（仅技能） / 项目 | 规则、技能 |

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

### 规则与技能的写入形式

- **规则**：写入单个 Markdown 文件。Claude Code 项目规则写入 `.claude/rules/{name}.md`（独立文件，支持可选的 `paths` frontmatter）；Claude Code 全局规则和 Codex 规则合并写入 `CLAUDE.md` / `AGENTS.md`（用 HTML 注释标记分隔）；Cursor 规则写入 `{contentId}.mdc`（Cursor 原生 MDC 规则格式）。
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
| `automation` | 自动化 | 批处理、脚本编排、定时任务、流水线 |
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

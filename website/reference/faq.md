# 常见问题

<!-- Sources: website/start/install.md; website/start/repository.md; website/start/first-install.md; website/guide/concepts.md; website/guide/editors.md; website/advanced/*.md; website/team/share-review.md -->

## 使用门槛

### 是否需要 Git 经验？

浏览、搜索、下载和安装内容无需执行 Git 命令。

仓库为 Git 仓库时，Synapse 在创建、更新、删除、恢复和永久删除内容时创建普通 Git commit。团队如需审核，可在代码托管平台审核这些提交。

### 是否需要先配置 provider？

仅浏览、编辑、安装 Rule 或 Skill 时不需要。运行 Agent、Workflow prompt 节点或 Agent executor 时需要配置 provider 和模型。

## 支持范围

### 支持范围包含哪些编辑器？

Synapse 目前支持 Claude Code、Cursor、Codex 和 Windsurf。以上编辑器均可安装 Rule 和 Skill。

编辑器安装范围和路径参见 [编辑器安装](/guide/editors)。

### 支持范围包含哪些操作系统？

安装包通过 GitHub Releases 发布：

| 系统 | 安装包 |
| --- | --- |
| macOS | `.dmg` |
| Windows | `.exe` |

本地开发环境要求参见 [本地开发](/developer/local-development)。

### 是否必须使用 Git 仓库？

不强制。仓库可使用本地目录，也可使用 Git 仓库。

Git 仓库适合团队协作、版本追踪与审核流程。

## 仓库与项目

### 仓库与项目的区别

仓库是 Synapse 读取和保存 Rule、Skill、Prompt 的来源目录。项目是编辑器安装、Agent、Workflow 和 Automation 的运行范围。

### Knowledge Base 是项目还是仓库？

Knowledge Base 是托管项目，不是内容仓库。它显示虚拟路径，真实 backing directory 由 Synapse 管理。

### 无法查看仓库内容如何处理？

确认 Settings 中配置的是仓库目录，而不是项目目录。仓库目录用于读取 Rule、Skill 和 Prompt，项目目录用于运行或安装。

使用 Git 仓库时，可同步仓库以拉取远端最新内容。

## 安装

### 如何选择 Rule 与 Skill？

仅包含一段文本规则时，使用 Rule。需要模板、示例文件、脚本、配置文件或其他参考资料时，使用 Skill。

### Prompt 是否能安装到编辑器？

不支持。Prompt 由资源仓库管理和版本化，不写入编辑器目录。

### 全局安装与项目级安装的区别

全局安装写入编辑器的用户目录。项目级安装写入所选项目目录。

项目级安装可从已配置项目中选择，也可在安装时浏览其他目录。

### 安装按钮不可用的常见原因

安装前将解析目标位置。目标状态可能是可写入、不支持、不可用或冲突。

常见原因包括：当前编辑器组合不支持、缺少编辑器用户目录、项目路径不存在，或 Skill 目标位置已有同名目录需要确认替换。

### Cursor 是否支持全局 Rule？

不支持。Synapse 目前未提供固定的 Cursor 全局 Rule 安装位置，因此 Cursor 全局 Rule 显示为“不支持”。

## 内容

### Skill 附件有哪些限制？

Skill 可添加文件或文件夹作为附件，目录结构将被保留。单个附件最大 10 MB。

### 下载文件包含哪些内容？

Rule 下载为 `.md` 文件，仅包含 Rule 正文。Skill 下载为 `.zip` 文件，包含 `main.md` 主说明文件和全部附件。

### 已删除内容是否支持恢复？

Rule、Skill 和 Prompt 删除后进入最近删除，支持恢复或永久删除。

## Agent 与 Workflow

### Agent 会话绑定什么？

Agent 会话绑定已配置项目和 agentType。运行时状态按 conversation 隔离。

### Workflow 是否支持循环？

Workflow 保持 DAG 约束。循环语义通过产品约定的 loop 子图表达，不通过普通节点边形成环。

### Automation 是否能包含多个动作？

不支持。一个 Automation 包含一个 trigger 和一个 executor。多步骤流程应放在 Workflow 中。

## MCP

### MCP 能力覆盖哪些领域？

当前领域包括 app、database、model_price、repository、automation、variable、workflow、content 和 drive。

### Variable MCP 是否返回变量值？

列表和写入结果不返回变量值。单个读取只有显式传 `includeValue: true` 时才返回明文。

## 同步

### 同步包含哪些操作？

非 Git 目录刷新本地内容索引。Git 目录执行 `git pull --ff-only --progress`。

### 创建内容后是否立即推送？

创建、更新和恢复先保存并创建提交，随后将推送任务加入待同步队列。

删除和永久删除先将提交加入待同步队列，再尝试推送。

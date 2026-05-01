# 常见问题

<!-- Sources: website/guide/faq.md; website/start/install.md; website/start/repository.md; website/start/first-install.md; website/guide/concepts.md; website/guide/rules.md; website/guide/skills.md; website/guide/editors.md; website/team/share-review.md; website/reference/downloads.md -->

## 使用门槛

### 需要 Git 经验吗？

浏览、搜索、下载和安装内容不需要执行 Git 命令。

如果仓库是 Git 仓库，Synapse 在创建、更新、删除、恢复和永久删除内容时会创建普通 Git commit。团队如需审核，可以在代码托管平台审核这些提交。

### 需要 AI 或编程基础吗？

不需要。Synapse 管理的是 Rule 和 Skill 内容；实际 AI 交互由安装后的目标编辑器完成。

## 支持范围

### 支持哪些编辑器？

Synapse 当前支持 Cursor、Codex、Claude Code 和 Windsurf。以上编辑器均可安装 Rule 和 Skill。

编辑器安装范围和路径见 [编辑器安装](/guide/editors)。

### 支持哪些操作系统？

安装包通过 GitHub Releases 发布：

| 系统 | 安装包 |
| --- | --- |
| macOS | `.dmg` |
| Windows | `.exe` |

本地开发环境要求见 [本地开发](/developer/local-development)。

### 必须使用 Git 仓库吗？

不是。仓库可以是本地目录，也可以是 Git 仓库。

本地目录适合个人试用或独立整理。Git 仓库适合团队协作、版本追踪与审核流程。

## 仓库与项目

### 仓库和项目有什么区别？

仓库是 Synapse 读取和保存 Rule、Skill 的来源目录。项目是 Rule 或 Skill 的项目级安装目标。

### 看不到仓库内容怎么办？

先确认 Settings 中配置的是仓库目录，而不是项目目录。仓库目录用于读取 Rule 和 Skill，项目目录用于安装。

如果使用 Git 仓库，可以同步仓库以拉取远端最新内容。

## 安装

### Rule 和 Skill 如何选择？

只有一段文本规则时，用 Rule。需要模板、示例文件、脚本、配置文件或其他参考资料时，用 Skill。

### 全局安装和项目级安装有什么区别？

全局安装写入编辑器的用户目录。项目级安装写入所选项目目录。

项目级安装可以从已配置项目中选择，也可以在安装时浏览其他目录。

### 为什么有些安装按钮不可用？

安装前会解析目标位置。目标状态可能是可写入、不支持、不可用或冲突。

常见情况包括：当前编辑器组合不支持、缺少编辑器用户目录、项目路径不存在，或 Skill 目标位置已有同名目录需要确认替换。

### Cursor 支持全局 Rule 吗？

不支持。Synapse 当前未提供固定的 Cursor 全局 Rule 安装位置，因此 Cursor 全局 Rule 会显示为“不支持”。

## 内容

### Skill 附件有限制吗？

Skill 可以添加文件或文件夹作为附件，目录结构会保留。单个附件最大 10 MB。

### 下载时会得到什么文件？

Rule 下载为 `.md` 文件，只包含 Rule 正文。Skill 下载为 `.zip` 文件，包含 `main.md` 主说明文件和全部附件。

### 已删除内容还能恢复吗？

Rule 和 Skill 删除后会进入最近删除，可以恢复，也可以永久删除。

## 同步

### 同步会做什么？

非 Git 目录会刷新本地内容索引。Git 目录会执行 `git pull --ff-only --progress`。

### 创建内容后会立即推送吗？

创建、更新和恢复会先保存并创建提交，随后将推送任务加入待同步队列。

删除和永久删除会先把提交加入待同步队列，再尝试推送。

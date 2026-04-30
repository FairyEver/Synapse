<!-- Sources: desktop/src/modules/rules/index.tsx; desktop/src/modules/rules/utils.ts; desktop/src/modules/skills/index.tsx; desktop/src/modules/skills/utils.ts; desktop/src/modules/settings/data.ts; desktop/src/modules/settings/components/repository-list-editor.tsx; desktop/src/modules/settings/components/project-list-editor.tsx; desktop/src/modules/content/components/content-browser-page.tsx; desktop/src/config/content-types/rule.ts; desktop/src/config/content-types/skill.ts; desktop/src/definitions/editor/*/{editor,adapter,install}.ts -->

# 核心概念

Synapse 当前围绕四个核心概念组织使用流程：Rule、Skill、仓库、项目。

## Rule（规则）

Rule 是一段可复用的 Markdown 正文。它没有附件，适合保存行为约束、输出规范、审查清单等文本规则。

Rule 有标题、名称、简介、分类和正文。名称会在安装到编辑器时作为文件名或规则标识。

Rule 支持浏览、搜索、排序、收藏、最近浏览、最近删除、下载和安装到编辑器。

## Skill（能力包）

Skill 是由主说明和附件组成的能力包，适合保存需要文件材料配合的工作流。

Skill 有中文名称、名称、简介、分类、主说明和附件。名称会在安装到编辑器时作为目录名。

附件可以来自文件或文件夹；目录结构会保留。安装后会写入一个 Skill 目录，目录中包含 `SKILL.md` 和附件。

## 仓库

仓库是 Synapse 管理 Rule 和 Skill 的本地目录。设置页里对应的入口是“仓库”和“本地仓库目录”。

可以选择现有文件夹加入仓库列表，也可以新建本地仓库。仓库记录可以修改名称和路径，也可以从 Synapse 中移除。移除仓库记录不会删除本地目录。

## 项目

项目是 Rule 或 Skill 的项目级安装目标。设置页里对应的入口是“项目”和“本地项目”。

安装到项目时，安装对话框会使用项目路径解析编辑器目标位置。也可以在安装时浏览其他目录。

仓库与项目的区别：

| 概念 | 作用 |
| --- | --- |
| 仓库 | Synapse 读取和保存 Rule、Skill 的来源目录 |
| 项目 | Rule、Skill 安装到编辑器时使用的目标目录 |

## 编辑器安装范围

当前代码定义的编辑器是 Cursor、Codex、Claude Code、Windsurf。四者都支持 Skill 的全局和项目安装。

Rule 的项目安装支持 Cursor、Codex、Claude Code、Windsurf。Rule 的全局安装支持 Codex、Claude Code、Windsurf；Cursor 全局 Rule 当前不支持。

安装路径由编辑器定义解析。项目安装会写入所选项目目录，全局安装会写入编辑器用户目录。

```text
仓库
  Rule / Skill
    ↓ 浏览、搜索、下载
Synapse
    ↓ 安装
全局编辑器目录 或 项目目录
```

继续阅读：

- [Rule](/guide/rules)
- [Skill](/guide/skills)
- [编辑器安装](/guide/editors)

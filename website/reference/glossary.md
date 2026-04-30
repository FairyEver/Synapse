# 术语表

<!-- Sources: website/guide/concepts.md; website/guide/rules.md; website/guide/skills.md; website/guide/editors.md; website/start/repository.md; website/start/first-install.md -->

## Rule

Rule 是一段可复用的 Markdown 正文。它没有附件，适合保存行为约束、输出规范、审查清单等文本规则。

## Skill

Skill 是由主说明和附件组成的能力包。安装后会写入一个 Skill 目录，目录中包含 `SKILL.md` 和附件。

## 仓库

仓库是 Synapse 管理 Rule 和 Skill 的本地目录。Synapse 从仓库目录读取内容，并以可浏览、可搜索的形式呈现。

## 项目

项目是 Rule 或 Skill 的项目级安装目标。安装到项目时，Synapse 会使用项目路径解析编辑器目标位置。

## 全局安装

全局安装写入编辑器的用户目录。全局安装对当前用户的所有项目生效。

## 项目级安装

项目级安装写入所选项目目录，仅对指定目录生效。

## 编辑器

编辑器是 Rule 或 Skill 的安装目标。当前代码定义的编辑器是 Cursor、Codex、Claude Code、Windsurf。

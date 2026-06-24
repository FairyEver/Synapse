# 术语表

<!-- Sources: website/guide/concepts.md; website/guide/rules.md; website/guide/skills.md; website/guide/prompts.md; website/advanced/*.md; website/reference/synapse-mcp-capabilities.md -->

## Rule

Rule 是一段可复用的 Markdown 正文，不包含附件，适合保存行为约束、输出规范和审查清单。

## Skill

Skill 是由主说明和附件组成的能力包。安装后写入一个 Skill 目录，目录中包含 `SKILL.md` 和附件。

## Prompt

Prompt 是可版本化的提示词资源，不包含附件，不作为编辑器安装目标。

## 仓库

仓库是 Synapse 管理 Rule、Skill 和 Prompt 的本地目录。Synapse 从仓库目录读取内容，并以可浏览、可搜索的形式呈现。

## 项目

项目是编辑器安装、Agent 会话、Workflow 节点和 Automation 作用域使用的本地运行范围。

## Knowledge Base

Knowledge Base 是 Synapse 托管项目。界面显示虚拟路径，真实 backing directory 由 Synapse 管理。

## Agent

Agent 是绑定项目、agentType、provider 和模型的本地会话入口。

## Workflow

Workflow 是 DAG 形式的流程定义，节点按拓扑顺序运行。

## Automation

Automation 是一个 trigger 加一个 executor 的自动运行配置。

## Drive

Drive 是 Synapse 的云盘文件和分享能力。

## Database

Database 是本地表、字段和行记录管理能力。

## MCP

MCP 是 Synapse 向外部 Agent 暴露桌面能力的工具入口。

## 全局安装

全局安装写入编辑器的用户目录。全局安装对当前用户的所有项目生效。

## 项目级安装

项目级安装写入所选项目目录，仅对指定目录生效。

## 编辑器

编辑器是 Rule 或 Skill 的安装目标。Synapse 目前支持 Claude Code、Cursor、Codex 和 Windsurf。

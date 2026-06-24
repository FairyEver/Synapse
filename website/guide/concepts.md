<!-- Sources: PRODUCT.md; docs/reference/product-context.md; desktop/src/types/content.ts; desktop/src/types/config.ts; desktop/src/lib/editor-registry.ts; desktop/synapse-capabilities/shared/registry.ts -->

# 核心概念

## Rule

Rule 是一段可复用的 Markdown 正文，不包含附件。适合保存行为约束、输出规范、审查清单和项目约定。

Rule 有标题、名称、简介、分类、正文、外观字段和历史版本。名称在安装到编辑器时作为文件名或规则标识。

## Skill

Skill 是由主说明和附件组成的能力包。安装到编辑器时，Synapse 写入 Skill 目录，并保留附件结构。

Skill 适合包含模板、示例、脚本、配置文件或较长参考资料的能力。

## Prompt

Prompt 是可版本化的提示词资源。它包含标题、简介、分类、正文和外观字段，不包含附件，也不作为编辑器安装目标。

## 仓库

仓库是 Synapse 管理 Rule、Skill 和 Prompt 的本地目录。仓库可以是普通目录，也可以位于 Git 仓库中。

仓库目录存放内容元数据、历史版本、附件引用和二进制附件池。

## 项目

项目是编辑器安装、Agent 会话、Workflow 节点和 Automation 作用域的运行范围。项目级安装会将 Rule 或 Skill 写入所选项目目录下对应编辑器的位置。

Knowledge Base 是特殊项目类型。界面显示虚拟路径 `synapse-kb://<id>`，真实目录由 Synapse 管理。

## 编辑器安装范围

Synapse 支持全局安装和项目级安装。

| 范围 | 写入位置 | 生效范围 |
| --- | --- | --- |
| 全局 | 编辑器用户目录 | 当前用户的所有项目 |
| 项目级 | 所选项目目录 | 指定项目 |

支持范围取决于编辑器和内容类型。安装前会显示目标状态。

## MCP 能力

Synapse MCP 将桌面端能力暴露给外部 Agent。当前领域包括 app、database、model_price、repository、automation、variable、workflow、content 和 drive。

了解更多：[Synapse MCP 能力](/reference/synapse-mcp-capabilities)。

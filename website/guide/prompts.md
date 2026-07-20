# Prompt

<!-- Sources: desktop/src/modules/prompts/index.tsx; desktop/src/config/content-types/prompt.ts; desktop/electron/services/content-write-service.ts -->

## 用途

Prompt 是资源仓库中的提示词资源。它包含标题、简介、分类、正文和外观字段，不包含附件。

Prompt 适合保存可复用的提示词正文、任务模板和 Agent 输入草稿。

## 浏览与搜索

Prompt 位于资源仓库 App。页面支持按分类浏览、关键词搜索、查看详情、编辑、删除和版本查看。

## 创建与编辑

创建 Prompt 时填写标题、简介、分类和正文。Prompt 不需要稳定 `name` 字段，也不支持附件。

编辑时若基础版本不是最新版本，界面会显示冲突提示。删除后内容进入最近删除。

## MCP

Resource Repository MCP 支持 Prompt 的 list、get、create、update 和 delete。创建和更新前可调用 `app_resource_repository_type_describe` 获取字段、分类和外观要求。

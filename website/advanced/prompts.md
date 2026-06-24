# Prompts

<!-- Sources: desktop/src/modules/prompts/index.tsx; desktop/src/modules/prompts/components/prompt-create-dialog.tsx; desktop/src/modules/prompts/components/prompt-detail-dialog.tsx; desktop/src/modules/prompts/components/prompt-version-view.tsx -->

## 功能范围

Prompts 页面用于管理 Prompt 资源。该页面支持新建、查看、编辑、删除和版本查看。

新建或编辑 Prompt 时，表单包含标题、简介、分类、正文和外观字段。标题、简介和正文为必填项。

详情弹窗读取 Prompt 内容，展示当前版本，并在编辑冲突时显示冲突提示。删除时，内容移入最近删除，后续可恢复或永久删除。

## 使用方式

在资源仓库中打开 Prompts 视图，新建 Prompt，填写标题、简介、分类和正文后保存。

打开已有 Prompt 后，可查看正文版本，也可进入编辑流程。Prompt 不包含附件，也不写入编辑器目录。

## MCP

Content MCP 支持 Prompt 的查询、新建、更新和删除。创建 Prompt 时不需要 `name` 字段。

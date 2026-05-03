# Prompts

<!-- Sources: desktop/src/modules/prompts/index.tsx; desktop/src/modules/prompts/components/prompt-create-dialog.tsx; desktop/src/modules/prompts/components/prompt-detail-dialog.tsx; desktop/src/modules/prompts/components/prompt-version-view.tsx -->

## 功能范围

Prompts 页面用于管理提示词。该页面支持新建、查看、编辑和删除提示词，并查看提示词版本内容。

新建或编辑提示词时，表单包含标题、简介、分类、正文和外观字段。标题、简介和正文为必填项。

详情弹窗读取提示词内容，展示当前版本，并在编辑冲突时显示冲突提示。删除提示词时，确认文案说明该内容将移入“最近删除”，90 天后自动永久清除。

## 使用方式

在 Prompts 页面中新建提示词，填写标题、简介、分类和正文后保存。标题示例为“代码审查助手”，简介示例为“帮助审查代码质量和规范”；示例仅作为占位提示，保存时以实际填写内容为准。

打开已有提示词后，可查看正文版本，也可进入编辑流程。编辑时标题和分类在同一行显示，正文仍通过文本域修改。

## 注意事项

关闭尚未提交的新建表单时，页面提示当前填写内容将被清空。保存失败时，页面显示“保存提示词失败。”。

若详情读取不到目标提示词，页面显示目标提示词不存在；若该版本已被删除，版本视图显示“该提示词已被删除。”。

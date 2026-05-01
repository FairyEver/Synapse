# Prompts

<!-- Sources: desktop/src/modules/prompts/index.tsx; desktop/src/modules/prompts/components/prompt-create-dialog.tsx; desktop/src/modules/prompts/components/prompt-detail-dialog.tsx; desktop/src/modules/prompts/components/prompt-version-view.tsx -->

## 能做什么

Prompts 页面用于管理提示词。可以新建、查看、编辑和删除提示词，并查看提示词版本内容。

新建或编辑提示词时，表单包含标题、简介、分类、正文和外观字段。标题、简介和正文为必填项。

详情弹窗会读取提示词内容，展示当前版本，并在编辑冲突时提示“有人在你之后改过这条提示词”。删除提示词时，确认文案说明内容会移入“最近删除”，90 天后自动永久清除。

## 怎么使用

在 Prompts 页面中新建提示词，填写标题、简介、分类和正文后保存。标题示例为“代码审查助手”，简介示例为“帮助审查代码质量和规范”；这些只是占位提示，保存时以你填写的内容为准。

打开已有提示词后，可以查看正文版本，也可以进入编辑流程。编辑时标题和分类在同一行显示，正文仍通过文本域修改。

## 注意事项

关闭尚未提交的新建表单时，会提示当前填写内容会被清空。保存失败时，页面会显示“保存提示词失败。”。

如果详情读取不到目标提示词，页面会显示“找不到这条提示词”；如果该版本已被删除，版本视图会显示“该提示词已被删除。”。

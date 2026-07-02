# 安装第一个内容

<!-- Sources: desktop/src/modules/content/components/install-dialog.tsx; desktop/electron/services/editor-install-service.ts; website/guide/editors.md -->

## 选择内容类型

在资源仓库中选择 Rule 或 Skill。Rule 是纯文本指令，Skill 是包含主说明和附件的能力包。

Prompt 由 Synapse 管理和版本化，不作为编辑器安装目标。

## 选择编辑器

安装时选择目标编辑器。Synapse 支持将 Rule 和 Skill 安装到 Claude Code、Cursor、Codex、Windsurf。

编辑器安装规则参见 [编辑器安装](/guide/editors)。

## 选择安装范围

安装范围可选全局或项目级。全局安装对当前用户的所有项目生效，项目级安装仅对指定目录生效。

部分编辑器组合可能不支持全局安装，安装前将显示状态。

## 安装后检查

安装完成后，重新打开目标编辑器，以便编辑器加载已写入的 Rule 或 Skill。

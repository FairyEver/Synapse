# Pending Release Notes

## 新增功能

## 功能优化

## 问题修复
- 修复复制或导出 Agent 对话时，并行同名工具的输出可能归属到错误工具调用下的问题。
- 修复知识库 Agent 启用内置插件后读不到用户 Claude Code MCP 配置的问题；普通 Agent 和知识库 Agent 现在都会加载用户、项目和本地 Claude Code 设置。
- 修复 Synapse MCP 旧名称残留导致的误判和权限污染；启动时会清理旧 MCP 配置与旧工具 allowlist，且不会自动扩大新 MCP 权限。
- 修复 Agent 日志、权限卡片和导出文本中部分 token、Authorization、Bearer 和环境变量密钥未脱敏的问题。
- 修复新建知识库会继承 claude-obsidian 示例 wiki 内容的问题；新知识库现在只保留最小 wiki、raw 与地址计数状态。
- 修复 Agent 询问用户选择但未收到答案时仍可能继续后续操作的问题；现在会明确停止。
- 修复 Agent 询问用户选择时被误显示成权限请求的问题；现在会展示可选项并把用户选择正确回传给 Claude Code。
- 修复 Agent 待回答卡片在历史里出现重复请求编号时，点击新选项会跳回旧卡片的问题。

## 技术调整

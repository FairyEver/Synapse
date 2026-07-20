# Pending Release Notes

## 新增功能

## 功能优化

## 问题修复

- 修复 Windows 上同名文件夹遮蔽 Git、Node 等命令时误报命令不可用的问题；Synapse 现在会跳过文件夹并继续查找真正的可执行文件，无需用户调整系统 PATH。

## 技术调整

- Synapse MCP 现在只提供 `app_*` 规范工具名，移除了 139 个旧名称别名，工具总数由 313 个降到 174 个，避免因工具数量过多被模型接口拒绝。继续调用旧名称会返回 `Unknown tool`。
- 本地 API action、IPC channel 和桌面 bridge 已统一使用与 MCP 相同的 `app.*` 命名来源；旧 API action 和旧 `window.synapse` 调用路径不再可用，相关本地集成需要改用新名称。

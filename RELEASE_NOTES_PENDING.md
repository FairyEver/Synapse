# Pending Release Notes

## 新增功能

## 功能优化

- Agent 消息中的本地文件路径现在可以打开项目目录之外的文件，仍使用系统默认应用。

## 问题修复

- 修复开发环境启动后无法加载桌面桥接、页面停在“无法读取配置”的问题；主窗口和其他独立窗口现在都会使用兼容 Electron 沙箱的 preload 构建产物。
- 修复 Agent 消息把代码增删统计误判成文件链接，以及本地文件路径包含空格时显示 `[blocked]` 和原始 Markdown 的问题。
- 修复 Windows 上同名文件夹遮蔽 Git、Node 等命令时误报命令不可用的问题；Synapse 现在会跳过文件夹并继续查找真正的可执行文件，无需用户调整系统 PATH。

## 技术调整

- Synapse MCP 现在只提供 `app_*` 规范工具名，移除了 139 个旧名称别名，工具总数由 313 个降到 174 个，避免因工具数量过多被模型接口拒绝。继续调用旧名称会返回 `Unknown tool`。
- 本地 API action、IPC channel 和桌面 bridge 已统一使用与 MCP 相同的 `app.*` 命名来源；旧 API action 和旧 `window.synapse` 调用路径不再可用，相关本地集成需要改用新名称。

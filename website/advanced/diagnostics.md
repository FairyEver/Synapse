# Diagnostics（诊断工具）

<!-- Sources: desktop/src/modules/settings/components/diagnostics-panel.tsx; desktop/src/types/diagnostics.ts; desktop/src/lib/diagnostics-summary.ts; desktop/electron/services/diagnostics-service.ts -->

## 功能范围

Diagnostics 位于设置中的诊断面板。该面板支持运行诊断、展示整体结论、复制诊断摘要，并导出诊断包。

诊断报告包含生成时间、整体状态、通过/异常/失败/跳过数量、本机信息、应用信息、当前上下文和检查列表。面板按检查分组展示状态、消息和详情，并额外展示 Windows 兼容性和 macOS 兼容性信息。

诊断服务检查系统进程、应用版本、临时目录写入、仓库路径、项目路径、日志文件、近期日志、启动与重启信号、Windows 兼容日志、Database 状态、Database 完整性、Database CLI、Database MCP、服务注册表、DataRepository 和运行状态。此外，渲染进程追加一次 Renderer-Main IPC 往返检查。

## 使用方式

选择“运行诊断”生成报告。生成后可选择“复制摘要”，将 Markdown 格式摘要复制到剪贴板。

选择“导出诊断包”后，系统要求选择保存位置，并生成 zip 文件。导出成功后，应用将在系统文件管理器中显示该文件。

## 注意事项

导出诊断包前，系统检查目标 zip 文件的写入权限；权限被拒绝时不会写入。导出包包含 `diagnostics.json`、`summary.md`、manifest，并尽可能包含配置备份、Database 数据库副本和日志文件；无法加入的文件将记录到 manifest 的 skipped 列表。

诊断状态包括 `ok`、`degraded`、`failed` 和 `skipped`。整体状态规则是：存在失败项时为失败；没有失败但存在异常项时为异常；否则为通过。

# Diagnostics

<!-- Sources: desktop/src/modules/settings/components/diagnostics-panel.tsx; desktop/src/types/diagnostics.ts; desktop/src/lib/diagnostics-summary.ts; desktop/electron/services/diagnostics-service.ts -->

## 能做什么

Diagnostics 位于设置中的诊断面板。它可以运行诊断、展示整体结论、复制诊断摘要，并导出诊断包。

诊断报告包含生成时间、整体状态、通过/异常/失败/跳过数量、本机信息、应用信息、当前上下文和检查列表。面板会按检查分组展示状态、消息和详情，并额外展示 Windows 兼容性和 macOS 兼容性信息。

诊断服务会检查系统进程、应用版本、临时目录写入、仓库路径、项目路径、日志文件、近期日志、启动与重启信号、Windows 兼容日志、Data Store 状态、Data Store 完整性、Data Store CLI、Data Store MCP、服务注册表、DataRepository 和连接器运行状态。前端还会追加一次 Renderer-Main IPC 往返检查。

## 怎么使用

点击“运行诊断”生成报告。生成后可以点击“复制摘要”，把 Markdown 格式摘要复制到剪贴板。

点击“导出诊断包”会选择保存位置并生成 zip 文件。导出成功后，应用会在系统文件管理器中显示该文件。

## 注意事项

导出诊断包前会检查目标 zip 文件的写入权限；权限被拒绝时不会写入。导出包会包含 `diagnostics.json`、`summary.md`、manifest，并尽量加入配置备份、Data Store 数据库副本和日志文件；无法加入的文件会记录到 manifest 的 skipped 列表。

诊断状态只有 `ok`、`degraded`、`failed` 和 `skipped`。整体状态规则是：存在失败项时为失败；没有失败但存在异常项时为异常；否则为通过。

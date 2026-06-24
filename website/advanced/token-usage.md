# Token Usage

<!-- Sources: desktop/src/modules/usage-analysis; desktop/electron/services/usage-analysis; desktop/src/modules/model-price -->

## 功能范围

Token Usage 读取本机 AI 编辑器和 Agent 的会话记录，解析 token 用量，按模型价格规则估算费用，并提供多维度报表。

当前系统 App 入口名为“用量监控”。页面包含 Claude Code 和 Codex 视图，支持刷新、时间范围筛选、模型分布、项目分布、工具分布、详情列表和会话详情。

## 数据采集

数据读取发生在本机。扫描使用文件指纹判断增量，未变化的文件跳过解析。

解析结果包含 input、output、cache read、cache write 和 reasoning 等 token 类型。费用估算依赖 Model Price 规则；未命中的模型显示为未定价。

## 使用方式

1. 打开用量监控。
2. 选择 Claude Code 或 Codex。
3. 选择刷新，或使用当前页面的自动刷新。
4. 按时间范围、模型、项目和工具查看统计。
5. 打开详情页查看单次会话记录。

## 注意事项

费用为估算值，实际账单可能因折扣、套餐或供应商计费口径不同。

部分编辑器默认不生成详细日志，需在编辑器设置中开启后才能采集。

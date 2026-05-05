# Token Usage 官网页面设计

## 概述

为 Synapse 官网新增 Token Usage（用量统计）功能介绍，包含首页 feature 卡片和高级功能区详细页。

## 变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `website/index.md` | 修改 | features 新增第 9 项 |
| `website/advanced/token-usage.md` | 新建 | 详细功能页 |
| `website/.vitepress/config.mts` | 修改 | 侧边栏新增入口 |
| `website/advanced/index.md` | 修改 | 总览列表新增链接 |

## 首页 Feature 卡片

```yaml
title: Token Usage（用量统计）
details: 扫描本地 AI 编辑器日志，汇总 token 消耗与费用估算，支持按模型、日期、Agent 多维度查看。
```

位置：features 列表末尾（第 9 项）。

## 详细页结构（advanced/token-usage.md）

### 功能范围

Token Usage 扫描本地 AI 编辑器和 Agent 的会话日志，解析每次对话的 token 用量，按模型定价估算费用，并提供多维度可视化。

统计维度：

- 概览 — 总 token 数、总费用、活跃天数、贡献热力图
- 模型分布 — 按模型或按编辑器×模型分组的用量与费用
- 日报 — 每日 token 消耗趋势
- 小时分布 — 24 小时使用热力图
- Agent 分布 — 各编辑器/Agent 的用量占比
- 汇总 — 综合统计数据

### 支持的编辑器与 Agent

表格（名称 + 日志格式），共 21 种：

| 名称 | 日志格式 |
|------|----------|
| Claude Code | JSONL |
| Codex | JSONL |
| Cursor | CSV |
| Gemini CLI | JSON / JSONL |
| Copilot | JSONL (OpenTelemetry) |
| Amp | JSON |
| Roo Code | JSON |
| Kilo Code | JSON |
| OpenCode | JSON |
| Pi | JSONL |
| Kimi | JSONL |
| Qwen | JSONL |
| Mux | JSON |
| OpenClaw | JSONL |
| Droid | JSON |
| Codebuff | JSON |
| Hermes | SQLite |
| Goose | SQLite |
| Crush | JSON |
| Antigravity | JSONL |
| Synthetic | SQLite |

### 统计方式

三段说明：

1. **数据采集** — 读取各编辑器在本地磁盘上的会话日志文件。扫描使用文件指纹（大小 + 修改时间）判断增量，未变化的文件跳过解析。
2. **Token 解析** — 从日志中提取每条消息的 input tokens、output tokens、cache read tokens 和 cache write tokens。部分编辑器还包含 reasoning tokens。
3. **费用估算** — 内置主流模型定价表（Anthropic、OpenAI、Google、DeepSeek、xAI、Moonshot），按各 token 类型分别计算费用。定价表随版本更新。

### 使用方式

有序列表：

1. 打开 Token Usage 页面，选择"扫描"触发数据采集
2. 扫描完成后自动展示概览视图
3. 通过顶部标签切换统计维度（概览 / 模型 / 日报 / 小时 / Agent / 汇总）
4. 使用时间范围筛选器限定统计区间
5. 使用数据源筛选器选择要包含的编辑器
6. 使用分组方式切换按模型或按编辑器×模型分组
7. 选择"导出"将当前数据导出为文件

### 注意事项

- 所有数据读取和存储均在本地完成，不上传到任何服务器。
- 费用为基于公开定价的估算值，实际账单可能因折扣、套餐等因素不同。
- 部分编辑器默认不生成详细日志，需在编辑器设置中开启后才能采集。
- 首次扫描可能耗时较长（取决于历史日志量），后续增量扫描通常在数秒内完成。

## 侧边栏位置

在 `/advanced/` sidebar 中，排在 Task Scheduler 之后、Editor Scan 之前：

```
总览 → Agent → Prompts → Database → Task Scheduler → **Token Usage** → Editor Scan → Diagnostics
```

## 设计约束

- 文案遵循 `website-copy.md` 规范：不用营销腔、不做情感铺垫、术语保持英文
- 页面结构对齐现有 Database / Task Scheduler 页面风格
- 不描述未实现的功能

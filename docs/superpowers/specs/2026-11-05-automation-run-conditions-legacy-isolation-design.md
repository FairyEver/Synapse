# Automation 附加条件与旧版隔离

日期：2026-11-05。

## 目标

把“星期几”和“每天的时间段”从 Cron、固定间隔的触发器配置里抽离为 Automation 级附加条件，并让同一层条件覆盖全部自动触发方式。已有 `schemaVersion: 1` 自动化不迁移、不删除，升级后自动停用并保留为只读配置。

## 版本边界

- 新创建 Automation 固定写入 `schemaVersion: 2`。
- 已有 `schemaVersion: 1` 保持原版本和原结构，不把 `trigger.config.activeDays/timeRange` 转成新条件。
- 应用启动在恢复中断运行后、安排任何定时器前，幂等停用所有仍启用的 `v1` 条目，并清空派生的 `nextRunAt`。
- 停用不修改名称、触发器、执行器、提示词、创建时间或运行历史。
- `v1` 不可编辑、启用或手动运行；详情继续展示原始配置和提示词。
- 自动清理、退休执行器清理和 `deleteNonAgent` 不得删除 `v1`。备份导入时 `v1` 强制停用并保留。

## 条件模型

```ts
type AutomationConditions = {
  operator: "and" | "or"
  items: Array<
    | { type: "weekdays"; days: number[] }
    | { type: "daily-time-range"; start: string; end: string }
  >
}
```

- 每类条件最多一项。
- `days` 使用 `0=周日` 到 `6=周六`，持久化前去重排序。
- 时间段使用 `HH:mm`，结束允许 `24:00`，开始必须早于结束。
- 空条件表示不限制；多个条件统一使用 `and` 或 `or`。
- 创建时省略 `conditions` 表示不限制；更新时空缺表示保留，`null` 表示清空。

## 运行时

- Cron、固定间隔、Webhook、外部邮件和站内信都经过同一 Automation 条件闸门。
- 手动运行不受附加条件限制；已经启动的运行跨过结束时间后继续。
- Cron 使用自身时区，其他触发器使用本机时区。
- 时间窗口开始包含、结束排除。
- Cron/固定间隔计算下次运行时使用 Automation 条件，保留间隔节奏、夏令时处理和最多五年的搜索上限。
- Webhook 和邮件按事件接收时间判断；执行前再次复验，窗口外事件直接丢弃，不延期、不补跑。
- Webhook 窗口外不创建用户可见运行记录；邮件投递在内部标记 skipped 并推进去重水位。

## 桌面界面

- 左侧触发卡下方显示“并且符合以下条件”，再显示独立条件卡。
- 条件卡默认没有条件，通过“添加条件”选择“星期几”或“每天的时间段”。
- 两项条件之间显示“并且 / 或者”关系控件。
- 条件独立于触发器类型，切换 Cron、固定间隔或事件触发器时保留。
- `v1` 详情显示“旧版自动化已停用，请新建后重新配置”，隐藏编辑、启用和运行入口。

## 公开契约

- IPC、Renderer bridge、MCP create/update/list/get 支持顶层 `conditions`。
- 公开摘要增加 `schemaVersion`、`legacy` 和安全的条件结构。
- 触发器发现不再返回 `activeDays/timeRange`。
- 不新增 IPC、MCP 工具或 capability；Automation 仍为 14 个 capability / 14 个 MCP 索引。
- `automation.items` 的 DataRepository namespace 版本不变，条目版本允许 `1 | 2`。

## 非目标

- 不自动把旧条件转换成新条件。
- 不恢复已在交付前被退休执行器清理删除的数据。
- 不支持旧版 Synapse 读取 `schemaVersion: 2`。
- 不支持工作日与时间段之外的额外条件类型。

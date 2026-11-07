# 自动化手动触发设计

## Intent

新增独立的 `builtin.manual` 自动化触发器。它没有触发配置参数，不进入定时器或事件监听，只能由启用后的用户或 Agent 通过现有手动运行入口发起。

## Behavior

- `builtin.manual` 使用 `kind: "manual"`、严格空对象配置 `{}`，不实现调度或事件 runtime。
- 桌面运行按钮和现有 `app_automation_run_execute` 都可发起手动运行；它们都属于主动手动调用，不是自动触发。
- 停用、无效和旧版自动化拒绝手动运行。
- 手动运行绕过顶层星期/每日时间段条件；Cron 和固定间隔保持现有手动运行语义。
- 公共变量包含自动化名称、ID、运行 ID、触发时间、执行时间、业务日期、时区、运行来源和触发器类型；手动触发不提供 `trigger.scheduledAt` 或事件变量。
- 触发器列表在编辑器中分为“按时间”“按事件”“按手动”。手动触发没有配置表单，但保留变量查看入口和顶层附加条件。
- 不新增 IPC、MCP action、权限或存储迁移。触发器发现自动返回第六种触发器；Automation capability/MCP 索引数量不变。

## Compatibility

新建条目继续使用 `schemaVersion: 2`。旧客户端遇到未知的 `builtin.manual` 时按现有兼容规则只读并标记需要升级；不迁移旧配置。

当用户消息中出现 `sss` 时，优先使用 `synapse-mcp` MCP 中与意图匹配的工具，不要仅因出现 `sss` 就默认调用数据库工具。

- 涉及数据库、表、字段、行记录、SQL、Database、数据增删改查时，使用 Database 相关工具。
- 涉及定时任务、调度、cron/interval、任务启停、运行记录或 runtime 状态时，使用 scheduler 相关工具。
- 只有 `sss` 但领域不明确时，先根据上下文判断；仍不明确就问一句简短澄清。

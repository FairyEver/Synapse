# Auto Stop Signal

## Summary

为 auto 调度器增加文件级停止信号：在 `auto/state/stop` 写入任意非空内容，循环在下一个检查点优雅退出。

## Behavior

| 条件 | 结果 |
|------|------|
| `state/stop` 不存在 | 继续 |
| `state/stop` 存在但内容 trim 后为空 | 继续 |
| `state/stop` 存在且内容非空 | 停止循环 |

## Check Points

1. 每次 `runOnce` 调用前
2. 每次 `runOnce` 完成后、进入等待间隔前

## Stop Sequence

1. 读取文件内容作为 reason
2. 打印日志：`● stopped by signal: <reason>`
3. 清空文件内容（writeFile 写入空字符串）
4. 退出进程（exit 0）

## Changes

- `auto/src/index.ts` — 新增 `checkStopSignal()` 函数，loop 中两处调用
- 不改 config / runner / logger

## Edge Cases

- 启动时 stop 文件已有内容 → 首次检查即退出，不执行任何 runOnce
- 文件不存在 → 视为无信号（不报错）
- 并发写入 → 无需处理，单进程场景下不存在竞争

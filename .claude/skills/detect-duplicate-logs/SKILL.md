---
name: detect-duplicate-logs
description: 分析日志中的重复条目，定位代码中的诱发因素（React StrictMode + 不纯的 state updater / 无取消的 useEffect），自动修复。Use when 分析日志、看日志、日志分析、log analysis、review logs、检查日志重复、duplicate logs。
user-invocable: false
---

# Detect & Fix Duplicate Logs

当用户提供应用日志进行分析时，自动扫描重复日志条目并修复代码根因。

## When to activate

用户贴了日志让分析时自动触发，不管用户的主要意图是什么。作为背景检查与用户的其他请求并行执行。

触发短语：`分析日志` · `看日志` · `日志分析` · `分析新的日志` · `log analysis` · `review logs` · `检查日志`

## Detection

扫描日志，找出出现 2+ 次的条目（相同消息、时间戳相同或相差 <10ms、相同 payload）。

忽略：
- main 进程 DEBUG 级别日志（`config-store`、`repository-store`、`ipc.update`）— 这是 dev 模式下 StrictMode 的正常 IPC 重复
- 确实是独立操作的条目（时间差 >100ms、payload 不同）

聚焦 renderer 侧 INFO/WARN/ERROR 级别的明确重复。

## Root Cause Patterns

此项目使用 React 19 + StrictMode，最常见的重复日志根因：

### Pattern 1: Logger inside `setState` updater

StrictMode 会双重调用 state updater 函数（updater 必须是纯函数）。

```ts
// BAD
setSomeState((prev) => {
  if (prev !== next) {
    logger.info("Changed.", { from: prev, to: next })  // 副作用！
  }
  return next
})
```

修复：用 `useRef` 追踪前值，在 updater 外面记日志。

```ts
const someStateRef = useRef(someState)
someStateRef.current = someState

// 在回调中：
const prev = someStateRef.current
if (prev !== next) {
  logger.info("Changed.", { from: prev, to: next })
}
setSomeState(next)
```

### Pattern 2: Logger inside async `useEffect` without cancellation

StrictMode mount → unmount → remount，effect 跑两次。异步 effect 如果没有取消守卫，完成时会双重记日志。

```ts
// BAD
useEffect(() => {
  void (async () => {
    const result = await fetchSomething()
    logger.info("Loaded.", { count: result.length })
  })()
}, [dep])
```

修复：用 `AbortController` 或 `cancelled` flag。

```ts
useEffect(() => {
  const controller = new AbortController()
  void (async () => {
    const result = await fetchSomething()
    if (controller.signal.aborted) return
    logger.info("Loaded.", { count: result.length })
  })()
  return () => controller.abort()
}, [dep])
```

### Pattern 3: Logger inside synchronous `useEffect`

同步 effect 中的日志用 ref 去重。

```ts
const prevOpenRef = useRef(open)
useEffect(() => {
  if (prevOpenRef.current !== open) {
    logger.info("Visibility changed.", { open })
    prevOpenRef.current = open
  }
}, [open])
```

## Procedure

1. 解析日志，按消息文本分组，识别重复
2. 如果没有重复 → 报告"未检测到重复日志"，结束
3. 对每组重复：
   a. `grep` 日志消息字符串，定位源码位置
   b. 读取上下文代码，判断属于哪种 pattern
   c. 应用对应的修复模式
4. 运行 `pnpm -s exec tsc --noEmit --pretty false` 验证编译通过
5. 报告发现和修复内容

## Important

- 修复后必须验证编译通过
- 不要动 main 进程 DEBUG 级别的重复 — dev 模式下正常
- 添加 `useRef` 前检查是否已导入
- 如果 state 来自自定义 hook（不是直接 `useState`），ref 追踪的是 hook 返回值
- 如果 `refresh()` 等函数暴露给外部调用者，`signal` 参数保持可选

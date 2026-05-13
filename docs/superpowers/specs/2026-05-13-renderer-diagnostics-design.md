# Renderer Diagnostics 设计

## 背景

Synapse 已有基础的前端错误拦截（`installRendererLogForwarding` 捕获 `window.error` + `unhandledrejection`，`AppErrorBoundary` 捕获 React 渲染错误），但在用户 fanxw 的白屏事件中，日志里没有任何前端报错——因为渲染进程被 macOS 内存压力冻结，根本没有 JS 错误发生。

现有机制覆盖不到的场景：进程冻结/崩溃、console.error 输出、网络请求失败、资源加载失败、性能劣化。

## 目标

建立完整的渲染进程可观测性层，所有信号最终落盘到日志文件，用于事后诊断。

## 架构

按 Electron 进程边界拆分为两侧：

```
主进程 (electron/)
└── services/renderer-health/
    ├── renderer-health-service.ts   # 心跳检测 + 崩溃监听
    └── constants.ts                 # 超时阈值配置

渲染进程 (src/)
└── app-shell/diagnostics/
    ├── index.ts                     # installDiagnostics() 统一入口
    ├── guard.ts                     # 防递归写入守卫
    ├── console-interceptor.ts       # console.error/warn 拦截
    ├── network-interceptor.ts       # fetch 失败记录
    ├── resource-error-listener.ts   # 资源加载失败
    ├── performance-observer.ts      # longtask + 内存采样
    └── heartbeat-responder.ts       # 响应主进程心跳 ping
```

### 数据流

- 渲染进程信号 → `createRendererLogger("diagnostics.<module>")` → IPC `synapse:log:write` → `logStore` → 日志文件
- 主进程信号 → `createMainLogger("renderer-health")` → `logStore` → 日志文件

## 防递归策略

所有诊断模块通过统一的 `guardedLog` 写日志：

```typescript
// diagnostics/guard.ts
let _writing = false

export function guardedLog(logger, level, msg, meta?) {
  if (_writing) return
  _writing = true
  try {
    logger[level](msg, meta)
  } finally {
    _writing = false
  }
}
```

规则：
- 正在写日志时产生的新诊断事件直接丢弃，不递归
- console 拦截器内部调用原始 `originalConsole.error()` 保持 DevTools 输出不变
- 网络拦截器不监听 IPC 通信（IPC 走 Electron contextBridge，不经过 fetch）

## 主进程：renderer-health-service

### 心跳检测

- 每 30 秒通过 `webContents.send('synapse:diagnostics:ping')` 发送心跳
- 渲染进程收到后立即回复 `synapse:diagnostics:pong`
- 等待 5 秒未收到 pong → `WARN` "渲染进程无响应"
- 连续 3 次无响应 → `ERROR` "渲染进程疑似冻结"，附带最后成功响应时间戳
- 恢复响应后记录 `INFO` "渲染进程恢复响应"

### 崩溃检测

- 监听 `webContents.on('render-process-gone')`
- 记录 `ERROR`，包含 `details.reason`（crashed / killed / oom）和 `details.exitCode`

### 生命周期

- 随 BrowserWindow 创建时启动，窗口关闭时停止
- 窗口最小化/隐藏时不暂停

## 渲染进程：diagnostics 模块

### console-interceptor

- 保存原始引用 `originalConsole = { error: console.error, warn: console.warn }`
- 替换 `console.error` / `console.warn`：先调原始方法保持 DevTools 正常，再 `guardedLog` 转发
- 日志 tag：`diagnostics.console`
- 参数序列化：对象 `JSON.stringify` 截断到 2KB，Error 实例提取 message + stack

### network-interceptor

- 包装全局 `fetch`：response 非 ok 或 catch 网络错误时记录
- 日志 tag：`diagnostics.network`
- 记录：method、URL（脱敏去掉 query 中 token/key 参数）、status、耗时、错误类型
- 不拦截 `file://` 协议请求
- 不记录 response body

### resource-error-listener

- `document.addEventListener("error", handler, true)` 捕获阶段监听
- 只处理 target 为 `HTMLImageElement | HTMLScriptElement | HTMLLinkElement`
- 日志 tag：`diagnostics.resource`
- 记录：标签类型、src/href、失败时间

### performance-observer

- `PerformanceObserver` 监听 `longtask`，duration > 100ms 时记录 `WARN`
- 日志 tag：`diagnostics.performance`
- 记录：duration、startTime、attribution
- 内存采样：每 60 秒读 `performance.memory`，仅 `usedJSHeapSize / jsHeapSizeLimit > 0.85` 时记录 `WARN`

### heartbeat-responder

- 监听 `synapse:diagnostics:ping`，立即回复 `pong`
- 极简实现，不做额外逻辑

## 集成

### 渲染进程启动顺序

```typescript
// main.ts
installRendererLogForwarding()  // 现有，不动
installDiagnostics()            // 新增，紧随其后
// React render...
```

### 主进程集成

```typescript
// createWindow()
const win = new BrowserWindow(...)
rendererHealthService.attach(win.webContents)
```

### 卸载/清理

- `installDiagnostics()` 返回 cleanup 函数，HMR 热更新时调用
- 各模块 `install()` 返回 `() => void` 用于还原 monkey-patch

## 日志格式示例

```
[WARN ] [renderer:diagnostics.console] Uncaught TypeError: Cannot read property 'x' of null
[WARN ] [renderer:diagnostics.network] 请求失败 POST /api/license/validate → 429 (312ms)
[ERROR] [renderer:diagnostics.resource] 资源加载失败 <script src="/assets/chunk-abc.js">
[WARN ] [renderer:diagnostics.performance] 长任务 duration=230ms startTime=14523ms
[WARN ] [main:renderer-health] 渲染进程无响应 (lastPong=2026-05-13T09:30:12Z, elapsed=35s)
[ERROR] [main:renderer-health] 渲染进程疑似冻结 (consecutiveMisses=3)
[ERROR] [main:renderer-health] 渲染进程崩溃 reason=oom exitCode=134
```

## 配置

不做运行时配置开关，所有模块默认启用。未来需要按环境关闭再加 feature flag。

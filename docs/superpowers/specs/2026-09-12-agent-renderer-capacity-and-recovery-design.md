# Agent Renderer 容量与恢复设计

## 目标

Agent Provider 可以产生远高于用户可见内容数量的 SDK 遥测和流式增量。本设计把 SDK 消息、运行时语义状态、Renderer 显示投影分开，避免高频事件或超长对象压垮 Electron Renderer，并在 Renderer 故障时停止其发起的本地 Agent。

百炼 200K 自动整理与 6 MiB 请求体恢复继续独立生效；本设计适用于所有 Agent Provider。

## 数据边界

```text
SDK 消息 → 入口分类 → 语义事件 / 流式增量 / 聚合诊断
         → 有界 Renderer 投影 → 有界 EventBus 批次 → Renderer
```

### Hard Rules

- `system/thinking_tokens` 不生成 AgentEvent，不进入 EventBus、Conversation history、agent.events 或轮次结果。真实推理文本仍由 `thinking_delta` 提供。
- 未知 SDK type/subtype 默认忽略，只允许记录不含正文、路径、凭据或原始 payload 的聚合统计。新增用户可见 SDK 类型必须显式映射。
- Renderer 事件不得携带 Provider 原始 payload、Assistant 原始 message/contentBlocks、图片 Base64 或完整工具正文。
- 本地流式事件 50 ms 内最多投递一次；每批最多 128 条、64 KiB；每个 Renderer/对话最多一个未确认批次；等待确认的数据最多 512 KiB，超限改为 timeline resync。
- 普通 Agent send/恢复响应只返回不超过 32 KiB 的终态摘要，不返回正文或整轮事件数组。
- Timeline 以连续记录区间分页，允许切开同一用户回合；`beforeIndex` 为排他记录索引，保留稳定 ID 和 `toolUseId` 以便跨页关联。不得为凑齐一轮突破页上限或整轮裁成空页。无可展示记录但仍有旧页时显示加载历史入口；加载中或可重试的历史错误不得显示“暂无消息”。
- Timeline 每页最多 100 条、1 MiB，单项预览最多 64 KiB。全文接口只能按已校验的 project、conversation 和 history index 读取，每次最多 64 KiB，不接受路径。
- AgentRuntimeTurnResult 不保留流式增量和未知诊断；语义事件集合有硬上限，并始终优先保留终态、权限、工具结果摘要与最后 Assistant。
- Renderer 启动时必须在进入 Chromium 原生序列化前移除 `performance.measure` 的可选 `detail`；不得依赖序列化失败后的 JS 异常恢复，避免 React 开发诊断克隆大型 props 时触发原生 OOM。
- `render-process-gone` 事件处理栈内不得同步执行 `loadURL`、`reload` 或其它 Renderer 导航；恢复入口必须延迟到下一个 macrotask，并在执行前确认窗口仍受当前健康服务管理。
- Renderer 崩溃时只停止该 Renderer 发起的本地交互轮次；Automation、Workflow、Relay 和其它窗口不受影响。已执行工具不回滚、不重放。
- Renderer 持续无响应 5 秒后执行同样止损。先调用 SDK interrupt，2 秒未结束则关闭 LiveSession 和子进程。
- 恢复入口不得静态导入普通 App 或 Agent 模块。60 秒内重复崩溃停止自动恢复并提供原生重新打开/退出操作。

## 持久化与维护

- Conversation history、usage、附件、artifact 和文件检查点是权威数据，不因显示降级删除。
- streamDiagnostics 保持每轮 1000 条、512 KiB，终态批量落库。
- 历史 `sdkEvent + system/thinking_tokens` 由后台 DataRepository Worker 清理：每批最多 500 行、每轮最多 100,000 行，可中断、可重试，不执行启动期 VACUUM。
- Renderer 长任务每 10 秒最多记录一条数量、累计时长和最大时长汇总。

## 用户体验

- 正常流式显示最多增加 50 ms 延迟；极端积压时暂时停止逐字动画并从 timeline 恢复最终状态。
- 超长内容显示预览和“内容较长，查看全文”，全文按 64 KiB 分段查看。
- Renderer 故障时显示“正在恢复界面…”。恢复后原对话保留部分输出和“界面异常，本次运行已停止。”，用户点击“继续”才开始新一轮。
- 不自动重试请求，不自动重放工具，不改变附件原件或模型思考能力。

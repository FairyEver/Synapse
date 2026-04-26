# Stage 14 Feishu/Lark Runtime Migration Plan

## 目标

在 Synapse 中将外部平台范围裁剪为 Feishu/Lark，并按 CC Connect 源码迁移 Feishu/Lark 真实运行时，使扫码保存后能启动或重载连接、接收消息、进入 Synapse agent/session 链路并回复。

## 范围

- 读取并对照用户指定的 CC Connect 与 Synapse 源码。
- 生成 Stage 14 要求的 artifacts。
- 仅保留 Feishu/Lark 当前产品入口，历史非 Feishu/Lark 配置最多作为 legacy/unsupported 读取展示。
- 补齐 Feishu/Lark registration、runtime、message receive/reply send、UI 状态和测试。
- 按可独立验收批次提交。

## 成功标准

- artifacts `14.0` 至 `14.5` 和 `0.0-latest-handoff.md` 已更新。
- 平台列表、新增入口和 runtime 当前只暴露 Feishu/Lark。
- 保存 Feishu/Lark 配置后触发 runtime start/reload。
- Feishu/Lark inbound message 能进入 Synapse session，agent 回复会调用 outbound send。
- 指定测试、typecheck、hard constraints、ipc codegen 和 diff check 完成或有明确阻塞记录。

## 阶段

### 阶段 1：源码对照与当前状态

**状态：** complete

验证：生成 `待办/cc-connect-migration/artifacts/14.1-feishu-lark-source-trace.md` 与 `14.0-feishu-lark-runtime-state.md`。

### 阶段 2：平台范围裁剪

**状态：** complete

验证：只暴露 Feishu/Lark，非 Feishu/Lark 不可新增，生成 `14.2-platform-scope-prune-report.md` 并提交 B01。

### 阶段 3：Feishu/Lark registration 与 runtime

**状态：** in_progress

验证：保存配置后启动/重载 runtime，支持 WebSocket、事件转换、消息回复，生成 `14.3-feishu-lark-runtime-implementation-report.md` 并提交 B02/B03。

### 阶段 4：UI 状态与测试

**状态：** in_progress

验证：二维码流程状态完整，补充 unit/runtime 测试，生成 `14.4-feishu-lark-test-report.md`。

### 阶段 5：真实验收与交接

**状态：** pending

验证：完成或明确记录真实扫码验收阻塞，生成 `14.5-feishu-lark-real-acceptance.md` 与 `0.0-latest-handoff.md`。

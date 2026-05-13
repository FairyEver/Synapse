# Phase 2 实施提示词

> 复制以下内容到新对话中，作为开场消息。

---

## 任务

在 `cc-sdk` 分支上继续实施 Phase 2：用 Agent SDK 替换 spawn CLI，重写 Provider 管理模块。

Phase 1 已完成（11 个 commit，净删 ~2800 行），当前状态：
- 分支：`cc-sdk`（基于 main）
- TypeScript 编译通过，1029 测试全部通过，build 成功
- 所有 agent 代码只剩 Claude Code 一条路径
- `AgentAdapterFactory` 已删除，`AgentRuntimeService` 直接使用 `ClaudeCodeAdapter`
- 前端无 agent 类型选择 UI

## Phase 2 设计规格

完整设计文档：`docs/superpowers/specs/2026-05-13-cc-sdk-migration-design.md`（Phase 2 部分）

### 两大工作块

**A. Agent SDK 集成**

- 安装 `@anthropic-ai/claude-agent-sdk`（TypeScript SDK，自带 CC binary）
- 新建 `electron/services/agent-runtime/claude-sdk-session.ts`，实现 `AgentLiveSession` 接口
- 封装 SDK `query()` 调用，将 streaming 事件转换为现有 `AgentEvent` 类型
- 管理会话生命周期（resume / cancel / abort）
- 删除 `electron/services/agent-runtime/adapters/` 整个目录（含 `claude-code.ts`，488 行）
- 删除 `AgentAdapter` 接口和 `ClaudeProcessRunner` 接口
- `AgentRuntimeService` 直接持有 `ClaudeSDKSession`，不再通过 adapter 间接调用
- `AgentLiveSession` 接口保留（描述会话行为）

**B. Provider 模块重写**

- 删除 `electron/services/provider-config/` 整个目录（当前 ~640 行）
- 新建 `electron/services/provider/`：
  - `provider-service.ts` — Provider CRUD + 活跃选择 + `buildEnv(providerId)`
  - `provider-secret-store.ts` — Electron safeStorage 加密存取 API Key
  - `provider-presets.ts` — 内置预设列表
  - `types.ts` — CCProvider / ProviderCategory 类型定义
- 数据模型见设计文档 `CCProvider` 接口
- 预设参考：`/Users/liyang/Documents/code/demo/cc-switch-main/src/config/claudeProviderPresets.ts`（1029 行，30+ provider 配置）
- API Key 用 `safeStorage.encryptString()` 加密后存入 SQLite blob
- 对话级 Provider 绑定：创建对话时记录 `providerId`，发送消息时 `buildEnv(providerId)` 注入到 SDK `query()` 的 env
- 已有对话不可切换 provider
- 新对话默认使用"活跃 provider"，创建时可选其他

**C. 前端 Provider UI**

- Settings 内新增 Provider 管理页面：列表 + 新增/编辑/删除
- 对话创建时增加 Provider 选择器（下拉）
- 对话界面显示当前 provider 状态指示
- 删除旧的 provider 配置 UI

### 关键接口对接

当前 `AgentRuntimeService`（842 行）的核心调用链：
1. `send(message)` → `messageRouter.send(message)`
2. `messageRouter` 调用 `resolveAdapter()` 获取 adapter
3. adapter 的 `execute()` 方法 spawn CLI 进程
4. 进程输出通过 JSON lines 解析为 `AgentEvent`

Phase 2 后：
1. `send(message)` → `messageRouter.send(message)`
2. `messageRouter` 调用 `resolveSession()` 获取 `ClaudeSDKSession`
3. session 调用 SDK `query()` 并注入 provider env
4. SDK streaming 事件直接映射为 `AgentEvent`

### 不受影响的模块

- 编辑器安装逻辑（Skills/Rules 安装到各编辑器）
- 内容管理（Rules / Skills / Prompts CRUD）
- 仓库 Git 操作
- Workflow 编排（已限制为 CC-only）
- 定时任务（已限制为 CC-only）

## 执行要求

1. 先阅读设计文档 Phase 2 部分和当前代码状态
2. 使用 `/superpowers:brainstorming` 进行设计细化（SDK 事件映射、Provider UI 交互等细节）
3. 然后 `/superpowers:writing-plans` 写实施计划
4. 最后执行实施

## 参考文件

- 设计文档：`docs/superpowers/specs/2026-05-13-cc-sdk-migration-design.md`
- Phase 1 计划（已完成）：`docs/superpowers/plans/2026-05-13-cc-only-phase1.md`
- Provider 预设参考：`/Users/liyang/Documents/code/demo/cc-switch-main/src/config/claudeProviderPresets.ts`
- Provider 类型参考：`/Users/liyang/Documents/code/demo/cc-switch-main/src/types.ts`
- 当前 adapter 实现：`electron/services/agent-runtime/adapters/claude-code.ts`（488 行，了解事件映射）
- 当前 service：`electron/services/agent-runtime/agent-runtime-service.ts`（842 行）
- 当前 provider-config：`electron/services/provider-config/`（~640 行，即将被替换）

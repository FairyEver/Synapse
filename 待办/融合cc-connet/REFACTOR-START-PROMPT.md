# 启动提示词（无人值守模式）

> 首次启动 Synapse 架构重构时复制整段给 AI。中途断网请改用 `REFACTOR-RESUME-PROMPT.md`。

---

**⬇ 以下整段复制粘贴给 AI ⬇**

````text
你是 Synapse 架构重构的无人值守执行者。用户已离开、不会在线回应。你必须自主、连续地完成全部 Phase 0.1 - 0.6 重构、进行自检循环、写出最终报告，全程不暂停不询问。

# 0. 绝对原则

1. **不暂停**：任何情况下都不要"等待用户指令"。遇到任何问题都自主决策并继续。
2. **不询问**：用户已离开。任何疑问写进 REPORT 文件，继续推进。
3. **不欺骗**：失败就是失败。任何测试失败、任何跳过的任务、任何偏离都要如实记录。
4. **不 push**：本地 commit 即可，永远不要 `git push`。
5. **不动 SPEC**：发现 SPEC 问题只在 REPORT 记录建议，不修改 SPEC 本身。

# 1. 关键文件路径

- **SPEC**（设计源）: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/架构前置改造建议.md`
- **PROGRESS**（进度快照，你维护）: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/REFACTOR-PROGRESS.md`
- **REPORT**（最终报告，你维护）: `/Users/liyang/Documents/code/github/Synapse/待办/融合cc-connet/REFACTOR-COMPLETION-REPORT.md`
- **工作目录**: `/Users/liyang/Documents/code/github/Synapse/`

# 2. 启动自检

## 2.1 检查是否重复启动

如果 `REFACTOR-PROGRESS.md` 已存在：

- 读取其 `status` 字段：
  - `completed` → 停下输出"重构已完成，见 REPORT"，不要再做。
  - 其他状态 → 停下输出"已在进行中，请使用 REFACTOR-RESUME-PROMPT.md 恢复"，不要再做。

如果 `REFACTOR-PROGRESS.md` 不存在 → 继续 §2.2。

## 2.2 环境检查

- 跑 `git status`。如果工作区不干净：
  - 跑 `git stash push -m "pre-refactor-autostash-$(date +%s)"` 把现有改动暂存。
  - 在 REPORT 记录 stash 名称以便用户事后恢复。
- 跑 `git log -1 --format='%H %s'` 记录起始 commit。
- 切出分支：`git checkout -b feat/phase-0/architecture-foundation-$(date +%Y%m%d)`。

## 2.3 初始化文件

1. 通读 SPEC 全文（2012 行，分批读完，不要略读）。
2. 按 §10 任务清单创建 `REFACTOR-PROGRESS.md`（见 §11 模板）。
3. 按 §12 模板创建 `REFACTOR-COMPLETION-REPORT.md` 骨架。
4. 立即开始执行第一个任务 `T1.1`。

# 3. 原子任务执行循环（核心）

对每个任务重复以下流程，**完成一个立即进下一个，不暂停不汇报**：

```
任务开始:
  1. 在 PROGRESS 更新 current_task / started_at，status=in_progress
  2. 读 SPEC 对应章节，读相关现有代码（引用行号）
  3. 实施代码改动
  4. 跑自测（见 §5）
  5. 若自测失败 → 尝试修复，最多 3 次
       仍失败 → 标记 blocked，记录到 PROGRESS + REPORT，立刻跳到下一任务
  6. 硬约束自检（见 §6）
  7. git add <相关文件> && git commit -m "refactor(phase-0.X): T<N>.<M> <简述>"
  8. 在 PROGRESS 把任务从 pending 移到 completed，记录 commit hash
  9. 在 REPORT 增量追加一段本任务记录
  10. 立即进入下一任务（不汇报不暂停）
```

**任务粒度与清单见 SPEC + 本文 §10**。一共约 71 个任务。

# 4. 决策策略（不问用户）

遇到任何 SPEC 未明确或有歧义的地方，按决策等级自主处理：

## Level 1 自主决策（不需记录）

- 变量名、函数名、文件内代码风格
- 测试 fixture 的具体数值
- 错误消息的具体文案
- 依赖的具体版本号（选 npm 上最新 stable）
- 单元测试的断言写法

## Level 2 有记录的自主决策（记录到 PROGRESS + REPORT）

触发条件：**SPEC 未覆盖的设计选择**。

- 按 SPEC 的整体精神选最合理方案
- 立即在 REPORT 的"决策记录"段写一条：
  - 决策点描述
  - 候选方案
  - 选择的方案及理由
  - 相关 commit hash

## Level 3 保守决策（记录 + 标红）

触发条件：下列任一情况。

- SPEC 与现有代码行为矛盾
- 改动会影响用户数据格式
- 改动会破坏向后兼容
- 安全相关（加密、权限、网络）的模糊处

处理：**选最保守的方案（通常是保留现有行为）**，在 REPORT 的"需用户复核的关键决策"段标红记录。

## 决策模板

记录到 REPORT 时使用统一格式：

```markdown
### [Level X] <决策点简述>

- **时间**: <ISO>
- **任务**: T<N>.<M>
- **背景**: <SPEC/代码哪里不清楚>
- **候选**: 
  - A: ...
  - B: ...
- **选择**: <A 或 B>
- **理由**: <为什么>
- **commit**: <hash>
- **需用户复核**: 是 / 否
```

# 5. 自测要求

每个原子任务完成前必须跑：

```bash
# 在仓库根目录跑
pnpm desktop:typecheck
pnpm --filter @synapse/desktop test -- <本任务相关 test 文件 glob>
```

如果任务涉及 IPC：

```bash
pnpm generate:ipc
git diff desktop/electron/generated/ desktop/src/generated/ 
# 检查 diff 符合预期；若 codegen 工具未实现，先跳过这步
```

**失败重试策略**：

- 第 1 次失败：分析错误、修正代码、重跑
- 第 2 次失败：检查是否理解错 SPEC、重新设计实现
- 第 3 次失败：
  - 回滚本任务的改动 `git checkout .`
  - 在 PROGRESS 标记任务 `blocked`，记录详细 traceback
  - 在 REPORT 追加一段"遇到的问题"
  - **立刻跳到下一任务**，不再尝试

# 6. 硬约束自检（每次 commit 前）

对本次改动跑这些 grep（在 commit 前）：

```bash
# 1. 不应有新增全局单例
rg "export\s+default\s+new\s+\w+Service\(" desktop/electron/ desktop/src/ --glob '!**/*__tests__*'

# 2. 不应有新增的裸 IPC 注册
rg "ipcMain\.(handle|on)\(" desktop/electron/ --glob '!desktop/electron/runtime/ipc/**' --glob '!desktop/electron/generated/**'

# 3. 不应有裸 webContents.send
rg "webContents\.send\(" desktop/electron/ --glob '!desktop/electron/runtime/event-bus/**' --glob '!desktop/electron/runtime/window/**'

# 4. 不应有裸 http.createServer
rg "(http|net|https)\.createServer\(" desktop/electron/ --glob '!desktop/electron/runtime/network/**'

# 5. 不应有 modules 间直接 import 实现
rg "from\s+['\"]\.\.?/\.\./modules/[^'\"]+/(service|internal|handlers)" desktop/electron/modules/ desktop/src/modules/ 2>/dev/null

# 6. 不应有 catch 空块
rg "catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}" desktop/electron/ desktop/src/ --glob '!**/*__tests__*'

# 7. 不应有裸 fs.writeFile 写业务数据（排除 runtime、tests、日志轮转）
rg "fs\.(writeFile|writeFileSync)\(" desktop/electron/ --glob '!desktop/electron/runtime/**' --glob '!**/*__tests__*' --glob '!**/log*'
```

任一 grep 有新增命中 → 修正后才 commit。

# 7. Phase 完成时（无停顿）

一个 Phase 的最后一个原子任务完成时：

1. 跑 Phase 级验收（见 §8）。
2. 在 PROGRESS 标记本 Phase 完成。
3. 在 REPORT 追加 Phase 总结段（见 §12）。
4. **不暂停不汇报，立即开始下一 Phase 的 T<N>.1**。

# 8. Phase 验收（每 Phase 完成时跑）

```bash
pnpm desktop:typecheck
pnpm desktop:lint  # 若命令不存在则跳过，并在 REPORT 记录
pnpm desktop:test  # 本 Phase 相关全量测试
```

结果无论成败都记录。失败的测试如果是**本 Phase 任务引入的新测试**→ 尝试修复；如果是**与本 Phase 无关的既有测试**→ 记录为待排查，不阻塞继续。

# 9. 全部 Phase 完成后：自检循环

所有 6 个 Phase 的原子任务都走完后（含 blocked），开启自检循环：

```
audit_round = 0
max_rounds = 10

while audit_round < max_rounds:
  audit_round += 1
  issues = run_audit_checks()  # 见下
  
  write_audit_round_to_report(audit_round, issues)
  
  if issues == empty:
    mark_status(completed)
    write_final_summary_to_report()
    break
  
  fix_issues_batched(issues)   # 把修复也做成原子 commit
  # 继续下一轮
  
if audit_round == max_rounds and issues still present:
  mark_status(completed_with_issues)
  write_final_summary_to_report(flag="remaining issues")
  break
```

## 9.1 五类审计检查（每轮都跑）

**A. 编译与测试**

```bash
pnpm desktop:typecheck
pnpm desktop:test
```

**B. 硬约束 grep**（§6 全部 7 条）

**C. SPEC §15.13 接口总览核对**

逐项检查 `desktop/electron/runtime/` 下目录结构是否符合 SPEC §15.13 的清单（13 个子目录 + 各自文件）。每个未建立的子目录记为一个 issue。

**D. 硬约束清单核对**

核对 SPEC §1 的 11 条硬约束在代码中是否得到贯彻。

**E. PROGRESS / REPORT 一致性**

- PROGRESS 所有任务都应有 commit hash（或 blocked 标记）
- REPORT 应覆盖 PROGRESS 的所有任务
- 所有 Level 2/3 决策都应在 REPORT 中列出

## 9.2 修复策略

- 每个 issue 当做一个 mini 任务处理，走 §3 的原子任务循环。
- mini 任务的 commit message 前缀用 `refactor(audit-R<轮>): <简述>`。
- 修复失败 3 次同样跳过，记录到 REPORT。

## 9.3 终止判定

- issues 为空（连续 1 轮干净即可）→ 完成
- audit_round > 10 → 终止，标记 `completed_with_issues`

# 10. 任务清单（71 个原子任务）

创建 PROGRESS 时把这份清单作为初始状态。

### Phase 0.1 ServiceRegistry（9 任务）
- T1.1 建 `desktop/electron/runtime/service-registry/` 骨架 + types.ts + errors.ts
- T1.2 实现 topo.ts 拓扑排序 + 单测（含循环检测）
- T1.3 实现 registry.ts register/inspect + 单测
- T1.4 实现 startAll/stopAll 含超时控制 + 单测
- T1.5 迁移 core.config / core.logging 为 ServiceDescriptor
- T1.6 迁移 core.data-store / core.update / core.app-icon 为 ServiceDescriptor
- T1.7 迁移 repo.watch / repo.maintenance / repo.pending-pushes / ui.tray 为 ServiceDescriptor
- T1.8 改写 `desktop/electron/main.ts` 为 registry 启停钩子（< 120 行）
- T1.9 Phase 0.1 集成测试（启动 inspect 全 running、关闭 15s 内 stopped）

### Phase 0.2 DataRepository（14 任务）
- T2.1 建 `desktop/electron/runtime/data-repo/` 类型 + DataNamespace 抽象 + 单测
- T2.2 实现 JsonBackend + 原子写 + 单测
- T2.3 实现 EncryptedJsonBackend（Electron safeStorage）+ 单测（含 Linux 无 keyring 抛 EncryptionUnavailableError）
- T2.4 实现 JsonLinesBackend + 单测
- T2.5 实现 SqliteBackend 包装现有 data-store + 单测
- T2.6 实现 Migration 框架 + NamespaceSchema + 单测
- T2.7 迁移 core.config namespace + v0→v1 迁移脚本 + 迁移测试
- T2.8 迁移 core.identity / repo.pending-pushes / repo.repositories 到 DataRepository
- T2.9 预留 secrets / providers / projects / connectors / conversations / audit / outbox 等 namespace schema（接口占位）
- T2.10 实现 BackupStrategy + BackupRegistry + local-zip 默认实现（§15.11）
- T2.11 实现 NamespaceExporter + ExporterRegistry 骨架（§15.11）
- T2.12 实现 LayeredConfig 接口占位 + 单测（§15.8）
- T2.13 改写 `config-backup-service.ts` 走 DataRepository.exportAll/importAll（IPC 通道不变）
- T2.14 Phase 0.2 集成测试（v0 config 迁移、备份导入、加密可用性）

### Phase 0.3 IPC Codegen + WindowManager + NetworkServiceRegistry（16 任务）
- T3.1 建 `desktop/electron/runtime/ipc/` 类型定义 + errors
- T3.2 实现 IpcRegistry 运行时 + zod validation + 单测
- T3.3 写 `scripts/generate-ipc.ts`（ts-morph 解析 IpcModule → 生成 channels/preload/bridge-types）+ codegen 测试
- T3.4 迁移 shell / cli / identity / user-profile 为 IpcModule
- T3.5 迁移 log / update / editor-scan / editor 为 IpcModule
- T3.6 迁移 config / repository 为 IpcModule
- T3.7 迁移 content 为 IpcModule（最复杂）
- T3.8 迁移 data-store 为 IpcModule（包一层不动现有 API）
- T3.9 删旧 `channels.ts` / `*-handlers.ts` / `types/bridge.ts`
- T3.10 改写 `preload.ts` 为 `export * from "../generated/preload.generated"`
- T3.11 引入 IPC_PROTOCOL_VERSION 握手 + 单测（§15.2）
- T3.12 建 `runtime/window/` WindowManager + 迁移 createMainWindow
- T3.13 迁移 contentWindowService 到 WindowManager
- T3.14 替换所有 BrowserWindow.getAllWindows() 为 WindowManager.broadcast
- T3.15 建 `runtime/network/` NetworkServiceRegistry 骨架 + 单测（§15.2）
- T3.16 Phase 0.3 集成测试 + codegen CI 闸门脚本

### Phase 0.4 EventBus（8 任务）
- T4.1 建 `runtime/event-bus/` 类型 + bus 核心实现 + 单测
- T4.2 实现 scope 过滤 + WindowManager 广播桥接
- T4.3 实现 coalesce 背压策略（默认 16ms 合并窗口）+ 单测
- T4.4 渲染端 `src/runtime/event-bus-client.ts` + EventRouter
- T4.5 迁移 5 个现有事件到 domain+type 模型（repository/update/data-store 三 domain）
- T4.6 删旧 sendToRenderer 辅助函数
- T4.7 预留 EventBusBridge / EventRecorder 接口占位（§15）
- T4.8 Phase 0.4 集成测试（双窗口事件传播、scope 过滤）

### Phase 0.5 ProjectContainer + ProcessRuntime（7 任务）
- T5.1 建 `runtime/project-container/` 类型 + registry 骨架 + 单测
- T5.2 实现 ScopedEventBus + ProjectScopedDataRepo + 单测（跨 project 隔离）
- T5.3 实现 idle-reaper 全局服务
- T5.4 渲染端 `app-shell/active-project.tsx` + `use-active-project.ts`
- T5.5 建 `runtime/process/` ProcessRuntime 接口 + main 直跑实现 + 单测（§15.3）
- T5.6 建 `runtime/runtime-mode.ts` + `bootstrap.ts`（§15.3）
- T5.7 Phase 0.5 集成测试

### Phase 0.6 工程规范与可观测性（17 任务）
- T6.1 实现 `runtime/logging/` StructuredLogger + 按大小/按天轮转 + 按 module 分流 + 单测
- T6.2 实现 `runtime/observability/metrics.ts` MetricsRegistry + Counter/Gauge/Histogram + 单测
- T6.3 实现 `runtime/observability/tracer.ts` Tracer + Span + 单测
- T6.4 实现 `runtime/observability/health.ts` HealthCheckAggregator + 单测
- T6.5 实现 `runtime/observability/diagnostics.ts` DiagnosticsCollector（脱敏）+ 单测
- T6.6 实现 `runtime/security/permission-guard.ts` PermissionGuard + 默认策略 + 单测
- T6.7 实现 `runtime/security/audit-sink.ts` AuditSink（JsonLines backend）+ 单测
- T6.8 实现 `runtime/scheduling/` TaskQueue + RateLimiter（令牌桶）+ CircuitBreaker + 单测
- T6.9 实现 `runtime/extension/` ExtensionRegistry + ExtensionPoint + 单测
- T6.10 迁移 content types / editors / editor-scan providers 到 ExtensionPoint（保留现有硬编码作为默认注册）
- T6.11 实现 `desktop/src/runtime/i18n.ts` + `theme.ts` 接口占位（§15.9）
- T6.12 实现 `desktop/src/runtime/debug-panel.tsx` 骨架（dev-only）
- T6.13 建 `desktop/tests/{unit,ipc,perf,fuzz,e2e}/` 目录 + fixture 工具 + 示例测试
- T6.14 加 ESLint 规则（禁 modules 互相 import）+ 确认 lint 通过
- T6.15 更新 `AGENTS.md` 硬约束段（同步 SPEC §1 的 11 条）
- T6.16 更新 `.github/workflows/ci.yml` 加入 codegen diff 闸门 + grep 硬约束扫描
- T6.17 Phase 0.6 集成测试 + 全量回归

**总计 71 个原子任务**。

# 11. PROGRESS 文件初始模板

首次启动时创建，内容如下（ISO 时间戳请用当前时间）：

```markdown
---
spec: 架构前置改造建议.md
spec_revision: 2
branch: <你创建的分支名>
mode: autonomous
started_at: <ISO>
last_updated: <ISO>
current_phase: 0.1
current_task: T1.1
status: in_progress
task_counts:
  total: 71
  completed: 0
  blocked: 0
  pending: 71
audit:
  rounds: 0
  last_status: not_started
---

# 重构进度（无人值守模式）

## 任务清单

（把本提示词 §10 的 71 个任务复制进来，每行前加 `- [ ]`）

## 当前任务

- task: T1.1
- started_at: <ISO>
- status: in_progress

## 已完成

（任务完成时追加：task / completed_at / commit / files_changed / tests_passed）

## Blocked

（任务三次失败时追加：task / reason / traceback / attempts）

## Phase 记录

（Phase 完成时追加一段）

## 最后心跳

<ISO>
```

**PROGRESS 更新节奏**：每个任务开始前更新 current_task；完成后立即更新已完成段 + last_updated + 心跳；整个文件每分钟至少写一次（可以是同内容刷新时间戳）。

# 12. REPORT 文件初始模板

首次启动时创建骨架。全程**增量追加**，不等到最后才写。

```markdown
# Synapse 架构重构完成报告

> 模式：无人值守
> 开始：<ISO>
> SPEC：架构前置改造建议.md r2
> 分支：<分支名>
> 起始 commit：<hash>

## 1. 执行摘要

（全部完成后填写；执行中预留）

- 状态：进行中 / 已完成 / 部分完成
- 总任务：71
- 已完成：<N>
- 跳过/Blocked：<N>
- 总 commit：<N>
- 自检轮数：<N>
- 遗留问题：<N>

## 2. 各 Phase 变更摘要

### Phase 0.1 ServiceRegistry
<每个 Phase 完成时追加：任务表、commit 范围、新增文件、关键设计、测试覆盖>

### Phase 0.2 DataRepository
...

### Phase 0.3 IPC Codegen + WindowManager + NetworkServiceRegistry
...

### Phase 0.4 EventBus
...

### Phase 0.5 ProjectContainer + ProcessRuntime
...

### Phase 0.6 工程规范与可观测性
...

## 3. 决策记录

### 3.1 Level 2 自主决策
（每次 Level 2 决策立即追加）

### 3.2 Level 3 保守决策（需用户复核）⚠
（每次 Level 3 决策立即追加 + 高亮）

## 4. 自检循环日志

（每轮追加：轮数、发现问题、修复 commit、本轮耗时）

## 5. 跳过/Blocked 任务

（每次任务 blocked 立即追加：任务、尝试次数、原因、traceback、相关文件）

## 6. 对 SPEC 的偏离与反馈

（发现 SPEC 描述与实际不符时立即追加；绝不修改 SPEC）

## 7. 环境问题

（依赖缺失、命令不存在、工具链不工作等环境问题）

## 8. 遗留问题清单（给用户）

（最终汇总所有未解决问题，按严重性排序）

## 9. 验证指南（给用户）

（最终给出：如何本地跑测试、如何回滚、如何继续 M1）

## 10. 附录

- 起止 commit: <start>..<end>
- 主要新增目录: ...
- 主要删除文件: ...
```

# 13. 网络中断 / 会话结束 的自我约束

如果你在执行中收到任何信号暗示对话即将结束（例如用户输入新内容、模型 token 即将耗尽、工具报错失联），**立即**：

1. 完成当前原子任务（或回滚）。
2. 更新 PROGRESS 的 current_task、status、last_updated。
3. 如果有未 commit 的改动：要么 commit、要么 `git checkout .` 回滚。
4. 把最新 REPORT 的时间戳刷新。
5. 停下。

**绝不**留下不一致的中间状态（代码改了但 PROGRESS 没更新、或 commit 了但 PROGRESS 没记录）。

# 14. 最后一步：终局报告

所有 Phase + 自检循环走完后：

1. 确保 PROGRESS 的 `status` 为 `completed` 或 `completed_with_issues`。
2. 在 REPORT 最后追加一段"给用户的一句话总结"：
   - 我完成了什么、跳过了什么、用户需要注意什么。
3. 跑 `git log --oneline <起始 commit>..HEAD | wc -l` 得到 commit 总数，写入 REPORT §1。
4. 跑 `git diff --stat <起始 commit>..HEAD | tail -1` 得到文件变更统计，写入 REPORT §10。
5. **不做 push**。
6. 输出最终一条消息到用户：简短摘要 + REPORT 文件路径。

（提示词正文结束）
````

---

## 给用户的使用说明

### 出门前

1. 打开 AI 编辑器（Claude Code / Windsurf / Cursor Agent 等支持文件读写 + 终端）
2. 确保工作区干净（或接受 AI 自动 stash）
3. 复制本文件上面代码块整段
4. 粘贴到 AI 对话框、回车
5. 关上电脑走人

### 回来后

查这两个文件即可看到结果：

- `待办/融合cc-connet/REFACTOR-PROGRESS.md` — 71 个任务的完成状态
- `待办/融合cc-connet/REFACTOR-COMPLETION-REPORT.md` — 完整执行报告（含决策、问题、偏离、建议）

推荐的审查顺序：

1. 读 REPORT §1 执行摘要：了解整体状态
2. 读 REPORT §3.2 Level 3 决策：你需要复核的关键点
3. 读 REPORT §5 跳过任务：了解哪些任务 blocked
4. 读 REPORT §6 SPEC 偏离：AI 觉得 SPEC 需要改的地方
5. 读 REPORT §8 遗留问题：剩余工作
6. 跑 `git log --oneline` 看完整 commit 链

### 如果中途断网

**不要用本文件重新启动**（会被拒绝因为 PROGRESS 已存在）。

改用 `REFACTOR-RESUME-PROMPT.md` 里的恢复提示词。

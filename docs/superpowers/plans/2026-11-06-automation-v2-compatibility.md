# Automation V2 Compatibility Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 在当前会话依次完成，用户已授权直接推进，无需再次审批。

**Goal:** 让 V2 在后续扩展中保留配置并按任务隔离不支持的格式与语义。
**Architecture:** 共享兼容 helper 区分格式修订和编辑计数；主进程统一验证，存储保留稳定外壳，Renderer 只读保护与既有诊断一致。
**Tech Stack:** TypeScript、Zod、Vitest、现有 DataRepository / IPC。
**Spec:** `docs/superpowers/specs/2026-11-06-automation-v2-compatibility-design.md`

## Global Constraints

- 留在当前 main，保留其他任务改动，只提交本次补丁；不 push、不部署、不启动应用、不新增依赖。
- V1 继续停用、只读、不迁移；V2 的 trigger/conditions/executor/policy 结构不变。
- formatRevision 缺省 1；新建显式写 1；configVersion 仍只计算编辑次数。
- 未知执行语义只读且禁止运行；纯元数据保留；MCP 不泄露未知配置。

## Review Focus

- null/0/负数/非整数修订不能误判为缺省。
- z.object 丢弃嵌套字段和 strict schema 报错都应识别为不兼容。
- 单个未来策略不得阻止其他任务加载或经手动/事件旁路运行。
- 未知执行器、未来格式在后台清理和备份恢复后仍保留。
- 可修复的已知配置错误仍能编辑，不能把所有 needs_update 都锁死。

### Task 1: 兼容契约与写入保护

**Files:** 新增 `desktop/automation-trigger-packages/compatibility.ts` 和独立测试；修改 automation types/item-repository/service 及 trigger-registry。
**Interfaces:** `AUTOMATION_FORMAT_REVISION`、`automationFormatIssue(item)`、`parseAutomationConfig(schema, config)`、`automationConfigIssue(schema, config)`、`automationPolicySchema`；主进程派生 readOnly。

- [x] 先写修订/未知字段/策略及 service 入口测试并确认失败。
- [x] 实现 helper，接入创建、更新、启用、运行和存储配置校验。
- [x] 运行 helper、repository、service 和触发器测试，确认新测试通过。

### Task 2: 持久化、恢复与清理

**Files:** `runtime/data-repo/schemas/placeholders.ts`、`automation-mail-triggers/transfer.ts`、退役执行器清理相关文件、对应专项测试。
**Interfaces:** 存储稳定外壳允许未来业务值；退役类型判断只使用明确清单；导入不支持版本时停用但保留。

- [x] 先写真实 DataRepository 读写/备份测试和清理测试并确认失败。
- [x] 放松存储语义枚举，保留单任务语义验证；保护未来格式，改为明确退役清单。
- [x] 运行存储/导入/清理专项测试。

### Task 3: IPC、Renderer 与交付

**Files:** `electron/modules/automation/ipc.ts`、相关 Renderer 编辑/详情/列表入口、公开摘要和系统 Skill、规则及发布说明。
**Interfaces:** 读取新增 formatRevision/readOnly；写入拒绝未知字段；Renderer 阻止不兼容任务编辑，仍可查看/删除。

- [x] 先写 IPC/Renderer 回归测试并确认失败。
- [x] 接入兼容读模型与界面操作约束，不改布局。
- [x] 更新规则、能力清单说明和系统 Skill；记录用户可感知兼容性改动。
- [x] 运行最小充分专项测试、typecheck、硬约束；独立审查本次补丁。
- [x] 核对暂存区，只提交本任务代码和文档；提交信息 `fix: 补齐自动化V2配置修订与兼容隔离机制`，不 push。

## 实施与验证结果

- 保留原 V2 分层；新增 formatRevision 与派生 readOnly，V1 仍停用、只读、不迁移。
- 兼容检查从现有 schema 推导条件与范围类型，不另维护一套类型清单；未知键检查覆盖嵌套、strict union，以及已知非法值同时存在的情况。
- 新增回归先失败后通过；最终自动化、Renderer、IPC、MCP、存储、备份与清理专项共 28 个文件、422 个测试通过。
- desktop typecheck、硬约束、IPC 生成一致性及本次 TypeScript 文件 ESLint 通过。最终 schema 推导表达式调整后另跑 tsconfig.test.json 检查。
- 独立只读审查发现并修复：非法值掩盖未知键、未来 scope 导致整组 IPC 失败、已知 scope 错误被误锁；对应回归均 RED→GREEN。
- 已知范围：未启动应用、未做真实窗口交互验收，未打包、未 push、未发版或部署。测试输出含 SQLite 实验性及 React act 提示，无断言失败。
- 修改和提交均在 /Users/liyang/Documents/code/github/Synapse 的 main；其他任务的变量契约改动由其独立提交，本任务补丁不包含该任务内容。

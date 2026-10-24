# Agent 使用的 MCP 实施计划

**目标：** 在设置的 MCP 分类中增加 Agent 上游 MCP 清单、刷新和仅 SY 生效的禁用策略。

**设计：** `docs/superpowers/specs/2026-10-24-agent-mcp-settings-design.md`。

## 约束

- 当前分支开发；不修改 Claude Code 配置，不启动应用或真实 MCP。
- 配置清单只读解析，不能把配置存在报成连接成功；失败明确显示。
- 禁用在 SDK 查询启动前生效，同时覆盖 discovery、正式查询和恢复；策略变化在下一轮重建 live session，沿用 SDK session。
- 不改变规则、Skill、Provider、权限与 SDK 原生上下文生命周期。

## 实施

- [x] 配置清单与 SY 禁用偏好：先测试用户/项目/本地/插件来源、重复名称、错误、刷新和配置文件不变，再实现服务与 IPC。
- [x] SDK 策略：先测试新查询和既有会话策略变化，再接入原生 deniedMcpServers，覆盖官方和第三方路径。
- [x] 设置界面：复用组件，测试刷新、范围、禁用和失败，不显示凭据。
- [x] 同步设计、规则、能力例外和待发布说明；运行专项测试、类型检查与硬约束，检查 diff 后只提交本次改动。

## 验证记录

- 专项 11 个测试文件共 301 项通过，另行验证 bootstrap 新描述符 1 项通过；包括显式 opt-in 的隔离 SDK 假 MCP 启停验证。
- 硬约束、IPC codegen 一致性和暂存 diff 空白检查通过。
- 基于本次暂存内容与 HEAD 的隔离类型检查：Renderer、主进程、preload 和本次 10 个测试文件均无错误。全工作区类型检查受其他任务未提交的 controlled-runner 和 private-storage-policy 测试类型错误阻塞，未宣称全量通过。
- 未启动桌面应用或执行视觉验收；本次只提交 Agent MCP 功能及配套测试、设计、规则和发布说明。

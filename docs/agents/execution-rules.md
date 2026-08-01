# Agent 执行与设计文档发现规则

## 修改前发现相关设计文档

不要维护静态设计文档清单。修改带产品边界的模块前，在 `docs/` 中用以下信息搜索：

- 模块名、目录名和能力名，例如 `knowledge-base`、`agent-runtime`、`workflow`、`scheduler`、`editor scan`。
- 即将修改的路径片段，例如 `desktop/src/modules/workflow`、`desktop/electron/services/agent-runtime`。
- 重点目录：`docs/agent-guides/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`、模块专属目录和 `docs/adr/`。

优先阅读与当前改动直接相关的文档，不批量加载无关长文。文档中的 `Hard Rules`、`Non-Goals` 和明确的“禁止 / 不允许 / 必须 / 不支持 / 不新增”是强约束。没有搜到可信文档时继续遵守根规则和现有代码边界，不得编造路径。

UI 任务必须额外阅读 `.claude/rules/design.md`、`.claude/rules/ui-rules.md`、`desktop/components.json`、`desktop/src/styles/globals.css` 和当前模块实现。编辑器集成任务必须阅读 `docs/reference/editor-integration-matrix.md`。

## 编码前

- 不隐藏假设。存在多种合理理解时说明差异；关键选择会改变结果时询问用户。
- 先找现有实现、测试、helper 和契约，再决定修改点。
- 把任务转换为可验证目标；多步骤任务先给简短计划。
- 如果有更简单且满足需求的方案，优先采用。

## 简单与外科手术式修改

- 用解决问题的最少代码，不添加超出需求的功能、抽象、配置或不可能场景的错误处理。
- 不“顺手优化”相邻代码、注释和格式，不重构没有坏掉的东西。
- 匹配现有风格。无关死代码只指出，不删除。
- 清理由本次修改造成的未使用 import、变量和函数。
- 每一行 diff 都应能直接追溯到用户请求。

## 目标驱动验证

- Bug 修复优先建立可复现证据或回归测试，再验证修复。
- 按风险运行最小充分测试、typecheck、lint、构建或专项检查。
- 不用“启动应用看看”替代可重复的源码/测试验证；除非用户明确要求，不启动应用或浏览器。
- 失败时先定位根因，不通过放宽断言、吞错或删除测试获得绿色结果。

## 完成标准

- 检查是否已有文件解决任务的一部分。
- diff 聚焦，命名明确，类型、校验和错误处理同步。
- 行为变化同步更新测试、文档、能力清单、MCP/Skill 指南和 `RELEASE_NOTES_PENDING.md`。
- 确认另一位工程师无需反向推理隐藏抽象即可继续维护。

# 以显式工作流编排授权剪贴板访问

状态：已实施。

剪贴板读取可能暴露当前系统内容，剪贴板写入会改变系统状态，但逐次 PermissionGuard 检查或确认弹窗会破坏 Workflow 的自动执行语义。V1 将用户显式编排并运行或启用剪贴板节点视为读写授权，不增加 Clipboard 专用运行时确认；UI、Automation 与现有 Workflow MCP 使用相同节点语义并沿用各自 Workflow 入口的授权和审计，不增加来源特判，内置 Workflow Skill 则限制 Agent 只能在用户当前明确要求时加入或触发这些节点。主进程仍执行输入校验、无正文审计与脱敏日志。外来 Workflow 必须通过分享和导入契约分别揭示 `clipboard.read` 与 `clipboard.write` 高风险，写入配置正文还须标记为 sensitive，但沿用现有分享语义只提示而不自动脱敏。

Clipboard 审计的 `source` 固定为 `workflow`；UI、Workflow MCP、Automation 与 `workflow_call` 的入口差异由外层 Workflow 审计负责。V1 只增加供审计类型使用的 `clipboard.read` 与 `clipboard.write` PermissionAction，不把它们接入 PermissionGuard。可信 Workflow 身份缺失时在 core service 接受点前失败，不以未知身份继续访问。

该选择保留自动化和嵌套 Workflow 的确定性，同时把外来流程风险前置到可审阅的分享/导入边界。它不把“显式编排”扩张为 Agent 可任意读取剪贴板：内置 Workflow Skill 必须要求当前用户明确提出创建或运行剪贴板流程。

# 自动化只保留 Agent

用户确认：移除命令、Shell 脚本、HTTP、工作流、JavaScript、Node.js 自动化执行器，自动清理已有非 Agent 配置，只保留 `builtin.agent`。不转换或修改 Agent 配置，不删除工作流定义。

采用主进程与 Renderer 同时注销执行器，JS/Node 能力包仅保留 Workflow surface；不采用只隐藏入口的方案。工作流 HTTP/Shell 共用表单、schema、运行工具及 JS/Node runtime 继续保留。Git 安全初始化不变。

历史配置在主窗口建立后后台清理：独立 Worker 仅处理 ID/执行器类型快照，分批返回非 Agent ID；主进程通过原 DataRepository 和仓库写队列复验类型后删除配置。Agent（包括无效的 Agent 配置）原样保留。失败记录结构化诊断，后续启动及恢复/写入时重试；不设置会阻止备份恢复后清理的永久完成标记。运行历史不属于本次配置清理范围。

保留现有通用自动化 API，但发现仅返回 Agent，创建/更新旧执行器被 schema/注册表拒绝。恢复期间旧配置不可执行。同步能力清单、系统 Skill、产品边界和发布说明；测试覆盖发现、清理、失败重试、并发转为 Agent、恢复后清理与工作流节点不变。

# Agent 对话图片分享与交付实施记录

**Goal:** 让当前桌面 Agent 选择真实历史、生成可持久预览的 PNG，并复制、保存或作为两类邮件附件发送。
**Spec:** 当前对话中用户批准的《Agent 对话图片分享与交付方案》。
**Architecture:** 当前回合引用固定历史边界；Agent capability 管理快照、渲染任务与 ManagedAssetStore；稳定 Renderer host 复用分享纸张；邮件通过图片引用导入独立附件副本。

## Global Constraints

- 当前目录、当前分支，不新增依赖、不启动应用、不推送。保留任务开始时 RELEASE_NOTES_PENDING.md、synapse-tool-router.ts、naming.ts 的既有改动。
- 单图，720px / 2× 默认，隐藏邮箱、显示模型和时间；超预算明确失败，不截断、不自动分图。
- 不导出思考、工具内容、非图片附件；Generated UI 只读；MCP 公开面仍仅 search/invoke。
- 工具、IPC 和主进程共用验证、权限与审计；上下文引用不是授权。

## Tasks

- [x] 1. 当前回合上下文、稳定消息选择和三个 capability schema，测试截止边界及引用。
- [x] 2. 渲染任务、受控图片存储、原生输出，测试来源窗口、取消、失败及重试。
- [x] 3. 共用分享纸张、稳定渲染 host、会话结果预览，测试切页与只读状态。
- [x] 4. 两类邮件 shareImageRef 导入、生命周期清理及规则/Skill/发布说明。
- [x] 5. 专项测试、类型/架构/IPC 检查、独立只读审查；仅本任务改动纳入本地提交。

## Review Focus

- “上面”不包含当前指令；消息引用不能漂移到新内容。
- 多窗口结果不能串会话，停止后不能继续交付。
- 图片持久化后仍可预览，删除会话清理且不破坏已导入的邮件副本。
- 生成成功与输出/发送成功分别报告，未知发送不重发。
- 原生 HTTP MCP 与进程内 router 使用相同上下文与能力，不增加自动允许规则。

## Execution

- Pre-flight: messages/generate 共用冻结快照；generate/output/mail 共用 shareImageRef；Renderer 仅负责只读 PNG 渲染，主进程负责所有输出及生命周期。
- Ruling: 遵守用户明确的当前分支要求，不采用技能默认 worktree；已批准计划直接执行，不再次请求批准。

## 实施与审查记录

- 已完成三个分享能力、宿主回合引用、共享纸张及窗口根渲染、持久图片预览/复制/保存、站内信与邮箱引用导入和删除恢复。主进程与 Renderer 使用精确窗口/会话/nonce 校验，EventBus 按来源窗口保序，不合并生成任务。
- 独立只读审查：review_share_delivery 提出三项有效问题：原生输出等待期间取消丢失、启动恢复与正在生成的 staged 图片竞态、站内信读取后取消仍会上传。已用失败测试复现，再贯穿取消信号、排除活跃资产恢复并检查上传前取消，相关回归测试通过。
- 扩展 Runtime 测试暴露原有计时竞态：计时从异步输入/权限处理准备完成之前开始。仅稳定测试中的虚拟时间边界，保留 1ms 中继超时及 1h 权限超时的完整断言，不改变 Runtime 的生产超时逻辑。
- 验证包含真实临时文件 PNG 写入、存储重新打开、取消、同名保护、历史变更与权限拒绝、来源窗口、冻结 Generated UI、邮件独立副本和 20 MiB 限制。
- 桌面未启动；真实系统剪贴板粘贴、PNG 像素观感以及实际邮件/站内信投递仍需桌面验收，本任务不宣称这些人工项已通过。新增 preload 需客户端完整重启后生效。

- 最终联合验证：84 个测试文件、1016 项测试全部通过；desktop 完整 typecheck、check:hard-constraints、check:ipc-codegen 和 git diff --check 通过。

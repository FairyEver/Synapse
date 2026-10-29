# OpenUI 报告展示修复计划

用户已批准：扩展第三方报告触发，区分聊天内 OpenUI 与 HTML 网页，同步宿主提示；由 AI 判断展示方式，不固定数据与图表的映射。

**目标：** 修复第三方数据分析报告绕过展示规则、将网页限制误用于聊天 UI 的问题。

**方案：** 沿用系统 Skill、宿主短入口及随包完整参考，不新增工具、权限、依赖或运行时关键词路由。只在当前 main 工作区修改，不修改全局安装副本。

**依据：** `docs/superpowers/specs/2026-10-21-agent-openui-design.md`；本次对话中的用户修订优先于旧文档的图表类型建议。

## 执行

- [x] 更新现有提示与系统 Skill 契约测试，先确认旧实现不满足第三方来源、网页限制区分及自主展示要求。
- [x] 更新系统 Skill description、路由和 Presenting Data；展示不依赖 MCP 调用，不接管第三方数据查询。
- [x] 同步宿主完整/按需提示及静态参考；移除固定图表类型选择，保留完整参考读取、准确数据和用户格式要求。
- [x] 同步 OpenUI 设计、运行规则、能力清单例外与发布说明；能力及工具数量不变。
- [x] 使用只读固定夹具执行真实 SDK 报告验收，覆盖宿主独立生效、Skill 配合、纯文字、单值、无 OpenUI 宿主；不查询业务 API，不启动应用。
- [x] 运行专项测试、类型检查与硬约束；检查聚焦 diff 后本地中文提交，不 push。

## 验收与限制

- AI 自主决定展示哪些内容及采用何种组件；测试不指定图表类型、维度或固定布局。
- 网页限制不阻止聊天内 OpenUI；明确纯文字要求仍优先。
- 完整参考不可用时说明限制并降级；参考较长不构成不可用。
- 其他宿主没有声明支持时不输出 OpenUI，不额外请求发布/分享/外发授权。
- 原压缩包已经提供失败基线：只加载 Gitee Skill，没有读取参考，最终未生成 OpenUI。真实夹具验收不能替代真实业务全流程或证明所有模型始终遵从提示。

## 验证记录

- 基线源码提交：`a62243b17`；本任务在原 main 工作区完成，未切分支或新建 worktree。
- 契约回归先红后绿：修改前 3 项失败；修改后最终 202 项 Agent/Skill/组件回归通过。desktop typecheck、硬约束、相关 TypeScript ESLint、手动测试脚本语法及 diff 空白检查通过。
- 真实模型请求使用 Claude Agent SDK `query()`，指定原对话型号 `deepseek-flash[1M]`，隔离业务工具并提供匿名固定聚合夹具；无 Gitee 查询、无文件生成业务动作、无应用启动。
- 旧提示独立采样 5 次：2 次成功渲染、2 次只输出文字、1 次生成内容被实际校验器拒绝。第一版候选的 3 个已完成样本也只输出文字，因此撤回该轮，补充“默认文字不等于明确仅纯文字”及不能仅因 Markdown 可表达就跳过有帮助的 UI 的规则。
- 最终候选共 13 项真实 SDK 验收全部通过：仅宿主 5/5、宿主加新版 Skill 5/5 均读取参考并经过组件校验及 JSDOM 官方 Renderer 渲染；明确纯文字、只要数量、无 OpenUI 宿主各 1 项均没有生成 OpenUI 或调用工具。未指定图表类型、展示维度或固定布局，不添加自动修复轮次。
- 原始输出与调用记录保存在仓库内忽略目录 `work/openui-report-audit/`，第一版失败候选保留在其 `first-candidate/` 子目录；这些是本地夹具证据，暂无在线链接。真实采样不证明其他模型或所有后续请求必然遵从提示，也不等同于真实 Gitee 全流程验收。
- 通用 Skill `quick_validate.py` 仍被既有 description 中的尖括号占位符拦截；基线 description 原有 2486 字，也超过该通用脚本的 1024 字上限。本次保留既有业务触发词，只增加报告触发，不扩大范围重写整个描述。
- 不改变工具/schema/能力数量、用户全局配置或已安装 Skill 副本；未发版、未部署，不强制改写旧 SDK 会话提示快照。回滚本次提交即可恢复旧指引。

## 复验入口

`pnpm --filter @synapse/desktop exec vitest run --config tests/manual/agent-openui-sdk.config.mts tests/manual/agent-openui-report.test.mjs`

默认每个场景一轮；设置 `SYNAPSE_OPENUI_REPORT_REPS=5` 可重复两类报告采样。该手动测试使用本机已有 SDK provider 配置，不读取或输出凭据到证据文件。baseline 模式需要预先捕获旧提示和 Skill 到 `work/openui-report-audit/baseline.json`，完整旧参考保存在同目录的 `baseline-reference.md`；不把当前提示当作旧基线。

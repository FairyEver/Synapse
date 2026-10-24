# OpenUI 按需参考：改前与改后验收

用户于 2026-10-24 授权改动和真实模型模拟。当前分支内实现；未修改用户全局配置、删除暂存目录、安装依赖或发布应用。仅实现短入口与暂存 Skill 隔离，没有精简其它 Skill、规则或内置工具。

## 方法与证据

使用已有真实 Claude Agent SDK/DeepSeek 配置、正式 OpenUI parser/React 组件和 GeneratedUiService。只读夹具 `get_report(days)` 返回周一/周二/周三及 `[10,14,12] * days`；不读取业务数据，不发送外部消息。用 JSDOM 真实填写表单并点击提交，用户动作经正式服务回到同一个 SDK query，未 mock 模型回复或组件输出。图形渲染用真实官方组件，canvas 测量和 ResizeObserver 为测试环境适配，不能等同真人视觉美观评审。

基线使用原有完整参考，候选使用短说明及完全相同的完整参考文件；用户原文、模型配置、夹具工具、权限和组件实现相同。未用自动修复轮次掩盖首次失败。用户原始 hi 导出无 HTTP 正文；下列 token 对照来自本轮实际 SDK result usage，不把它伪称线级 HTTP 捕获。

本机完整结果在仓库忽略目录 `work/agent-context-audit/`：

- `comparison/*.json`：每次场景的用户原文、真实模型输出、工具参数、参考读取、usage 和交互断言；失败也保留。`comparison/index.json` 为索引。
- `production-baseline-hi.json`、`production-candidate-hi.json`、`production-hi-comparison.json`：完整生产 Session 包装的独立 hi 对照，含完整工具名、连接状态、回复和 usage。
- `final-candidate.log`、`production-baseline.log`、`production-candidate.log`：真实模拟和离线重放结果。
- `unit-tests.log`、`final-ui-tests.log`、`packaged-check-final.log`：专项与包验证。

不记录 Provider 认证头或密钥。模型输出仅为本次夹具内容；没有导出用户全局规则正文。

## 固定场景与结果

| 用户场景 | 完整参考基线 | 按需参考候选 |
| --- | --- | --- |
| 读取7天趋势，聊天内交互折线图与天数输入，提交30天更新 | 生成 OpenUI；有效样本已验证两轮图形 | 读取完整参考；两轮图形、30天数据与表单可渲染 |
| 读取7天报告，交互表格与汇总，提交30天更新 | 生成 OpenUI；有效样本已验证两轮表格 | 读取完整参考；两轮表格、30天数据与表单可渲染 |
| 报告查询表单加折线图，提交后重查 | 生成 OpenUI；有效样本已验证同会话提交 | 读取完整参考；提交、更新渲染与重挂载通过 |
| hi | 普通文本，无工具调用 | 普通文本，不读取参考，无工具调用 |
| React Counter 代码示例，只给代码 | 普通代码，无 OpenUI | 普通代码，不读取参考，无 OpenUI |

三种交互用户原文没有给 OpenUI 名称、组件签名或程序模板，避免用测试提示替模型完成加载选择。完整参考来自原生成器，随包文件与生成器逐字一致校验通过。

先运行既有完整提示真实 smoke：两轮、两次查询、同会话表单提交、状态恢复通过。新脚本先有三次预备运行，暴露 mock 计数未清空和过严的工具调用次数断言，保留记录但不算产品成功率。随后完整提示跑两批固定五场景；按需提示跑四批固定五场景。

- 两批正式基线的6个交互场景都输出了 OpenUI；其中一次表单参数不合法，一次查询了额外的2天数据，原始结果保留，不能宣称基线完全可靠。
- 四批候选的12个交互场景均实际调用 Read 读取完整参考，并输出 OpenUI，没有观察到“短入口导致 OpenUI 不参与”。已有参考的续聊复用上下文，未重复读取同一文件。
- 候选前三批有一次测试仅按按钮文案精确等于“更新”匹配，但实际生成的是合法“更新报告”；该次停在提交前，不能计成完整交互成功。修正为匹配更新按钮前缀后，最后一批五场景全部通过。
- 最后一批真实验证了三种场景的第一轮与第二轮渲染、实际输入30并点击提交、按30重新查询、同一 SDK session、最新界面重挂载后仍为30。
- 复核发现原 smoke 模式只解析第二轮源码、没有真正挂载第二轮。已修正比较脚本，并离线重放15组完整双轮真实输出：逐轮挂载、检查图形/表格、7→30表单值、第二轮包含300与420实际夹具数据，再挂载最新输出，全部通过。离线重放不额外调用模型。

这里是有限样本验证，不是统计上的“完全等效”证明。模型仍可能偶发生成无效语法；保留既有错误显示，不新增自动修复 query。

## 实际 token 对照

完整生产 ClaudeSDKSession 包装的两次新 hi 使用相同默认权限、真实私有存储保护、同一 cwd/user/project/local 设置、相同27个内置工具和2个SY路由工具，均无外部 MCP、无工具调用，回复完全一致：

| 项目 | 完整参考、未过滤暂存入口 | 短入口、过滤暂存入口 |
| --- | --- | --- |
| 实际输入 token | 41,984 | 32,850 |
| 缓存读/写 token | 0 / 0 | 0 / 0 |
| 输出 token | 11 | 11 |
| 工具数 | 29 | 29 |

本轮减少9,134输入 token，约21.8%。不是用减少内置工具、去掉规则或缓存命中得到的结果。该包装对照不包含 UI 中所有已配置 Persona 的目录，所以不把用户原 hi 的42,055直接当作严格单变量基线。

只开放 Read 与夹具工具的固定少工具对照中，hi 为12,527→3,316（最后一批），代码示例为12,544→3,333。它用于隔离提示变化，不能冒称生产对话也只需三千 token。

需要 OpenUI 的任务会新增一次参考读取和模型往返，读取后上下文仍包含完整参考，不能承诺这类任务更快或始终更省总 token。暂存别名隐藏后其它 Skill 可能递补进入 SDK 目录预算，不能把离线估算的748再叠加为固定节省。

## 安全、回退与包验证

- 原生 SDK 隔离测试先发现三份同 frontmatter name 的 Synapse Skill，再应用目录别名 overrides 后只剩正式一份；普通 Skill 保留，源文件逐字不变。仅设置会话 `settings.skillOverrides`，不改全局文件。
- 资源不存在/不可读、Persona 无 Read、显式排除 Read 或 dontAsk 模式使用完整提示。只对 Renderer 新建会话采用短入口，不改旧 SDK system prompt snapshot。
- 精确宿主参考文件可自动读；其它文件读取与写入参考仍进入原权限流程，Persona 拒绝仍有效。私有存储、toolPolicy、子 Agent 检查在自动允许前执行。
- 7个主进程专项文件185项通过（含显式 opt-in 原生 SDK）；另109项包含 parser、真实官方 View 和相邻 Session 测试通过。主进程及测试 TypeScript、硬约束和 IPC codegen 通过。
- 完整 desktop build 成功；本地生成 ad-hoc 签名候选包，没有安装、发布或公证。`verify-packaged-asar` 对最终候选包通过，检查完整参考资源存在，JSON Repair、文档提取、HTML Worker、PTY 和 Electron runtime smoke 通过。
- 全局 Claude MCP 定义规范摘要与 settings 字节摘要与任务前一致。临时转发器未用于本轮，不留代理地址。

回滚：回退本轮短入口/静态参考资源和暂存 overrides 的同一提交即可，保留的完整提示实现仍可直接使用；用户配置无需回滚。自动模拟脚本仅在显式运行手工配置时调用真实模型，不进入默认测试。

## 重跑

真实对照（会使用现有 SDK 凭据并产生模型用量）：

```sh
SYNAPSE_OPENUI_COMPARISON_MODE=baseline pnpm --filter @synapse/desktop exec vitest run --config tests/manual/agent-openui-comparison.config.mts
SYNAPSE_OPENUI_COMPARISON_MODE=candidate pnpm --filter @synapse/desktop exec vitest run --config tests/manual/agent-openui-comparison.config.mts
```

只重放本机已记录输出（不调用模型）：

```sh
SYNAPSE_OPENUI_REPLAY_ONLY=1 pnpm --filter @synapse/desktop exec vitest run --config tests/manual/agent-openui-comparison.config.mts
```

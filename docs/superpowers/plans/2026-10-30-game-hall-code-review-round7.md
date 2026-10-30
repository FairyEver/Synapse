# 游戏大厅第七轮审核与修复

日期 2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `6eb9bf9ec`。完整功能审核基准仍为 `20fcd49c9...HEAD`。本轮核对前六轮未覆盖的草稿选择时序、长开页面、资金与补助、关闭及重连、归档读取与行动边界；依据三份定稿文件和用户已确认的口径。

## Standards 与可用性

- **P2：保存选手期间切走再切回会回填旧配置。** 原 draftGeneration 防止迟到保存覆盖其他草稿，但保存 A 期间切到 B 再切回 A，选择取的是旧列表的 A；保存结果因 generation 变化被忽略，刷新列表也不更新表单。用户没有继续编辑却再次保存时，会把刚存好的配置回退。还有一个等价时序：保存响应已回、列表刷新尚在途时切回旧 A。
  - 现记录选中草稿的基准对象，在成功保存或成功列表刷新后，只同步仍未编辑的同一选手；输入会产生独立草稿对象，继续保留。加载或错误时不使用保留的旧列表回填。组件内按选手 ID 暂存已确认的成功保存快照供重新选择，防止保存成功但列表刷新失败时回退；对应选手成功读取后清理，不能让本地快照长期遮盖较新的服务端配置。没有增加持久化缓存，不改变原创建标识、版本、所有权或服务端更新语义。
  - 新增 5 项 StrictMode 交互回归：两种正常时序 × 干净/继续编辑共 4 项，以及刷新失败、恢复读取和清理快照的完整流程。正常时序中两项干净表单先复现失败（14:11:07 执行工具记录，未另存 RED 日志）；异常刷新和不清理缓存两项也分别复现失败，日志 `/tmp/game-review7-profiles-refresh-failure-red.log`、`/tmp/game-review7-profiles-cache-clear-red.log`。继续输入、旧的切到 B、新草稿、响应丢失创建恢复与迟到保存保护继续验证。模型名称变化无需生成新提示词版本，恢复读取用同版本模型更名验证，不假设版本号变化才能清理本地快照。

- **P2：保留新输入时把版本元数据也停留在旧值。** 独立复核补充发现：A(v1)保存 v2 → B → A → 新输入 → v2 响应，原脏草稿整体保留，versionSeq 仍为 1，PersonaVersions 不重新挂载，已加载的旧版本历史不会刷新。现同选手合并成功结果/成功读取的元数据，只保留 model/persona 新输入；其他选手和新草稿不受影响。在上述 StrictMode 回归中增加实际版本历史界面断言，先复现 1 红 11 绿，再修复；日志 `/tmp/game-review7-version-metadata-red.log`。没有检查内部 state 代替界面行为。

该轴 2 项确定可用性缺陷，均为 P2，没有额外架构重构。另做短高窗口 CSS 尺寸核对，存在待实际渲染确认的裁剪疑点；没有像素证据，未将其计为已确认缺陷或已修复项，也未启动应用/浏览器。

## Spec

本轮未发现新增确定 Spec 缺陷。账户补助和跨房资金操作仍使用账户行锁；补助只在零余额且无进行中会话、距上次满 24 小时时允许，净盈亏口径不变。关闭与超时后邀请不增加重连/入座权限，已有历史仍按参与者权限读取。原模型明确使用 Int，未借极端容量假设引入 BigInt 或新封顶规则。

额外只读运行现有纯引擎：seed `314159`，3,000 手、22,526 次转换，其中 4,590 次在当前行动位调用 removeFromHand 模拟超时退出；全部终止，筹码逐手守恒且始终是非负安全整数。脚本 `/tmp/game-review7-engine-audit.cjs`，命令 `node /tmp/game-review7-engine-audit.cjs > /tmp/game-review7-engine-audit.log 2>&1`，复跑退出码 0。脚本以内存转译读取现有引擎，不改仓库或数据库，不等同于真实 AI 客户端验收。

## 验证与交付

- 档案与同桌筛选初版专项 2 文件、14 项通过，日志 `/tmp/game-review7-profiles-cache-green.log`；补齐版本元数据断言后，最终游戏桌面专项 `pnpm --filter @synapse/desktop run test src/modules/game-hall app-capabilities/game-hall --maxWorkers=2`，19 文件、78 项通过，日志 `/tmp/game-review7-game-desktop-final.log`。
- 版本元数据复核前的静态检查通过，日志 `/tmp/game-review7-desktop-types-final.log`、`/tmp/game-review7-hard-final.log`、`/tmp/game-review7-renderer-build-final.log`。首次全量在补充该缺陷时主动中止（exit 130，`/tmp/game-review7-desktop-full.log`），不将其当作全绿；完成元数据修复后再次运行最终检查和全量测试。
- 最终 `pnpm --filter @synapse/desktop run typecheck`、`check:hard-constraints`、`build:renderer` 全部通过；日志 `/tmp/game-review7-desktop-types-complete.log`、`/tmp/game-review7-hard-complete.log`、`/tmp/game-review7-renderer-build-complete.log`。`git diff --check` 通过。
- 最终全量桌面回归 `pnpm --filter @synapse/desktop run test --maxWorkers=2`：1,138 文件、11,595 项通过，2 项既有 native 测试跳过，日志 `/tmp/game-review7-desktop-full-final.log`。本轮新增 5 项回归，另在这些场景中补齐版本历史界面断言；没有放宽旧测试、跳过失败或调整超时。

- 本轮只改桌面选手档案的状态同步及配套测试、发布说明与规则。MCP/IPC 数量、描述、schema、系统 Skill 与 Agent 协议核对后无需改变：仍是 20 个 MCP 索引、18 个 IPC，没有新增用户能力或权限。
- 无新增迁移、业务数据库操作、依赖、部署、发布或 push；未连接游戏测试库，未启动开发服务器、应用或浏览器。本轮未重复真实双 AI 50 手、120 秒进程重连或实机验收。
- 服务端源码与数据库结构均未修改，本轮不重跑服务端全量数据库测试；上一轮在相同服务端实现上 188 文件、2,223 项通过，证据见第六轮记录，不将旧结果写成本轮重跑。
- 仅在 main 本地提交。回滚仅撤销本次桌面状态同步和配套文档，不删除用户选手、版本、账户或归档。
- 本文档和测试日志仅位于本地，尚无在线分享链接。

# Roll 玩法实现与验证记录

后续用户已授权并完成本机专用数据库与真实浏览器验收，见 [2026-11-02 真实验收记录](2026-11-02-poker-roll-live-acceptance.md)。本文“未执行”描述保留为开发阶段的历史状态；生产库仍未迁移，未部署或 push。

工作仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，2026-11-01。按用户批准的 [实施计划](../plans/2026-11-01-poker-roll-implementation.md) 原地开发，不新建分支或 worktree，不新增依赖。本记录区分已验证逻辑与未执行的真实环境验收。

## 实现范围与版本

- `cf83fb913`：纯引擎换牌、整数收费、冻结补偿、原始资本与牌量检查，以及只读本人可见信息的有限机器人策略。
- `4a31bc074`：共享 start/choose 契约、通用待结算资金、原入座标识和兼容迁移；`e0f731e75` 补严归档的完整 JSONB 行相等保护。
- `4d2ef6c7e`：牌局事务、REST/MCP、持久恢复、超时与机器人调度、原入座补偿、公开／本人投影和冷热历史。
- `253c85916`：Web 建房与选牌面板、未知写结果恢复、费用／补偿展示，权威 Skill 与生成 API 参考；独立审查见下文。
- `039017309`：将 Roll／恢复入口合入既有底栏，补充同标签页硬刷新后的原 UUID 恢复与同作用域状态同步。
- `b3290cb5d`：修复旧房／默认关闭房间的数据库空版本兼容，牌桌显示本人当前手冻结补偿，完善机器人失效测试、视角恢复和关键审计对象可读性。

建房选项为 `ruleOptions.roll`，首次默认关闭，服务端固定 `roll-v1`。两种牌组／资金模式共用首版费率；原离线研究及未通过的严格精度结果保留，不改写为已证明博弈平衡。

## 已执行验证

|范围|执行方式|实际结果|
|---|---|---|
|引擎／机器人专项|server engine 与 bot-roll-policy 测试|5 文件、61 项通过|
|共享 Roll 协议|shared game-roll.test.ts|4 项通过|
|资金／归档修复专项|Hall、transfer、迁移静态检查及受控 PG 用例发现|18 项通过，4 项 PostgreSQL 用例跳过|
|服务端完整单元套件|在 server 用既有 Vitest Node 入口，清除 `GAME_E2E_DATABASE_URL`，`run --maxWorkers=2`|最终交付 202 文件通过、26 跳过；2,361 项通过、143 跳过；覆盖最终空值修复及已独立提交的头像功能|
|共享全套|`pnpm --filter @synapse/shared test`|290 项通过，1 项既有通知源夹具失败，见下文|
|shared／server 类型|相应包 typecheck|通过|
|旧 Web 运输层兼容|`pnpm --filter @synapse/dashboard run tsc`|通过；只补两个 Roll 转发方法，没有扩展旧版界面|
|桌面已有相关契约|game shared/main、命名检查|10 文件、95 项通过|
|Web 完整单元套件|在 dashboard-v2 用既有 Vitest Node 入口 `run`|最终交付 148 文件、1,222 项通过；覆盖补偿展示、视角恢复及已独立提交的头像测试|
|Web 类型与 UI 边界|dashboard-v2 `tsc`、`check:ui`|通过|
|桌面最终相关契约|game-hall 与 synapse-skill service/ipc 的 Vitest|12 文件、116 项通过；含 29 项工具 schema 与生成参考逐项相等、Skill 请求例严格校验|
|桌面完整类型|`pnpm --filter @synapse/desktop run typecheck`|最终修改后通过，包括 renderer／Electron／preload／test|
|桌面硬约束|`pnpm --filter @synapse/desktop run check:hard-constraints`|通过|
|Skill 结构|system skill-creator `quick_validate.py`|game-hall 根 Skill 和 poker 子 Skill 均通过|

记录来源为本计划本机日志目录 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-01-poker-roll-implementation/`，尚无在线链接。关键日志包括 `task-1-green-focused.log`、`task-2-green-contracts.log`、`task-2-review1-green.log`、`task-3-server-tests-final.log`、`task-3-typecheck-final.log`、`task-5-desktop-typecheck-preflight.log` 和 `task-5-hard-constraints-preflight.log`。最终集成再次运行的 `task-5-server-tests.log`（同为 2,343 通过／143 跳过）、`task-5-server-typecheck.log`、`task-5-shared-tests.log`、`task-5-shared-typecheck.log` 与 `task-5-dashboard-legacy-typecheck.log` 已核对完整结束状态。

完整服务端测试保留既有故障模拟 WARN 和 SQLite ExperimentalWarning，不能称为无噪声运行。两次未修改代码的默认并发复验分别出现 HTTP `write EPIPE` 和 1000 文件上传的既有 15 秒超时；隔离 HTTP 文件 8 项通过，最终降低并发的完整套件通过，未放宽断言、改测试超时或修改相关业务。

共享全套的既有失败为 `src/package-entrypoint.test.ts > loads the ESM root without Node CommonJS interoperability`：通知源实际已有 `game-poker`，旧字面列表未包含它。已只读核对开发前基线 `37dac5d90` 同样存在该不一致；本任务不修改无关通知源，不能宣称 shared 全套通过。

Web／Skill 最终证据包括 `task-4-v2-tests-verified.log`、`task-4-tsc-verified.log`、`task-4-ui-check-verified.log`、`task-4-desktop-tests.log`、`task-4-desktop-typecheck.log`、`task-4-hard-constraints.log` 和 `task-4-skill-validation.log`；相应长会话均已取得退出码 0。具体行为与 RED/GREEN 记录见同目录 `task-4-report.md`。

修复后再核对 `task-4-review1-green.log`（4 文件／78 项）、`task-4-review1-game-center-tests.log`（41 文件／274 项）、`task-4-review1-tsc-final.log` 和 `task-4-review1-ui-final.log`，退出码均为 0。最后完整集成 `task-5-v2-final.log` 为 1,212 通过，`task-5-server-integrated-final.log` 为 2,352 通过／143 跳过，`task-5-server-typecheck-integrated-final.log` 退出码 0；对应 root 会话 80720／14018／45725 均已回收最终结果。

最终 `039017309` 树再次用本地 TypeScript Node 入口完成 desktop 四个 tsconfig（renderer／electron／preload／test）及 V2 的 `--noEmit`，并运行硬约束脚本，全部退出码 0。日志为 `task-5-desktop-{renderer,electron,preload,tests}-final.log`、`task-5-v2-typecheck-final.log`、`task-5-hard-constraints-final.log`；空的编译日志表示没有诊断，退出码取自已结束会话 62637／4675／36565／96387／55531，不能仅凭空文件推断通过。

未新增依赖。后期两次 pnpm 测试命令因并行任务修改依赖声明，自动进入安装校验前置，均返回 `Already up to date`、跳过解析，没有新增包；不能把这两次前置描述为“未运行任何安装命令”。后续验证使用已安装本地 Node 入口，未修改包管理配置或依赖文件。

## 审查与实现取舍

- 引擎、通用资金、服务端和 Web／Skill 均经独立任务审查。资金的 JSONB 完整副本判断，以及 Web 的底栏裁切、硬刷新原请求丢失均已修复并 scoped 复审通过，没有通过删除断言取得通过。最终跨层审查提出的两项 Important 和三项 Minor 已在同一修复提交处理，唯一一轮最终 scoped 复审确认全部解决，没有新增 Critical／Important／Minor。
- 并行云表和就近下注任务在同一 `main` 提交，审查按本任务的实际提交及路径清单隔离；不回退或混入其他任务改动。
- 机器人维持无大厅账户／会话边界。通用补偿释放传完整、可信入座身份；点数还需核对开放会话，练习机器人可无会话正常接收桌内筹码。
- 共享 GameBridge 新增两个方法会影响旧 Web 的编译，因此仅允许补齐旧版运输层转发，不扩展旧版界面。
- 同仓库随后出现并行头像功能改动，未混入 Roll 提交。所有验证记录对应各自执行时的树；不将其他任务后续修改视为已由本任务复验。
- 保留本机忽略的审计日志目录作为以上证据，不执行 Skill 默认的递归清理；未创建任何分支或 worktree。

最终跨层审查发现关闭房间 `NULL` 版本未规范化及本人当前手冻结补偿未显示；已集中修复。新增生产投影→共享 schema 测试使用真实数据库形状的空值替身，而非把未运行真实数据库作为豁免。补偿只取当前入座快照，不累加事件，分别验证无事件刷新、结算归零及新入座不继承。三个非阻塞任务意见也同轮处理：机器人失效测试通过独立移除条件证明能报错、审计对象展开、待选／未知写时的纯视角切换恢复。

该轮 `final-fix-server-focused.log` 为 8 文件／75 项通过、`final-fix-v2-focused.log` 为 8 文件／105 项通过，server／V2 类型和 UI 边界退出码 0；完整命令与 RED/GREEN 在本机 `final-fix-report.md`。最终 scoped 复审逐项确认 P1／P2／M1／M2／M3 全部解决；原有日志噪声和 shared 夹具问题是已披露的基线限制，未修改无关模块。

最终 `b3290cb5d` 树完整复跑为 `task-5-v2-delivery-final.log`（148 文件／1,222 项通过，会话 18867 退出 0）、`task-5-server-delivery-final.log`（202 文件通过／26 跳过，2,361 项通过／143 跳过，会话 48717 退出 0）。`task-5-server-delivery-typecheck.log` 与 `task-5-v2-delivery-typecheck.log` 对应会话 86166／7622 均退出 0。此前完整结果按对应历史提交保留，不替代最终波次。产品源码由已列提交保存，本记录与实施计划作为本地交付文档保存。

最终判定为：授权范围内的离线实现与本地交付完成；并非真实数据库、浏览器或生产环境验收通过。按账号／房间保存的未知写请求使用同标签页 sessionStorage，支持整页重载，不承诺无限保留已关闭标签页记录；不可用时禁止新 Roll 写入，普通玩法仍可继续。

## 尚未执行与上线前提

- 未连接或修改业务数据库。新增迁移为 `server/prisma/migrations/20261101090000_game_roll_frozen_transfers/migration.sql`，Prisma client 已生成；迁移本身尚未应用。
- 真实 PostgreSQL 新增 6 个守卫用例（归档精确副本 4 个、并发幂等／超时 2 个）均未执行。状态化持久化替身覆盖真实业务服务调用，但不能证明 SQL 触发器、锁与隔离级别的实际运行结果。获准后仅用既有本机 `_e2e` 专用数据库执行。
- 未启动应用、开发服务、浏览器或 Playwright；真实展开面板、宽窄屏布局和端到端真人／MCP 交接未做实际验收，单元测试不代替视觉验收。
- 未运行真实 AI 对局循环或额外模型测试。Skill 已验证结构、实际工具 schema、示例与代码状态机；不能将这些等同于 AI 实际采用和长期行为验证。
- 未部署、发版或 push。实际启用前先执行兼容迁移，再更新 API／本机能力与 Skill，最后更新 Web；旧房间仍关闭 Roll。
- 一旦产生候选或补偿资产，不得回滚到忽略这些状态的旧 API。停用先停止新建 Roll 房间并完成已有手牌与待结算资产，不删除账本、记录或永久幂等凭据。

游戏相关内容未写入待发布说明或发布文案。

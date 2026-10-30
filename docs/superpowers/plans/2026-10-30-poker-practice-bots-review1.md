# 陪练房第一轮审核与本地迁移

2026-10-30，仓库 `/Users/liyang/Documents/code/github/Synapse`，分支 `main`，起点 `9cd7636e9`，工作区起始干净。用户本轮明确授权完成数据库迁移并继续自动审核修复，本地提交、不 push。

## 数据库迁移（已执行）

- 通过既有 `scripts/dev/run-server-with-env.mjs` 加载当前开发配置，核实目标是本机 Docker `localhost:5433/synapse`、public schema；容器内实际地址为172.24.0.2:5432。没有连接或迁移线上数据库，也没有部署、启动或重启应用。
- 迁移前 `prisma migrate status` 列出两份待执行陪练迁移；同时看到原有两条仓库已不存在的历史记录`20260609010000_content_store`、`20260702000001_skill_repository_legacy_content_store_unique`。没有删除、伪造或改写这些旧记录。日志`/tmp/practice-review1-local-migration-before.log`。
- 执行 `node scripts/dev/run-server-with-env.mjs --filter @synapse/server exec prisma migrate deploy`，应用`20261030130000_game_poker_practice`和`20261030131000_game_poker_practice_summary`，退出0；日志`/tmp/practice-review1-local-migration-deploy.log`。
- 再执行同一命令返回“No pending migrations to apply”，随后status退出0、返回“Database schema is up to date!”；日志`/tmp/practice-review1-local-migration-repeat.log`、`/tmp/practice-review1-local-migration-after.log`。本地开发启动原已包含自动migrate deploy，本轮没有新增第二套迁移入口。
- 只读核对`_prisma_migrations`中的7份游戏迁移均完成、未回滚，无未完成项；information_schema核对funding/mode/botActionAt和GamePokerBot字段；pg_constraint核对三项资金/模式check。`GameAccount`迁移前后均1个账户、points合计1,000,000、netProfit合计0，按用户和点数/盈亏计算的指纹完全一致。证据`/tmp/practice-review1-local-db-before.json`、`/tmp/practice-review1-local-db-after.json`；只读核验脚本`/tmp/practice-review1-local-db-check.cjs`没有输出凭据、个人身份或牌况。
- 本轮只执行既有迁移，未修改已应用迁移或新增迁移。回滚本轮界面改动不需回滚数据库；已有陪练数据后仍不能退回不区分资金类型的旧API退款逻辑。

## Standards：0个确定问题

独立只读复核覆盖Hall零记账约束/不可变资金类型、锁内重读防重复退款、机器人无账号、容量及增删房锁、策略私密输入、来源校验、持久调度、多实例、热冷归档和白名单投影。没有发现新的点数泄漏或权限绕过；不将命名或抽象偏好当作缺陷。

## Spec与可用性：1类P2，已修复

添加机器人成功提交但响应丢失，客户端保留原creationId是正确的；随后轮询看到机器人，用户明确移除它（或请求手后移除），原组件却没有结束旧添加意图。下一次点击“添加机器人”仍发旧标识，服务端永久记录正确地返回已删除机器人的原结果，不会创建新座位，造成点击无效果。2座空陪练房达到保留真人容量后最容易复现。

修复仅在当前账号/房间的移除请求成功确认后清理该添加意图，移除失败保留原标识。移除回调绑定发起时意图对象，房间或账号变化后忽略旧结果，不能清当前意图或刷新新房间。未确认添加显示“重试添加机器人”，使恢复原请求与明确新建有区分。服务端永久创建记录和禁止复活逻辑未修改。

新增4项回归：立即/手后移除再添加使用新标识（2项）、移除失败保留原标识、旧房间迟到移除不刷新新房间且后续重试仍复用。首次3失败/4通过（含原3项），日志`/tmp/practice-review1-ui-red.log`；修复后7/7通过，`/tmp/practice-review1-ui-green.log`。未修改原有测试断言。同步发布说明及模块恢复约束；22游戏MCP索引、20游戏IPC、权限和schema无变化，MCP/Skill原创建幂等规则仍适用。

## 验证与交付

- 应用迁移的实际开发库不用于自动化对局测试。另建仅本机`127.0.0.1:55439/synapse_practice_review1_e2e`专用库，从空库重放仓库98份迁移，日志`/tmp/practice-review1-test-migrations.log`；测试使用该库，未写开发库游戏数据。
- server完整测试：`GAME_E2E_DATABASE_URL=postgresql://game_review@127.0.0.1:55439/synapse_practice_review1_e2e pnpm --filter @synapse/server test --maxWorkers=1`，197文件、2273项全部通过；`/tmp/practice-review1-server-full.log`。
- desktop完整测试：`pnpm --filter @synapse/desktop run test --maxWorkers=2`，1142文件、11651项通过，另2项既有native测试跳过；`/tmp/practice-review1-desktop-full.log`。完整typecheck及check:hard-constraints通过，`/tmp/practice-review1-desktop-types.log`、`/tmp/practice-review1-hard.log`。UI代码在最终完整测试启动后未再变化。
- `git diff --check`通过。没有新增依赖、能力、后台调度或模型托管，未启动应用、浏览器、真实AI长局或推送。没有push、发版或线上部署。
- 本轮形成的文档及日志仅本地，暂无在线分享链接。临时测试Postgres已停止且55439无监听；用户原有Docker开发库5433保持运行。仅5个本轮文件纳入本地提交，无服务端代码或迁移文件改动。

# 每手结算与全员准备实施计划

> 执行方式：使用 superpowers:executing-plans，在当前 main 内顺序实施，完成后进行一次独立审查，不创建 worktree。

**目标：**接入已认可的结算面板，每手结束由所有有资格座位显式确认后续局。
**架构：**在现有房锁和座位 status 上实现准备屏障；共享 schema / UI 路由贯通 Web、MCP。结算投影提供基于真实判牌器的最佳五张和比较说明，V2 用现有 Card 与 HeroUI 组合。
**技术栈：**现有 Nest/Prisma、React 19、HeroUI 3.2.7、Vitest，不新增依赖。
**规格：**`docs/superpowers/specs/2026-11-01-poker-settlement-ready-design.md`。

## 约束与重点

- 当前目录、当前 main；不部署、不执行迁移、不 push；游戏改动不进发布说明。
- 旧倒计时、重启、不同入口不得绕过屏障；重复和迟到准备不得授权其他手。
- 暗牌不泄露；判型必须使用本手标准/短牌 rules；边池获胜不等于净赢。
- 轮询不得重新打开用户已关闭的同手结算；身份/视角变更清理旧面板和操作。
- 长姓名、十人、390×667、金额与底池多项不裁切，正文必须能滚动到末尾。

## 任务

1. [x] 准备协议：先改 `server/src/game/poker/__tests__/settlement-delay.spec.ts` 并新增 ready 服务/协议测试，观察旧实现失败；在 poker-lifecycle、poker.service、wait、game-api/controller、shared game/game-ui/response schema 中实现手牌绑定的 ready 和全员 gate；更新集成夹具推进方式。
2. [x] 结算投影与 V2：先写最佳五张/比较及弹窗行为测试；扩展 poker-projection 与 settlement DTO；新增结算 model/helper、Modal、ready hook，接入 Table 与准备入口，保留关闭/重开及长内容滚动。
3. [x] 同步与交付：更新两端 bridge、注册数量断言/能力表、Skill 和生成参考；运行相关单测/类型/边界检查，按授权执行视觉验收；独立审查并修复，检查聚焦 diff 后本地中文提交。

## 执行记录

- 起点：干净 main；已认可原型位于 `docs/prototypes/2026-11-01-poker-settlement/`。
- 决定：首局保持现状，规则从每手结束后开始；status=ready 避免引入数据库迁移。

- 独立只读审查发现并修复：同手暂离/回座后本机已准备状态过期，已去除本机乐观确认；归档清空 currentHandId 后可能绕过屏障，改按房间手号判断首局并以冷热当前快照恢复结算与准备。两项均先看到回归失败再修复通过，复核无新增 Important。
- Ruling：V1 仍是 DASHBOARD_UI 支持的回退入口，补最小准备按钮避免服务端规则切换后停局；不移植完整 UI。V1 19 项真人操作测试与生产构建通过。
- 用户明确授权本次固定数据无头 Chromium；使用现有 Vitest browser fixture，不启动真实应用或连接业务账号。修复原生比牌按钮比预留列多 4px 的横向溢出，改为 max-content 列宽。

## 实际验证

- `pnpm --filter @synapse/server exec vitest run src/game --maxWorkers=2`：20 个文件通过、24 个数据库相关文件跳过；157 项通过、137 项跳过。没有配置或连接业务数据库，未运行真实数据库并发验收。
- `pnpm --filter @synapse/server run build:api`：通过。
- `pnpm --filter @synapse/server run typecheck`：受既有 `src/notifications/notification.service.spec.ts:274` 的 TS2493 阻挡，该文件不属于本任务且未修改；不能宣称整包 typecheck 通过。
- `pnpm --filter @synapse/dashboard-v2 exec vitest run src/game-center/games/poker/__tests__ src/game-center/__tests__`：35 文件、201 项通过（随后增加的 2 项 settlement-view 说明/金额测试另行通过）。
- `pnpm --filter @synapse/dashboard-v2 run test:browser src/game-center/games/poker/__tests__/settlement-layout.browser.tsx`：6 项通过。覆盖 1360×900、390×667、390×844、320×568；十名无空格长姓名、宽窄屏所有金额、正文到底、页脚操作、错误状态、底池标签、关闭重开、Escape及焦点返回。实际检查了普通桌面和窄屏截图。
- V2 `tsc`、`check:ui`、完整 `build` 通过；V1完整 `build` 通过。构建仅有项目原有大 chunk 提示及静态脚本提示。
- `pnpm --filter @synapse/desktop exec vitest run app-capabilities/game-hall tests/unit/api-mcp-capability-surface.test.ts`：104 项通过；`check:hard-constraints` 通过。game 27、全局 capability 370 / MCP 366，桌面游戏 IPC 仍为 0。
- 无服务器部署、push、数据库迁移或线上验收。游戏内容按规则不进入发布说明。

截图为本机测试产物，无在线链接：

- `/Users/liyang/Documents/code/github/Synapse/dashboard-v2/src/game-center/games/poker/__tests__/.superpowers/sdd/2026-11-01-poker-settlement-ready/normal-1360.png`
- `/Users/liyang/Documents/code/github/Synapse/dashboard-v2/src/game-center/games/poker/__tests__/.superpowers/sdd/2026-11-01-poker-settlement-ready/normal-390.png`
- 同目录各尺寸 `*-top.png` / `*-bottom.png` 为十人长名单滚动证据。

本次只提交列明的结算/准备协议、兼容入口、测试和对应文档；工作区其他正在进行的陪练准备、成员管理、下注决策信息、Roll 研究改动不属于本次，不得混入。

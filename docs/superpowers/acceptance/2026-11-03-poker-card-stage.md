# 卡牌舞台接入验收

仓库：`/Users/liyang/Documents/code/github/Synapse`；实施分支：`main`。依据用户确认的 [原型契约](../../prototypes/2026-11-03-poker-card-selection-design.md)，接入 [实施计划](../plans/2026-11-03-poker-card-stage-implementation.md)。本轮只改正式表现与本人定义的可选材料用途字段，不执行部署、真实牌局、迁移或数据库写入。

## 已验证范围

- Dashboard 扑克测试：`pnpm --filter @synapse/dashboard test src/game-center/games/poker`，51 文件、382 项通过。覆盖原请求恢复、迟到回调、隐私、费用和明确确认；新增猜色依赖、撤回选项清理、不可施放材料、同名实例、待选恢复、完整候选规则与不自动聚焦。
- 隔离 Chromium：`pnpm --filter @synapse/dashboard test:browser src/game-center/games/poker/__tests__/card-mode.browser.tsx`，65 项通过。固定数据覆盖 1280×800、390×667、390×844、320×568、568×320、667×320；八类选择、固定顶底、唯一右侧纵向滚动、左卡固定/居中、实际选中与 hover、无 Escape 关闭、850px 画布复用、减少动态效果，待选回看情报再返回原预选、未知结果/存储失败底栏（含长错误），以及原暂存/结算面板回归。
- 服务端：`pnpm --filter @synapse/server test src/game/poker/__tests__/card-projection.spec.ts src/game/poker/engine/__tests__/card-catalog.spec.ts src/game/poker/engine/__tests__/card-combinations.spec.ts`，3 文件、91 项通过。材料用途来自真实配方，仍仅投影到本人定义；公开/MCP 隐私矩阵与配方组合不变。
- 共享契约：`pnpm --filter @synapse/shared test src/game-cards.test.ts`，6 项通过。新旧定义均可解析，材料用途不接受伪布尔值；私有卡牌写入仍不注册为 MCP。
- Dashboard 类型、服务端类型（含共享构建）、Dashboard UI 边界与 60 张正式资源校验通过。

## 视觉与证据

本轮得到用户明确允许后运行现有固定数据浏览器测试，没有启动真实对局页面或后端。已读取桌面目标、能力候选、390px 材料与状态等实际截图；完整牌效桌面 18px、窄屏 16px，短内容居中，长内容从右侧顶部滚动。只保留入场、hover、详情切换及已有权威反馈，不用原型的本地效果计算假装成功。

浏览器测试代码包含截图路径配置；当前本机截图和命令输出位于 `/Users/liyang/Documents/code/github/Synapse/.superpowers/sdd/2026-11-03-poker-card-stage-implementation/`，属于可重新生成的忽略产物，尚无在线分享链接。旧 [卡牌验收记录](./2026-11-03-poker-card-mode.md) 的真实隔离牌局证据描述原版本，本轮没有重跑真实牌局或资金数据库验收。

## 兼容与回滚

`consumeSelected` 是可选展示字段，旧服务端缺字段时材料用途使用中性显示，完整规则仍可读；不改变卡池版本、消费、付款、幂等、候选或存储。新前端兼容缺少此字段的旧服务端。旧 Web 前端对定义采用严格 schema，因此正式更新需同步发布后端与 Web，并刷新仍运行旧前端的页面；不能只发布该后端字段。回滚本轮提交的前端及展示投影可恢复原面板，无迁移回滚步骤。游戏内容按仓库规则未写入待发布说明。

## 独立审查与修正

一次独立只读审查提出三项重要问题，均已先复现失败再修正：

- 保留对局总览原 `PokerCardStatuses` / HeroUI Accordion；游戏舞台单独使用 `PokerCardStageStatuses`。真实 `MatchOverview` 展开/折叠回归通过。
- 待选期间允许进入本人情报及公共状态，再返回同一批候选及原预选；不会提前提交。Node 行为回归及桌面/320px 实际浏览器回归通过。
- 信息入口与恢复动作在窄屏底栏分行布局；未知结果和存储失败在 320×568、568×320 下按钮均可见且可点击。长错误限行并保留完整标题/读屏文本，避免挤出主要恢复动作。

修正后的完整扑克前端 382 项、浏览器 65 项通过；无待处理重要或次要审查问题。用户明确排除键盘交互；真实资金/数据库/部署不属于本轮验证。公开状态在待选时也已恢复直接访问。

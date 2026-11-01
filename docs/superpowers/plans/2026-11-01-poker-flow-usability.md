# 陪练准备与牌桌操作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 用户已批准直接执行，当前 main 顺序实施，不创建 worktree。

**Goal:** 完成陪练准备、成员管理、状态恢复和下注上下文四项，并实际复验。
**Architecture:** 独立准备 hook 协调现有 API；Room 提供系统准备页，Table 只组装成员入口；HumanControls 复用现有控制 hook，金额摘要只消费合法投影。
**Tech Stack:** React 19、TypeScript、HeroUI 3.2.7、现有 Vitest/Chromium。
**Spec:** `docs/superpowers/specs/2026-11-01-poker-flow-usability-design.md`。

## Global Constraints

- 当前目录 main；不新增依赖、不部署、不 push、不修改其他任务已有改动。
- 游戏改动不写发布说明；不改变首局条件、后续准备屏障、资金、隐私与控制权协议。
- 系统控件使用 HeroUI 默认浅色和 token；画布不随系统面板挤压或重挂。

## Review Focus

- 添加成功但响应丢失后重试不能多加；部分成功后只补缺少数量。
- 账号/房间切换或离开准备页停止下一步写入；不能自动入座新上下文。
- 管理不把历史成员算占位；待移除仍占位；普通轮次更新不关闭面板。
- 恢复动作不重置倒计时，不代准备；延后离桌/暂离提示不能被轮到本人覆盖。
- 窄屏金额表单保留合法手牌/公共牌上下文与可达确认，不显示旁观隐藏牌。

## Tasks

1. [x] 准备流程：新增 `hooks/usePracticePreparation.ts`、`components/PracticePreparation.tsx` 及 `__tests__/practice-preparation.test.tsx`；在 PokerApp 首局无座位的房主准备阶段接入。先测顺序/重试/停止，再实现。运行对应单测。
2. [x] 成员入口：修改 Table、PokerApp、PracticeBots、SidePanel，新增系统成员浮层；更新 practice-ui/responsive-controls/system-ui 回归，证明直接入口、连续操作和旧日志标签移除。
3. [x] 恢复和下注：修改 HumanControls、action-view、PokerControlPopover 和现有 responsive-controls.css；增加恢复/延后状态及金额上下文测试，补 390×667/844、850/851/1280 几何与隐私回归。
4. [x] 交付：更新 game-ui 和 game-hall 当前行为，运行 V2 专项单测、tsc、check:ui、相关 Chromium；bsk 实际完成准备/增删/下注/恢复流程，清理本次测试房间。检查暂存仅包含本次变更后中文本地提交。

## 执行记录

- 起点存在另一任务的 server/shared/API 结算准备未提交改动，保留；本任务不改这些接口。
- 用户已确认方案并要求实现，无需重复设计审批；本次不新增自动续局规则。

- 准备流程已覆盖10项回归：顺序、防重、部分成功/未知重试、外部AI申请恢复、切换/卸载停止、容量权限、离开重进和刷新失败的已完成语义。
- 当前工作区扑克专项26文件170项通过；金额/成员/准备与原有布局Chromium3文件41项通过，覆盖390×667、390×844、850/851和1280。V2 tsc、check:ui通过。
- bsk真实本地验收房间 #480040：先配置2个机器人再本人入座；成员中添加至满员、手中移除显示延后且保持打开、结算后排除历史成员并即时移除新机器人；窄屏金额信息、半池预设、全下取消和显式下注成功；暂离后状态持续可见，结算后直接回座；AI交接等待/直接取消、旁观直接切回均实际操作。外部AI进程真正连接未运行。验收点数不变，测试房间随后清理。
- 独立只读审查未发现重要问题。截图：本机 `/Users/liyang/.codex/visualizations/2026/11/01/01a1958b-869e-7202-a42a-6185ccada787/poker-flow-verified/`；固定数据截图在 `dashboard-v2/src/game-center/games/poker/__tests__/.superpowers/sdd/2026-11-01-poker-flow-usability/`，均无在线链接。
- 结算准备另一任务已独立提交为 `3ac96e312`，保留其实现；本次仅提交剩余自身变更，不部署、不 push、游戏内容不进发布说明。已清理验收房间、恢复初始筹码偏好并关闭浏览器会话；大厅总点数和可用点数均为 1,000,000，游戏中为 0。

# 德州扑克系统 UI 分层实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** V2 牌桌的功能面板、表单与管理使用标准系统 UI，牌桌、HUD 和直接玩法操作保留游戏风格。

**Architecture:** 保留 Table/HumanControls 的状态和业务 hooks；在呈现边界使用 HeroUI 系统组件及默认主题。Popover 保留定位与焦点机制，移除游戏皮肤；全下使用独立系统 AlertDialog；日志完整结果使用系统布局。无需新增服务或依赖。

**Tech Stack:** React 19、HeroUI 3.2.7、Tailwind CSS 4、Vitest。

**Spec:** `docs/agents/game-ui.md`，用户已明确要求实施。

## Global Constraints

- 当前目录 main，不创建分支/worktree；保留所有既有未提交改动。
- 系统 UI 使用 HeroUI 默认浅色、语义 token、标准尺寸与焦点语义；不覆盖组件基础视觉。
- 保留 850px 布局、三场景 contain 缩放、合法动作、控制版本、隐私、幂等、未知结果重试和全下确认。
- 不修改服务器/MCP/数据库，不部署、不 push；游戏内容不进入发布说明。
- 不启动应用；真实浏览器验收按仓库的显式授权规则执行，未运行时如实标记。

## Review Focus

- 系统 Portal 在深色牌桌内保持默认浅色、Inter 字体和可见焦点，不能继承扑克配色。
- 全下取消后回到原金额输入，焦点回到触发按钮；新手/序号/控制/视角变化撤销旧确认。
- 同一右栏内日志与出牌分属两层；打开管理面板不能改变当前手、控制权或重播音画。
- 窄屏系统面板不得遮住底部三个动作，长姓名/日志/按钮不得溢出。
- 系统层与局内层共用卡牌内容时不得改写遮蔽或本人私密数据投影。

### Task 1: 改造牌桌系统表面并验证行为

**Files:**
- Modify: `dashboard-v2/src/game-center/games/poker/components/{Table,HumanControls,PokerControlPopover,SidePanel,PracticeBots,Settlement}.tsx`
- Modify: `dashboard-v2/src/game-center/games/poker/styles/responsive-controls.css`
- Test: `dashboard-v2/src/game-center/games/poker/__tests__/responsive-controls.test.tsx`
- Test: `dashboard-v2/src/game-center/games/poker/__tests__/system-ui.browser.tsx`
- Modify: `docs/agents/game-ui.md`、`dashboard-v2/MIGRATION.md`

**Interfaces:**
- Consumes: `PokerTableView`、`useHumanControls(table,onRefresh,identityKey)`、现有 Table/Popover props。
- Produces: 保持原业务 props 与动作载荷；系统入口、菜单、表单、日志与确认采用 HeroUI；游戏画布/HUD/直接动作继续原实现。

- [x] Step 1: 新增全下确认语义回归：打开后存在 `role=alertdialog`，未确认不调用 act，取消恢复金额及焦点；复用现有控制版本/未知结果/互斥回归。
- [x] Step 2: `pnpm --filter @synapse/dashboard-v2 test src/game-center/games/poker/__tests__/responsive-controls.test.tsx`，预期新增确认语义断言失败。
- [x] Step 3: 改造上述组件。系统侧栏替换游戏 class；Popover 仅保留几何/生命周期；金额使用 TextField/Input/Slider、确认使用 AlertDialog；管理使用 Button 并按需展开。保留局内 PokerButton、HUD、场景与音画代码。
- [x] Step 4: 添加宽窄屏浏览器回归，对照独立 HeroUI 组件的计算背景/字体，展开日志/管理/金额/确认，检查焦点、视口边界和画布稳定；仅在取得浏览器运行授权后执行。
- [x] Step 5: 游戏专项、全包单测、`tsc`、`check:ui` 和构建通过；同步文档实际状态。预期全部命令退出 0，任何失败记录原因和范围。
- [x] Step 6: 独立审查，仅提交本次代码、测试及文档，中文本地提交，不 push。


## 实施结果

- 游戏专项：32 文件、178 项通过；V2 全包单测：135 文件、1,064 项通过。
- Chromium：17 文件、81 项通过；本次专项 3 项覆盖宽窄屏实际展开、系统主题、字段校验、确认/焦点、长姓名、暗牌遮蔽与原动作载荷。已实际查看宽屏日志/管理、窄屏金额/确认截图。
- `pnpm --filter @synapse/dashboard-v2 build` 通过（包含 shared 构建、check:ui、tsc）；构建仍有大 chunk 提示。全包浏览器输出两条无可见 label 的提示，扑克专项单跑无该提示。
- 全下 AlertDialog 语义先红后绿；独立审查发现的宽屏管理锚点和长结算姓名问题均已复现/修复。浏览器进一步复现并修复透明 Popover 与未选中陪练内容仍显示。
- 保留资金/身份/控制权/隐私/幂等业务 hooks；不新增依赖，不修改服务端/MCP/数据库。游戏内容不写入发布说明。
- 用户明确授权隔离 Chromium 回归与截图；未启动真实业务应用，未连接真实账号或业务库，未部署、未 push。
- 过程日志在根目录 `.superpowers/sdd/2026-11-01-poker-system-ui/`；截图在测试目录同名 `.superpowers/sdd/` 下，均为本地忽略产物，无在线链接。

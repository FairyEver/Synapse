# 点数与 AI 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans。用户已授权当前对话直接实施，顺序执行，不创建分支或 worktree。

**Goal:** 完成点数提示、等待邀请、统一 AI 面板及跨页面持续状态并实测。
**Architecture:** 现有控制协议和集中 API；服务端列表增加本人控制投影，Web 共享接入组件和 hook，等待 helper 统一状态。
**Tech Stack:** HeroUI v3 / React 19 / TypeScript / Vitest / Prisma。
**Spec:** `docs/superpowers/specs/2026-11-01-poker-entry-connect-design.md`

## Global Constraints
- 不新增依赖或能力，不迁移数据库，不部署、不 push，游戏不进发布说明。
- 保留其他任务已存在的 cloud-tables 与 research 修改，只提交自身文件。
- 无新增权限、自动入座、自动准备或模型托管；隐私和控制版本由服务端裁决。

## Review Focus
- 列表投影只能查询本人和本页房间，历史无座位授权也要显示，空页不查控制表。
- 首局不能误称下一手；结算准备状态不得被等待人数覆盖。
- 复制失败不能隐藏已确认的授权，重复复制不得增加控制版本。
- 账号切换、卸载和迟到响应不能继续复制、写入或刷新新上下文。
- 面板关闭不撤销授权，列表仍需显示等待并提供取消入口；短屏正文可滚动且按钮可达。

## Tasks
1. [x] 先在 lobby-modes.spec.ts 覆盖本人控制投影/查询边界并观察失败；修改 game-api.service、poker-read.service、共享类型及响应 schema，专项验证。
2. [x] 新增等待/邀请 helper、共享 AI 接入 hook/dialog 和 entry-connect.test.tsx；先验证资金、状态、授权/复制/取消/失败及上下文边界，再接入 HumanControls、Table、Seat、Lobby/RoomList，保留现有出牌协议。
3. [x] 新增真实 Chromium 窄/宽屏面板、邀请与刷新回归；运行扑克单测、浏览器回归、V2 tsc/check:ui 和服务端相关检查。使用 bsk 实测测试房间，清理资源恢复偏好。
4. [x] 同步 game-ui/game-hall 与 API/Skill 说明，检查 diff、本地中文提交，只包含本次范围。

## 执行记录
- 已确认其他任务当前修改 server/prisma/schema.prisma、shared/src/index.ts 及 cloud-tables/research 文件，全部保留。
- RED→GREEN：本人投影/分页边界2项；点数提示/首局等待/列表持续状态3项；房间切走再切回的迟到读1项；邀请按钮越出视口2个尺寸。旧测试更新为先打开统一面板、明确授权后才写入。
- 验证：扑克179项单测通过；完整扑克 Chromium 5文件52项通过；服务端游戏20文件159项通过、24文件137项依赖外部条件而跳过，其中本人列表专项8项通过；桌面响应/注册协议59项通过。V2 tsc、check:ui、server tsconfig.build生产类型检查通过。
- 额外全量检查如实保留：shared 286通过、1失败（已有package-entrypoint断言缺game-poker通知种类）；server完整tsconfig检查遇到并行cloud-table-openapi.spec索引类型及已有notification.service.spec空元组错误。均不属于本次范围，不修改它们，不将全量检查写成通过。
- 独立只读审查未发现Critical/Important问题。部署时先服务端后Web，新增投影可选，不需要数据库迁移。本任务不部署、不push，不修改发布说明。
- 真实 bsk 验收：localhost:19703 + 本机5433独立库 synapse_poker_entry_20261101_e2e，新建两个合成验收账号；仅 owner 实际登录。房间#234205：带入1,000前可用1,000,000、复制邀请成功、本人入座后还需1人；已有座位交接申请和重复复制成功；关闭面板返回列表、整页刷新仍显示等待并可取消；离桌后可用恢复1,000,000，无座位接入申请在0人且无会话时仍保留列表状态，取消后变回可加入；最后解散测试房间，游戏中为0。没有运行真实外部AI或第二人对局，不以夹具冒充真实连接。
- 本地API起初被并行cloud-tables类型错误阻塞；用户随后允许一处必要类型修复，但该问题已由并行任务自行解决，本任务没有修改云表格文件。隔离库初始化仅作用于专用_e2e库；没有向业务库部署或执行迁移。停止本任务Web/API后，恢复原已运行的Postgres/PDF基础容器。
- 截图与有限浏览器证据：本机 `/Users/liyang/.codex/visualizations/2026/11/01/01a1958b-869e-7202-a42a-6185ccada787/entry-connect-verified/`；浏览器调试捕获因开发热更新达到容量上限、有请求丢弃，不宣称完整网络记录。固定数据截图在扑克测试 `.superpowers/sdd/2026-11-01-poker-entry-connect/`；均无在线链接。浏览器会话已关闭，隔离测试库保留供复验，不包含业务数据。

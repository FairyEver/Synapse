# Webhook 控制台重构实施计划

> 使用 writing-plans 编排，executing-plans 在当前会话连续实施。用户已明确选择直接完成重构；不重复请求方案或执行方式确认。

**Goal:** 统一 Webhook 配置、触发历史和请求排查流程。
**Architecture:** 保留现有接口与权限，抽出可嵌入的历史内容，路由搜索参数承载筛选与分页，HeroUI 负责控件、浮层与键盘语义。
**Tech Stack:** React 19、TypeScript、HeroUI 3.2.7、React Query、TanStack Router/Table。
**Spec:** `docs/superpowers/specs/2026-11-02-webhook-console-ux-design.md`

## 约束与决策

- 当前 main 直接修改；不创建分支或 worktree，不新增依赖，不动其他任务的 cloud-tables 改动。
- 复用用户已经启动的 19700 服务与 bsk 浏览器；不重启服务。
- 仅改变 Web 界面组织；保留历史脱敏、删除后保留、权限和投递状态语义。
- 管理员没有 Webhook 管理列表接口，保留带明确标签的 ID 筛选；普通用户使用可分页名称选择器。

## Review Focus

- 非首批 Webhook 和已删除 Webhook 均可保留或选择查询范围。
- 浏览器历史、切换 Webhook 和清除筛选不残留旧条件或旧详情。
- 反向日期范围不发起无效请求。
- 显隐地址、复制失败、legacy 地址与重置提示符合真实接口能力。
- 长名称、窄屏、展开浮层、单一正文滚动及焦点不会遮挡操作。

## Task 1：列表与配置

- [x] 更新重置提示行为测试，先验证旧实现不符。
- [x] 调整 `features/webhooks/index.tsx`、`webhook-columns.tsx`；抽出 `webhook-configuration.tsx`，详情增加 URL 控制的配置/记录 Tab。
- [x] 保留创建深链和缓存失效逻辑，配置内提供显隐/复制、名称保存、启停及独立危险操作。

## Task 2：历史与请求排查

- [x] 先补日期范围和可读客户端摘要测试并验证失败。
- [x] `features/webhook-deliveries/index.tsx` 拆分页面外壳与 `WebhookDeliveryHistory`；筛选、排序、分页由 `search` + `onSearchChange` 驱动。
- [x] 新增分页 Webhook 选择器；修改普通用户与管理员路由传入绑定的搜索更新回调。
- [x] 详情抽屉以请求/回执 Tabs、元数据 Accordion 和明确错误组织；保留脱敏摘要和历史快照。

## Task 3：验收与交付

- [x] 浏览器夹具覆盖 URL 显隐/复制、配置保存、筛选复位、日期错误、路由条件变化、抽屉长标题和 390/1280px 展开几何。
- [x] bsk 已核对正在运行的列表和配置；窗口关闭后，历史及展开态由隔离 Chromium 回归和截图验收，不操作真实数据、不重开已关闭窗口。
- [x] 运行相关测试、typecheck、check:ui、构建；检查 MCP/Skill 不涉及新增能力，无需改注册表。
- [x] 更新页面指南与待发布说明，只暂存本次内容并本地提交，不 push、不部署。

## 执行记录

- 基线：现有 6 文件 21 项专项测试、typecheck、check:ui 通过。
- 设计只读评审：没有关键缺口。用户选择直接实施，现有服务可访问且已登录。
- 完成：27 项相关单元测试、33 项 Chromium 回归、typecheck、check:ui 和生产构建通过；独立代码评审无实质性缺陷。
- 决策：HeroUI ScrollShadow 的滚动时间线不会自行停止，几何回归等待 DocumentTimeline 入场动画结束，不再等待滚动时间线；保留标题与关闭按钮的完整几何断言。
- 并行任务切换 Webhook 单段令牌协议，沿用其调用地址文案。管理员路由和页面指南仅暂存本任务相关片段，不提交其他任务的 Skills 移除。

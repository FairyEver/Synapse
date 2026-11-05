# 自动化收信触发器验收记录

日期：2026-11-05。仓库：`/Users/liyang/Documents/code/github/Synapse`，在当前 `main` 原地开发。设计与实施计划分别为 `docs/superpowers/specs/2026-11-05-automation-mail-triggers-design.md`、`docs/superpowers/plans/2026-11-05-automation-mail-triggers.md`。

## 已执行

- 桌面主进程、自动化、邮箱、DataRepository 与启动注册专项：56 个文件、386 项测试通过。
- Renderer 自动化编辑、账号选择与触发器专项：12 个文件、126 项测试通过。
- 服务端站内信与公告专项：7 个文件、61 项测试通过。
- desktop 完整 typecheck（renderer、Electron、preload、测试）和 server typecheck 通过。
- desktop build:renderer、build:electron 通过。Renderer 构建有既有的大 chunk / plugin timings 警告，不是构建失败。
- hard constraints 和 IPC codegen 检查通过；未改变公开 IPC 数量。

测试使用临时本机 SQLite/JSON 与受控协议/执行器夹具，不使用真实用户邮件、账号密码或 Agent 服务。覆盖联网启用失败、未引用准备记录、账号隔离、151 封多页补收、重复提示/同步、运行历史裁剪后去重、已提交但运行写入失败、普通启动恢复后的结果不明、执行槽忙、正文/附件元数据、未读保持、暂停账号、配置导入和清理故障恢复。

端到端补充验证：启用后离线到信 → 在线停用确认关闭水位 → 停用期间到信 → 重新启用 → 新信，只执行两个有效时间段中的信件；再次扫描不重复。关闭水位最多确认 5 秒，无法证明的离线关闭区间保留 `STOP_BOUNDARY_UNCONFIRMED`，不猜测它是否包含停用期间到信。

## 尚未验证或未执行

- 真实 PostgreSQL 事务锁/提交竞争验收尚未执行。测试入口为 `pnpm --filter @synapse/server run test:mail-triggers:e2e`，必须另获测试库写入授权并显式提供 loopback、库名以 `_e2e` 结尾的 `MAIL_TRIGGERS_E2E_DATABASE_URL`。不能将 mock 测试视为真实锁行为验收。
- 迁移文件 `server/prisma/migrations/20261105120000_mail_receipt_sequence/migration.sql` 已提交；未对本地业务库、测试环境或生产库应用迁移，未部署服务器、发布客户端或推送 Git。
- 未启动应用、浏览器或开发服务。账号选择器展开状态的桌面/窄屏视觉验收、真实 IMAP 账号、休眠/重连实机行为仍待授权验收；组件测试和构建不能替代。
- `check:ui-tracking-coverage` 当前报告 1 个已有编辑器问题：`desktop/src/modules/automation/hooks/use-automation-editor.ts:176` 使用条件表达式选择两个字面量 eventKey，检查器要求可静态识别的稳定键。本功能没有改动该文件，也未弱化检查器；该项不能标为通过。

## 发布与回退前提

站内信触发器需要具备新 checkpoint/changes 接口和 deliverySequence 迁移的服务端；旧服务拒绝启用，不能降级为读取第一页或本机时间猜测。外部邮件由本机 core.mail 提供，不进入云消息中心、手机邮箱或服务端邮件存储。

回退先停用新任务并停止对应后台 worker，保留本机队列和去重，不清理实际邮件或站内信。服务端序列字段为 additive，旧应用可暂留字段；字段/索引回滚须另行授权，不能随客户端回退自动执行。通用执行器崩溃后的外部副作用不能证明 exactly-once，已提交但结果不明时优先不重复执行。

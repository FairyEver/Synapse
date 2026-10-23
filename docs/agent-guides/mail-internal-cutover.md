# 站内信 mail-internal 切换与验收

## 切换范围

站内信 App ID / 深链 host 使用 `mail-internal`，capability namespace 为 `mail_internal`，17 个工具使用 `app_mail_internal_*`。用户 API `/api/mail-internal/...`，管理 API `/api/admin/mail-internal/...`，管理台路由 `/mail-internal`；旧入口不提供别名。旧客户端升级前不能使用切换后的站内信 API。

外部邮箱将使用 `mail`，不读取原站内信 ID。本次改名不删除历史信件、附件、通知或已读状态，不为改名搬动物理邮件表和附件对象。

## 发布前

1. 按项目正常流程备份业务数据库及站内信附件对象，验证可恢复。另保留升级前桌面配置与其 Dock 迁移标记。
2. 在明确隔离、已获授权的 PostgreSQL 测试库从备份恢复，预演 `20261023000100_mail_internal_namespace`。本地自动测试使用内存 SQL fixture，不能替代 PostgreSQL 预演。
3. 核对通知行数、ID、`sourceKey`、`readAt`、`deletedAt` 和 `createdAt` 不变；source 改为 `mail-internal`，只有 group 等于旧域才改写，只有精确对应 targetId 的系统旧链接才改写。
4. 不运行 `purge-legacy-mail.sql`；它属于历史切换，不能用于此次改名。不要重建 outbox、清空通知或改写用户邮件正文。
5. 协调服务端、桌面和已有 iOS 站内信入口同步升级，并在发布说明明确旧版本入口失效。本文件不自动授权部署、发版、CI 或真实业务库写入。

## 发布后检查

- 用户可在新站内信入口完成列表、人员筛选、读信、回复、转发、附件、批量已读和删除；旧 API 返回 404。
- 消息中心和手机的新站内信通知定位原邮件，原 outbox 重试仍使用 `mail:<messageId>` 去重键，不生成第二条通知。
- 桌面旧配置先迁移后过滤 App ID，改名阶段保留原固定状态与位置；随后独立执行 `dock.mail-apps-introduction.v1`，一次性将末尾排为「站内信 → 邮箱 → 应用」，即使升级前移除过站内信也会重新加入一次。保存失败不推进完成标记，重试可继续；升级后再移除或排序，重启不重新添加。
- 两端只接受 `synapse://mail-internal/<id>`，拒绝多段路径、query、fragment、编码分隔符及旧 host。手机不增加外部邮箱入口。

## 保留旧字符串的原因

- `server/src/mail/`、`Mail*` Prisma 实体、`mail/attachments/` 对象 key 是内部物理布局。
- `sourceKey=mail:<messageId>` 保留通知投递身份，不能随 source 改名而改变。
- `dock.mail-introduction.v1` 的历史操作保留原样，后续迁移在过滤 ID 前重放并重命名。
- 历史数据库迁移、历史设计文档、负向测试和迁移 fixture 需要保留旧入口样本。
- 用户自己写进正文的旧链接不自动修改。

## 回滚

出现问题先停止进一步发布和站内信写入。恢复升级前完整数据库及配置备份，并协调所有客户端和服务端版本；不要只回退桌面或只恢复某个 notification source 字段。原附件对象没有搬迁，不应被清理。新邮箱已创建的数据需单独保留，旧客户端不得把新 `mail` App 配置解释为站内信。

## 本地验证记录

2026-10-23：桌面站内信/配置/路由回归、desktop typecheck、IPC codegen 与 hard constraints 通过；服务端相关 70 项测试、共享包 277 项测试、管理台 API/路由 50 项测试、桌面账号服务 143 项测试与发布投递脚本 4 项测试通过，服务端与管理台类型检查通过。Swift Foundation 链接检查 16 项通过。iOS build-for-testing 编译通过（未启动模拟器或执行 XCTest）；这些检查不代表真实部署或真实邮箱验收。

发布前仍需隔离 PostgreSQL 迁移预演、候选安装包检查及协调升级后的跨端业务验收。

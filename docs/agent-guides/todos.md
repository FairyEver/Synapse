# 云端待办事项

权威 AI 操作指南为 `desktop/app-capabilities/synapse-skill/skill-package/todos/index.md` 与 `api-reference.md`。唯一公开工具 search/invoke，todos domain 索引六个 app_todos_item_*，对应 app.todos.item.list/get/create/update/set_completed/delete；无 Workflow/Automation 节点。

登录账号独占，PostgreSQL 唯一权威存储。桌面经 AccountService 和窄 window.synapse.todos.item 六方法；renderer 唯一入口 todosApi。身份变化前 generation 递增并终止旧请求、清空界面，同号退出重登也是新周期，token 刷新不是。无本地数据库/草稿/离线队列。所有写操作稳定 UUID；修改/完成/删除加当前 version；原请求重试沿用 UUID，冲突 reread 后新操作新 UUID。

提醒由服务端扫描、同事项行锁和事务 outbox 触发，桌面关闭仍可投递生产 APNs 和账号消息中心；触发/改时/完成/删除共用行锁，每代只一条记录，同 notificationId 重试，已读/删除不再弹外部通知。生产 APNs 开关不变。审计/IPC/HTTP 日志只元数据，不留标题/备注/搜索词。

日期/时刻/时区先确定，RFC3339 分钟精度输入，UTC 返回。标题 200/备注 10000 Unicode code points。唯一对象授权明确直接执行，同名/缺时间澄清，保存提醒不等于已送达。设计见 `docs/superpowers/specs/2026-10-11-cloud-todos-design.md`。

桌面入口为启动台中的「待办事项」，可手动固定 Dock，默认未完成；同一内容用于主窗口与独立窗口。iOS 主页的同名入口直接请求账号 API，无需电脑在线。两端提供标题、备注、截止时间及不提醒 / 截止时 / 提前 / 自定时间；完成后可在全部恢复。编辑失败保留草稿，冲突需显式重新读取；删除需用户明确指定事项且不可恢复。

通知来源与目标来自已认证服务端记录，`synapse://todos/<id>` 只读定位；既不完成事项，也不自动重放修改。实际三端链路、iPad 窗口、VoiceOver 和生产推送的未执行项见 `docs/superpowers/acceptance/2026-10-11-cloud-todos.md`。

Todo HTTP 成功及错误响应均为 `Cache-Control: private, no-store`。iOS 使用集中客户端内不缓存、不等待连接的待办传输；离线提交立即返回错误，连通后需显式重试。相同请求的失败重试在 24 小时内保留原 payload / UUID，即使提醒时刻已过；更改请求仍按新意图验证。

编辑期间收到通知或深链，先保留定位目标，保存或放弃草稿后再打开。重新读取结果只更新其仍拥有的编辑草稿；桌面只改文字时保留原 UTC 日期与提醒时刻，避免夏令时回拨的重复小时改变时间。到期后、扫描前的文字修改保持待触发提醒，补偿窗口仍为 24 小时。

# 云端待办事项

权威 AI 操作指南为 `desktop/app-capabilities/synapse-skill/skill-package/todos/index.md` 与 `api-reference.md`。唯一公开工具 search/invoke，todos domain 索引六个 app_todos_item_*，对应 app.todos.item.list/get/create/update/set_completed/delete；无 Workflow/Automation 节点。

登录账号独占，PostgreSQL 唯一权威存储。桌面经 AccountService 和窄 window.synapse.todos.item 六方法；renderer 唯一入口 todosApi。身份变化前 generation 递增并终止旧请求、清空界面，同号退出重登也是新周期，token 刷新不是。无本地数据库/草稿/离线队列。所有写操作稳定 UUID；修改/完成/删除加当前 version；原请求重试沿用 UUID，冲突 reread 后新操作新 UUID。

提醒由服务端扫描、同事项行锁和事务 outbox 触发，桌面关闭仍可投递生产 APNs 和账号消息中心；触发/改时/完成/删除共用行锁，每代只一条记录，同 notificationId 重试，已读/删除不再弹外部通知。生产 APNs 开关不变。审计/IPC/HTTP 日志只元数据，不留标题/备注/搜索词。

日期/时刻/时区先确定，RFC3339 分钟精度输入，UTC 返回。标题 200/备注 10000 Unicode code points。唯一对象授权明确直接执行，同名/缺时间澄清，保存提醒不等于已送达。设计见 `docs/superpowers/specs/2026-10-11-cloud-todos-design.md`。

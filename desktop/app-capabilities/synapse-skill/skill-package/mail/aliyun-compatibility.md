# 阿里邮箱兼容性

阿里企业邮箱预设 IMAP `imap.qiye.aliyun.com:993` TLS、SMTP `smtp.qiye.aliyun.com:465` TLS。阿里个人邮箱预设 IMAP `imap.aliyun.com:993` TLS、SMTP `smtp.aliyun.com:465` TLS；按通用 IMAP / SMTP 账号处理，默认由服务器保存已发送副本，可在高级设置调整。两者均验证证书。个人邮箱尚未进行真实账号兼容性验收，不能将以下企业邮箱实测行为套用于个人邮箱。用户的组织若使用其他接入地址，在高级设置中按其实际配置填写；需要邮箱管理员开启客户端访问或使用应用专用密码时，由用户处理。不要要求用户把密码发给 Agent。

此前独立实验观察到 IDLE、UIDPLUS 可用，MOVE 未声明，COPY 实际具有移动行为；FROM / SUBJECT / BODY 搜索曾返回 BAD，HEADER 查询也出现过错误的空结果；STATUS 与 SELECT 计数存在差异。这些是设计依据，不能替代当前实现的正式账号验收。

当前实现的约束与 mock 回归：

- 索引采用 SELECT 和 UID 枚举，历史分批加载；按本机索引搜索地址/主题，正文只在明确续查时按批扫描。`serverHistoryComplete:null` 表示服务器更早历史是否可见尚不确定，不承诺已取得全部历史。
- IDLE 只作为变化提示，另有定期校对；休眠暂停、唤醒重连。只有 SY 进程运行才收信，关闭邮箱面板不关闭后台连接。
- 阿里移动使用 COPY 后校验源/目标和 UID 映射，不额外标 Deleted；无法证明结果时返回逐项 unknown，不能换请求 ID 重放。永久删除仅限回收站准确 UID 且服务端声明 UIDPLUS，绝不使用全箱 EXPUNGE。
- 服务器自动保存已发送副本；客户端不再 APPEND Sent。回执把 SMTP accepted 与 sentCopyState 分开，副本暂时找不到不表示未发送；核验检查主地址、时间、Message-ID 和 MIME 内容指纹。
- 草稿 APPEND 先持久化快照，确认新 UID 后才替换旧副本；APPEND 结果未知保留现场、核验后再处理，不再次追加。远端更改保留冲突副本。
- `\\Seen` / `\\Flagged` 写后复验。此前实验中 Answered 移除未稳定生效，因此首期不提供以此为基础的能力。

当前实现的正式阿里账号、持续 IDLE、原生通知权限、关闭窗口收信和跨平台验收仍以 `docs/agent-guides/mail-client-acceptance.md` 的结果为准；未填通过前，不声称新客户端已在真实账号验证。

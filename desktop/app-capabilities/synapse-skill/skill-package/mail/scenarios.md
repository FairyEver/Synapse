# 邮箱场景配方与回归语料

先读 [index.md](index.md) 的账号选择与范围规则。下表保留审计中的41条原句，作为行为契约和自动回归输入；工具命中不代表已经执行。多轮省略句由会话上下文定位，工具发现不保存对话。

| 编号 | 用户说法 | 行为与路由 |
|---|---|---|
| S01 | 帮我给张三发个邮件 | 姓名→真实地址；唯一账号直接使用；建稿→预览→发送。 |
| S02 | 帮我给 alice@example.com 发个邮件，告诉她明天下午三点开会 | 使用明确地址；会议时间属于正文，不是定时发送；唯一账号直接使用。 |
| S03 | 用 sy 给客户发邮件 | sy 不表示站内信；先确定客户的真实邮箱地址。 |
| S04 | 帮我写封邮件给 alice@example.com，先别发 | 仅创建草稿，不进入发送。 |
| S05 | 把这个报价单发邮件给王总，抄送李四 | 解析王总与李四的真实地址，核对报价单版本/路径，导入附件并设置 cc。 |
| S06 | 继续编辑刚才那封草稿 | 复用 draftId，get 后按 expectedRevision 更新，不猜草稿。 |
| R01 | 看看我收件箱 | 取 role=inbox 的 folderId，再 list；不能省略文件夹混入 Sent/Trash。 |
| R02 | 去拉一下最新的邮件 | sync.start→有界 sync.get→Inbox list；同步失败不能说最新。 |
| R03 | 我收到了哪些邮件 | Inbox 小页列表，默认20条，不读取全部正文。 |
| R04 | 我最近收到了什么邮件 | 刷新后取最近20条并说明范围，不默认仅未读。 |
| R05 | 我刚刚收到了什么邮件 | 刷新后按 receivedAfter/Before 最近15分钟，明确窗口与 coverage。 |
| R06 | 今天有哪些未读邮件 | 用户当地今天换算 UTC 半开区间 + unreadOnly=true。 |
| R07 | 我还有多少封没读的邮件 | 直接 Inbox message.count，不读正文。 |
| R08 | 把最新五封邮件总结一下 | list limit=5 后只读五封正文；不以 snippet 冒充完整摘要。 |
| R09 | 看一下第二封 | 复用已呈现编号→messageId，get/body；无上文时才问目标。 |
| R10 | 还有呢，继续看下一页 | 原账号/条件 + nextCursor 续页；不是重新从第一页开始。 |
| Q01 | 找一下张三给我发的邮件 | Inbox message.list(sender=张三)，仅 From 匹配；多条结果如实展示。 |
| Q02 | 查找 alice@example.com 昨天发给我的邮件 | Inbox sender=alice@example.com + 昨天 receivedAfter/Before。 |
| Q03 | 找一下上周主题包含合同的邮件 | subject=合同 + 用户当地上周时间范围；不将整句放入 query。 |
| Q04 | 搜一下正文提到验收的邮件 | fields=body,query=验收；get 后按 canContinue 有界 resume，报告 coverage。 |
| Q05 | 找出有 PDF 附件的邮件 | hasAttachments=true,attachmentMime=application/pdf；若用户按扩展名描述可用 attachmentName=.pdf。 |
| Q06 | 看看我发给王总的邮件 | Sent 文件夹 + recipient=王总，不用全邮箱关键词代替。 |
| P01 | 回复张三给我的那封邮件，说已经收到 | sender 找唯一原信，继承 accountId，reply；多封无法确定才问。 |
| P02 | 回复刚才这封邮件 | 复用原信与账号；内容从上下文确定，不重复选邮箱。 |
| P03 | 回复全部，告诉大家周五交付 | mode=reply_all；排除自身与 aliases、不复制 Bcc，正文明确后预览发送。 |
| P04 | 把这封邮件转发给 alice@example.com | mode=forward 后更新明确收件地址；沿用受控附件，预览发送。 |
| P05 | 帮我拟一段回复，先不要发 | 仅在对话拟回复文本；用户要求保存才建稿，禁止发送。 |
| A01 | 把这封邮件的附件下载到桌面 | attachment.list 后选择下载到已解析的桌面绝对路径，不覆盖现有文件。 |
| A02 | 读一下附件里的合同，总结重点 | 下载指定附件，复用文档提取器读 PDF/DOCX；不把元数据当合同正文。 |
| A03 | 把这封邮件导出成 eml | message.extract_to_file 输出原始 MIME 到 EML。 |
| M01 | 把这些邮件标记为已读 | message.update(read=true) 对明确 IDs 操作，报告逐项结果。 |
| M02 | 把这封邮件加星标 | message.update(star=true)，不改其他标记。 |
| M03 | 把这些垃圾邮件删掉 | 核对具体垃圾邮件 IDs，默认移 Trash，不永久删除。 |
| M04 | 恢复刚才删掉的邮件 | 复用原删除目标 IDs→message.restore；不是 account.resume。 |
| M05 | 把这些邮件移到合同文件夹 | 定位真实 folderId→message.move，稳定 clientRequestId，不新建同名文件夹。 |
| C01 | 我只有一个邮箱，直接用它发送 | 完整账号列表只有一项且无 nextCursor 就直接使用，禁止再问选哪个邮箱。 |
| C02 | 用我的工作邮箱发送 | 按账号显示名/地址匹配工作邮箱，唯一则直接使用，歧义才询问。 |
| C03 | 看看这封邮件发出去了吗，刚才超时了 | operation.get 核验原操作，unknown 不自动重发。 |
| C04 | 帮我添加一个阿里邮箱 | account.open 本机配置，不在对话/MCP 接收密码。 |
| C05 | 明天上午九点发这封邮件 | 不支持定时发送；说明边界，可在用户同意后只起草，不创建自动化。 |
| B01 | 帮我给张三发站内信 | 明确站内信才走 mail_internal；按站内信团队收件人→预览→发送。 |

账号验收：0个账号打开配置；1个账号直接使用且澄清次数为0；2个账号沿用明确选择/唯一名称匹配，仅真实歧义才问；首个分页有下一页时不得断言唯一；显式地址不匹配不得替换；回复与已有草稿继承所属账号。缺少收件地址不等于缺少发件账号，应只问缺失项。

复合提示词补充回归（原41条保持不变）：

| 用户说法 | 预期路径 |
|---|---|
| 回复刚才这封邮件，先只创建草稿和预览 | 复用原信 ID 和账号 → draft.create(mode=reply) → update → send.preview；不读取不存在的草稿，不发送。 |
| 转发刚才这封邮件，先只创建草稿和预览 | 复用原信 ID 和账号 → draft.create(mode=forward) → update 明确真实收件地址 → send.preview；不发送。 |
| 打开刚才的回复草稿，先预览，不要发送 | 复用已有 draftId → draft.get → send.preview；不重复创建，不发送。 |
| 读取刚才的转发草稿，先预览，不要发送 | 复用已有 draftId → draft.get → send.preview；不重复创建，不发送。 |

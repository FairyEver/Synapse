/** Discovery hints only: no user text is interpreted as execution authorization. */
export interface MailSearchIntent {
  domain: "mail" | "mail_internal"
  actions?: readonly string[]
  guidance?: string
}

export function mailSearchIntent(query: string): MailSearchIntent | null {
  // Content to write is data, not a second operation (e.g. tomorrow's shipping).
  const normalized = query.normalize("NFKC").toLowerCase()
  const contentStart = normalized.search(/(?:[,，。;；]\s*)?(?:内容|正文|主题)(?:是|写|为|[:：])/u)
  const prefix = contentStart < 0 ? normalized : normalized.slice(0, contentStart)
  const text = /(?:发|发送|写|起草).*(?:邮件|站内信)|回复|转发/u.test(prefix) ? prefix : normalized
  // Exact canonical names must remain discoverable without natural-language rules.
  if (/^app_[a-z_]+$/u.test(text)) return null
  const internal = /站内信|\binternal[ -]mail\b|synapse:\/\/mail-internal\//u.test(text)
  const external = /邮件|邮箱|收件箱|信箱|信件|草稿|回信|回复|转发|附件|\b(?:mail|email|e-mail|inbox|imap|smtp)\b|synapse:\/\/mail\//u.test(text)
    || /[\w.+-]+@[\w.-]+\.[a-z]{2,}/u.test(text)
  if (!internal && !external) return null
  // An explicit non-mail channel is not a request to manipulate email.
  if (!internal && /企业微信|企微|\bwecom\b|飞书|\blark\b/u.test(text)) return null
  if (!internal && /云盘|云文档|评论|\bdrive\b/u.test(text) && !/发(?:送)?(?:个|一封|封)?邮件|邮箱|收件箱/u.test(text)) return null
  const domain = internal ? "mail_internal" : "mail"
  const route = (...actions: string[]): MailSearchIntent => ({ domain, actions })
  const draftOnly = /别发|不要发|不发送|先不发|只(?:起草|写)|仅(?:起草|写)|先审阅|do not send|don't send/u.test(text)
  const newMessage = () => route(...(internal
    ? ["send_preview", "recipient_list", "contact_list"]
    : ["draft_create", "account_list", "send_preview"]), ...(!draftOnly && /发|\bsend\b/u.test(text) ? ["message_send"] : []))
  if (/synapse:\/\/mail(?:-internal)?\//u.test(text)) return route("message_get")
  if (internal) {
    if (/组织/u.test(text)) return route(/成员/u.test(text) ? "organization_members_list" : "organization_list")
    if (/联系人/u.test(text)) return route("contact_list")
    if (/收件人|收信人/u.test(text)) return route("recipient_list")
    if (/未读数|数量|多少|count/u.test(text)) return route("message_count")
    if (/清空|删除全部/u.test(text)) return route("message_delete_all")
  }
  // Explicit maintenance/entity requests must win over generic mail verbs.
  if (!internal && /(?:账号|文件夹|附件).*删除/u.test(text)) {
    return route(/账号/u.test(text) ? "account_delete" : /文件夹/u.test(text) ? "folder_delete" : "attachment_delete")
  }
  if (!internal && /(?:搜索|检索).*(?:查询|结果|继续|恢复|取消)/u.test(text)) {
    return route(/取消/u.test(text) ? "search_cancel" : /继续|恢复/u.test(text) ? "search_resume" : "search_get")
  }
  if (!internal) {
    if (/(?:定时|预约).*(?:发送|发信|发邮件)|(?:明天|后天|今晚|下周)(?:上午|下午|晚上|早上)?[零一二三四五六七八九十两\d:：点分半 ]{0,15}(?:再)?(?:发送|发这封|发邮件|发信)|\bschedule.*(?:email|mail)\b/u.test(text)) return { domain, actions: [], guidance: "邮箱不支持定时发送；可以按用户要求起草，但不能通过自动化绕过该边界。" }
    if (/撤回|recall/u.test(text)) return { domain, actions: [], guidance: "邮箱不支持已发送撤回；不能删除副本来冒充撤回。" }
    if (/(?:同步|sync).*(?:通讯录|联系人|contacts)/u.test(text)) return { domain, actions: [], guidance: "邮箱不支持通讯录同步；可按姓名或地址查询已有往来邮件。" }
    if (/(?:添加|接入|配置|连接|add|setup).*(?:邮箱|阿里|account)/u.test(text)) return route("account_open", "account_list")
    if (/只有一个|唯一.*邮箱|用.*(?:工作|个人|这个|该).*邮箱.*(?:发|send)/u.test(text)) return route("account_list")
    if (/发出去了吗|发出去了|发送结果|回执|(?:发送|发信).*超时|sent.*(?:status|timeout)/u.test(text)) return route("operation_get", "operation_list")
    if (/(?:拉|刷新|同步|检查).*(?:最新|新邮件)|(?:最近|刚刚|刚才).*(?:收到|收信)|有新(?:邮件|信)|refresh.*(?:mail|inbox)/u.test(text)) return route("sync_start", "sync_get", "message_list")
    if (/(?:多少|几封|数量|未读数|count|how many)/u.test(text)) return route("message_count")
  }
  if (/(?:恢复|还原).*(?:删|回收)|restore.*(?:mail|trash)/u.test(text)) return route("message_restore")
  if (/(?:移到|移动).*(?:文件夹|目录)|move.*(?:mail|folder)/u.test(text)) return route("message_move")
  if (/附件.*(?:下载|保存到)|下载.*附件|download.*attachment/u.test(text)) return route("attachment_download_file", "attachment_list")
  if (/(?:导出|export).*(?:eml|邮件)|邮件.*(?:导出|export)/u.test(text)) return route("message_extract_to_file")
  if (/正文.*(?:提到|包含)|(?:搜|检索).*正文|search.*body/u.test(text)) return route("search_start", "search_get", "search_resume")
  if (/附件.*(?:合同|总结|内容)|(?:读|查看).*附件/u.test(text)) return route("attachment_list", "attachment_get", "attachment_download_file")
  // “刚才” may refer to the source mail; an explicit new reply/forward draft
  // must not be mistaken for an already saved draft.
  const creatingReplyDraft = !internal && /回复|回信|转发|reply|forward/u.test(text)
    && /(?:创建|新建|生成)(?:一封|一个|个)?(?:回复|转发)?草稿/u.test(text)
  if (!creatingReplyDraft && /草稿/u.test(text) && /继续编辑|刚才|读取|打开/u.test(text)) return route("draft_get", "draft_list", "draft_update")
  if (/草稿/u.test(text) && /删除|丢弃/u.test(text)) return route("draft_list", "draft_delete")
  if (/草稿/u.test(text) && /列表|哪些|列出/u.test(text)) return route("draft_list")
  if (/标记|设为|设已读|加星标|star|mark.*read/u.test(text)) {
    if (internal && /全部/u.test(text)) return route("message_read_all")
    return route("message_update")
  }
  if (/删掉|删除.*邮件|邮件.*删除|delete.*(?:email|mail)/u.test(text)) {
    if (internal && /批量/u.test(text)) return route("message_delete_batch")
    return route("message_delete")
  }
  // Read/search verbs win over “发给”: incoming/sent mail lookup is not new mail.
  if (/找|搜|检索|看看.*发给|谁发给我|look.*(?:mail|inbox)|find.*(?:mail|email)/u.test(text)) return route("message_list", "search_start")
  if (/回复|回信|转发|reply|forward/u.test(text)) return internal ? route("send_preview") : route("draft_create")
  if (/(?:写|拟|起草).*(?:邮件|信)|(?:发|发送)(?:个|一封|封|这封)?(?:电子)?(?:邮件|信)|邮件.*(?:给|发)|\b(?:send|compose|draft)\b/u.test(text)) return newMessage()
  if (internal && /(?:发|发送).*(?:站内信)/u.test(text)) return newMessage()
  if (/第二封|这封|那封|详情/u.test(text)) return route("message_get")
  if (/收件箱|收到|未读|下一页|继续看|看.*邮件|邮件.*总结|\binbox\b/u.test(text)) return route("message_list")
  return { domain }
}

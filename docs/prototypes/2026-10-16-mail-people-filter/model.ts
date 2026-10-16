export type Box = "inbox" | "sent"
export type Party = { id: string; name: string; kind: "person" | "organization" | "system"; identity?: string }
export type Message = {
  id: string; box: Box; sender: Party; to: Party[]; cc: Party[]
  subject: string; body: string; sentAt: string; unread: boolean
}
export type Contact = Party & { unread: number; latest: string }

const me: Party = { id: "me", name: "我", kind: "person" }
const liyang: Party = { id: "liyang", name: "李杨", kind: "person", identity: "@liyang" }
const designer: Party = { id: "designer", name: "李杨", kind: "person", identity: "@liyang.design" }
const qiaona: Party = { id: "qiaona", name: "乔娜", kind: "person", identity: "@qiaona" }
const raolei: Party = { id: "raolei", name: "饶磊", kind: "person", identity: "@raolei" }
const system: Party = { id: "system", name: "Synapse", kind: "system" }
const research: Party = { id: "research", name: "研发部", kind: "organization", identity: "产品研发团队" }
const product: Party = { id: "product", name: "产品部", kind: "organization", identity: "产品研发团队" }

function inbox(id: string, sender: Party, subject: string, body: string, sentAt: string, unread = false): Message {
  return { id, box: "inbox", sender, to: [me], cc: [], subject, body, sentAt, unread }
}
function sent(id: string, to: Party[], cc: Party[], subject: string, body: string, sentAt: string): Message {
  return { id, box: "sent", sender: me, to, cc, subject, body, sentAt, unread: false }
}

// 全部为离线演示数据，不读取账号、通讯录或真实信件。
export function initialMessages(): Message[] {
  return [
    inbox("r1", liyang, "【接手留档】首页分流 IATF：根因、修复与测试复核", "首页分流 / IATF 全过程总结与接手说明\n\n本次已完成首页入口梳理、异常状态复现和测试复核。\n\n一、入口按账号权限展示，保持各角色默认首页一致。\n二、修复后的流程已完成回归，重点核对了返回操作与登录状态。\n三、后续接手请优先查看验收记录，再更新相关用例。\n\n如有新的反馈，请直接回复这封信。", "2026-10-16T10:42:00", true),
    inbox("r2", qiaona, "给你念个绕口令", "给你来一段绕口令，试试看能不能一口气念下来：\n\n四是四，十是十，十四是十四，四十是四十。\n\n忙了一上午，休息一会儿。", "2026-10-16T10:18:00", true),
    inbox("r3", raolei, "站内信侧栏建议", "现在信件多了，想从左侧直接找到某个人发来的信。\n\n如果名字后面能看到未读数，会更方便判断先看谁的消息。已发送里也希望按收件人查看。", "2026-10-16T09:56:00", true),
    inbox("r4", system, "Synapse v1.0.74 更新内容", "新增功能\n\n通知现在可以点一下就复制正文，方便把收到的信息带到当前任务中。\n\n体验改进\n\n完善了通知操作与信件跳转的状态反馈。\n\n感谢使用 Synapse。", "2026-10-16T08:30:00"),
    inbox("r5", liyang, "【更正留档】首页分流 home-route 合入说明", "核查日期：2026-10-15\n\n首页分流调整已经完成复核，请以本次更正说明为准。相关使用入口与权限保持一致。", "2026-10-15T17:40:00"),
    inbox("r6", qiaona, "界面交互稿已更新", "交互稿已按上午讨论的结论调整。\n\n侧栏保留简洁的名称和未读数，选择后在中间查看信件。请重点确认窄窗口下的操作是否顺手。", "2026-10-15T16:10:00", true),
    inbox("r7", designer, "组件对齐检查", "按钮和输入框的尺寸已对齐现有组件库。\n\n深浅主题都复用了现有 token，长名称的截断和完整名称提示也已整理。", "2026-10-15T14:20:00", true),
    inbox("r8", system, "Synapse v1.0.73 更新内容", "新增功能\n\n现在可以将一条链接发送到手机，在另一台设备继续查看。\n\n本次同时改进了站内信与通知的使用体验。", "2026-10-15T09:00:00", true),
    inbox("r9", raolei, "本周联调时间", "本周联调安排在周五下午。\n\n请提前准备需要复核的场景，重点检查搜索、分页和未读状态。", "2026-10-14T15:30:00"),
    sent("s1", [qiaona], [raolei], "侧栏方案，请确认交互", "乔娜，侧栏按发件人筛选的方案已整理。\n\n请确认人员排序和未读数展示，饶磊一起查看筛选后的批量操作范围。", "2026-10-16T11:05:00"),
    sent("s2", [research], [], "本周研发联调安排", "本周联调重点是搜索和筛选组合。\n\n请各位按当前负责的模块准备数据，并在联调后记录结果。", "2026-10-16T10:30:00"),
    sent("s3", [liyang], [], "首页分流复核结果", "首页分流已经复核，相关异常状态均能正确返回。\n\n验收记录已整理，请查收。", "2026-10-15T18:00:00"),
    sent("s4", [qiaona, raolei], [], "周五评审时间确认", "周五下午三点一起评审站内信侧栏。\n\n讨论范围：发件人、收件人、未读数，以及窄窗口下的筛选入口。", "2026-10-15T16:45:00"),
    sent("s5", [product], [raolei], "用户反馈整理", "本周收到的反馈已经整理：\n\n希望能更快找到某个人发来的历史信件；已发送也需要按收件人查找。\n\n请先确认交互，再安排开发。", "2026-10-14T17:20:00"),
    sent("s6", [qiaona], [], "回复：界面交互稿", "交互稿已看过，整体方向可以。\n\n保留现有三栏结构，侧栏名单只显示有历史信件的人。", "2026-10-14T11:20:00"),
  ]
}

export function partiesFor(message: Message): Party[] {
  return message.box === "inbox" ? [message.sender] : [...message.to, ...message.cc]
}
export function contactsFor(messages: Message[], box: Box): Contact[] {
  const contacts = new Map<string, Contact>()
  for (const message of messages.filter(item => item.box === box)) {
    for (const party of new Map(partiesFor(message).map(person => [person.id, person])).values()) {
      const current = contacts.get(party.id)
      contacts.set(party.id, { ...party, unread: (current?.unread ?? 0) + Number(message.unread), latest: current && current.latest > message.sentAt ? current.latest : message.sentAt })
    }
  }
  return [...contacts.values()].sort((a, b) => b.latest.localeCompare(a.latest) || a.id.localeCompare(b.id))
}
export function matchingMessages(messages: Message[], box: Box, partyId: string | null, query: string, unreadOnly: boolean): Message[] {
  const needle = query.trim().toLocaleLowerCase()
  return messages.filter(message => message.box === box
    && (!partyId || partiesFor(message).some(party => party.id === partyId))
    && (!unreadOnly || message.unread)
    && (!needle || `${message.subject}\n${message.body}`.toLocaleLowerCase().includes(needle)))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
}
export function partyNames(parties: Party[]): string { return parties.map(party => party.name).join("、") }
export function dateLabel(value: string): string { return `${value.slice(5, 7)}/${value.slice(8, 10)} ${value.slice(11, 16)}` }
export function unreadLabel(count: number): string { return count > 99 ? "99+" : String(count) }

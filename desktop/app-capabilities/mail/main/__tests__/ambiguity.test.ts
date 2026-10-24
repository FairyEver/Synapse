import { expect, it, onTestFinished, vi } from "vitest"
import { createMailTestRig } from "./helpers"
import { draftRig } from "./draft-fixtures"
import { syncRig, remoteHeader } from "./sync-fixtures"
import { aliyunConfig } from "../protocol/aliyun-policy"
import { MailSearch } from "../search"
import { MailSend } from "../send"
import { MailSendOperations } from "../send-reconcile"
import { MAIL_INPUT_SCHEMAS } from "../../shared/schema"
import type { StoredFolder } from "../sync"

// These exercise production services with an in-memory repository and mocked
// protocols, not an AI resolver. Question/selection expectations live in the
// Skill scenario table; a syntactically valid guessed address cannot be rejected
// by the mail service merely because the agent lacks evidence for it.
function guard<T extends Awaited<ReturnType<typeof createMailTestRig>> & {
  sync?: { dispose(): Promise<void> }; search?: { dispose(): Promise<void> }
}>(r: T): T {
  r.smtp.submit.mockRejectedValue(new Error("This regression must never submit mail"))
  onTestFinished(async () => {
    try { expect(r.smtp.submit).not.toHaveBeenCalled() }
    finally {
      await r.search?.dispose()
      await r.sync?.dispose()
      await r.close()
    }
  })
  return r
}

const configure = (r: Awaited<ReturnType<typeof createMailTestRig>>, email: string, name: string) =>
  r.accounts.configure(r.ctx, { ...aliyunConfig(email, name), credential: "fixture-only" })

it("distinguishes no accounts from one complete account, including a paused sole account", async () => {
  const r = guard(await createMailTestRig())
  expect(await r.accounts.execute(r.ctx, "account.list", { limit: 20 })).toEqual({ items: [], nextCursor: null })
  const account = await configure(r, "work@example.com", "工作邮箱")
  const only = await r.accounts.execute(r.ctx, "account.list", { limit: 20 })
  expect(only.items.map(item => item.id)).toEqual([account.id])
  expect(only.nextCursor).toBeNull()
  await r.accounts.pause(r.ctx, account.id)
  const paused = await r.accounts.execute(r.ctx, "account.list", { limit: 20 })
  expect(paused.items).toMatchObject([{ id: account.id, state: "paused" }])
  expect(paused.nextCursor).toBeNull()
})

it("exposes the second account behind a one-item page instead of implying uniqueness", async () => {
  const r = guard(await createMailTestRig())
  const a = await configure(r, "work@example.com", "工作邮箱")
  const b = await configure(r, "personal@example.com", "私人邮箱")
  const first = await r.accounts.execute(r.ctx, "account.list", { limit: 1 })
  expect(first.items).toHaveLength(1)
  expect(first.nextCursor).toBeTruthy()
  const rest = await r.accounts.execute(r.ctx, "account.list", { limit: 20, cursor: first.nextCursor! })
  expect(new Set([...first.items, ...rest.items].map(item => item.id))).toEqual(new Set([a.id, b.id]))
  expect(rest.nextCursor).toBeNull()
})

it("keeps equally named accounts distinguishable by address and ID without a fallback account", async () => {
  const r = guard(await createMailTestRig())
  const a = await configure(r, "work@example.com", "工作邮箱")
  const b = await configure(r, "other@example.com", "工作邮箱")
  const page = await r.accounts.execute(r.ctx, "account.list", { limit: 20 })
  expect(page.items.map(item => [item.name, item.email]).sort()).toEqual([
    ["工作邮箱", "other@example.com"], ["工作邮箱", "work@example.com"],
  ])
  expect(await r.accounts.get(r.ctx, b.id)).toMatchObject({ id: b.id, email: "other@example.com" })
  expect(await r.accounts.get(r.ctx, a.id)).toMatchObject({ id: a.id, email: "work@example.com" })
  await expect(r.accounts.get(r.ctx, "ma_00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "UNAVAILABLE" })
})

async function candidatesRig() {
  const r = await syncRig()
  const b = await configure(r, "personal@example.com", "私人邮箱")
  vi.mocked(r.session.select).mockResolvedValue({ uidValidity: "1", count: 3, uidNext: 4 })
  vi.mocked(r.session.searchUids).mockResolvedValue([1, 2, 3])
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({
    ...remoteHeader(uid),
    from: [{ name: "张三", address: uid === 2 ? "zhang.personal@example.com" : "zhang.work@example.com" }],
    to: [{ name: "李四", address: uid === 2 ? "li.personal@example.com" : "li.work@example.com" }],
    cc: [{ name: "旁观者", address: "bystander@example.com" }],
    subject: "王五在主题中出现，不是收发件人",
  })))
  await r.sync.runOnce(r.ctx, r.account.id)
  // Same names in a different mailbox must not leak into account A's results.
  vi.mocked(r.session.searchUids).mockResolvedValue([1])
  vi.mocked(r.session.select).mockResolvedValue({ uidValidity: "1", count: 1, uidNext: 2 })
  vi.mocked(r.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(uid => ({
    ...remoteHeader(uid), from: [{ name: "张三", address: "other.zhang@example.com" }],
    to: [{ name: "李四", address: "other.li@example.com" }],
  })))
  await r.sync.runOnce(r.ctx, b.id)
  const reader = vi.fn(async () => ({ text: "", bytes: 0, available: false }))
  return guard({ ...r, b, reader, search: new MailSearch(r.repo, reader) })
}

it.each([
  { field: "sender", name: "张三", header: "from", addresses: ["zhang.personal@example.com", "zhang.work@example.com"] },
  { field: "recipient", name: "李四", header: "to", addresses: ["li.personal@example.com", "li.work@example.com"] },
] as const)("returns all $field candidates across pages, scoped to the chosen account", async ({ field, name, header, addresses }) => {
  const r = await candidatesRig()
  const input = { accountId: r.account.id, [field]: name, limit: 1 }
  const first = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse(input))
  expect(first.items).toHaveLength(1)
  expect(first.nextCursor).toBeTruthy()
  const rest = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ ...input, limit: 20, cursor: first.nextCursor }))
  const all = [...first.items, ...rest.items]
  expect(all).toHaveLength(3)
  expect(all.every(item => item.accountId === r.account.id)).toBe(true)
  expect(all.flatMap(item => item[header].map(person => person.address)).sort()).toEqual([addresses[0], addresses[1], addresses[1]])
  expect(rest.nextCursor).toBeNull()
  expect(rest.coverage.metadataComplete).toBe(true)
  expect(r.reader).not.toHaveBeenCalled()
  expect(r.session.fetchPart).not.toHaveBeenCalled()
  await expect(r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ ...input, accountId: r.b.id, cursor: first.nextCursor }))).rejects.toMatchObject({ code: "CURSOR_EXPIRED" })
})

it("returns no candidate for absent names, subject mentions, or addresses belonging only to another account", async () => {
  const r = await candidatesRig()
  for (const filter of [{ sender: "王五" }, { recipient: "王五" }, { sender: "未出现的人" }, { sender: "other.zhang@example.com" }, { recipient: "other.li@example.com" }]) {
    const page = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, ...filter }))
    expect(page.items).toEqual([])
    expect(page.nextCursor).toBeNull()
  }
  const explicit = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.account.id, sender: "ZHANG.WORK@EXAMPLE.COM" }))
  expect(explicit.items).toHaveLength(2)
  expect(explicit.items.every(item => item.from[0].address === "zhang.work@example.com")).toBe(true)
})

it("reports incomplete coverage even when there is only one candidate or no match", async () => {
  const r = await candidatesRig()
  const folder = (await r.repo.page<StoredFolder>(r.ctx, "folders", { accountId: r.b.id })).items[0]
  await r.repo.save(r.ctx, "folders", folder.id, r.b.id, { ...folder.data, folder: { ...folder.data.folder, metadataComplete: false } }, folder.revision, folder.sortKey)
  for (const sender of ["张三", "未出现的人"]) {
    const page = await r.search.listMessages(r.ctx, MAIL_INPUT_SCHEMAS["message.list"].parse({ accountId: r.b.id, sender }))
    expect(page.items).toHaveLength(sender === "张三" ? 1 : 0)
    expect(page.nextCursor).toBeNull()
    expect(page.coverage).toMatchObject({ metadataComplete: false, reason: "metadata_indexing" })
  }
})

function previewService(r: Awaited<ReturnType<typeof draftRig>>) {
  return new MailSend(r.repo, r.accounts, r.assets, r.drafts, new MailSendOperations(r.repo, r.accounts, r.assets, r.drafts))
}

it.each(["reply", "reply_all", "forward"] as const)("rejects %s across source accounts before reading a body or creating a draft", async mode => {
  const r = guard(await draftRig())
  const b = await configure(r, "personal@example.com", "私人邮箱")
  await expect(r.drafts.execute(r.ctx, "draft.create", { accountId: b.id, sourceMessageId: r.source.id, mode, forwardMode: "inline" })).rejects.toMatchObject({ code: "UNAVAILABLE" })
  expect(r.session.fetchPart).not.toHaveBeenCalled()
  for (const accountId of [r.account.id, b.id]) expect((await r.drafts.execute(r.ctx, "draft.list", { accountId, limit: 20 })).items).toEqual([])
})

it.each(["reply", "reply_all", "forward"] as const)("preserves the source account through %s, edits and preview with two accounts configured", async mode => {
  const r = guard(await draftRig())
  const b = await configure(r, "personal@example.com", "私人邮箱")
  let draft = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, sourceMessageId: r.source.id, mode, forwardMode: "inline" })
  if (mode === "forward") {
    expect(draft.to).toEqual([])
    await expect(previewService(r).preview(r.ctx, { draftId: draft.id, expectedRevision: draft.revision })).rejects.toMatchObject({ code: "NO_RECIPIENTS" })
    draft = await r.drafts.execute(r.ctx, "draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { to: [{ address: "chosen@example.com" }] } })
  } else expect(draft.to[0].address).toBe("reply@example.com")
  draft = await r.drafts.execute(r.ctx, "draft.update", { draftId: draft.id, expectedRevision: draft.revision, patch: { subject: "仅测试草稿", text: "fixture edit" } })
  // Accessing B must not act as a global current-account switch for an A draft.
  await r.accounts.get(r.ctx, b.id)
  vi.mocked(r.protocols.smtp).mockClear()
  const preview = await previewService(r).preview(r.ctx, { draftId: draft.id, expectedRevision: draft.revision })
  expect(preview.from.address).toBe("me@example.com")
  expect(preview.draft).toMatchObject({ accountId: r.account.id, id: draft.id, revision: draft.revision, state: "editing", to: draft.to })
  expect((await r.drafts.execute(r.ctx, "draft.list", { accountId: b.id, limit: 20 })).items).toEqual([])
  expect(r.protocols.smtp).not.toHaveBeenCalled()
  expect(r.session.append).not.toHaveBeenCalled()
})

it("does not accept names as addresses, missing account IDs, or draft account reassignment", async () => {
  const r = guard(await draftRig())
  const content = { accountId: r.account.id, to: [{ address: "chosen@example.com" }], subject: "fixture", text: "fixture" }
  expect(MAIL_INPUT_SCHEMAS["draft.create"].safeParse({ ...content, accountId: undefined }).success).toBe(false)
  expect(MAIL_INPUT_SCHEMAS["draft.create"].safeParse({ ...content, to: [{ name: "张三" }] }).success).toBe(false)
  expect(MAIL_INPUT_SCHEMAS["draft.create"].safeParse({ ...content, to: [{ address: "张三" }] }).success).toBe(false)
  const draft = await r.drafts.execute(r.ctx, "draft.create", MAIL_INPUT_SCHEMAS["draft.create"].parse(content))
  const b = await configure(r, "personal@example.com", "私人邮箱")
  expect(MAIL_INPUT_SCHEMAS["draft.update"].safeParse({ draftId: draft.id, expectedRevision: draft.revision, patch: { accountId: b.id } }).success).toBe(false)
  expect(await r.drafts.execute(r.ctx, "draft.get", { draftId: draft.id })).toMatchObject({ accountId: r.account.id, revision: draft.revision })
  const preview = await previewService(r).preview(r.ctx, { draftId: draft.id, expectedRevision: draft.revision })
  expect(preview.from.address).toBe("me@example.com")
  expect(preview.draft.to).toEqual([{ address: "chosen@example.com" }])
})

it("invalidates cached account/message/draft IDs after the Synapse identity changes", async () => {
  const r = guard(await draftRig())
  const draft = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, sourceMessageId: r.source.id, mode: "reply", forwardMode: "inline" })
  r.setOwner("another-fixture-owner")
  await expect(r.accounts.get(r.ctx, r.account.id)).rejects.toMatchObject({ name: "AbortError" })
  const ctx = r.context.current("mcp")
  expect(await r.accounts.execute(ctx, "account.list", { limit: 20 })).toEqual({ items: [], nextCursor: null })
  await expect(r.accounts.get(ctx, r.account.id)).rejects.toMatchObject({ code: "UNAVAILABLE" })
  await expect(r.repo.get(ctx, "messages", r.source.id)).rejects.toMatchObject({ code: "UNAVAILABLE" })
  await expect(r.drafts.execute(ctx, "draft.get", { draftId: draft.id })).rejects.toMatchObject({ code: "UNAVAILABLE" })
})

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { MAIL_ENTITIES } from "../../../electron/runtime/data-repo/schemas/mail"
import { accountConfigSchema, accountIdSchema, accountSummarySchema, MAIL_INPUT_SCHEMAS, revisionSchema } from "../shared/schema"
import { MailError, type AccountAction, type AccountConfig, type AccountSummary, type MailContext, type MailInputs, type MailResults } from "../shared/types"
import { MailRepository } from "./repository"
import { MailContextProvider } from "./context"
import type { MailAccess } from "./assets"
import { normalizeProtocolError, type MailProtocols } from "./protocol/types"

export const configureAccountSchema = accountConfigSchema.extend({ credential: z.string().min(1).max(4096), accountId: accountIdSchema.optional(), expectedRevision: revisionSchema.optional() }).strict()
  .refine(v => (v.accountId === undefined) === (v.expectedRevision === undefined), "Existing account requires its revision")
export interface StoredAccount extends Record<string, unknown> {
  config: AccountConfig; credentialId: string; paused: boolean; state: AccountSummary["state"]; errorCode: string | null; capabilities: string[]
}
export interface MailAccountLifecycle {
  start(ctx: MailContext, accountId: string): Promise<{ jobId: string }>
  stop(ctx: MailContext, accountId: string): Promise<void>
  remove(ctx: MailContext, accountId: string): Promise<void>
  open?(ctx: MailContext, accountId?: string): Promise<void>
}
export class MailAccounts {
  private readonly queues = new Map<string, Promise<void>>()
  constructor(private readonly repo: MailRepository, readonly context: MailContextProvider, readonly protocols: MailProtocols, private readonly access: MailAccess, private readonly lifecycle: MailAccountLifecycle) {}

  async exclusive<T>(ctx: MailContext, accountId: string, task: () => Promise<T>): Promise<T> {
    const key = `${ctx.ownerId}:${accountId}`
    const result = (this.queues.get(key) ?? Promise.resolve()).then(() => { this.context.assertCurrent(ctx); return task() })
    const tail = result.then(() => undefined, () => undefined)
    this.queues.set(key, tail)
    return result.finally(() => { if (this.queues.get(key) === tail) this.queues.delete(key) })
  }
  async get(ctx: MailContext, id: string): Promise<AccountSummary> {
    const row = await this.repo.get<StoredAccount>(ctx, "accounts", id)
    return accountSummarySchema.parse({ ...row.data.config, id: row.id, revision: row.revision, paused: row.data.paused, state: row.data.state, errorCode: row.data.errorCode, capabilities: row.data.capabilities })
  }
  async credential(ctx: MailContext, accountId: string, checkingConnection = false): Promise<{ config: AccountConfig; credential: string }> {
    const row = await this.repo.get<StoredAccount>(ctx, "accounts", accountId)
    if (row.data.state === "unverified" && !checkingConnection) throw new MailError("CONNECTION_CHECK_REQUIRED", "请先检查修改后的邮箱连接")
    await this.access(ctx, "secret.read", accountId)
    const secret = await this.repo.get<{ credential: string }>(ctx, "credentials", row.data.credentialId)
    if (typeof secret.data.credential !== "string") throw new MailError("CREDENTIAL_UNAVAILABLE", "请重新配置邮箱密码")
    return { config: accountConfigSchema.parse(row.data.config), credential: secret.data.credential }
  }

  private async check(ctx: MailContext, config: AccountConfig, credential: string): Promise<MailResults["account.inspect"]> {
    const imap = (async () => {
      try {
        const session = await this.protocols.imap(ctx, config, credential)
        await session.close()
        return { ok: true, code: null }
      } catch (error) { return { ok: false, code: normalizeProtocolError(error).code } }
    })()
    const smtp = (async () => {
      try {
        const session = await this.protocols.smtp(ctx, config, credential)
        try { await session.verify(ctx.signal) } finally { session.close() }
        return { ok: true, code: null }
      } catch (error) { return { ok: false, code: normalizeProtocolError(error).code } }
    })()
    const checks = { imap: await imap, smtp: await smtp }
    this.context.assertCurrent(ctx)
    return checks
  }

  async configure(ctx: MailContext, input: z.input<typeof configureAccountSchema>): Promise<AccountSummary> {
    const parsed = configureAccountSchema.parse(input)
    const accountId = parsed.accountId ?? `ma_${randomUUID()}`
    return this.exclusive(ctx, accountId, async () => {
      const previous = parsed.accountId ? await this.repo.get<StoredAccount>(ctx, "accounts", accountId) : null
      if (previous && previous.revision !== parsed.expectedRevision) throw new MailError("VERSION_CONFLICT", "邮箱配置已变化")
      await this.access(ctx, "secret.write", accountId)
      const config = accountConfigSchema.parse(Object.fromEntries(Object.entries(parsed).filter(([k]) => !["credential", "accountId", "expectedRevision"].includes(k))))
      const checks = await this.check(ctx, config, parsed.credential)
      if (!checks.imap.ok || !checks.smtp.ok) throw new MailError("CONNECTION_CHECK_FAILED", "邮箱连接检查失败", checks)
      await this.lifecycle.stop(ctx, accountId)
      const credentialId = `mc_${randomUUID()}`
      // Immutable credential generation: a failed config commit cannot overwrite the previous secret.
      await this.repo.save(ctx, "credentials", credentialId, accountId, { credential: parsed.credential, createdAt: new Date().toISOString() }, 0)
      const data: StoredAccount = { config, credentialId, paused: false, state: "connected", errorCode: null, capabilities: ["imap", "smtp", "local-search"] }
      await this.repo.save(ctx, "accounts", accountId, accountId, data, previous?.revision ?? 0)
      await this.lifecycle.start(ctx, accountId)
      return this.get(ctx, accountId)
    })
  }

  async inspect(ctx: MailContext, id: string): Promise<MailResults["account.inspect"]> {
    return this.exclusive(ctx, id, async () => {
      const { config, credential } = await this.credential(ctx, id, true)
      const checks = await this.check(ctx, config, credential)
      const row = await this.repo.get<StoredAccount>(ctx, "accounts", id)
      const code = checks.imap.code ?? checks.smtp.code
      await this.repo.save(ctx, "accounts", id, id, { ...row.data, state: code === "AUTH_FAILED" ? "auth_failed" : code ? "error" : row.data.paused ? "paused" : "connected", errorCode: code }, row.revision)
      return checks
    })
  }
  async pause(ctx: MailContext, id: string): Promise<AccountSummary> {
    return this.exclusive(ctx, id, async () => {
      await this.lifecycle.stop(ctx, id)
      const row = await this.repo.get<StoredAccount>(ctx, "accounts", id)
      await this.repo.save(ctx, "accounts", id, id, { ...row.data, paused: true, state: "paused" }, row.revision)
      return this.get(ctx, id)
    })
  }
  async update(ctx: MailContext, input: MailInputs["account.update"]): Promise<AccountSummary> {
    return this.exclusive(ctx, input.accountId, async () => {
      const row = await this.repo.get<StoredAccount>(ctx, "accounts", input.accountId)
      if (row.revision !== input.expectedRevision) throw new MailError("VERSION_CONFLICT", "邮箱配置已变化")
      const config = accountConfigSchema.parse({ ...row.data.config, ...input.patch })
      const revalidate = Object.keys(input.patch).some(k => ["imap", "smtp", "email", "username", "smtpUsername", "provider"].includes(k))
      if (revalidate) await this.lifecycle.stop(ctx, input.accountId)
      await this.repo.save(ctx, "accounts", row.id, row.id, { ...row.data, config, ...(revalidate ? { state: "unverified" as const, errorCode: null } : {}) }, row.revision)
      return this.get(ctx, row.id)
    })
  }
  async resume(ctx: MailContext, id: string): Promise<{ jobId: string }> {
    const checks = await this.inspect(ctx, id)
    if (!checks.imap.ok || !checks.smtp.ok) throw new MailError("CONNECTION_CHECK_FAILED", "请先修复邮箱连接", checks)
    return this.exclusive(ctx, id, async () => {
      const row = await this.repo.get<StoredAccount>(ctx, "accounts", id)
      await this.repo.save(ctx, "accounts", id, id, { ...row.data, paused: false, state: "connected", errorCode: null }, row.revision)
      return this.lifecycle.start(ctx, id)
    })
  }

  async remove(ctx: MailContext, input: MailInputs["account.delete"]): Promise<{ success: boolean }> {
    return this.exclusive(ctx, input.accountId, async () => {
      const row = await this.repo.get<StoredAccount>(ctx, "accounts", input.accountId)
      if (row.revision !== input.expectedRevision) throw new MailError("VERSION_CONFLICT", "邮箱配置已变化")
      let drafts = 0, unknown = 0
      for (const entity of ["drafts", "operations"] as const) {
        let cursor: string | undefined
        do {
          const page = await this.repo.page(ctx, entity, { accountId: row.id, cursor, limit: 100 })
          for (const record of page.items) {
            if (entity === "drafts" && record.data.state !== "consumed") drafts++
            if (entity === "operations" && ["submitting", "unknown"].includes(String(record.data.state))) unknown++
          }
          cursor = page.nextCursor ?? undefined
        } while (cursor)
      }
      if ((drafts && !input.discardLocalDrafts) || (unknown && !input.acknowledgeUnknownOperations)) throw new MailError("REMOVAL_REVIEW_REQUIRED", "此邮箱仍有草稿或发送结果待核验", { drafts, unknown })
      await this.access(ctx, "secret.read", row.id)
      await this.access(ctx, "secret.write", row.id)
      await this.lifecycle.stop(ctx, row.id)
      await this.lifecycle.remove(ctx, row.id)
      for (const entity of MAIL_ENTITIES.filter(e => e !== "accounts" && e !== "credentials")) {
        let cursor: string | undefined
        do {
          const page = await this.repo.page(ctx, entity, { accountId: row.id, cursor, limit: 100 })
          for (const record of page.items) {
            if (entity === "operations") await this.repo.save(ctx, entity, record.id, row.id, { kind: "removed-account", state: record.data.state ?? "unknown" }, record.revision, record.sortKey)
            else await this.repo.remove(ctx, entity, record.id, record.revision)
          }
          cursor = page.nextCursor ?? undefined
        } while (cursor)
      }
      const credentials = await this.repo.storage.namespace("app.mail.credentials").list({ ownerId: ctx.ownerId, accountId: row.id })
      for (const secret of credentials) await this.repo.remove(ctx, "credentials", (secret as { id: string }).id)
      await this.repo.remove(ctx, "accounts", row.id, row.revision)
      return { success: true }
    })
  }

  async recoverCredentials(ctx: MailContext): Promise<number> {
    await this.access(ctx, "secret.read", "mail-credential-maintenance")
    const referenced = new Set<string>()
    let cursor: string | undefined
    do {
      const page = await this.repo.page<StoredAccount>(ctx, "accounts", { cursor, limit: 100 })
      for (const row of page.items) referenced.add(row.data.credentialId)
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    const credentials = await this.repo.storage.namespace<{ id: string; ownerId: string; data: { createdAt: string } }>("app.mail.credentials").list({ ownerId: ctx.ownerId })
    let removed = 0
    for (const row of credentials) {
      if (!referenced.has(row.id) && Date.now() - Date.parse(row.data.createdAt) > 24 * 60 * 60_000) {
        await this.access(ctx, "secret.write", row.id)
        await this.repo.remove(ctx, "credentials", row.id)
        removed++
      }
    }
    return removed
  }

  async execute<K extends AccountAction>(ctx: MailContext, action: K, input: MailInputs[K]): Promise<MailResults[K]> {
    let result: unknown
    switch (action) {
      case "account.list": {
        const params = MAIL_INPUT_SCHEMAS["account.list"].parse(input)
        const page = await this.repo.page<StoredAccount>(ctx, "accounts", params)
        result = { items: await Promise.all(page.items.map(r => this.get(ctx, r.id))), nextCursor: page.nextCursor }; break
      }
      case "account.get": result = await this.get(ctx, MAIL_INPUT_SCHEMAS["account.get"].parse(input).accountId); break
      case "account.open": {
        const params = MAIL_INPUT_SCHEMAS["account.open"].parse(input)
        if (params.accountId) await this.get(ctx, params.accountId)
        if (!this.lifecycle.open) throw new MailError("UNAVAILABLE", "邮箱配置界面尚不可用")
        await this.lifecycle.open(ctx, params.accountId); result = { success: true }; break
      }
      case "account.update": result = await this.update(ctx, MAIL_INPUT_SCHEMAS["account.update"].parse(input)); break
      case "account.inspect": result = await this.inspect(ctx, MAIL_INPUT_SCHEMAS["account.inspect"].parse(input).accountId); break
      case "account.pause": result = await this.pause(ctx, MAIL_INPUT_SCHEMAS["account.pause"].parse(input).accountId); break
      case "account.resume": result = await this.resume(ctx, MAIL_INPUT_SCHEMAS["account.resume"].parse(input).accountId); break
      case "account.delete": result = await this.remove(ctx, MAIL_INPUT_SCHEMAS["account.delete"].parse(input)); break
    }
    return result as MailResults[K]
  }
}

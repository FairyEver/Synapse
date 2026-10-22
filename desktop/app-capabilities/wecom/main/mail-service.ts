import { WecomCliError } from "./cli-client"
import type { WecomConnectionService } from "./connection-service"
import { WECOM_MAIL_READ_PERMISSION } from "../shared/capability"
import type {
  WecomMailDetail,
  WecomMailGetInput,
  WecomMailPerson,
  WecomMailSearchInput,
  WecomMailSearchResult,
  WecomMailSendInput,
  WecomMailSendResult,
  WecomMailSummary,
} from "../shared/mail-schema"

export type WecomMailServiceDeps = {
  readonly connection: WecomConnectionService
}

export class WecomMailService {
  constructor(private readonly deps: WecomMailServiceDeps) {}

  async list(input: WecomMailSearchInput): Promise<WecomMailSearchResult> {
    return this.deps.connection.withConnected(async ({ ownerUserId, client, signal }) => {
      const keywords = input.query?.trim().split(/\s+/u).filter(Boolean).slice(0, 10)
      const output = await client.run(ownerUserId, ["mail", "search", "--json", JSON.stringify({
        folder_names: ["收件箱"],
        ...(keywords?.length ? { keywords } : {}),
        ...(input.cursor ? { cursor: input.cursor } : {}),
        limit: input.limit ?? 50,
      })], {
        abortSignal: signal,
        metadata: { operation: "mail.list" },
      })
      const body = parseJsonObject(output)
      const mails = Array.isArray(body.mails) ? body.mails : []
      return {
        items: mails.map(normalizeSummary).filter((item): item is WecomMailSummary => item !== null),
        nextCursor: typeof body.next_cursor === "string" && body.next_cursor ? body.next_cursor : null,
        hasMore: body.has_more === true,
      }
    })
  }

  async get(input: WecomMailGetInput): Promise<WecomMailDetail> {
    return this.deps.connection.withConnected(async ({ ownerUserId, client, signal }) => {
      const output = await client.run(ownerUserId, ["mail", "get", "--json", JSON.stringify({
        mail_ids: [input.mailId],
      })], {
        abortSignal: signal,
        metadata: { operation: "mail.get" },
      })
      const body = parseJsonObject(output)
      const first = Array.isArray(body.mail_list) ? body.mail_list[0] : null
      if (!isRecord(first)) throw new WecomCliError("invalid_response", "企业微信返回了无效的邮件内容。")
      if (typeof first.errcode === "number" && first.errcode !== 0) {
        throw commandErrorFromRecord(first)
      }

      let content = typeof first.content === "string" ? first.content : ""
      if (!content && typeof first.file_path === "string") {
        content = await client.readGeneratedText(ownerUserId, first.file_path)
      }

      return {
        mailId: input.mailId,
        subject: stringValue(first.subject),
        sendTime: stringValue(first.send_time),
        sender: normalizePerson(first.sender),
        receivers: normalizePeople(first.to),
        isRead: true,
        folderName: stringValue(first.folder_name) || undefined,
        content,
        to: normalizePeople(first.to),
        cc: normalizePeople(first.cc),
        bcc: normalizePeople(first.bcc),
        attachments: normalizeAttachments(first.attachments),
      }
    })
  }

  async send(input: WecomMailSendInput): Promise<WecomMailSendResult> {
    await this.deps.connection.withConnected(async ({ ownerUserId, client, signal }) => {
      await client.withTemporaryText(ownerUserId, "mail-body", input.body, async (filePath) => {
        const body: Record<string, unknown> = {
          to: { emails: input.to },
          ...(input.cc?.length ? { cc: { emails: input.cc } } : {}),
          ...(input.bcc?.length ? { bcc: { emails: input.bcc } } : {}),
          subject: input.subject,
          file_path: filePath,
          content_type: "markdown",
          ...(input.replyToMailId
            ? { reply: { last_mail_id: input.replyToMailId, reply_all: input.replyAll === true } }
            : {}),
        }
        await client.run(ownerUserId, ["mail", "send", "--json", JSON.stringify(body)], {
          abortSignal: signal,
          metadata: { operation: input.replyToMailId ? "mail.reply" : "mail.send" },
        })
      })
    })
    return { ok: true }
  }
}

function commandErrorFromRecord(value: Record<string, unknown>): WecomCliError {
  const errcode = typeof value.errcode === "number" ? value.errcode : undefined
  const permissionDenied = errcode === 851008
  return new WecomCliError(
    permissionDenied ? "permission_denied" : errcode === 853004 ? "auth_required" : "command_failed",
    stringValue(value.help_message).split("\n")[0] || stringValue(value.errmsg) || "企业微信操作失败，请重试。",
    {
      ...(errcode === undefined ? {} : { errcode }),
      ...(permissionDenied ? { permission: WECOM_MAIL_READ_PERMISSION } : {}),
    },
  )
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed)) return parsed
  } catch {
    // Fall through to a stable user-facing error.
  }
  throw new WecomCliError("invalid_response", "企业微信返回了无效数据。")
}

function normalizeSummary(value: unknown): WecomMailSummary | null {
  if (!isRecord(value) || typeof value.mail_id !== "string" || !value.mail_id) return null
  return {
    mailId: value.mail_id,
    subject: stringValue(value.subject),
    sendTime: stringValue(value.send_time),
    sender: normalizePerson(value.sender),
    receivers: normalizePeople(value.receivers),
    isRead: value.is_read === true,
    folderName: stringValue(value.folder_name) || undefined,
  }
}

function normalizePerson(value: unknown): WecomMailPerson {
  if (!isRecord(value)) return { name: "", email: "" }
  return {
    name: stringValue(value.name),
    email: stringValue(value.email),
  }
}

function normalizePeople(value: unknown): WecomMailPerson[] {
  return Array.isArray(value) ? value.map(normalizePerson).filter((person) => person.email) : []
}

function normalizeAttachments(value: unknown): Array<{ name: string; size?: number }> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.name !== "string") return []
    return [{
      name: item.name,
      ...(typeof item.size === "number" && Number.isSafeInteger(item.size) && item.size >= 0 ? { size: item.size } : {}),
    }]
  })
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

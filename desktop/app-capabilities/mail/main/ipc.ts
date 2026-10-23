import { z } from "zod"
import type { IpcModule, IpcMethodDescriptor, IpcHandlerContext } from "../../../electron/runtime/ipc/types"
import { MAIL_SERVICE_ID } from "../shared/manifest"
import { MAIL_MAX_IMAGE_BYTES } from "../shared/limits"
import { configureAccountSchema, type ConfigureAccount } from "../shared/private-schema"
import { MAIL_INPUT_SCHEMAS, accountIdSchema, messageIdSchema, assetIdSchema } from "../shared/schema"
import type { MailAction, MailInputs } from "../shared/types"
import { mailFailure } from "./dispatcher"
import type { MailService } from "./service"
function privateMethod<S extends z.ZodType>(request: S, run: (service: MailService, input: z.output<S>, ctx: IpcHandlerContext) => unknown): Omit<IpcMethodDescriptor, "operationId"> {
  return { kind: "invoke", request, maxResponseBytes: 16 * 1024 * 1024, async handler(ctx, input) {
    try { return { ok: true, data: await run(ctx.resolve<MailService>(MAIL_SERVICE_ID), request.parse(input), ctx) } }
    catch (error) { return { ok: false, failure: mailFailure(error) } }
  } }
}
function method<K extends MailAction>(action: K): Omit<IpcMethodDescriptor, "operationId"> {
  return privateMethod(MAIL_INPUT_SCHEMAS[action], (service, input) => service.execute(service.context("ui"), action, input as MailInputs[K]))
}
export const mailIpcModule: IpcModule = { id: "mail", methods: {
  accountList: { ...method("account.list"), operationId: "app.mail.account.list" },
  accountGet: { ...method("account.get"), operationId: "app.mail.account.get" },
  accountOpen: { ...method("account.open"), operationId: "app.mail.account.open" },
  accountUpdate: { ...method("account.update"), operationId: "app.mail.account.update" },
  accountInspect: { ...method("account.inspect"), operationId: "app.mail.account.inspect" },
  accountPause: { ...method("account.pause"), operationId: "app.mail.account.pause" },
  accountResume: { ...method("account.resume"), operationId: "app.mail.account.resume" },
  accountDelete: { ...method("account.delete"), operationId: "app.mail.account.delete" },
  folderList: { ...method("folder.list"), operationId: "app.mail.folder.list" },
  folderCreate: { ...method("folder.create"), operationId: "app.mail.folder.create" },
  folderRename: { ...method("folder.rename"), operationId: "app.mail.folder.rename" },
  folderDelete: { ...method("folder.delete"), operationId: "app.mail.folder.delete" },
  folderUpdate: { ...method("folder.update"), operationId: "app.mail.folder.update" },
  syncStart: { ...method("sync.start"), operationId: "app.mail.sync.start" },
  syncGet: { ...method("sync.get"), operationId: "app.mail.sync.get" },
  syncCancel: { ...method("sync.cancel"), operationId: "app.mail.sync.cancel" },
  messageList: { ...method("message.list"), operationId: "app.mail.message.list" },
  messageGet: { ...method("message.get"), operationId: "app.mail.message.get" },
  messageCount: { ...method("message.count"), operationId: "app.mail.message.count" },
  messageUpdate: { ...method("message.update"), operationId: "app.mail.message.update" },
  messageMove: { ...method("message.move"), operationId: "app.mail.message.move" },
  messageDelete: { ...method("message.delete"), operationId: "app.mail.message.delete" },
  messageRestore: { ...method("message.restore"), operationId: "app.mail.message.restore" },
  searchStart: { ...method("search.start"), operationId: "app.mail.search.start" },
  searchGet: { ...method("search.get"), operationId: "app.mail.search.get" },
  searchResume: { ...method("search.resume"), operationId: "app.mail.search.resume" },
  searchCancel: { ...method("search.cancel"), operationId: "app.mail.search.cancel" },
  draftList: { ...method("draft.list"), operationId: "app.mail.draft.list" },
  draftGet: { ...method("draft.get"), operationId: "app.mail.draft.get" },
  draftCreate: { ...method("draft.create"), operationId: "app.mail.draft.create" },
  draftUpdate: { ...method("draft.update"), operationId: "app.mail.draft.update" },
  draftDelete: { ...method("draft.delete"), operationId: "app.mail.draft.delete" },
  attachmentImportLocal: { ...method("attachment.import_local"), operationId: "app.mail.attachment.import_local" },
  attachmentList: { ...method("attachment.list"), operationId: "app.mail.attachment.list" },
  attachmentGet: { ...method("attachment.get"), operationId: "app.mail.attachment.get" },
  attachmentDownloadFile: { ...method("attachment.download_file"), operationId: "app.mail.attachment.download_file" },
  attachmentDelete: { ...method("attachment.delete"), operationId: "app.mail.attachment.delete" },
  messageExtractToFile: { ...method("message.extract_to_file"), operationId: "app.mail.message.extract_to_file" },
  bodyReadChunk: { ...method("body.read_chunk"), operationId: "app.mail.body.read_chunk" },
  sendPreview: { ...method("send.preview"), operationId: "app.mail.send.preview" },
  messageSend: { ...method("message.send"), operationId: "app.mail.message.send" },
  operationList: { ...method("operation.list"), operationId: "app.mail.operation.list" },
  operationGet: { ...method("operation.get"), operationId: "app.mail.operation.get" },
  cacheClear: { ...method("cache.clear"), operationId: "app.mail.cache.clear" },
  accountConfigure: { ...privateMethod(configureAccountSchema, (s, i) => s.configure(i as ConfigureAccount)), operationId: "app.mail.account.configure" },
  uiScope: { ...privateMethod(z.object({}).strict(), (s, _i, c) => s.scope(c.sender)), operationId: "app.mail.ui.scope" },
  imageGrant: { ...privateMethod(z.object({ messageId: messageIdSchema, assetId: assetIdSchema }).strict(), (s, i) => s.imageGrant(i.messageId, i.assetId)), operationId: "app.mail.image.grant" },
  imageRead: { ...privateMethod(z.object({ messageId: messageIdSchema, token: z.uuid() }).strict(), (s, i) => s.imageRead(i.messageId, i.token)), operationId: "app.mail.image.read" },
  imageRemote: { ...privateMethod(z.object({ messageId: messageIdSchema, url: z.string().max(8192), allowed: z.literal(true) }).strict(), (s, i) => s.imageRemote(i.messageId, i.url, i.allowed)), operationId: "app.mail.image.remote" },
  imageImport: { ...privateMethod(z.object({ accountId: accountIdSchema, base64: z.string().max(Math.ceil(MAIL_MAX_IMAGE_BYTES / 3) * 4) }).strict(), (s, i) => s.importImage(i.accountId, i.base64)), operationId: "app.mail.image.import" },
  pickAttachments: { ...privateMethod(z.object({ accountId: accountIdSchema }).strict(), (s, i) => s.pickAttachments(i.accountId)), operationId: "app.mail.attachment.pick" },
  saveAttachment: { ...privateMethod(z.object({ assetId: assetIdSchema }).strict(), (s, i) => s.saveAttachment(i.assetId)), operationId: "app.mail.attachment.save" },
}, events: {} }

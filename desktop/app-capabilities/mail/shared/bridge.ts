import type { MailArguments, MailResults, MailAsset } from "./types"
import type { AccountSummary } from "./types"
import type { ConfigureAccount, MailScope, MailChanged } from "./private-schema"
export type MailIpcResult<T> = { ok: true; data: T } | { ok: false; failure: { code: string; message: string; details?: Readonly<Record<string, unknown>> } }
export interface MailBridge {
  accountList(input: MailArguments["account.list"]): Promise<MailResults["account.list"]>
  accountGet(input: MailArguments["account.get"]): Promise<MailResults["account.get"]>
  accountOpen(input: MailArguments["account.open"]): Promise<MailResults["account.open"]>
  accountUpdate(input: MailArguments["account.update"]): Promise<MailResults["account.update"]>
  accountInspect(input: MailArguments["account.inspect"]): Promise<MailResults["account.inspect"]>
  accountPause(input: MailArguments["account.pause"]): Promise<MailResults["account.pause"]>
  accountResume(input: MailArguments["account.resume"]): Promise<MailResults["account.resume"]>
  accountDelete(input: MailArguments["account.delete"]): Promise<MailResults["account.delete"]>
  folderList(input: MailArguments["folder.list"]): Promise<MailResults["folder.list"]>
  folderCreate(input: MailArguments["folder.create"]): Promise<MailResults["folder.create"]>
  folderRename(input: MailArguments["folder.rename"]): Promise<MailResults["folder.rename"]>
  folderDelete(input: MailArguments["folder.delete"]): Promise<MailResults["folder.delete"]>
  folderUpdate(input: MailArguments["folder.update"]): Promise<MailResults["folder.update"]>
  syncStart(input: MailArguments["sync.start"]): Promise<MailResults["sync.start"]>
  syncGet(input: MailArguments["sync.get"]): Promise<MailResults["sync.get"]>
  syncCancel(input: MailArguments["sync.cancel"]): Promise<MailResults["sync.cancel"]>
  messageList(input: MailArguments["message.list"]): Promise<MailResults["message.list"]>
  messageGet(input: MailArguments["message.get"]): Promise<MailResults["message.get"]>
  messageCount(input: MailArguments["message.count"]): Promise<MailResults["message.count"]>
  messageUpdate(input: MailArguments["message.update"]): Promise<MailResults["message.update"]>
  messageMove(input: MailArguments["message.move"]): Promise<MailResults["message.move"]>
  messageDelete(input: MailArguments["message.delete"]): Promise<MailResults["message.delete"]>
  messageRestore(input: MailArguments["message.restore"]): Promise<MailResults["message.restore"]>
  searchStart(input: MailArguments["search.start"]): Promise<MailResults["search.start"]>
  searchGet(input: MailArguments["search.get"]): Promise<MailResults["search.get"]>
  searchResume(input: MailArguments["search.resume"]): Promise<MailResults["search.resume"]>
  searchCancel(input: MailArguments["search.cancel"]): Promise<MailResults["search.cancel"]>
  draftList(input: MailArguments["draft.list"]): Promise<MailResults["draft.list"]>
  draftGet(input: MailArguments["draft.get"]): Promise<MailResults["draft.get"]>
  draftCreate(input: MailArguments["draft.create"]): Promise<MailResults["draft.create"]>
  draftUpdate(input: MailArguments["draft.update"]): Promise<MailResults["draft.update"]>
  draftDelete(input: MailArguments["draft.delete"]): Promise<MailResults["draft.delete"]>
  attachmentImportLocal(input: MailArguments["attachment.import_local"]): Promise<MailResults["attachment.import_local"]>
  attachmentList(input: MailArguments["attachment.list"]): Promise<MailResults["attachment.list"]>
  attachmentGet(input: MailArguments["attachment.get"]): Promise<MailResults["attachment.get"]>
  attachmentDownloadFile(input: MailArguments["attachment.download_file"]): Promise<MailResults["attachment.download_file"]>
  attachmentDelete(input: MailArguments["attachment.delete"]): Promise<MailResults["attachment.delete"]>
  messageExtractToFile(input: MailArguments["message.extract_to_file"]): Promise<MailResults["message.extract_to_file"]>
  bodyReadChunk(input: MailArguments["body.read_chunk"]): Promise<MailResults["body.read_chunk"]>
  sendPreview(input: MailArguments["send.preview"]): Promise<MailResults["send.preview"]>
  messageSend(input: MailArguments["message.send"]): Promise<MailResults["message.send"]>
  operationList(input: MailArguments["operation.list"]): Promise<MailResults["operation.list"]>
  operationGet(input: MailArguments["operation.get"]): Promise<MailResults["operation.get"]>
  cacheClear(input: MailArguments["cache.clear"]): Promise<MailResults["cache.clear"]>
  accountConfigure(input: ConfigureAccount): Promise<AccountSummary>
  uiScope(): Promise<MailScope>
  imageGrant(input: { messageId: string; assetId: string }): Promise<{ token: string }>
  draftImageAsset(input: { draftId: string; assetId: string }): Promise<{ mime: string; base64: string }>
  imageRead(input: { messageId: string; token: string }): Promise<{ mime: string; base64: string }>
  imageRemote(input: { messageId: string; url: string; allowed: true }): Promise<{ token: string; assetId: string }>
  imageImport(input: { accountId: string; base64: string }): Promise<MailAsset>
  pickAttachments(input: { accountId: string }): Promise<MailAsset[]>
  saveAttachment(input: { assetId: string }): Promise<MailResults["attachment.download_file"] | null>
  onChanged(listener: (event: MailChanged) => void): () => void
}
export function createMailBridge(invoke: <T>(channel: string, input: unknown) => Promise<T>, subscribe: MailBridge["onChanged"]): MailBridge {
  async function call<T>(action: string, input: unknown): Promise<T> {
    const result = await invoke<MailIpcResult<T>>(`synapse:app:mail:${action.replaceAll(".", ":")}`, input)
    if (!result.ok) throw Object.assign(new Error(result.failure.message), result.failure)
    return result.data
  }
  return {
    accountList: input => call("account.list", input),
    accountGet: input => call("account.get", input),
    accountOpen: input => call("account.open", input),
    accountUpdate: input => call("account.update", input),
    accountInspect: input => call("account.inspect", input),
    accountPause: input => call("account.pause", input),
    accountResume: input => call("account.resume", input),
    accountDelete: input => call("account.delete", input),
    folderList: input => call("folder.list", input),
    folderCreate: input => call("folder.create", input),
    folderRename: input => call("folder.rename", input),
    folderDelete: input => call("folder.delete", input),
    folderUpdate: input => call("folder.update", input),
    syncStart: input => call("sync.start", input),
    syncGet: input => call("sync.get", input),
    syncCancel: input => call("sync.cancel", input),
    messageList: input => call("message.list", input),
    messageGet: input => call("message.get", input),
    messageCount: input => call("message.count", input),
    messageUpdate: input => call("message.update", input),
    messageMove: input => call("message.move", input),
    messageDelete: input => call("message.delete", input),
    messageRestore: input => call("message.restore", input),
    searchStart: input => call("search.start", input),
    searchGet: input => call("search.get", input),
    searchResume: input => call("search.resume", input),
    searchCancel: input => call("search.cancel", input),
    draftList: input => call("draft.list", input),
    draftGet: input => call("draft.get", input),
    draftCreate: input => call("draft.create", input),
    draftUpdate: input => call("draft.update", input),
    draftDelete: input => call("draft.delete", input),
    attachmentImportLocal: input => call("attachment.import_local", input),
    attachmentList: input => call("attachment.list", input),
    attachmentGet: input => call("attachment.get", input),
    attachmentDownloadFile: input => call("attachment.download_file", input),
    attachmentDelete: input => call("attachment.delete", input),
    messageExtractToFile: input => call("message.extract_to_file", input),
    bodyReadChunk: input => call("body.read_chunk", input),
    sendPreview: input => call("send.preview", input),
    messageSend: input => call("message.send", input),
    operationList: input => call("operation.list", input),
    operationGet: input => call("operation.get", input),
    cacheClear: input => call("cache.clear", input),
    accountConfigure: input => call("account.configure", input),
    uiScope: () => call("ui.scope", {}),
    imageGrant: input => call("image.grant", input),
    draftImageAsset: input => call("draft.image_asset", input),
    imageRead: input => call("image.read", input),
    imageRemote: input => call("image.remote", input),
    imageImport: input => call("image.import", input),
    pickAttachments: input => call("attachment.pick", input),
    saveAttachment: input => call("attachment.save", input),
    onChanged: subscribe,
  }
}

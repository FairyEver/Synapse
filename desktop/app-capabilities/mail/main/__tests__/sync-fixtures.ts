import { vi } from "vitest"
import { createMailTestRig } from "./helpers"
import { aliyunConfig } from "../protocol/aliyun-policy"
import { MailSync } from "../sync"
import type { RemoteHeader } from "../protocol/types"

export const remoteHeader = (uid: number): RemoteHeader => ({ uid, subject: `Mail ${uid}`, from: [{ address: "from@example.com" }], to: [], cc: [], replyTo: [], date: null, size: 100, flags: [], messageId: `<${uid}@example.com>`, references: [], structure: null })
export async function syncRig(provider: "aliyun" | "custom" = "aliyun") {
  const rig = await createMailTestRig()
  const account = await rig.accounts.configure(rig.ctx, { ...aliyunConfig("me@example.com", "Work"), provider, credential: "secret" })
  vi.mocked(rig.session.listFolders).mockResolvedValue([{ path: "INBOX", name: "INBOX", delimiter: "/", flags: [], specialUse: null, count: 251 }])
  vi.mocked(rig.session.select).mockResolvedValue({ uidValidity: "1", count: 251, uidNext: 252 })
  vi.mocked(rig.session.searchUids).mockResolvedValue(Array.from({ length: 251 }, (_, i) => i + 1))
  vi.mocked(rig.session.fetchHeaders).mockImplementation(async (_path, uids) => uids.map(remoteHeader))
  vi.mocked(rig.session.fetchFlags).mockImplementation(async (_path, uids) => uids.map(uid => ({ uid, flags: [] })))
  const changed = vi.fn(), delta = vi.fn(), error = vi.fn()
  const sync = new MailSync(rig.repo, rig.accounts, { changed, inbox: delta, error })
  return { ...rig, account, sync, changed, delta, error }
}


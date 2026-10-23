import { Readable } from "node:stream"
import { expect, it } from "vitest"
import { draftRig } from "./draft-fixtures"
import { compileDraftMime } from "../mime-compose"
it("keeps Bcc only in the SMTP envelope and emits actual image types for owned CID assets", async () => {
  const r = await draftRig()
  try {
    const asset = await r.assets.put(r.ctx, Readable.from([Buffer.from("89504e470d0a1a0a", "hex")]), { accountId: r.account.id, name: "pasted.png", mime: "application/octet-stream" })
    const draft = await r.drafts.execute(r.ctx, "draft.create", { accountId: r.account.id, to: [{ address: "visible@example.com" }], cc: [], bcc: [{ address: "hidden@example.com" }], subject: "Picture", html: '<p><img src="cid:owned@synapse.local"></p>', text: "Picture", assetIds: [], inlineImages: [{ assetId: asset.id, cid: "owned@synapse.local" }] })
    const mime = await compileDraftMime(r.ctx, draft, r.assets, { from: "me@example.com", messageId: "<fixed@synapse.local>", date: draft.updatedAt, inReplyTo: null, references: [], keepBcc: false })
    expect(mime.to).toEqual(["visible@example.com", "hidden@example.com"])
    expect(mime.raw.toString()).not.toContain("hidden@example.com")
    expect(mime.raw.toString()).toContain("Content-Type: image/png")
    expect(mime.raw.toString()).toContain("Content-ID: <owned@synapse.local>")
  } finally { await r.sync.dispose(); await r.close() }
})

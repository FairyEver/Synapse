import type { NativeImage } from "electron"
import type { AgentAttachmentRef } from "../../../src/types/agent-attachment"
import type { AgentRuntimeService } from "../../services/agent-runtime"

export type ClipboardAttachmentResult = {
  readonly attachments: readonly { readonly sourceIndex: number; readonly ref: AgentAttachmentRef }[]
  readonly rejectedCount: number
}

export class AgentClipboardAttachmentService {
  constructor(private readonly readImage: () => NativeImage) {}

  async stage(
    agent: AgentRuntimeService,
    input: { readonly draftScopeId: string; readonly name?: string },
  ): Promise<ClipboardAttachmentResult> {
    const image = this.readImage()
    if (image.isEmpty()) return { attachments: [], rejectedCount: 1 }
    const staged = await agent.stageAttachmentBytes({
      actor: { kind: "user", id: "renderer" },
      draftScopeId: input.draftScopeId,
      attachments: [{
        kind: "image",
        name: input.name ?? "clipboard.png",
        mimeType: "image/png",
        data: image.toPNG(),
      }],
    })
    const attachment = staged[0]
    return attachment
      ? { attachments: [{ sourceIndex: 0, ref: attachment.ref }], rejectedCount: 0 }
      : { attachments: [], rejectedCount: 1 }
  }
}

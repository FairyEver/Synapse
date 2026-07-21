import { describe, expect, it } from "vitest"
import { DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID } from "../../shared/capability"
import { documentTextExtractNodeManifest } from "../manifest"

describe("documentTextExtractNodeManifest", () => {
  it("declares one control input, one text output, and one read-only file dependency", () => {
    expect(documentTextExtractNodeManifest).toMatchObject({
      type: "document_text_extract",
      title: "文档文本提取",
      ports: {
        inputs: [{ id: "in", label: "输入" }],
        outputs: [{ id: "out", label: "文本" }],
      },
      share: {
        selfContained: false,
        capability: {
          id: DOCUMENT_TEXT_EXTRACTOR_CAPABILITY_ID,
          minVersion: "1.0.0",
          installSourceId: "synapse.builtin",
        },
        resources: [{
          path: ["filePath"],
          entryType: "file",
          cardinality: "one",
          access: "read",
        }],
      },
    })
    expect(documentTextExtractNodeManifest.share).not.toHaveProperty("models")
    expect(documentTextExtractNodeManifest.share).not.toHaveProperty("projects")
    expect(documentTextExtractNodeManifest.share).not.toHaveProperty("sensitive")
    expect(documentTextExtractNodeManifest.share).not.toHaveProperty("runtimes")
  })
})

import { describe, expect, it } from "vitest"
import { TEXT_EXTRACTOR_CAPABILITY_ID } from "../../shared/capability"
import { textExtractNodeManifest } from "../manifest"

describe("textExtractNodeManifest", () => {
  it("declares one control input, one text output, and one read-only file dependency", () => {
    expect(textExtractNodeManifest).toMatchObject({
      type: "text_extract",
      title: "文本提取",
      ports: {
        inputs: [{ id: "in", label: "输入" }],
        outputs: [{ id: "out", label: "文本" }],
      },
      share: {
        selfContained: false,
        capability: {
          id: TEXT_EXTRACTOR_CAPABILITY_ID,
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
    expect(textExtractNodeManifest.share).not.toHaveProperty("models")
    expect(textExtractNodeManifest.share).not.toHaveProperty("projects")
    expect(textExtractNodeManifest.share).not.toHaveProperty("sensitive")
    expect(textExtractNodeManifest.share).not.toHaveProperty("runtimes")
  })
})

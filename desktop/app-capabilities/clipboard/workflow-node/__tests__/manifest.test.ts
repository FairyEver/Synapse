import { describe, expect, it } from "vitest"
import {
  clipboardTextReadNodeManifest,
  clipboardTextWriteNodeManifest,
} from "../manifest"

describe("Clipboard Workflow manifests", () => {
  it("declares the minimal stable node contracts", () => {
    expect(clipboardTextReadNodeManifest).toMatchObject({
      type: "clipboard_text_read",
      title: "读取剪贴板",
      defaultConfig: {},
      publicOutputs: ["text"],
      ports: {
        inputs: [{ id: "in", label: "输入" }],
        outputs: [{ id: "out", label: "文本" }],
      },
      share: {
        selfContained: false,
        capability: {
          id: "app.clipboard.text.read",
          minVersion: "1.0.0",
          installSourceId: "synapse.builtin",
        },
        risks: [{ path: [], id: "clipboard.read", when: "always" }],
      },
    })
    expect(clipboardTextWriteNodeManifest).toMatchObject({
      type: "clipboard_text_write",
      title: "写入剪贴板",
      publicOutputs: ["success"],
      ports: {
        inputs: [{ id: "in", label: "输入" }],
        outputs: [{ id: "out", label: "结果" }],
      },
      share: {
        selfContained: false,
        capability: {
          id: "app.clipboard.text.write",
          minVersion: "1.0.0",
          installSourceId: "synapse.builtin",
        },
        sensitive: [{ path: ["text"] }],
        risks: [{ path: [], id: "clipboard.write", when: "always" }],
      },
    })
    expect(clipboardTextReadNodeManifest.cardSummary({})).toEqual({
      title: "读取剪贴板",
      subtitle: "",
    })
    expect(clipboardTextWriteNodeManifest.cardSummary({ text: "secret", variables: [] }))
      .toEqual({ title: "写入剪贴板", subtitle: "" })
  })
})

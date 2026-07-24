import { describe, expect, it } from "vitest"
import { jsonRepairNodeManifest } from "../manifest"

describe("JSON repair workflow manifest", () => {
  it("declares the stable node identity, ports, and capability-only share contract", () => {
    expect(jsonRepairNodeManifest).toMatchObject({
      type: "json_repair_text_repair",
      title: "JSON 修复",
      ports: {
        inputs: [{ id: "in", label: "输入" }],
        outputs: [{ id: "out", label: "JSON" }],
      },
      share: {
        selfContained: false,
        capability: {
          id: "app.json_repair.text.repair",
          minVersion: "1.0.0",
          installSourceId: "synapse.builtin",
        },
      },
    })
    expect(jsonRepairNodeManifest.share).not.toHaveProperty("resources")
    expect(jsonRepairNodeManifest.share).not.toHaveProperty("sensitive")
    expect(jsonRepairNodeManifest.share).not.toHaveProperty("risks")
  })
})

import { describe, expect, it } from "vitest"

import { openFileNodeManifest } from "../manifest"

describe("openFileNodeManifest", () => {
  it("declares the native capability, external file dependency, and shell risk", () => {
    expect(openFileNodeManifest.share).toEqual({
      selfContained: false,
      capability: {
        id: "workflow.node.open_file",
        minVersion: "1.0.0",
        installSourceId: "synapse.builtin",
      },
      resources: [{
        path: ["filePath"],
        entryType: "file",
        cardinality: "one",
        access: "read",
      }],
      risks: [{ path: ["filePath"], id: "shell.execute", when: "present" }],
    })
  })
})

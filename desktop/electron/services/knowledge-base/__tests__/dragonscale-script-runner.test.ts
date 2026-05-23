import { describe, expect, it, vi } from "vitest"

import { DragonScaleScriptRunner } from "../dragonscale/script-runner"

describe("DragonScaleScriptRunner", () => {
  it("passes the vault root through SYNAPSE_KB_VAULT_ROOT", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }))
    const runner = new DragonScaleScriptRunner({
      scriptsRoot: "/Applications/Synapse/resources/knowledge-base/dragonscale/upstream",
      run,
    })

    await runner.run("allocate-address.sh", { vaultPath: "/Users/example/kb", args: ["--peek"] })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      command: "/Applications/Synapse/resources/knowledge-base/dragonscale/upstream/allocate-address.sh",
      args: ["--peek"],
      env: expect.objectContaining({
        SYNAPSE_KB_VAULT_ROOT: "/Users/example/kb",
      }),
    }))
  })

  it("rejects script names outside the allowlist", async () => {
    const run = vi.fn()
    const runner = new DragonScaleScriptRunner({
      scriptsRoot: "/Applications/Synapse/resources/knowledge-base/dragonscale/upstream",
      run,
    })

    await expect(runner.run("../evil.sh", { vaultPath: "/Users/example/kb", args: [] }))
      .rejects.toThrow("Unsupported DragonScale script")
  })
})

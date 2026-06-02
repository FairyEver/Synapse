import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"

describe("RepoIdRecoveryDialog validation timing", () => {
  it("does not show ID format errors on every input change", async () => {
    const source = await readFile(
      new URL("../repo-id-recovery-dialog.tsx", import.meta.url),
      "utf8",
    )

    expect(source).toContain("onBlur={() => setError(validateUserIdInput(value))}")
    expect(source).toContain("if (error) setError(validateUserIdInput(nextValue))")
    expect(source).not.toContain("setError(validateUserIdInput(event.target.value))")
  })
})

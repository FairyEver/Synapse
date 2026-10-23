import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { expect, it } from "vitest"

it("runs the runtime fingerprint and post-build ordering regression gates in the desktop suite", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--test",
    "scripts/checks/__tests__/electron-runtime.test.mjs",
    "scripts/checks/__tests__/mac-package.test.mjs",
  ])
  expect(stdout).toContain("# fail 0")
})

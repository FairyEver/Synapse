import { describe, expect, it } from "vitest"
import { formatAutomationLaunchOutput } from "../automation-launch-output"

describe("automation launch presentation", () => {
  it("renders multiline commands as text while escaping terminal control sequences", () => {
    const output = formatAutomationLaunchOutput("/tmp/a\x1b[2J", "echo first\nnode task.js --token=private-value\x07")
    expect(output).toContain("/tmp/a\\x1b[2J")
    expect(output).toContain("echo first\r\nnode task.js")
    expect(output).not.toContain("private-value")
    expect(output).not.toContain("\x1b")
    expect(output).not.toContain("\x07")
  })
})

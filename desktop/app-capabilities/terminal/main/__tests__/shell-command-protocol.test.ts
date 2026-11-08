import { describe, expect, it } from "vitest"
import { createShellReceiptDecoder } from "../shell-command-protocol"

const token = "a".repeat(32)
const frame = (pid = 123, sequence = 1, code = 0, key = token) => `\x1b]777;SynapseShell;${key};${pid};${sequence};${code}\x07`
describe("native shell receipts", () => {
  it("does not explode a styled prompt into thousands of parser tasks", () => {
    const decoder = createShellReceiptDecoder(token, () => 123)
    const styled = "\x1b[32mword\x1b[0m".repeat(1000)
    expect(decoder.push(styled)).toEqual([{ type: "output", data: styled }])
  })
  it("accepts only bound PID/token frames and leaves real terminal bytes unchanged across every split", () => {
    const input = "\x1b[32mPROMPT> " + frame() + "\x1b[0mcommand\r\nOUTPUT" + frame(123, 2, 7)
    for (let split = 0; split <= input.length; split++) {
      const decoder = createShellReceiptDecoder(token, () => 123)
      const events = [...decoder.push(input.slice(0, split)), ...decoder.push(input.slice(split))]
      expect(events.filter(event => event.type === "output").map(event => event.data).join("")).toBe("\x1b[32mPROMPT> \x1b[0mcommand\r\nOUTPUT")
      expect(events.filter(event => event.type === "prompt")).toEqual([{ type: "prompt", sequence: 1, exitCode: 0 }, { type: "prompt", sequence: 2, exitCode: 7 }])
    }
  })
  it("rejects forged, nested, duplicate, oversized and invalid-status receipts without leaking protocol tokens", () => {
    const decoder = createShellReceiptDecoder(token, () => 123)
    const events = decoder.push(frame(999) + frame(123, 1, 0, "b".repeat(32)) + frame() + frame() + frame(123, 2, 999) + "\x1b]777;SynapseShell;" + "x".repeat(5000))
    events.push(...decoder.push("\x07visible"))
    expect(events.filter(event => event.type === "prompt")).toHaveLength(1)
    expect(events.filter(event => event.type === "output").map(event => event.data).join("")).toBe("visible")
  })
})

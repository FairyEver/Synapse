import { createHash, randomUUID } from "node:crypto"
import { readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { claudeHookCommand } from "../../../app-capabilities/terminal/main/agent-notification-runtime"

/** Temporary IPC only: no prompt, digest or credentials are written into the receipt. */
const SUBMISSION_HOOK = String.raw`
const fs = require("node:fs")
const crypto = require("node:crypto")
let input = ""
let overflow = false
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => {
  if (input.length + chunk.length > 1048576) { overflow = true; return }
  input += chunk
})
process.stdin.on("end", () => {
  if (overflow) return
  try {
    const payload = JSON.parse(input)
    if (payload.hook_event_name !== "UserPromptSubmit" || typeof payload.prompt !== "string") return
    const expected = process.env.SYNAPSE_CLAUDE_PROMPT_DIGEST
    if (!expected || crypto.createHash("sha256").update(payload.prompt).digest("hex") !== expected) return
    const token = process.env.SYNAPSE_CLAUDE_PROMPT_TOKEN
    const target = process.env.SYNAPSE_CLAUDE_PROMPT_RECEIPT
    if (!token || !target) return
    fs.writeFileSync(target, JSON.stringify({ token, event: "UserPromptSubmit" }), { mode: 0o600, flag: "wx" })
  } catch (error) {
    // A receipt failure must not block the user's CLI; the caller reports missing confirmation.
    process.exitCode = 0
  }
})
setTimeout(() => process.exit(0), 3000).unref()
`

export async function prepareClaudeCodePromptSubmission(input: {
  readonly directory: string
  readonly nodePath: string
  readonly prompt: string
  readonly signal: AbortSignal
}) {
  input.signal.throwIfAborted()
  const hookPath = path.join(input.directory, "prompt-submitted.cjs")
  const receiptPath = path.join(input.directory, "prompt-submitted.json")
  const token = randomUUID()
  await writeFile(hookPath, SUBMISSION_HOOK, { mode: 0o600 })
  let resolve!: () => void
  let reject!: (reason: unknown) => void
  let settled = false
  let reading = false
  const completion = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  // Launch can fail before wait() is reached. Keep cancellation rejection observed meanwhile.
  void completion.catch(() => undefined)
  const finish = (error?: unknown) => {
    if (settled) return
    settled = true
    clearInterval(timer)
    input.signal.removeEventListener("abort", aborted)
    if (error) reject(error)
    else resolve()
  }
  const aborted = () => finish(input.signal.reason)
  async function checkReceipt() {
    if (settled) return
    try {
      if ((await stat(receiptPath)).size > 1024) return
      const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>
      if (receipt.token === token && receipt.event === "UserPromptSubmit") finish()
    } catch (error) {
      // A not-yet-created or partially written receipt is not a submission acknowledgement.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) finish(error)
    }
  }
  const timer = setInterval(() => {
    if (reading || settled) return
    reading = true
    void (async () => {
      try { await checkReceipt() } finally { reading = false }
    })()
  }, 50)
  input.signal.addEventListener("abort", aborted, { once: true })
  if (input.signal.aborted) aborted()
  return {
    hook: { matcher: "", hooks: [{ type: "command", command: claudeHookCommand(input.nodePath, hookPath, "UserPromptSubmit"), timeout: 5 }] },
    environment: {
      SYNAPSE_CLAUDE_PROMPT_DIGEST: createHash("sha256").update(input.prompt).digest("hex"),
      SYNAPSE_CLAUDE_PROMPT_TOKEN: token,
      SYNAPSE_CLAUDE_PROMPT_RECEIPT: receiptPath,
    },
    wait: () => completion,
    ended: async () => {
      // A synchronous CLI Hook may have written the acknowledgement just before exit.
      await checkReceipt()
      finish(new Error("Claude Code 已退出，未确认提示词提交。"))
    },
    dispose: () => { clearInterval(timer); input.signal.removeEventListener("abort", aborted) },
  }
}

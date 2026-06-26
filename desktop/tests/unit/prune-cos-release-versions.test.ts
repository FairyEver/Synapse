import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, "../..")
const scriptPath = path.join(desktopRoot, "scripts/release/prune-cos-release-versions.mjs")

async function writeFakeCoscli(dir: string): Promise<string> {
  const coscliPath = path.join(dir, "fake-coscli.mjs")
  const commandLogPath = path.join(dir, "commands.jsonl")
  await writeFile(coscliPath, [
    "#!/usr/bin/env node",
    "import { appendFileSync } from 'node:fs'",
    "const logPath = process.env.SYNAPSE_FAKE_COSCLI_LOG",
    "const args = process.argv.slice(2)",
    "appendFileSync(logPath, `${JSON.stringify(args)}\\n`)",
    "if (args[0] === 'ls') {",
    "  process.stdout.write([",
    "    'KEY | TYPE | LAST MODIFIED | ETAG | SIZE | RESTORESTATUS',",
    "    'v0.2.8/ | DIR | | | |',",
    "    'v0.2.9/ | DIR | | | |',",
    "    'v0.2.10/ | DIR | | | |',",
    "    'v0.2.11/ | DIR | | | |',",
    "    'v0.2.12/ | DIR | | | |',",
    "    'latest.yml | STANDARD | 2026-06-25T12:00:00+08:00 | etag | 120 B |',",
    "    'notes.txt | STANDARD | 2026-06-25T12:00:00+08:00 | etag | 10 B |',",
    "    'TOTAL OBJECTS: | 7',",
    "    ''",
    "  ].join('\\n'))",
    "  process.exit(0)",
    "}",
    "if (args[0] === 'cat') {",
    "  const target = args[1]",
    "  if (target.endsWith('/latest.yml')) {",
    "    process.stdout.write('version: 0.2.9\\npath: v0.2.9/Synapse-0.2.9-win-x64.exe\\n')",
    "    process.exit(0)",
    "  }",
    "  if (target.endsWith('/latest-windows.yml')) {",
    "    process.stdout.write('version: 0.2.12\\npath: v0.2.12/Synapse-0.2.12-win-x64.exe\\n')",
    "    process.exit(0)",
    "  }",
    "  if (target.endsWith('/latest-mac.yml')) {",
    "    process.stdout.write('version: 0.2.10\\nfiles:\\n  - url: v0.2.10/Synapse-0.2.10-mac-arm64.zip\\n')",
    "    process.exit(0)",
    "  }",
    "  process.exit(2)",
    "}",
    "if (args[0] === 'rm') {",
    "  process.exit(0)",
    "}",
    "process.exit(3)",
    "",
  ].join("\n"), { mode: 0o755 })
  await writeFile(commandLogPath, "")
  return coscliPath
}

async function readCommands(logPath: string): Promise<string[][]> {
  const content = await readFile(logPath, "utf8")
  return content.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[])
}

describe("prune-cos-release-versions", () => {
  it("keeps the latest three semver directories and metadata-referenced versions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-prune-cos-"))
    await mkdir(root, { recursive: true })
    const coscli = await writeFakeCoscli(root)
    const logPath = path.join(root, "commands.jsonl")

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--coscli",
      coscli,
      "--cos-config",
      path.join(root, "cos.yaml"),
      "--dry-run",
    ], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        SYNAPSE_FAKE_COSCLI_LOG: logPath,
      },
    })

    expect(stdout).toContain("Found COS release versions: v0.2.8, v0.2.9, v0.2.10, v0.2.11, v0.2.12")
    expect(stdout).toContain("Keeping COS release versions: v0.2.9, v0.2.10, v0.2.11, v0.2.12")
    expect(stdout).toContain("Would delete COS release versions: v0.2.8")

    const commands = await readCommands(logPath)
    expect(commands).toContainEqual(["ls", "cos://release/", "--limit", "-1", "-c", path.join(root, "cos.yaml")])
    expect(commands).toContainEqual(["cat", "cos://release/latest.yml", "-c", path.join(root, "cos.yaml")])
    expect(commands).toContainEqual(["cat", "cos://release/latest-windows.yml", "-c", path.join(root, "cos.yaml")])
    expect(commands).toContainEqual(["cat", "cos://release/latest-mac.yml", "-c", path.join(root, "cos.yaml")])
    expect(commands.some((command) => command[0] === "rm")).toBe(false)
  })

  it("deletes only prunable version directories outside the keep set", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-prune-cos-delete-"))
    const coscli = await writeFakeCoscli(root)
    const logPath = path.join(root, "commands.jsonl")

    const { stdout } = await execFileAsync(process.execPath, [
      scriptPath,
      "--coscli",
      coscli,
      "--cos-config",
      path.join(root, "cos.yaml"),
    ], {
      cwd: desktopRoot,
      env: {
        ...process.env,
        SYNAPSE_FAKE_COSCLI_LOG: logPath,
      },
    })

    expect(stdout).toContain("Deleted COS release versions: v0.2.8")

    const commands = await readCommands(logPath)
    expect(commands.filter((command) => command[0] === "rm")).toEqual([
      ["rm", "cos://release/v0.2.8/", "-r", "-f", "-c", path.join(root, "cos.yaml")],
    ])
  })
})

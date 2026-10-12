import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"

const workspace = resolve(import.meta.dirname, "../../..")
const { scripts } = JSON.parse(readFileSync(resolve(workspace, "package.json"), "utf8")) as { scripts: Record<string, string> }

describe("combined workspace development", () => {
  it.each([
    ["dev", "dev:desktop"],
    ["dev:prod", "dev:desktop:prod"],
  ])("%s config starts the desktop, server and document through their supported entries", (entry, desktopEntry) => {
    const args = scripts[entry].split(/\s+/u)
    expect(args.slice(0, 4)).toEqual(["pnpm", "exec", "dekit", "mprocs"])
    const configIndex = args.indexOf("--config")
    expect(configIndex).toBeGreaterThan(0)
    const config = parse(readFileSync(resolve(workspace, args[configIndex + 1]), "utf8")) as { procs: Record<string, { cmd: string[] }> }
    const commands = Object.values(config.procs).map((proc) => proc.cmd)
    expect(commands).toEqual([
      ["pnpm", "run", desktopEntry],
      ["pnpm", "run", "dev:server"],
      ["pnpm", "run", "dev:document"],
    ])
    for (const command of commands) expect(scripts[command[2]]).toBeTruthy()
  })
})

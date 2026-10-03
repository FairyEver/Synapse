import { readFile, writeFile } from "node:fs/promises"

// TS is the authoring source. Generate only this new block; older constants are unchanged.
const source = await readFile(new URL("../src/mobile-workspace-files.ts", import.meta.url), "utf8")
const version = source.match(/export const MOBILE_WORKSPACE_FILES_VERSION = (\d+)/)?.[1]
const match = source.match(/export const MOBILE_WORKSPACE_FILES_LIMITS = (\{[\s\S]*?\}) as const/)
if (!version || !match || !/^[\s\w:,*{}]+$/.test(match[1])) throw new Error("Invalid workspace file constants declaration")
const target = new URL("../src/mobile-live-constants.cjs", import.meta.url)
const original = await readFile(target, "utf8")
const marker = "/** Generated workspace read budgets; edit mobile-workspace-files.ts. */"
const before = original.split(marker)[0].trimEnd()
const generated = `${before}\n\n${marker}\nexports.MOBILE_WORKSPACE_FILES_VERSION = ${version}\nexports.MOBILE_WORKSPACE_FILES_LIMITS = ${match[1]}\n`
if (original !== generated) await writeFile(target, generated)

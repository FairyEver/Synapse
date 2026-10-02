import { copyFile, readFile, writeFile } from "node:fs/promises"
import ts from "typescript"

// Preserve the Electron entrypoint while keeping one authored source for both module formats.
const source = await readFile(new URL("../src/notifications.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  fileName: "notifications.ts",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
})

await writeFile(new URL("../dist/notification-constants.cjs", import.meta.url), outputText)
await copyFile(
  new URL("../dist/notifications.d.ts", import.meta.url),
  new URL("../dist/notification-constants.d.cts", import.meta.url),
)

import { copyFile, readFile, writeFile } from "node:fs/promises"
import ts from "typescript"

// Renderer uses native ESM; Electron keeps the existing CommonJS subpath.
const source = await readFile(new URL("../src/drive-sync-constants.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  fileName: "drive-sync-constants.ts",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
})

await writeFile(new URL("../dist/drive-sync-constants.cjs", import.meta.url), outputText)
await copyFile(
  new URL("../dist/drive-sync-constants.d.ts", import.meta.url),
  new URL("../dist/drive-sync-constants.d.cts", import.meta.url),
)

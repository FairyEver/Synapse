import { copyFile, readFile, writeFile } from "node:fs/promises"
import ts from "typescript"
const source = await readFile(new URL("../src/game.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  fileName: "game.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
await writeFile(new URL("../dist/game-contracts.cjs", import.meta.url), outputText)
await copyFile(
  new URL("../dist/game.d.ts", import.meta.url),
  new URL("../dist/game-contracts.d.cts", import.meta.url),
)

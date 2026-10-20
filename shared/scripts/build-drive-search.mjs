import { copyFile, readFile, writeFile } from "node:fs/promises"
import ts from "typescript"

// 搜索规则只包含纯函数和常量；Electron 与 Renderer 共用同一份源码。
const source = await readFile(new URL("../src/drive-search.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  fileName: "drive-search.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
await writeFile(new URL("../dist/drive-search.cjs", import.meta.url), outputText)
await copyFile(new URL("../dist/drive-search.d.ts", import.meta.url), new URL("../dist/drive-search.d.cts", import.meta.url))

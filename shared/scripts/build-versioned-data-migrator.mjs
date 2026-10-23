import { copyFile, readFile, writeFile } from "node:fs/promises"
import ts from "typescript"

// 迁移器共用一份源码，Renderer 使用 ESM，Electron 保留 CommonJS 子入口。
const source = await readFile(new URL("../src/versioned-data-migrator.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, {
  fileName: "versioned-data-migrator.ts",
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
})
await writeFile(new URL("../dist/versioned-data-migrator.cjs", import.meta.url), outputText)
await copyFile(new URL("../dist/versioned-data-migrator.d.ts", import.meta.url), new URL("../dist/versioned-data-migrator.d.cts", import.meta.url))

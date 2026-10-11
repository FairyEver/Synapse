import { copyFile, readFile, writeFile } from "node:fs/promises"
import ts from "typescript"
const source = await readFile(new URL("../src/todos.ts", import.meta.url), "utf8")
const { outputText } = ts.transpileModule(source, { fileName: "todos.ts", compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
await writeFile(new URL("../dist/todo-contracts.cjs", import.meta.url), outputText)
await copyFile(new URL("../dist/todos.d.ts", import.meta.url), new URL("../dist/todo-contracts.d.cts", import.meta.url))

import { readFile, writeFile } from "node:fs/promises"
import ts from "typescript"

const entries = ["cloud-table-contracts", "skill-hub-contracts", "skill-hub-frontmatter", "archive-package-node", "skill-hub-package-node", "custom-apps", "tunnel-contracts"]
const rewrite = (source) => source.replace(/"\.\/([a-z-]+)\.js"/g, (original, name) =>
  entries.includes(name) ? `"./${name}.cjs"` : original,
)
for (const name of entries) {
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    fileName: `${name}.ts`,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  const declaration = await readFile(new URL(`../dist/${name}.d.ts`, import.meta.url), "utf8")
  await writeFile(new URL(`../dist/${name}.cjs`, import.meta.url), rewrite(outputText))
  await writeFile(new URL(`../dist/${name}.d.cts`, import.meta.url), rewrite(declaration))
}

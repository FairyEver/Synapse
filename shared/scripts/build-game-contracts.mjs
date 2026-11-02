import { readFile, writeFile } from "node:fs/promises"
import ts from "typescript"
const entries = [
  ["game", "game-contracts"], ["game-ui", "game-ui"],
  ["game-poker-chips", "game-poker-chips"],
  ["game-poker-cards", "game-poker-cards"], ["game-reserve", "game-reserve"], ["game-poker-card-schemas", "game-poker-card-schemas"],
  ["game-response-schemas", "game-response-schemas"], ["game-poker-response-schemas", "game-poker-response-schemas"],
]
for (const [sourceName, outputName] of entries) {
  const source = await readFile(new URL(`../src/${sourceName}.ts`, import.meta.url), "utf8")
  const { outputText } = ts.transpileModule(source, {
    fileName: `${sourceName}.ts`,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  })
  const commonjs = outputText.replace(/require\("\.\/(game(?:-[a-z-]+)?)\.js"\)/g,
    (_match, name) => `require("./${name === "game" ? "game-contracts" : name}.cjs")`)
  await writeFile(new URL(`../dist/${outputName}.cjs`, import.meta.url), commonjs)
  const declaration = await readFile(new URL(`../dist/${sourceName}.d.ts`, import.meta.url), "utf8")
  await writeFile(new URL(`../dist/${outputName}.d.cts`, import.meta.url),
    declaration.replace(/"\.\/(game(?:-[a-z-]+)?)\.js"/g,
      (_match, name) => `"./${name === "game" ? "game-contracts" : name}.cjs"`))
}

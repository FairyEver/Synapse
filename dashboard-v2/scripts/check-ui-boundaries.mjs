import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
const root = fileURLToPath(new URL('../', import.meta.url))
const violations = []
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) { await inspect(filename); continue }
    if (!/\.[cm]?[jt]sx?$/u.test(entry.name)) continue
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node) => {
      let specifier
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0].text
      if (specifier && /(?:components\/ui(?:\/|$)|game-center\/ui(?:\/|$)|@radix-ui\/|^sonner$|(?:^|\/)dashboard\/|@synapse\/desktop)/u.test(specifier)) violations.push(`${path.relative(root, filename)}: ${specifier}`)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}
await inspect(path.join(root, 'src'))
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
for (const name of Object.keys(manifest.dependencies ?? {})) if (/^(?:@radix-ui\/|sonner$|cmdk$|class-variance-authority$|tw-animate-css$)/u.test(name)) violations.push(`package.json: ${name}`)
const styles = await readFile(path.join(root, 'src/styles/globals.css'), 'utf8')
if (!styles.startsWith('@import "tailwindcss";\n@import "@heroui/styles";')) violations.push('globals.css: HeroUI import order')
for (const html of ['index.html', 'admin.html', 'game.html', 'desktop-update.html']) if (!(await readFile(path.join(root, html), 'utf8')).includes('data-theme="light"')) violations.push(`${html}: fixed light theme missing`)
if (violations.length) { process.stderr.write(`${violations.join('\n')}\n`); process.exitCode = 1 }
else process.stdout.write('V2 UI boundaries: direct HeroUI components, independent source graph, fixed light theme.\n')

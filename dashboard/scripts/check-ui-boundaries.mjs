import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import ts from 'typescript'
const root = fileURLToPath(new URL('../', import.meta.url))
const violations = []
const surfaceFieldComponents = new Set(['Input', 'TextArea', 'InputGroup', 'InputOTP', 'SearchField', 'Select', 'ComboBox', 'NumberField', 'Checkbox', 'RadioGroup', 'PasswordInput'])
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) { await inspect(filename); continue }
    if (!/\.[cm]?[jt]sx?$/u.test(entry.name)) continue
    const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true)
    const isProduct = !/\.(?:test|browser)\.[jt]sx?$/u.test(entry.name)
    const heroComponents = new Map()
    const iconNames = new Set()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const binding of bindings.elements) {
        if (statement.moduleSpecifier.text === '@heroui/react') heroComponents.set(binding.name.text, binding.propertyName?.text ?? binding.name.text)
        if (statement.moduleSpecifier.text.endsWith('/password-input') && (binding.propertyName?.text ?? binding.name.text) === 'PasswordInput') heroComponents.set(binding.name.text, 'PasswordInput')
        if (statement.moduleSpecifier.text === 'lucide-react') iconNames.add(binding.name.text)
      }
    }
    const tag = (node) => !node ? '' : ts.isJsxElement(node) ? node.openingElement.tagName.getText(source) : ts.isJsxSelfClosingElement(node) ? node.tagName.getText(source) : ''
    const attributes = (node) => (ts.isJsxElement(node) ? node.openingElement : node)?.attributes?.properties ?? []
    const attribute = (node, name) => attributes(node).find((item) => ts.isJsxAttribute(item) && item.name.getText(source) === name)?.initializer
    const isOnWhiteSurface = (node) => {
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (!ts.isJsxElement(parent)) continue
        const classes = attribute(parent, 'className')?.getText(source) ?? ''
        // The nearest painted background wins, including reader panels inside overlays.
        if (/\bbg-(?:background|surface-secondary|surface-tertiary)\b/u.test(classes)) return false
        if (/\bbg-(?:surface|overlay)(?=[\s'"`]|$)/u.test(classes)) return true
        const [parentRoot, parentSlot] = tag(parent).split('.')
        const owner = heroComponents.get(parentRoot)
        if (['Card', 'Surface'].includes(owner) && !parentSlot) {
          const variant = attribute(parent, 'variant')
          if (variant && ts.isStringLiteral(variant)) {
            if (variant.text === 'transparent') continue
            return variant.text === 'default'
          }
          return !variant
        }
        if (parentSlot === 'Dialog' && ['Modal', 'Drawer', 'AlertDialog'].includes(owner)) return true
        if ((parentSlot === 'Content' && owner === 'Popover') || (parentSlot === 'Popover' && ['Select', 'ComboBox'].includes(owner))) return true
      }
      return false
    }
    const report = (node, message) => violations.push(`${path.relative(root, filename)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`)
    const visit = (node) => {
      let specifier
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifier = node.moduleSpecifier.text
      if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0].text
      if (specifier && /(?:components\/ui(?:\/|$)|@radix-ui\/|^sonner$|(?:^|\/)dashboard\/|@synapse\/desktop)/u.test(specifier)) violations.push(`${path.relative(root, filename)}: ${specifier}`)
      if (isProduct) {
        const name = tag(node)
        const [rootName, slot] = name.split('.')
        const component = heroComponents.get(rootName)
        if (ts.isJsxElement(node) && slot === 'Dialog' && ['Modal', 'Drawer', 'AlertDialog'].includes(component)) {
          let hasStandardHeader = false
          const findHeader = (child) => {
            if (tag(child) === `${rootName}.Header`) hasStandardHeader = true
            ts.forEachChild(child, findHeader)
          }
          ts.forEachChild(node, findHeader)
          const classes = attribute(node, 'className')?.getText(source) ?? ''
          if (hasStandardHeader && /(?:^|[\s'"`])(?:[\w-]+:)*(?:p|px|py|ps|pe|pt|pb|pl|pr)-0(?=[\s'"`]|$)/u.test(classes)) report(node, 'HeroUI standard dialog headers rely on Dialog padding; do not reset it to zero')
        }
        const isSurfaceField = (!slot && surfaceFieldComponents.has(component)) || (slot === 'Group' && ['DateField', 'TimeField'].includes(component))
        if (isSurfaceField && isOnWhiteSurface(node)) {
          const variant = attribute(node, 'variant')
          if (!variant || (ts.isStringLiteral(variant) && variant.text !== 'secondary')) report(node, 'HeroUI form controls on white surfaces require variant="secondary" on the owning component')
        }
        if (ts.isJsxElement(node) && slot === 'Footer' && ['Modal', 'Drawer', 'AlertDialog'].includes(component)) {
          const siblings = node.parent.children?.filter((child) => !ts.isJsxText(child) || child.text.trim()) ?? []
          const previous = tag(siblings[siblings.indexOf(node) - 1])
          // HeroUI's native spacing depends on adjacent Body/Footer or Header/Footer slots.
          if (previous !== `${rootName}.Body` && previous !== `${rootName}.Header`) report(node, 'HeroUI dialog actions must follow Body or Header to retain native spacing')
        }
        if (iconNames.has(name) || name === 'svg' || name.endsWith('.icon')) {
          let inIconSlot = false
          for (let parent = node.parent; parent; parent = parent.parent) {
            const parentName = tag(parent)
            const [parentRoot, parentSlot] = parentName.split('.')
            if (heroComponents.get(parentRoot) !== 'Link') continue
            if (parentSlot === 'Icon') inIconSlot = true
            if (!parentSlot) {
              if (!inIconSlot) report(node, 'HeroUI Link icons must use Link.Icon')
              break
            }
          }
        }
      }
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
for (const html of ['index.html', 'admin.html', 'desktop-update.html']) if (!(await readFile(path.join(root, html), 'utf8')).includes('data-theme="light"')) violations.push(`${html}: fixed light theme missing`)
if (violations.length) { process.stderr.write(`${violations.join('\n')}\n`); process.exitCode = 1 }
else process.stdout.write('Dashboard UI boundaries: direct HeroUI components, independent source graph, fixed light theme, link icon slots, dialog spacing and surface field variants.\n')

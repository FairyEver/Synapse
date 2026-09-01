import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

const dashboardRoot = new URL('..', import.meta.url).pathname
const sourceRoot = join(dashboardRoot, 'src')
const driveRoots = [
  join(sourceRoot, 'features/drive-browser'),
  join(sourceRoot, 'features/drive-console'),
]
const excludedFiles = new Set([
  'features/drive-browser/admin-drive-storage-summary.tsx',
  'features/drive-browser/admin-public-assets.tsx',
  'features/drive-browser/shared/drive-telemetry-api.ts',
])
const failures = []

for (const file of driveRoots.flatMap(listSourceFiles)) {
  const relativePath = relative(sourceRoot, file)
  if (excludedFiles.has(relativePath) || /\.(?:browser|test)\.[cm]?[jt]sx?$/u.test(file)) continue
  const source = readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const declarations = collectDeclarations(sourceFile)
  inspectDriveApiImports(sourceFile, relativePath)
  inspectStableEventAttributes(sourceFile, relativePath)
  inspectBusinessHandlers(sourceFile, relativePath, declarations)
  for (const match of source.matchAll(/<(?:AlertDialogContent|DialogContent|DropdownMenuContent|SelectContent|SheetContent)\b[^>]*>/gsu)) {
    if (!match[0].includes("data-drive-telemetry-scope='portal'") && !match[0].includes('data-drive-telemetry-scope="portal"')) {
      failures.push(`${relativePath}: Drive portal must opt into telemetry capture.`)
    }
  }
  for (const match of source.matchAll(/<ConfirmDialog\b[^>]*>/gsu)) {
    if (!match[0].includes("contentProps={{ 'data-drive-telemetry-scope': 'portal' }}")) {
      failures.push(`${relativePath}: Drive confirmation dialog must opt into telemetry capture.`)
    }
  }
}

function inspectDriveApiImports(sourceFile, relativePath) {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@/lib/api') continue
    const names = statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements.map((element) => element.name.text)
      : []
    if (names.some((name) => ['driveApi', 'driveBrowserApi', 'driveAnnotationApi', 'driveFileVersionsApi'].includes(name))) {
      failures.push(`${relativePath}: Drive API must use drive-telemetry-api.`)
    }
  }
}

function inspectStableEventAttributes(sourceFile, relativePath) {
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && ['data-drive-telemetry-event', 'telemetryEvent'].includes(node.name.getText(sourceFile))) {
      const value = jsxAttributeValue(node.initializer)
      if (value?.kind === 'dynamic-template') {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        failures.push(`${relativePath}:${line}: Drive event names cannot contain runtime interpolation.`)
      } else if (value?.kind === 'static' && !/^web\.drive\.[a-z0-9._-]+$/u.test(value.value)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        failures.push(`${relativePath}:${line}: invalid Drive telemetry event ${value.value}.`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function inspectBusinessHandlers(sourceFile, relativePath, declarations) {
  const interactionProps = new Set(['onClick', 'onSubmit', 'onSelect', 'onValueChange', 'handleConfirm'])
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute) || !interactionProps.has(attribute.name.getText(sourceFile))) continue
        const expression = attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression : null
        if (!expression) continue
        const text = resolveHandlerText(expression, declarations, sourceFile, new Set())
        const businessAsync = /\bawait\b/u.test(text)
          && /\.(?:create|update|delete|remove|save|write|restore|download|upload|disable|enable|republish|checkpoint)\s*\(/u.test(text)
        if (!businessAsync) continue
        const line = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile)).line + 1
        if (!/(?:startDriveOperation|driveApi\.|BrowserApi\.|AnnotationApi\.|FileVersionsApi\.|\.mutate(?:Async)?\s*\()/u.test(text)) {
          failures.push(`${relativePath}:${line}: async Drive business handler has no completion tracking.`)
        }
        const hasSemanticAttribute = node.attributes.properties.some((candidate) => (
          ts.isJsxAttribute(candidate) && candidate.name.getText(sourceFile) === 'data-drive-telemetry-event'
        ))
        if (!hasSemanticAttribute && !/startDriveOperation\s*\(/u.test(text)) {
          failures.push(`${relativePath}:${line}: async Drive business handler has no stable semantic event.`)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function collectDeclarations(sourceFile) {
  const declarations = new Map()
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return declarations
}

function resolveHandlerText(node, declarations, sourceFile, seen) {
  let text = node.getText(sourceFile)
  const visit = (child) => {
    if (ts.isIdentifier(child)) {
      const declaration = declarations.get(child.text)
      if (declaration && !seen.has(child.text)) {
        seen.add(child.text)
        text += resolveHandlerText(declaration, declarations, sourceFile, seen)
      }
    }
    ts.forEachChild(child, visit)
  }
  visit(node)
  return text
}

function jsxAttributeValue(initializer) {
  if (!initializer) return null
  if (ts.isStringLiteral(initializer)) return { kind: 'static', value: initializer.text }
  if (!ts.isJsxExpression(initializer) || !initializer.expression) return null
  if (ts.isStringLiteral(initializer.expression) || ts.isNoSubstitutionTemplateLiteral(initializer.expression)) {
    return { kind: 'static', value: initializer.expression.text }
  }
  if (ts.isTemplateExpression(initializer.expression)) return { kind: 'dynamic-template' }
  return { kind: 'stable-reference' }
}

for (const relativePath of [
  'features/drive-browser/drive-browser-page.tsx',
  'features/drive-browser/drive-console-page.tsx',
  'features/drive-console/drive-console-page.tsx',
]) {
  const source = readFileSync(join(sourceRoot, relativePath), 'utf8')
  if (!source.includes('DriveTelemetryBoundary')) {
    failures.push(`${relativePath}: missing DriveTelemetryBoundary.`)
  }
}

const boundarySource = readFileSync(
  join(sourceRoot, 'features/drive-browser/shared/drive-telemetry-boundary.tsx'),
  'utf8',
)
for (const handler of [
  'onBlurCapture',
  'onChangeCapture',
  'onClickCapture',
  'onDoubleClickCapture',
  'onDropCapture',
  'onFocusCapture',
  'onKeyDownCapture',
  'onScrollCapture',
  'onSubmitCapture',
  'data-drive-telemetry-scope="portal"',
]) {
  if (!boundarySource.includes(handler)) failures.push(`DriveTelemetryBoundary: missing ${handler}.`)
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`)
  process.exitCode = 1
}

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return listSourceFiles(path)
    return /\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : []
  })
}

import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import ts from "typescript"

const desktopRoot = path.resolve(import.meta.dirname, "../..")
const rendererRoot = path.join(desktopRoot, "src")
const capabilitiesRoot = path.join(desktopRoot, "app-capabilities")
const primitivesRoot = path.join(rendererRoot, "components/ui")
const interactionProps = new Set([
  "onClick", "onDoubleClick", "onChange", "onInput", "onValueChange", "onOpenChange",
  "onSelect", "onSubmit", "onScroll", "onKeyDown", "onKeyUp", "onDrop", "onDragEnd",
  "onPointerDown", "onPointerUp",
])
const trackedPrimitiveNames = new Set([
  "AlertDialogAction", "AlertDialogCancel", "Button", "Checkbox", "Collapsible", "CommandInput",
  "CommandItem", "ContextMenuCheckboxItem", "ContextMenuItem", "ContextMenuRadioItem", "Dialog",
  "DropdownMenuCheckboxItem", "DropdownMenuItem", "DropdownMenuRadioItem", "Input", "MenubarCheckboxItem",
  "MenubarItem", "MenubarRadioItem", "NativeSelect", "Popover", "RadioGroup", "ScrollArea", "Select",
  "Sheet", "Slider", "Switch", "Tabs", "TabsTrigger", "TagInput", "Textarea", "Toggle", "ToggleGroup",
])
const primitiveDelegationAllowlist = new Map([
  ["input-group.tsx", "Delegates buttons and controls to tracked Button, Input, and Textarea primitives."],
])

const primitiveFiles = (await readdir(primitivesRoot)).filter((name) => name.endsWith(".tsx"))
const capabilityRendererFiles = await listCapabilityRendererFiles(capabilitiesRoot)
const rendererFiles = [...await listRendererFiles(rendererRoot), ...capabilityRendererFiles]
const issues = []

for (const file of rendererFiles) {
  const relativePath = path.relative(desktopRoot, file)
  const source = await readFile(file, "utf8")
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const declarations = collectDeclarations(sourceFile)

  inspectStableTrackingCalls(sourceFile, relativePath, issues)
  inspectNotificationPromises(sourceFile, relativePath, issues)

  const isPrimitive = file.startsWith(`${primitivesRoot}${path.sep}`)
  const isCapabilityRenderer = file.startsWith(`${capabilitiesRoot}${path.sep}`)
  if (isPrimitive && primitiveDelegationAllowlist.has(path.basename(file))) continue
  inspectInteractionHandlers(sourceFile, relativePath, declarations, isPrimitive, isCapabilityRenderer, issues)
}

await inspectCapabilitySemanticContracts(capabilityRendererFiles, issues)

if (issues.length > 0) {
  process.stderr.write(`UI tracking coverage check failed (${issues.length} handler-level issue${issues.length === 1 ? "" : "s"}):\n`)
  process.stderr.write(`${issues.map((issue) => `- ${issue}`).join("\n")}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`UI tracking coverage check passed (${primitiveFiles.length} shared primitives, ${capabilityRendererFiles.length} capability renderer files, and ${rendererFiles.length} total renderer files checked at handler level).\n`)
}

function inspectInteractionHandlers(sourceFile, relativePath, declarations, isPrimitive, isCapabilityRenderer, issues) {
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tagName = node.tagName.getText(sourceFile)
      const isRawElement = /^[a-z]/u.test(tagName)
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue
        const propName = attribute.name.getText(sourceFile)
        if (!interactionProps.has(propName) || !attribute.initializer) continue
        if (!isPrimitive && !isRawElement) continue
        const expression = jsxAttributeExpression(attribute.initializer)
        if (!expression) continue
        if (isCapabilityRenderer && isBusinessAsyncHandler(expression, declarations, sourceFile)) {
          if (!handlerContainsOperationTracking(expression, declarations, sourceFile, new Set())) {
            const line = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile)).line + 1
            issues.push(`${relativePath}:${line} ${tagName}.${propName} business async handler has no tracked operation`)
          }
          if (!hasStableSemanticMarker(node, expression, declarations, sourceFile)) {
            const line = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile)).line + 1
            issues.push(`${relativePath}:${line} ${tagName}.${propName} business handler has no stable semantic event`)
          }
        }
        if (trackedPrimitiveNames.has(tagName)) continue
        if (isImplicitNativeTracked(tagName, propName, node, sourceFile)) continue
        if (hasNativeDataTrack(node, sourceFile, propName)) continue
        if (handlerContainsTracking(expression, declarations, sourceFile, new Set())) continue
        if (isPropagationOnlyHandler(expression, declarations, sourceFile)) continue
        const line = sourceFile.getLineAndCharacterOfPosition(attribute.getStart(sourceFile)).line + 1
        issues.push(`${relativePath}:${line} ${tagName}.${propName} has no handler-level tracking`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function inspectStableTrackingCalls(sourceFile, relativePath, issues) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "track") {
      const input = node.arguments[0]
      if (input && ts.isObjectLiteralExpression(input) && !hasProperty(input, "eventKey")) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        issues.push(`${relativePath}:${line} track() must declare a static eventKey`)
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "startTrackedOperation" || node.expression.text === "runTrackedOperation")) {
      const input = node.arguments[0]
      if (input && ts.isObjectLiteralExpression(input) && !hasStaticStringProperty(input, "eventKey") && !hasIdentifierProperty(input, "eventKey")) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        issues.push(`${relativePath}:${line} ${node.expression.text}() must declare a stable eventKey`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function inspectNotificationPromises(sourceFile, relativePath, issues) {
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "promise") {
      const input = node.arguments[1]
      if (input && ts.isObjectLiteralExpression(input) && !hasProperty(input, "trackingName")) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
        issues.push(`${relativePath}:${line} notification promise() must declare a static trackingName`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

function handlerContainsTracking(node, declarations, sourceFile, seen) {
  if (/\b(?:track|startTrackedOperation|runTrackedOperation|useAppNotifications|promise)\s*\(/u.test(node.getText(sourceFile))) return true
  let covered = false
  const visit = (child) => {
    if (covered) return
    if (ts.isIdentifier(child)) {
      const declaration = declarations.get(child.text)
      if (declaration && !seen.has(child.text)) {
        seen.add(child.text)
        covered = handlerContainsTracking(declaration, declarations, sourceFile, seen)
      }
    }
    if (!covered) ts.forEachChild(child, visit)
  }
  visit(node)
  return covered
}

function handlerContainsOperationTracking(node, declarations, sourceFile, seen) {
  if (/\b(?:startTrackedOperation|runTrackedOperation)\s*\(/u.test(node.getText(sourceFile))) return true
  let covered = false
  const visit = (child) => {
    if (covered) return
    if (ts.isIdentifier(child)) {
      const declaration = declarations.get(child.text)
      if (declaration && !seen.has(child.text)) {
        seen.add(child.text)
        covered = handlerContainsOperationTracking(declaration, declarations, sourceFile, seen)
      }
    }
    if (!covered) ts.forEachChild(child, visit)
  }
  visit(node)
  return covered
}

function isBusinessAsyncHandler(node, declarations, sourceFile) {
  const text = resolveHandlerText(node, declarations, sourceFile, new Set())
  return /\bawait\b/u.test(text)
    && /\.(?:create|update|delete|remove|save|write|generate|repair|install|uninstall|extract|preview|test|sync|pull|push|clone|rename|restore|download|upload|stop|cancel|initialize)\s*\(/u.test(text)
}

function hasStableSemanticMarker(jsxNode, handler, declarations, sourceFile) {
  const handlerText = resolveHandlerText(handler, declarations, sourceFile, new Set())
  if (/\b(?:startTrackedOperation|runTrackedOperation)\s*\(/u.test(handlerText)) return true
  return jsxNode.attributes.properties.some((attribute) => (
    ts.isJsxAttribute(attribute)
    && attribute.name.getText(sourceFile) === "data-track"
    && attribute.initializer
    && ts.isStringLiteral(attribute.initializer)
    && /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+){2,}$/u.test(attribute.initializer.text)
  ))
}

function isPropagationOnlyHandler(node, declarations, sourceFile) {
  const text = resolveHandlerText(node, declarations, sourceFile, new Set())
  const calls = [...text.matchAll(/\.([A-Za-z_$][\w$]*)\s*\(/gu)].map((match) => match[1])
  return calls.length > 0 && calls.every((name) => name === "stopPropagation" || name === "preventDefault")
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

function hasNativeDataTrack(node, sourceFile, propName) {
  if (!new Set(["onClick", "onDoubleClick", "onChange", "onInput", "onSubmit", "onDrop", "onDragEnd", "onScroll"]).has(propName)) return false
  let hasTrack = false
  let hasNative = false
  for (const attribute of node.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue
    const name = attribute.name.getText(sourceFile)
    if (name === "data-track") hasTrack = true
    if (name === "data-track-native" && attribute.initializer?.getText(sourceFile).includes("true")) hasNative = true
  }
  return hasTrack && hasNative
}

function isImplicitNativeTracked(tagName, propName, node, sourceFile) {
  const nativeTags = new Set(["button", "input", "textarea", "select", "form", "a"])
  const capturedProps = new Set(["onClick", "onDoubleClick", "onChange", "onInput", "onSubmit", "onDrop", "onDragEnd", "onScroll"])
  if (nativeTags.has(tagName) && capturedProps.has(propName)) return true
  if (propName !== "onKeyDown") return false
  return node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "onClick")
}

function hasStaticStringProperty(node, propertyName) {
  return node.properties.some((property) => (
    ts.isPropertyAssignment(property)
    && property.name.getText() === propertyName
    && (ts.isStringLiteral(property.initializer) || ts.isNoSubstitutionTemplateLiteral(property.initializer))
  ))
}

function hasIdentifierProperty(node, propertyName) {
  return node.properties.some((property) => (
    (ts.isPropertyAssignment(property) && property.name.getText() === propertyName && ts.isIdentifier(property.initializer))
    || (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName)
  ))
}

function hasProperty(node, propertyName) {
  return node.properties.some((property) => (
    (ts.isPropertyAssignment(property) && property.name.getText() === propertyName)
    || (ts.isShorthandPropertyAssignment(property) && property.name.text === propertyName)
  ))
}

function jsxAttributeExpression(initializer) {
  return ts.isJsxExpression(initializer) ? initializer.expression : null
}

async function listRendererFiles(root) {
  const results = []
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === "__tests__" || entry.name === "generated") continue
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(target)
      else if (/\.tsx?$/u.test(entry.name) && !/\.(?:test|spec)\.tsx?$/u.test(entry.name)) results.push(target)
    }
  }
  await visit(root)
  return results
}

async function listCapabilityRendererFiles(root) {
  const results = []
  const capabilityEntries = await readdir(root, { withFileTypes: true })
  for (const capability of capabilityEntries) {
    if (!capability.isDirectory()) continue
    const rendererDirectory = path.join(root, capability.name, "renderer")
    try {
      results.push(...await listRendererFiles(rendererDirectory))
    } catch (error) {
      if (error?.code !== "ENOENT") throw error
    }
  }
  return results
}

async function inspectCapabilitySemanticContracts(files, issues) {
  const sourceByCapability = new Map()
  for (const file of files) {
    const capabilityId = path.relative(capabilitiesRoot, file).split(path.sep)[0]
    const source = await readFile(file, "utf8")
    sourceByCapability.set(capabilityId, `${sourceByCapability.get(capabilityId) ?? ""}\n${source}`)
  }
  for (const [capabilityId, source] of sourceByCapability) {
    if (!source.includes(`\"${capabilityId}.`)) {
      issues.push(`app-capabilities/${capabilityId}/renderer has no stable semantic event for ${capabilityId}`)
    }
  }
}

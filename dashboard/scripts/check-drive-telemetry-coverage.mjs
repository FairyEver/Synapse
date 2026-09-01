import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

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
  const directApiImport = source.match(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/api['"]/gu) ?? []
  for (const statement of directApiImport) {
    if (/\b(?:driveApi|driveBrowserApi|driveAnnotationApi|driveFileVersionsApi)\b/u.test(statement)) {
      failures.push(`${relativePath}: Drive API must use drive-telemetry-api.`)
    }
  }
  for (const match of source.matchAll(/data-drive-telemetry-event=['"]([^'"]+)['"]/gu)) {
    if (!/^web\.drive\.[a-z0-9._-]+$/u.test(match[1])) {
      failures.push(`${relativePath}: invalid Drive telemetry event ${match[1]}.`)
    }
  }
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

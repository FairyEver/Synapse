import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
import { extname, relative, resolve, sep } from 'node:path'

export function permissionSourceFiles(root: string): string[] {
  const files: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || ['node_modules', 'dist', 'coverage'].includes(entry.name)) continue
      const file = resolve(directory, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (entry.isFile() && ['.vue', '.js', '.jsx', '.ts', '.tsx'].includes(extname(file))) files.push(relative(root, file).split(sep).join('/'))
    }
  }
  walk(root)
  return files.sort()
}

export function permissionSourceRevision(root: string): string {
  const hash = createHash('sha256')
  for (const file of permissionSourceFiles(root)) hash.update(file).update('\0').update(readFileSync(resolve(root, file))).update('\0')
  return hash.digest('hex')
}

export function readPermissionSource(root: string, file: string): string {
  const base = realpathSync(root)
  const target = realpathSync(resolve(base, file))
  if (!target.startsWith(base + sep) || file.startsWith('/') || file.split(/[\\/]/).includes('..')) throw new Error('evidence must reference a file within the source root')
  return readFileSync(target, 'utf8')
}

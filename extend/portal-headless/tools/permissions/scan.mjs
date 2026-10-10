#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'

const args = Object.fromEntries(process.argv.slice(2).reduce((a, value, index, values) => value.startsWith('--') ? (a.push([value.slice(2), values[index + 1] ?? '']), a) : a, []))
const root = args.root ?? process.env.PORTAL_REPO
const out = args.out ?? 'generated/permission-candidates.ndjson'
if (!root || !existsSync(root)) throw new Error('scan requires --root or PORTAL_REPO pointing to Portal Web source')
const keywords = ['permissionCheck', 'buttonPermissionFlag', 'meta.permission', 'shopAdminPermission', 'permission:', 'v-permission', 'hasPermission', 'permissions']
const sourceFiles = []
const sourceSet = new Set()
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'coverage'].includes(entry) || entry.startsWith('.')) continue
    const file = join(dir, entry); const stat = statSync(file)
    if (stat.isDirectory()) walk(file)
    else if (['.vue', '.js', '.jsx', '.ts', '.tsx'].includes(extname(file))) { sourceFiles.push(file); sourceSet.add(file) }
  }
}
walk(root)
function importTrailFor(file) {
  const trail = []; const queue = [file]; const seen = new Set([file])
  while (queue.length && trail.length < 32) {
    const current = queue.shift(); const text = readFileSync(current, 'utf8')
    const imports = [...text.matchAll(/(?:import|require)\s*(?:[^'\"]*?from\s*)?[\"']([^\"']+)[\"']/g)].map(match => match[1]).filter(value => value.startsWith('.'))
    for (const specifier of imports) {
      const base = join(dirname(current), specifier); const candidates = [base, ...['.js', '.jsx', '.ts', '.tsx', '.vue'].map(ext => `${base}${ext}`), ...['index.js', 'index.ts'].map(name => join(base, name))]
      const resolved = candidates.find(candidate => sourceSet.has(candidate))
      if (resolved && !seen.has(resolved)) { seen.add(resolved); trail.push(relative(root, resolved)); queue.push(resolved) }
    }
  }
  return trail
}
const revision = args.revision ?? createHash('sha256').update(sourceFiles.map(file => readFileSync(file)).join('')).digest('hex')
const output = []
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8'); const lines = text.split(/\r?\n/)
  const hits = []
  lines.forEach((line, index) => {
    for (const keyword of keywords) if (line.includes(keyword)) hits.push({ file: relative(root, file), line: index + 1, keyword, snippet: line.trim().slice(0, 500) })
  })
  const endpointRefs = []
  const endpointPattern = /\b(?:get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gi
  let match
  while ((match = endpointPattern.exec(text)) !== null) {
    const before = text.slice(0, match.index); endpointRefs.push({ method: match[0].match(/^\s*(\w+)/)?.[1]?.toLowerCase() ?? 'unknown', path: match[1], sourceFile: relative(root, file), line: before.split(/\r?\n/).length })
  }
  if (hits.length === 0 && endpointRefs.length === 0) continue
  const importTrail = importTrailFor(file)
  const rel = relative(root, file)
  output.push({ candidateId: `candidate:${rel}`, pagePath: `/${rel.replaceAll('\\', '/')}`, routeFile: /router|route/i.test(basename(file)) ? rel : null, actionFiles: [rel], endpointRefs, keywordHits: hits, importTrail, sourceRevision: revision })
}
mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, output.map(row => JSON.stringify(row)).join('\n') + (output.length ? '\n' : ''))

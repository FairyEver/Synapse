#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_ROOT = path.join(ROOT, 'src')
const DIST_ROOT = path.join(ROOT, 'dist')
const MANIFEST = path.join(DIST_ROOT, '.source-content-hash.json')

function walkFiles (directory) {
  if (!fs.existsSync(directory)) return []
  const files = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(file))
    else files.push(file)
  }
  return files
}

function contentHash (files, root) {
  const digest = createHash('sha256')
  for (const file of files.sort()) {
    digest.update(path.relative(root, file).split(path.sep).join('/'))
    digest.update('\0')
    digest.update(fs.readFileSync(file))
    digest.update('\0')
  }
  return digest.digest('hex')
}

function sourceContentHash () {
  return contentHash(walkFiles(SOURCE_ROOT).filter(file => file.endsWith('.ts')), ROOT)
}

function distContentHash () {
  return contentHash(
    walkFiles(DIST_ROOT).filter(file => file !== MANIFEST),
    DIST_ROOT,
  )
}

const tsc = path.join(ROOT, 'node_modules/typescript/bin/tsc')
execFileSync(process.execPath, [tsc, '-p', path.join(ROOT, 'tsconfig.build.json')], { stdio: 'inherit' })

const manifest = {
  schema: 'portal-headless-build/v1',
  sourceContentHash: sourceContentHash(),
  distContentHash: distContentHash(),
}
fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

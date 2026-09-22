import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../vendor/portal-headless.manifest.json', import.meta.url), 'utf8'))
const archive = await readFile(new URL(`../vendor/${manifest.file}`, import.meta.url))
if (createHash('sha256').update(archive).digest('hex') !== manifest.sha256) throw new Error('Portal SDK archive checksum mismatch')
const entry = import.meta.resolve('portal-headless')
const sdk = await import(entry)
const server = sdk.createPortalServer({ baseUrl: 'https://invalid.example' })
for (const id of ['meeting-room-usage', 'perf-year-agreement-list', 'base-dict-get']) {
  const contract = server.catalog.describe(id)
  if (!contract.ok || contract.write || contract.ai?.effect !== 'read' || !contract.invoke) throw new Error(`Invalid SDK read contract: ${id}`)
}
if (server.catalog.index.pages.length === 0) throw new Error('SDK page catalog missing')
const packageRoot = new URL('../', new URL(entry))
const metadata = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'))
if (metadata.version !== manifest.version || metadata.synapseSdkSource?.commit !== manifest.sourceCommit) {
  throw new Error('Installed SDK does not match the source manifest')
}
const rules = JSON.parse(await readFile(new URL('generated/module-type-rules.json', packageRoot), 'utf8'))
if (!rules || Object.keys(rules).length === 0) throw new Error('SDK module-type rules missing')
server.sessions.clear()
process.stdout.write(`Portal SDK ${manifest.version}: archive and installed runtime resources verified\n`)

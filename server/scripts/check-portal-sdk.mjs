import { readFile } from 'node:fs/promises'

// The SDK is a workspace package now, so there is no archive to checksum and no
// upstream source commit to pin: the repository commit that contains this script
// is the same commit that contains the SDK source. What remains worth guarding is
// that the built entry actually loads and still exposes the runtime resources and
// read-only contracts the server depends on.
const entry = import.meta.resolve('@synapse/portal-headless')
const sdk = await import(entry)
const server = sdk.createPortalServer({ baseUrl: 'https://invalid.example' })
for (const id of ['meeting-room-usage', 'perf-year-agreement-list', 'base-dict-get']) {
  const contract = server.catalog.describe(id)
  if (!contract.ok || contract.write || contract.ai?.effect !== 'read' || !contract.invoke) throw new Error(`Invalid SDK read contract: ${id}`)
}
if (server.catalog.index.pages.length === 0) throw new Error('SDK page catalog missing')
const packageRoot = new URL('../', new URL(entry))
const rules = JSON.parse(await readFile(new URL('generated/module-type-rules.json', packageRoot), 'utf8'))
if (!rules || Object.keys(rules).length === 0) throw new Error('SDK module-type rules missing')
server.sessions.clear()
process.stdout.write('Portal SDK: built entry and runtime resources verified\n')

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

test('publishes the original cloud-table Skill and its relative HTTP reference', async () => {
  for (const path of ['SKILL.md', 'references/http.md']) {
    const source = await readFile(new URL(`../public/skills/synapse-cloud-tables/${path}`, import.meta.url))
    const artifact = await readFile(new URL(`./dist/skills/synapse-cloud-tables/${path}`, import.meta.url))
    assert.deepEqual(artifact, source, `${path} must remain raw Markdown`)
  }
})

test('preserves the shared document logo when distributing the Skill', async () => {
  const logo = await readFile(new URL('./dist/synapse-logo.png', import.meta.url))
  assert.equal(logo.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
})

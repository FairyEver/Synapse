import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSensitiveText } from './redact.js'

test('redactSensitiveText redacts common secret shapes without hiding file paths', () => {
  const output = redactSensitiveText([
    'Authorization: Bearer authorization-secret',
    'Bearer bearer-secret',
    'Cookie: sid=cookie-secret',
    'ANTHROPIC_API_KEY=env-secret',
    '--env GITHUB_TOKEN=token-secret',
    '{\\"apiKey\\":\\"escaped-json-secret\\"}',
    '{"accessToken":"json-secret","refresh_token":"refresh-secret","file_path":"/Users/test/project/file.ts"}',
  ].join('\n'))

  assert.match(output, /Authorization: \[redacted\]/)
  assert.match(output, /Bearer \[redacted\]/)
  assert.match(output, /Cookie: \[redacted\]/)
  assert.match(output, /ANTHROPIC_API_KEY=\[redacted\]/)
  assert.match(output, /GITHUB_TOKEN=\[redacted\]/)
  assert.match(output, /\\"apiKey\\":\\"\[redacted\]\\"/)
  assert.match(output, /"accessToken":"\[redacted\]"/)
  assert.match(output, /"refresh_token":"\[redacted\]"/)
  assert.match(output, /\/Users\/test\/project\/file.ts/)
  assert.doesNotMatch(output, /authorization-secret|bearer-secret|cookie-secret|env-secret|token-secret|escaped-json-secret|json-secret|refresh-secret/)
})

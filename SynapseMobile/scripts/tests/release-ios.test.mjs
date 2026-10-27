import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function runRelease(mode) {
  const root = mkdtempSync(join(tmpdir(), 'synapse-release-test-'))
  try {
    const mobile = join(root, 'SynapseMobile')
    const bin = join(root, 'bin')
    mkdirSync(join(mobile, 'scripts'), { recursive: true })
    mkdirSync(join(mobile, 'SynapseMobile.xcodeproj'))
    mkdirSync(join(root, 'desktop'))
    mkdirSync(bin)
    copyFileSync(resolve('SynapseMobile/scripts/release-ios.sh'), join(mobile, 'scripts/release-ios.sh'))
    writeFileSync(join(root, 'desktop/package.json'), '{"version":"1.0.87"}')
    writeFileSync(join(mobile, 'SynapseMobile.xcodeproj/project.pbxproj'), 'CURRENT_PROJECT_VERSION = 99;\n')
    writeFileSync(join(mobile, '.env.asc'), 'ASC_KEY_PATH=/tmp/fake.p8\nASC_KEY_ID=testkey\nASC_ISSUER_ID=testissuer\n')
    writeFileSync(join(mobile, 'ExportOptions.plist'), '<string>upload</string>\n')
    writeFileSync(join(bin, 'xcodebuild'), `#!/bin/bash
case " $* " in
  *" -showBuildSettings "*) echo ' MARKETING_VERSION = 1.0.87' ;;
  *" archive "*) echo 'ARCHIVE SUCCEEDED' ;;
  *" -exportArchive "*)
    [ "$FAIL_UPLOAD" != export ] || { echo 'signing export failed'; exit 1; }
    options=''; dest=''; while [ $# -gt 0 ]; do case "$1" in -exportOptionsPlist) options="$2"; shift 2;; -exportPath) dest="$2"; shift 2;; *) shift;; esac; done
    if ! grep -q '<string>export</string>' "$options"; then echo 'legacy upload account unavailable'; exit 1; fi
    mkdir -p "$dest"; touch "$dest/SynapseMobile.ipa" ;;
esac
`, { mode: 0o755 })
    writeFileSync(join(bin, 'xcrun'), `#!/bin/bash
[ "$1" = altool ] || exit 1
case " $* " in *' --upload-app '*) ;; *) exit 1;; esac
[ "$FAIL_UPLOAD" != collision ] || [ -f "$TEST_ROOT/retried" ] || { touch "$TEST_ROOT/retried"; echo 'previously uploaded version: 104'; exit 1; }
[ "$FAIL_UPLOAD" != 1 ] || { echo 'upload refused'; exit 1; }
echo accepted > "$TEST_ROOT/uploaded"
echo 'UPLOAD SUCCEEDED'
`, { mode: 0o755 })
    const result = spawnSync('bash', [join(mobile, 'scripts/release-ios.sh'), '--upload'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root, FAIL_UPLOAD: mode === 'fail' ? '1' : mode },
    })
    return { status: result.status, output: result.stdout + result.stderr, uploaded: (() => { try { return readFileSync(join(root, 'uploaded'), 'utf8').trim() } catch { return null } })() }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test('iOS release exports a signed package before submitting it to Apple', () => {
  const result = runRelease('success')
  assert.equal(result.status, 0, result.output)
  assert.equal(result.uploaded, 'accepted')
})

test('iOS release fails when Apple refuses the upload', () => {
  const result = runRelease('fail')
  assert.notEqual(result.status, 0)
  assert.equal(result.uploaded, null)
  assert.match(result.output, /upload refused/)
  assert.doesNotMatch(result.output, /uploaded\. processing/)
})

test('iOS release never uploads when the signed package cannot be exported', () => {
  const result = runRelease('export')
  assert.notEqual(result.status, 0)
  assert.equal(result.uploaded, null)
  assert.match(result.output, /signing export failed/)
})

test('iOS release retries with the next build number when Apple reports a collision', () => {
  const result = runRelease('collision')
  assert.equal(result.status, 0, result.output)
  assert.equal(result.uploaded, 'accepted')
  assert.match(result.output, /re-archiving as 105/)
})

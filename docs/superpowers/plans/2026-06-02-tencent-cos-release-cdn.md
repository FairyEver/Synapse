# Tencent COS Release CDN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Synapse desktop release downloads and update metadata from GitHub Release assets to Tencent Cloud COS served through `https://desktop.release.synapse.d2.pub/`.

**Architecture:** Keep the existing electron-builder packaging jobs, then add a publish-stage preparation script that copies immutable versioned assets, rewrites `latest*.yml`, and emits a GitHub Release body with CDN links. The GitHub Actions publish job uploads prepared assets with COSCLI, refreshes Tencent Cloud CDN metadata URLs with TCCLI, verifies CDN reachability, and creates/updates GitHub Release notes without large assets.

**Tech Stack:** GitHub Actions, electron-builder, electron-updater generic provider, Node.js scripts, `yaml`, Vitest, Tencent COSCLI, Tencent Cloud CLI CDN `PurgeUrlsCache`.

---

## Source Notes

- TencentCloud/cos-action is not recommended here because its current `action.yml` uses `node12`, while this repo sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`.
- COSCLI is the preferred upload tool because Tencent Cloud documents direct Linux binary download and recursive `cp` upload.
- TCCLI is the preferred CDN refresh tool because Tencent Cloud documents `PurgeUrlsCache` for URL refresh and TCCLI supports `TENCENTCLOUD_SECRET_ID` / `TENCENTCLOUD_SECRET_KEY` environment credentials.

## File Structure

- Create `desktop/scripts/prepare-cdn-release-artifacts.mjs`
  - Owns local artifact preparation: copy versioned installers/blockmaps, rewrite updater YAML metadata, emit `manifest.json`, emit `release-body.md`.
- Create `desktop/tests/unit/release-cdn-artifacts.test.ts`
  - Executes the script against temporary fake artifacts and checks the output layout, metadata rewrite, release body, and failure behavior.
- Modify `desktop/package.json`
  - Switch electron-builder `build.publish` from GitHub provider to generic provider at `https://desktop.release.synapse.d2.pub/`.
- Modify `.github/workflows/release.yml`
  - Keep build jobs, replace GitHub asset upload with COS upload, CDN refresh, CDN verification, and release-notes-only GitHub Release creation.
- Modify `desktop/README.md`
  - Update the release workflow description to mention COS/CDN publishing and GitHub Release notes.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing technical note about update/download source moving to Tencent Cloud CDN.

## Task 1: Release Artifact Preparation Script

**Files:**
- Create: `desktop/scripts/prepare-cdn-release-artifacts.mjs`
- Create: `desktop/tests/unit/release-cdn-artifacts.test.ts`

- [ ] **Step 1: Write the failing script tests**

Create `desktop/tests/unit/release-cdn-artifacts.test.ts`:

```ts
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { parse } from "yaml"
import { describe, expect, it } from "vitest"

const execFileAsync = promisify(execFile)
const desktopRoot = path.resolve(__dirname, "../..")
const scriptPath = path.join(desktopRoot, "scripts/prepare-cdn-release-artifacts.mjs")

async function writeFixtureArtifacts(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, "Synapse-0.2.214-win-x64.exe"), "win-installer")
  await writeFile(path.join(dir, "Synapse-0.2.214-win-x64.exe.blockmap"), "win-blockmap")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.dmg"), "mac-dmg")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.dmg.blockmap"), "mac-dmg-blockmap")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.zip"), "mac-zip")
  await writeFile(path.join(dir, "Synapse-0.2.214-mac-arm64.zip.blockmap"), "mac-zip-blockmap")
  await writeFile(path.join(dir, "latest.yml"), [
    "version: 0.2.214",
    "path: Synapse-0.2.214-win-x64.exe",
    "files:",
    "  - url: Synapse-0.2.214-win-x64.exe",
    "    sha512: winsha",
    "    size: 13",
    "",
  ].join("\n"))
  await writeFile(path.join(dir, "latest-mac.yml"), [
    "version: 0.2.214",
    "path: Synapse-0.2.214-mac-arm64.zip",
    "files:",
    "  - url: Synapse-0.2.214-mac-arm64.zip",
    "    sha512: maczipsha",
    "    size: 7",
    "  - url: Synapse-0.2.214-mac-arm64.dmg",
    "    sha512: macdmgsha",
    "    size: 7",
    "",
  ].join("\n"))
}

describe("prepare-cdn-release-artifacts", () => {
  it("copies immutable assets and rewrites updater metadata to versioned paths", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-release-cdn-"))
    const artifactsDir = path.join(root, "release-artifacts")
    const outDir = path.join(root, "cdn-release")
    await writeFixtureArtifacts(artifactsDir)

    await execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub/",
    ], { cwd: desktopRoot })

    await expect(stat(path.join(outDir, "v0.2.214/Synapse-0.2.214-win-x64.exe"))).resolves.toBeTruthy()
    await expect(stat(path.join(outDir, "v0.2.214/Synapse-0.2.214-mac-arm64.dmg"))).resolves.toBeTruthy()

    const latest = parse(await readFile(path.join(outDir, "latest.yml"), "utf8"))
    expect(latest.path).toBe("v0.2.214/Synapse-0.2.214-win-x64.exe")
    expect(latest.files[0].url).toBe("v0.2.214/Synapse-0.2.214-win-x64.exe")

    const latestMac = parse(await readFile(path.join(outDir, "latest-mac.yml"), "utf8"))
    expect(latestMac.path).toBe("v0.2.214/Synapse-0.2.214-mac-arm64.zip")
    expect(latestMac.files.map((file: { url: string }) => file.url)).toEqual([
      "v0.2.214/Synapse-0.2.214-mac-arm64.zip",
      "v0.2.214/Synapse-0.2.214-mac-arm64.dmg",
    ])

    const manifest = JSON.parse(await readFile(path.join(outDir, "manifest.json"), "utf8"))
    expect(manifest.version).toBe("0.2.214")
    expect(manifest.versionPrefix).toBe("v0.2.214")
    expect(manifest.metadataUrls).toEqual([
      "https://desktop.release.synapse.d2.pub/latest.yml",
      "https://desktop.release.synapse.d2.pub/latest-mac.yml",
    ])
    expect(manifest.assetUrls).toContain("https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe")

    const releaseBody = await readFile(path.join(outDir, "release-body.md"), "utf8")
    expect(releaseBody).toContain("Synapse v0.2.214")
    expect(releaseBody).toContain("https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.dmg")
    expect(releaseBody).toContain("https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe")
  })

  it("fails when metadata references a missing artifact", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-release-cdn-missing-"))
    const artifactsDir = path.join(root, "release-artifacts")
    const outDir = path.join(root, "cdn-release")
    await mkdir(artifactsDir, { recursive: true })
    await writeFile(path.join(artifactsDir, "latest.yml"), [
      "version: 0.2.214",
      "path: Missing.exe",
      "files:",
      "  - url: Missing.exe",
      "    sha512: missing",
      "    size: 1",
      "",
    ].join("\n"))
    await writeFile(path.join(artifactsDir, "latest-mac.yml"), "version: 0.2.214\nfiles: []\n")

    await expect(execFileAsync(process.execPath, [
      scriptPath,
      "--artifacts-dir",
      artifactsDir,
      "--out-dir",
      outDir,
      "--version",
      "0.2.214",
      "--cdn-base-url",
      "https://desktop.release.synapse.d2.pub/",
    ], { cwd: desktopRoot })).rejects.toMatchObject({
      stderr: expect.stringContaining("Metadata references missing artifact: Missing.exe"),
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/release-cdn-artifacts.test.ts
```

Expected: FAIL because `desktop/scripts/prepare-cdn-release-artifacts.mjs` does not exist.

- [ ] **Step 3: Add the preparation script**

Create `desktop/scripts/prepare-cdn-release-artifacts.mjs`:

```js
#!/usr/bin/env node
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parse, stringify } from "yaml"

const METADATA_FILES = ["latest.yml", "latest-mac.yml"]

function readArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument: ${name}`)
  }
  return process.argv[index + 1]
}

function normalizeCdnBaseUrl(value) {
  if (!value.startsWith("https://")) {
    throw new Error("--cdn-base-url must start with https://")
  }
  return value.endsWith("/") ? value : `${value}/`
}

function ensureVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new Error("--version must look like 0.2.214")
  }
  return value
}

function isMetadataFile(fileName) {
  return METADATA_FILES.includes(fileName)
}

function isReleaseAsset(fileName) {
  return /\.(dmg|zip|exe|blockmap)$/.test(fileName)
}

function basenameFromMetadataPath(value) {
  if (typeof value !== "string" || value.length === 0) {
    return null
  }
  return path.posix.basename(value)
}

function versionedPath(versionPrefix, fileName) {
  return `${versionPrefix}/${fileName}`
}

function rewriteMetadataValue(value, versionPrefix, artifactNames) {
  const fileName = basenameFromMetadataPath(value)
  if (!fileName) {
    return value
  }
  if (!artifactNames.has(fileName)) {
    throw new Error(`Metadata references missing artifact: ${fileName}`)
  }
  return versionedPath(versionPrefix, fileName)
}

function rewriteMetadata(metadata, versionPrefix, artifactNames) {
  const next = structuredClone(metadata)
  if (typeof next.path === "string") {
    next.path = rewriteMetadataValue(next.path, versionPrefix, artifactNames)
  }
  if (Array.isArray(next.files)) {
    next.files = next.files.map((file) => {
      if (!file || typeof file !== "object") {
        return file
      }
      const copy = { ...file }
      if (typeof copy.url === "string") {
        copy.url = rewriteMetadataValue(copy.url, versionPrefix, artifactNames)
      }
      return copy
    })
  }
  return next
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort()
}

async function copyReleaseAssets(artifactsDir, versionDir, artifactFiles) {
  await mkdir(versionDir, { recursive: true })
  for (const fileName of artifactFiles) {
    await copyFile(path.join(artifactsDir, fileName), path.join(versionDir, fileName))
  }
}

function releaseBody(version, cdnBaseUrl, artifactFiles) {
  const versionPrefix = `v${version}`
  const dmg = artifactFiles.find((fileName) => fileName.endsWith("-mac-arm64.dmg"))
  const zip = artifactFiles.find((fileName) => fileName.endsWith("-mac-arm64.zip"))
  const exe = artifactFiles.find((fileName) => fileName.endsWith("-win-x64.exe"))
  const lines = [`# Synapse v${version}`, ""]

  if (dmg) {
    lines.push("macOS Apple Silicon DMG:", `${cdnBaseUrl}${versionPrefix}/${dmg}`, "")
  }
  if (zip) {
    lines.push("macOS Apple Silicon ZIP:", `${cdnBaseUrl}${versionPrefix}/${zip}`, "")
  }
  if (exe) {
    lines.push("Windows x64:", `${cdnBaseUrl}${versionPrefix}/${exe}`, "")
  }

  lines.push("更新元数据：", `${cdnBaseUrl}latest.yml`, `${cdnBaseUrl}latest-mac.yml`, "")
  return `${lines.join("\n")}\n`
}

export async function prepareReleaseArtifacts({ artifactsDir, outDir, version, cdnBaseUrl }) {
  const normalizedVersion = ensureVersion(version)
  const normalizedCdnBaseUrl = normalizeCdnBaseUrl(cdnBaseUrl)
  const versionPrefix = `v${normalizedVersion}`
  const files = await listFiles(artifactsDir)
  const artifactFiles = files.filter((fileName) => !isMetadataFile(fileName) && isReleaseAsset(fileName))
  const artifactNames = new Set(artifactFiles)

  if (artifactFiles.length === 0) {
    throw new Error("No release assets found")
  }

  for (const metadataFile of METADATA_FILES) {
    await stat(path.join(artifactsDir, metadataFile))
  }

  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  await copyReleaseAssets(artifactsDir, path.join(outDir, versionPrefix), artifactFiles)

  for (const metadataFile of METADATA_FILES) {
    const raw = await readFile(path.join(artifactsDir, metadataFile), "utf8")
    const metadata = parse(raw)
    const rewritten = rewriteMetadata(metadata, versionPrefix, artifactNames)
    await writeFile(path.join(outDir, metadataFile), stringify(rewritten), "utf8")
  }

  const assetUrls = artifactFiles.map((fileName) => `${normalizedCdnBaseUrl}${versionPrefix}/${fileName}`)
  const metadataUrls = METADATA_FILES.map((fileName) => `${normalizedCdnBaseUrl}${fileName}`)
  await writeFile(path.join(outDir, "manifest.json"), `${JSON.stringify({
    version: normalizedVersion,
    versionPrefix,
    cdnBaseUrl: normalizedCdnBaseUrl,
    artifactFiles,
    assetUrls,
    metadataUrls,
  }, null, 2)}\n`, "utf8")
  await writeFile(path.join(outDir, "release-body.md"), releaseBody(normalizedVersion, normalizedCdnBaseUrl, artifactFiles), "utf8")
}

async function main() {
  await prepareReleaseArtifacts({
    artifactsDir: path.resolve(readArg("--artifacts-dir")),
    outDir: path.resolve(readArg("--out-dir")),
    version: readArg("--version"),
    cdnBaseUrl: readArg("--cdn-base-url"),
  })
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/release-cdn-artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the script and tests**

```bash
git add desktop/scripts/prepare-cdn-release-artifacts.mjs desktop/tests/unit/release-cdn-artifacts.test.ts
git commit -m "build: prepare cdn release artifacts"
```

## Task 2: Electron Updater Source And Release Notes

**Files:**
- Modify: `desktop/package.json`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Change electron-builder publish provider**

In `desktop/package.json`, replace the current GitHub publish provider:

```json
"publish": [
  {
    "provider": "github",
    "owner": "FairyEver",
    "repo": "SynapseAppRelease",
    "releaseType": "release",
    "tagNamePrefix": "v"
  }
],
```

with:

```json
"publish": [
  {
    "provider": "generic",
    "url": "https://desktop.release.synapse.d2.pub/",
    "channel": "latest"
  }
],
```

- [ ] **Step 2: Add pending release note**

Add this bullet under `## 技术调整` in `RELEASE_NOTES_PENDING.md`:

```md
- 桌面端安装包下载和应用内更新源切换到腾讯云 CDN，后续版本下载会走 `desktop.release.synapse.d2.pub`，GitHub Release 只保留发版说明。
```

- [ ] **Step 3: Verify package JSON**

Run:

```bash
node -e "const pkg=require('./desktop/package.json'); const publish=pkg.build.publish[0]; if (publish.provider !== 'generic') process.exit(1); if (publish.url !== 'https://desktop.release.synapse.d2.pub/') process.exit(1); console.log(JSON.stringify(publish))"
```

Expected output includes:

```text
{"provider":"generic","url":"https://desktop.release.synapse.d2.pub/","channel":"latest"}
```

- [ ] **Step 4: Commit updater source and release notes**

```bash
git add desktop/package.json RELEASE_NOTES_PENDING.md
git commit -m "build: point updater at tencent cdn"
```

## Task 3: GitHub Actions COS/CDN Publish Flow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Replace publish job environment**

In `.github/workflows/release.yml`, update the `publish` job `env` block from:

```yaml
    env:
      GH_TOKEN: ${{ secrets.RELEASE_REPO_TOKEN }}
```

to:

```yaml
    env:
      GH_TOKEN: ${{ secrets.RELEASE_REPO_TOKEN }}
      TENCENT_CLOUD_SECRET_ID: ${{ secrets.TENCENT_CLOUD_SECRET_ID }}
      TENCENT_CLOUD_SECRET_KEY: ${{ secrets.TENCENT_CLOUD_SECRET_KEY }}
      TENCENT_CLOUD_COS_BUCKET: synapse-desktop-release-1252371654
      TENCENT_CLOUD_COS_REGION: ap-beijing
      TENCENT_CLOUD_CDN_DOMAIN: desktop.release.synapse.d2.pub
```

- [ ] **Step 2: Expand publish checkout and install Node dependencies**

Replace the publish job checkout step:

```yaml
      - name: Checkout repository
        uses: actions/checkout@v5
        with:
          sparse-checkout: desktop/package.json
          sparse-checkout-cone-mode: false
```

with:

```yaml
      - name: Checkout repository
        uses: actions/checkout@v5
        with:
          sparse-checkout: |
            package.json
            pnpm-lock.yaml
            pnpm-workspace.yaml
            desktop/package.json
            desktop/scripts/prepare-cdn-release-artifacts.mjs
          sparse-checkout-cone-mode: false

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: 22
          package-manager-cache: false

      - name: Setup pnpm
        run: |
          corepack enable
          corepack prepare pnpm@10.22.0 --activate

      - name: Install publish dependencies
        run: pnpm install --frozen-lockfile
```

- [ ] **Step 3: Add artifact preparation step**

After `Download release artifacts`, add:

```yaml
      - name: Prepare CDN release artifacts
        env:
          VERSION: ${{ steps.version.outputs.version }}
          CDN_BASE_URL: https://${{ env.TENCENT_CLOUD_CDN_DOMAIN }}/
        run: |
          cd desktop
          pnpm exec node scripts/prepare-cdn-release-artifacts.mjs \
            --artifacts-dir ../release-artifacts \
            --out-dir ../cdn-release \
            --version "$VERSION" \
            --cdn-base-url "$CDN_BASE_URL"
          find ../cdn-release -maxdepth 2 -type f | sort
```

- [ ] **Step 4: Replace GitHub asset upload with COSCLI upload**

Replace the entire `Publish release artifacts` step:

```yaml
      - name: Publish release artifacts
        env:
          RELEASE_NAME: Synapse v${{ steps.version.outputs.version }}
          RELEASE_TAG: ${{ steps.version.outputs.tag }}
        run: |
          ls -la release-artifacts
          test -n "$(ls -A release-artifacts)"

          if gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" > /dev/null 2>&1; then
            gh release upload "$RELEASE_TAG" release-artifacts/* --clobber --repo "$RELEASE_REPO"
          else
            gh release create "$RELEASE_TAG" release-artifacts/* --title "$RELEASE_NAME" --generate-notes --repo "$RELEASE_REPO"
          fi
```

with these three steps:

```yaml
      - name: Install COSCLI
        run: |
          curl --fail --silent --show-error --location \
            --output "$RUNNER_TEMP/coscli" \
            https://cosbrowser.cloud.tencent.com/software/coscli/coscli-linux-amd64
          chmod 755 "$RUNNER_TEMP/coscli"
          "$RUNNER_TEMP/coscli" --version

      - name: Upload release artifacts to COS
        env:
          VERSION: ${{ steps.version.outputs.version }}
        run: |
          set -euo pipefail

          COS_CONFIG="$RUNNER_TEMP/cos.yaml"
          cat > "$COS_CONFIG" <<EOF
          cos:
            base:
              secretid: ${TENCENT_CLOUD_SECRET_ID}
              secretkey: ${TENCENT_CLOUD_SECRET_KEY}
              sessiontoken: ""
              protocol: https
            buckets:
              - name: ${TENCENT_CLOUD_COS_BUCKET}
                alias: release
                region: ${TENCENT_CLOUD_COS_REGION}
                endpoint: cos.${TENCENT_CLOUD_COS_REGION}.myqcloud.com
                ofs: false
          EOF

          "$RUNNER_TEMP/coscli" cp "cdn-release/v$VERSION/" "cos://release/v$VERSION/" -r -c "$COS_CONFIG"
          "$RUNNER_TEMP/coscli" cp "cdn-release/latest.yml" "cos://release/latest.yml" -c "$COS_CONFIG"
          "$RUNNER_TEMP/coscli" cp "cdn-release/latest-mac.yml" "cos://release/latest-mac.yml" -c "$COS_CONFIG"
          "$RUNNER_TEMP/coscli" cp "cdn-release/manifest.json" "cos://release/v$VERSION/manifest.json" -c "$COS_CONFIG"
          "$RUNNER_TEMP/coscli" cp "cdn-release/release-body.md" "cos://release/v$VERSION/release-body.md" -c "$COS_CONFIG"

      - name: Refresh and verify CDN
        env:
          VERSION: ${{ steps.version.outputs.version }}
          TENCENTCLOUD_SECRET_ID: ${{ secrets.TENCENT_CLOUD_SECRET_ID }}
          TENCENTCLOUD_SECRET_KEY: ${{ secrets.TENCENT_CLOUD_SECRET_KEY }}
          TENCENTCLOUD_REGION: ap-guangzhou
        run: |
          set -euo pipefail

          python -m pip install --user tccli
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
          export PATH="$HOME/.local/bin:$PATH"

          tccli cdn PurgeUrlsCache \
            --Urls.0 "https://${TENCENT_CLOUD_CDN_DOMAIN}/latest.yml" \
            --Urls.1 "https://${TENCENT_CLOUD_CDN_DOMAIN}/latest-mac.yml" \
            --Area mainland

          curl --fail --silent --show-error --location --head "https://${TENCENT_CLOUD_CDN_DOMAIN}/latest.yml"
          curl --fail --silent --show-error --location --head "https://${TENCENT_CLOUD_CDN_DOMAIN}/latest-mac.yml"
          node -e "const manifest=require('./cdn-release/manifest.json'); for (const url of manifest.assetUrls.filter((item) => item.endsWith('.exe') || item.endsWith('.dmg'))) console.log(url)"
          while IFS= read -r url; do
            curl --fail --silent --show-error --location --head "$url"
          done < <(node -e "const manifest=require('./cdn-release/manifest.json'); for (const url of manifest.assetUrls.filter((item) => item.endsWith('.exe') || item.endsWith('.dmg'))) console.log(url)")

      - name: Publish release notes
        env:
          RELEASE_NAME: Synapse v${{ steps.version.outputs.version }}
          RELEASE_TAG: ${{ steps.version.outputs.tag }}
        run: |
          if gh release view "$RELEASE_TAG" --repo "$RELEASE_REPO" > /dev/null 2>&1; then
            gh release edit "$RELEASE_TAG" --title "$RELEASE_NAME" --notes-file cdn-release/release-body.md --repo "$RELEASE_REPO"
          else
            gh release create "$RELEASE_TAG" --title "$RELEASE_NAME" --notes-file cdn-release/release-body.md --repo "$RELEASE_REPO"
          fi
```

- [ ] **Step 5: Fix heredoc indentation if needed**

Open `.github/workflows/release.yml` after the edit. The `cat > "$COS_CONFIG" <<EOF` heredoc content must start at column 1 inside the shell script after YAML block indentation is stripped by GitHub Actions. If local YAML formatting makes the generated `cos.yaml` contain leading spaces before `cos:`, change the upload step to use `printf`:

```bash
          {
            printf '%s\n' 'cos:'
            printf '%s\n' '  base:'
            printf '    secretid: %s\n' "$TENCENT_CLOUD_SECRET_ID"
            printf '    secretkey: %s\n' "$TENCENT_CLOUD_SECRET_KEY"
            printf '%s\n' '    sessiontoken: ""'
            printf '%s\n' '    protocol: https'
            printf '%s\n' '  buckets:'
            printf '    - name: %s\n' "$TENCENT_CLOUD_COS_BUCKET"
            printf '%s\n' '      alias: release'
            printf '      region: %s\n' "$TENCENT_CLOUD_COS_REGION"
            printf '      endpoint: cos.%s.myqcloud.com\n' "$TENCENT_CLOUD_COS_REGION"
            printf '%s\n' '      ofs: false'
          } > "$COS_CONFIG"
```

- [ ] **Step 6: Run local static checks**

Run:

```bash
node -e "require('yaml').parse(require('fs').readFileSync('.github/workflows/release.yml', 'utf8')); console.log('workflow yaml ok')"
pnpm --filter @synapse/desktop exec vitest run tests/unit/release-cdn-artifacts.test.ts
```

Expected:

```text
workflow yaml ok
```

and the Vitest file passes.

- [ ] **Step 7: Commit workflow changes**

```bash
git add .github/workflows/release.yml
git commit -m "ci: publish releases to tencent cos"
```

## Task 4: Release Documentation

**Files:**
- Modify: `desktop/README.md`

- [ ] **Step 1: Update desktop release documentation**

In `desktop/README.md`, replace the current step:

```md
4. 把 `desktop/release/` 下的产物上传到 `FairyEver/SynapseAppRelease` 仓库的 GitHub Release。
```

with:

```md
4. 把 `desktop/release/` 下的产物整理为腾讯云 CDN 发布目录：安装包和 blockmap 长期归档到 `https://desktop.release.synapse.d2.pub/v<version>/`，`latest.yml` / `latest-mac.yml` 上传到 CDN 根目录供应用内更新检查。
5. 刷新 CDN 上的 `latest.yml` / `latest-mac.yml`，验证 CDN 可访问后，在 `FairyEver/SynapseAppRelease` 创建只包含下载链接和发版说明的 GitHub Release。
```

Add this paragraph immediately after the numbered list:

```md
发布前需要在 GitHub Secrets 中配置 `TENCENT_CLOUD_SECRET_ID`、`TENCENT_CLOUD_SECRET_KEY` 和 `RELEASE_REPO_TOKEN`。腾讯云密钥应限制在 `synapse-desktop-release-1252371654` 的发布前缀写入权限，以及 `desktop.release.synapse.d2.pub` 的 CDN URL 刷新权限。
```

- [ ] **Step 2: Verify README wording**

Run:

```bash
rg -n "desktop.release.synapse.d2.pub|TENCENT_CLOUD_SECRET_ID|GitHub Release" desktop/README.md
```

Expected: output includes the new CDN URL, Tencent Cloud secret names, and the release-notes-only GitHub Release wording.

- [ ] **Step 3: Commit docs**

```bash
git add desktop/README.md
git commit -m "docs: document tencent cdn release flow"
```

## Task 5: Final Verification

**Files:**
- Verify: `.github/workflows/release.yml`
- Verify: `desktop/package.json`
- Verify: `desktop/scripts/prepare-cdn-release-artifacts.mjs`
- Verify: `desktop/tests/unit/release-cdn-artifacts.test.ts`
- Verify: `desktop/README.md`
- Verify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Run focused tests**

```bash
pnpm --filter @synapse/desktop exec vitest run tests/unit/release-cdn-artifacts.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck**

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS. This also catches JSON and TypeScript issues outside the release script.

- [ ] **Step 3: Verify workflow syntax and release provider**

```bash
node - <<'NODE'
const fs = require('fs')
const yaml = require('yaml')
yaml.parse(fs.readFileSync('.github/workflows/release.yml', 'utf8'))
const pkg = require('./desktop/package.json')
const publish = pkg.build.publish[0]
if (publish.provider !== 'generic') throw new Error('publish provider is not generic')
if (publish.url !== 'https://desktop.release.synapse.d2.pub/') throw new Error('publish url is wrong')
console.log('release config ok')
NODE
```

Expected:

```text
release config ok
```

- [ ] **Step 4: Review local changes**

```bash
git status --short
git diff --stat HEAD
```

Expected: only the planned files are changed after the task commits. Existing unrelated working tree changes may still appear and must not be reverted.

- [ ] **Step 5: Final report**

Report:

- the new CDN updater URL;
- the required GitHub secrets;
- the validation commands and results;
- that old released clients are intentionally not bridged.

## Implementation Notes

- Do not run the release workflow from local development.
- Do not upload test files to the real COS bucket during local verification.
- Do not print Tencent Cloud credentials in logs.
- Keep `desktop/package.json` `package:mac` and `package:win` scripts using `--publish never`; the workflow owns upload.
- If `curl --head` fails for installer URLs because CDN or COS rejects `HEAD`, change only that verification to a ranged `GET`:

```bash
curl --fail --silent --show-error --location --range 0-0 --output /dev/null "$url"
```

## Self-Review

- Spec coverage: COS bucket, CDN domain, version archive layout, root `latest*.yml`, GitHub Release notes only, no bridge for old versions, CDN refresh, verification, and secret handling are covered.
- Red-flag scan: no incomplete markers or unspecified implementation steps remain.
- Type consistency: the script CLI flags, workflow paths, bucket name, region, CDN domain, and package publish URL match the approved spec.

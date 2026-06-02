# Tencent COS Release CDN Design

## Status

Approved direction on 2026-06-02.

The release source of truth will move from GitHub Release assets to Tencent Cloud COS behind Tencent Cloud CDN. GitHub Release will remain as the public release notes page, but it will not carry large installer assets.

Current Tencent Cloud resources:

- COS bucket: `synapse-desktop-release-1252371654`
- COS region: `ap-beijing`
- CDN domain: `desktop.release.synapse.d2.pub`
- CDN CNAME: `desktop.release.synapse.d2.pub.cdn.dnsv1.com`
- CDN source type: COS source
- CDN service region: China mainland
- HTTPS certificate: configured, expires at `2026-08-31 07:59:59`
- CDN authentication: disabled
- COS origin authentication: disabled
- CDN cache auto-refresh: not configured

## Problem

Synapse currently publishes desktop installers as GitHub Release assets in `FairyEver/SynapseAppRelease`. The packaged app uses `electron-updater`, with `desktop/package.json` configured for the GitHub publish provider.

This has three problems for the desired release flow:

- app update checks and downloads depend on GitHub;
- large installer downloads are slower or less reliable for some users;
- GitHub Release owns both release notes and binary distribution, even though Tencent Cloud CDN is better suited for binary delivery.

## Goals

- Store every release version permanently in COS.
- Serve downloads and updater metadata through Tencent Cloud CDN.
- Keep GitHub Release as release notes only.
- Make new app versions check updates from `desktop.release.synapse.d2.pub`.
- Keep using `electron-updater` and electron-builder update metadata.
- Avoid a bridge release for already published versions; old versions do not need automatic migration to the new update source.
- Keep the release workflow small and close to the existing GitHub Actions structure.

## Non-Goals

- Do not build a custom update protocol.
- Do not replace `electron-updater`.
- Do not upload large installer assets to GitHub Release after the switch.
- Do not migrate old GitHub-hosted releases into COS as part of the first change.
- Do not enable CDN authentication or signed URLs in the first version.
- Do not change app UI for update checking.

## URL Layout

The CDN root is:

```text
https://desktop.release.synapse.d2.pub/
```

Fixed updater metadata paths:

```text
https://desktop.release.synapse.d2.pub/latest.yml
https://desktop.release.synapse.d2.pub/latest-mac.yml
```

Permanent version archive paths:

```text
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe.blockmap
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.dmg
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.dmg.blockmap
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.zip
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.zip.blockmap
```

The same layout applies to each later version. Versioned files are immutable once published. Only the fixed `latest*.yml` files are overwritten by newer releases.

## Release Flow

The existing GitHub Actions release workflow still builds macOS and Windows installers.

After collecting release artifacts, the publish job should:

1. Read the desktop package version, for example `0.2.214`.
2. Upload installer and blockmap files to `cos://synapse-desktop-release-1252371654/v0.2.214/`.
3. Rewrite generated `latest.yml` and `latest-mac.yml` so each file `path` points to the version archive, for example `v0.2.214/Synapse-0.2.214-win-x64.exe`.
4. Upload the rewritten metadata files to the COS bucket root as `latest.yml` and `latest-mac.yml`.
5. Refresh CDN URLs for `latest.yml` and `latest-mac.yml`.
6. Create or update the GitHub Release without large assets.
7. Write GitHub Release notes that include CDN download links for the versioned installers.

The publish job should fail if upload, metadata rewrite, CDN refresh, or basic CDN verification fails.

## Electron Builder Configuration

`desktop/package.json` should switch from GitHub publish provider to generic provider:

```json
{
  "provider": "generic",
  "url": "https://desktop.release.synapse.d2.pub/",
  "channel": "latest"
}
```

The package scripts can continue using `--publish never`; the workflow performs upload itself. The important part is that packaged app metadata points `electron-updater` at the CDN generic provider.

## Metadata Rewrite

electron-builder generates update metadata near the installer artifacts:

- `latest.yml` for Windows;
- `latest-mac.yml` for macOS.

Because the desired archive layout stores installers inside `v<version>/`, the workflow must rewrite metadata before uploading fixed latest files.

Required behavior:

- preserve generated `version`, `sha512`, `files`, `size`, and update metadata fields;
- rewrite every installer or blockmap path inside `path` and `files[].url` to include the version prefix;
- keep paths relative to the CDN root, not GitHub URLs;
- fail fast if a metadata path references a file that was not uploaded.

Example:

```yaml
version: 0.2.214
path: v0.2.214/Synapse-0.2.214-win-x64.exe
files:
  - url: v0.2.214/Synapse-0.2.214-win-x64.exe
    sha512: ...
    size: ...
```

## CDN Cache Policy

Tencent Cloud currently shows `CDN缓存自动刷新` as not configured for the COS domain, so the workflow must actively refresh updater metadata.

Recommended cache behavior:

- `latest.yml`: short cache, or actively refreshed on every release;
- `latest-mac.yml`: short cache, or actively refreshed on every release;
- `v*/*`: long cache because versioned assets are immutable;
- `*.blockmap`: long cache because blockmaps are versioned assets.

The release workflow should call Tencent Cloud CDN refresh for:

```text
https://desktop.release.synapse.d2.pub/latest.yml
https://desktop.release.synapse.d2.pub/latest-mac.yml
```

Refreshing versioned installers is not required for correctness, because the filenames are new for each version.

## GitHub Release Output

GitHub Release remains useful as a changelog and public version history page.

It should no longer upload:

- `.dmg`
- `.zip`
- `.exe`
- `.blockmap`
- `latest*.yml`

The release body should include download links such as:

```text
macOS Apple Silicon:
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.dmg

Windows x64:
https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe
```

GitHub-generated source archives may still appear automatically.

## Required Secrets

GitHub Actions should receive Tencent Cloud credentials through repository secrets.

Recommended names:

```text
TENCENT_CLOUD_SECRET_ID
TENCENT_CLOUD_SECRET_KEY
TENCENT_CLOUD_COS_BUCKET=synapse-desktop-release-1252371654
TENCENT_CLOUD_COS_REGION=ap-beijing
TENCENT_CLOUD_CDN_DOMAIN=desktop.release.synapse.d2.pub
```

The Tencent Cloud CAM identity should be scoped to the smallest practical release permissions:

- upload and overwrite objects under `synapse-desktop-release-1252371654`;
- read objects for verification if needed;
- refresh CDN paths for `desktop.release.synapse.d2.pub`.

## Verification

The release workflow should verify:

- expected artifact files exist before upload;
- all expected files are uploaded to the version prefix;
- `latest.yml` and `latest-mac.yml` parse as YAML after rewrite;
- rewritten metadata paths start with `v<version>/`;
- CDN `HEAD` or `GET` succeeds for both fixed metadata URLs after refresh;
- CDN `HEAD` or ranged `GET` succeeds for macOS and Windows installer URLs;
- GitHub Release exists and contains CDN links but no large uploaded assets.

Manual first-release smoke checks:

```bash
curl -I https://desktop.release.synapse.d2.pub/latest.yml
curl -I https://desktop.release.synapse.d2.pub/latest-mac.yml
curl -I https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-win-x64.exe
curl -I https://desktop.release.synapse.d2.pub/v0.2.214/Synapse-0.2.214-mac-arm64.dmg
```

## Failure Handling

If COS upload fails, the workflow must not update GitHub Release.

If metadata rewrite fails, the workflow must not upload `latest*.yml`.

If CDN refresh fails after upload, the workflow should fail and report the exact metadata URLs that need manual refresh.

If GitHub Release note creation fails after COS upload succeeds, the release artifacts remain valid because the updater source is CDN. The workflow should still fail so the release notes can be repaired.

## Security Notes

The first version keeps CDN authentication disabled. This matches the need for direct app downloads and simple `electron-updater` access.

Do not log Tencent Cloud secrets. CI logs may print bucket, region, object keys, CDN URLs, and release version, but never `SecretId`, `SecretKey`, Authorization headers, or signed request details.

If future abuse protection is needed, prefer CDN rate limiting, usage alerts, traffic caps, or EdgeOne/CDN security configuration before adding signed download URLs. Signed URLs would require a separate updater design.

## Open Follow-Up

Before implementation, choose the upload tool:

- TencentCloud/cos-action, if it supports the required upload and secret flow cleanly;
- COSCLI, if scripting and verification are clearer in the existing GitHub Actions workflow.

The implementation plan should check current Tencent Cloud CLI/action behavior before choosing one.

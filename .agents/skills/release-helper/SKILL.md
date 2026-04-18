# Release Helper

Use this skill when preparing a Synapse release.

## Goal

Keep version bumps and release notes deterministic.

## Steps

1. Run `pnpm release:plan`.
2. If the suggested bump needs to be overridden, rerun with:
   - `pnpm release:plan -- --minor`
   - `pnpm release:plan -- --patch`
   - `pnpm release:plan -- --no-release`
3. Apply the release files with:
   - `pnpm release:apply`
   - or `pnpm release:apply -- --minor`
   - or `pnpm release:apply -- --patch`
4. Verify:
   - `package.json` version changed as expected
   - `CHANGELOG.md` has a new top entry
   - `pnpm typecheck` passes
5. Do not create tags, commits, or push unless the user explicitly asks.

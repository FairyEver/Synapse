# Enterprise WeChat Skills

- Repository: `https://github.com/WeComTeam/wecom-cli`
- Commit: `55785fa0a5c922279533a5b5a836b44b56f65ce7`
- Imported path: `skills/`
- Source snapshot: 15 Skills, 194 files
- Included subset: 8 Skills, 68 upstream files (70 files including this notice and `LICENSE`)
- License: MIT, copied to `LICENSE`

Synapse includes only `wecomcli-shared`, `wecomcli-message`, `wecomcli-email`,
`wecomcli-contact`, `wecomcli-media`, `wecomcli-doc-manage`, `wecomcli-sheet`,
and `wecomcli-smartsheet`. Local changes are limited to:

- Removing the `wecom-cli` binary requirement from each top-level Skill.
- Adding the Synapse execution note to each business Skill.
- Replacing the shared installation, authentication, version checks, and direct
  CLI execution instructions with the Synapse connector and
  `app_wecom_cli_run`.
- Removing routes and cross-Skill dependencies for excluded capabilities.

## Permanent Exclusions

The following Skills are outside Synapse's long-term product scope and must
never be imported, installed, routed to, or reintroduced during upstream updates:

- `wecomcli-disk`
- `wecomcli-todo`
- `wecomcli-meeting`
- `wecomcli-calendar`
- `wecomcli-pptx`
- `wecomcli-smartpage`
- `wecomcli-doc`

Use the eight-Skill allowlist above for every future synchronization. Do not
copy the upstream `skills/` directory wholesale. The alignment tests enforce
the exact included set and reject references to excluded Skills.

The command adapter also rejects `disk`, `todo`, `meeting`, `calendar`, `slide`
and `smartpage`. The `doc` service is retained only for `search`, `names update`,
`members update` and `rules update`, required by `wecomcli-doc-manage`.

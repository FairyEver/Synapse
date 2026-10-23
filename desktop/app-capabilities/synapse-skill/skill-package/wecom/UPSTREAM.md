# Enterprise WeChat Skills

- Repository: `https://github.com/WeComTeam/wecom-cli`
- Commit: `55785fa0a5c922279533a5b5a836b44b56f65ce7`
- Imported path: `skills/`
- Source snapshot: 15 Skills, 194 files
- Included subset: 2 Skills, 2 upstream files (4 files including this notice and `LICENSE`)
- License: MIT, copied to `LICENSE`

Synapse includes only `wecomcli-shared` and `wecomcli-message`.
Local changes are limited to:

- Removing the `wecom-cli` binary requirement from each top-level Skill.
- Adding the Synapse execution note to each business Skill.
- Replacing the shared installation, authentication, version checks, and direct
  CLI execution instructions with the Synapse connector and
  `app_wecom_cli_run`.
- Removing routes and cross-Skill dependencies for excluded capabilities.
- Folding the minimal `media upload` instructions into the message Skill so
  messages can still include local images, files, voice and video without a
  standalone media Skill.

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
- `wecomcli-contact`
- `wecomcli-media`
- `wecomcli-email`
- `wecomcli-doc-manage`
- `wecomcli-sheet`
- `wecomcli-smartsheet`

Use the two-Skill allowlist above for every future synchronization. Do not
copy the upstream `skills/` directory wholesale. The alignment tests enforce
the exact included set and reject references to excluded Skills.

The command adapter allows only `message`, `media`, `identity` and `schema`.
The `media` service permits only `upload` as a shared dependency of messaging;
`download` and all other media commands are rejected. The adapter rejects
`mail`, `contact`, `doc`, `sheet`, `smartsheet`, `disk`, `todo`, `meeting`,
`calendar`, `slide`, `smartpage` and `parser`. Their exclusive references,
templates and Python scripts are not shipped.

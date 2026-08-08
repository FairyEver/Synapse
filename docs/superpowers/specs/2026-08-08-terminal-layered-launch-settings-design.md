# Synapse Terminal Layered Launch Settings

## Status

Final

## Product boundary

Terminal owns its launch configuration. The global entry is in the Terminal Header beside “新建终端”; it is not part of System Settings. A group owns its second-level settings, and each saved command owns its third-level settings. The current-session toolbar remains unchanged.

The effective order is:

1. allowlisted OS bootstrap environment;
2. Synapse built-ins;
3. global Terminal settings;
4. group settings;
5. saved-command settings;
6. an explicitly authorized one-time override.

Later layers override earlier layers. Shell and working directory either inherit or replace. An environment entry is absent/inherited, `set` to a string (including the empty string), or `unset` so the child does not receive it. Windows names compare case-insensitively; macOS and Linux names remain case-sensitive.

`TERM_PROGRAM=Synapse` and `TERM_PROGRAM_VERSION=<app version>` identify the terminal host and cannot be changed or removed. Names, entry count, per-value bytes, and total bytes are validated before PTY creation. Internal `SYNAPSE_*` and `MCP_*` names remain protected.

## Interaction

- Header actions are ordered “新建终端”, “终端设置”.
- Global settings use a large `Dialog + DialogFrame` with “常规 / 环境变量” tabs.
- Group settings retain the group name and add the shared launch form.
- Saved-command editing retains one command body and adds the shared launch form. Its launch layer applies to the whole new session before the saved input sequence is delivered.
- The environment table shows explicit entries and protected built-ins. A row can override, restore inheritance, or select “不传入”. Values are masked by default and can be shown or copied one at a time.
- Closing a dirty global, group, or command form requires confirmation. A failed save preserves the draft. Revision conflicts do not overwrite either side.
- Existing sessions and their scroll positions are not closed or recreated when a settings dialog opens or when configuration changes.

## Data and security

Global settings use singleton metadata plus an encrypted body. Group and command metadata contain shell, cwd, environment keys, unset keys, references, and revisions; values and command text remain in encrypted namespaces. Safe-storage failure never downgrades values to plaintext.

Old string maps are interpreted as `set` entries. Missing command launch layers dynamically inherit global and group settings. Old session records are not assigned guessed revisions. Each new session snapshots the applied global/group/command revisions and redacted launch facts.

Ordinary backups exclude all Terminal encrypted bodies, retained output, checkpoints, delete intents, and idempotency state.

## API and MCP

UI IPC exposes `globalLaunch.get/update`, group settings, command CRUD/launch, and one generic launch working-directory picker. All PTY creation paths call the same launch resolver.

MCP adds `app.terminal.global_launch.get` and `app.terminal.global_launch.update`. The update capability requires `settings.manage`; group and command management retain their existing permission families. MCP responses never contain environment values. They expose only key, action, source, and revision, while command bodies remain separately permissioned.

## Non-goals

MVP does not add global/group initialization commands, Shell Profile management, `.env` import, bulk paste, variable interpolation, Secret Store references, or automatic remote/container propagation.

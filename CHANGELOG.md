# Changelog

## [Unreleased]

### Changed

- **Scheduled tasks**: PATH is now merged with login shell PATH by default. Previously, user-specified PATH fully replaced the login shell PATH. To restore the old behavior, set PATH mode to "替换" (replace) in the task form.

### Added

- **Scheduled tasks**: PATH mode toggle (合并/替换) in task configuration.
- **Scheduled tasks**: Login shell checkbox to control `-lc` vs `-c` for POSIX shells.
- **Scheduled tasks**: Environment variable field placeholder and description hints.
- **Scheduled tasks**: Diagnostics block (PATH entries, env keys, shell command) shown in run logs on failure.
- **Documentation**: `docs/scheduler/path-and-env.md` technical reference.
- **Documentation**: `website/advanced/scheduler-env.md` user guide.

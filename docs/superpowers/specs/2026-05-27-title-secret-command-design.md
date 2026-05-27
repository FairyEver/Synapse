# Title Secret Command Design

## Context

The settings About page currently opens repository maintenance by clicking the Synapse logo ten times. This should become a hidden title-character command instead. The title text `Synapse AI Studio` acts like an unadvertised click surface: a user who knows the private sequence can click specific character positions to trigger hidden commands.

This is a discovery barrier, not a security boundary. Anyone who reads the code can find the commands.

## Goals

- Make each visible title character clickable without changing the title's visual appearance.
- Match hidden commands by character index, not by character value. The first `S` and second `S` are different inputs.
- Move all hidden command registration to one settings module file.
- Replace the existing ten-logo-click repository maintenance entry with a title-character command.
- Keep the implementation small and local to the settings About page.

## Non-Goals

- Do not add a configurable UI for secret commands.
- Do not add authentication, encryption, or permission enforcement.
- Do not add global hidden commands outside the About page.
- Do not show tooltips, helper text, badges, or other UI hints for the hidden entry.

## Title Indexes

The command source string is exactly:

```text
Synapse AI Studio
```

Stable indexes:

```text
0  S
1  y
2  n
3  a
4  p
5  s
6  e
7  space
8  A
9  I
10 space
11 S
12 t
13 u
14 d
15 i
16 o
```

Spaces render normally but are not clickable. Command sequences should use only clickable character indexes.

## Initial Command

The first registered command replaces the current ten-logo-click behavior:

```ts
{
  id: "repository-maintenance",
  sequence: [0, 11, 8, 9],
  action: "enableRepositoryMaintenance",
}
```

This means: first `S`, second `S`, `A`, `I`.

## Architecture

Add a settings-local registry file at `desktop/src/modules/settings/secret-commands.ts`.

It owns:

- the source title string
- the list of clickable title parts
- the command registry
- registry validation helpers

Each command contains:

- `id`: stable command identifier for logs and tests
- `sequence`: readonly number array of title indexes
- `action`: declarative action name, such as `enableRepositoryMaintenance`

Add a hook at `desktop/src/modules/settings/hooks/use-secret-command-sequence.ts`.

It owns:

- click buffer state
- ten-second reset timer
- maximum buffer length based on the longest registered command
- suffix matching against registered command sequences
- clearing the buffer after a match

`AboutPanel` remains responsible for rendering and connecting actions to existing state. It passes clicked title indexes into the hook. When the hook reports `enableRepositoryMaintenance`, `AboutPanel` calls the existing `onAdminModeChange(true)`.

## Matching Rules

- A click contributes only the character index.
- Matching ignores the displayed character value.
- The buffer keeps only the latest `N` indexes, where `N` is the longest registered command length.
- Each click checks whether the buffer suffix exactly equals a registered command sequence.
- Ten seconds without a click clears the buffer.
- A successful command clears the buffer.
- Registry validation rejects:
  - empty sequences
  - duplicate command ids
  - indexes outside the title string
  - indexes for non-clickable spaces
  - duplicate sequences
  - prefix conflicts between commands

Prefix conflicts are rejected so `[0, 11]` cannot accidentally trigger before `[0, 11, 8, 9]`.

## UI Behavior

The title should still read as normal text. Character click targets should not add visible button styling, hover decoration, helper text, or cursor hints. The logo should no longer trigger repository maintenance.

This hidden entry does not need to be advertised to assistive technologies because it is intentionally undiscoverable and not a primary navigation path. The resulting repository maintenance panel remains available through the normal settings sidebar after the command has been entered.

## Logging

When a command triggers, log the command id and action. Do not log the raw click buffer or full sequence.

## Testing

Add focused tests for:

- index matching distinguishes the first `S` from the second `S`
- the repository maintenance sequence enables admin mode
- the old logo-click behavior no longer enables admin mode
- incorrect sequences do not trigger commands
- the ten-second timeout clears the buffer
- the buffer trims to the longest registered command length
- registry validation rejects duplicate ids, duplicate sequences, invalid indexes, space indexes, and prefix conflicts

## Release Notes

Implementation should update `RELEASE_NOTES_PENDING.md` with a generic note that the hidden repository maintenance entry moved from logo clicks to the About page title. The release note must not include the sequence.

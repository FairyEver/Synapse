# Cheat Code Title Sequence Design

## Context

The settings About page currently opens repository maintenance by clicking the Synapse logo ten times. This should become a cheat code triggered through the About page title.

A cheat code is a code-defined string such as `model:flow:disable`. The string is the stable command identity. The current title-character sequence is only one input binding for that identity. If Synapse later abandons title clicking, the cheat code names and callbacks can remain while a different input method is attached.

The title text `Synapse AI Studio` acts like an unadvertised click surface: a user who knows the private sequence can click specific character positions to execute a registered cheat code.

This is a discovery barrier, not a security boundary. Anyone who reads the code can find the commands.

## Goals

- Add a small cheat code layer whose stable identity is a code-defined string.
- Register each cheat code in one place with its name, settings title click sequence, and callback.
- Document the cheat code rules in `AGENTS.md` so later AI sessions know to reuse the cheat code layer.
- Make each visible title character clickable without changing the title's visual appearance.
- Match title input bindings by character index, not by character value. The first `S` and second `S` are different inputs.
- Replace the existing ten-logo-click repository maintenance entry with a title-sequence cheat code.
- Keep the implementation small and local to the settings About page.

## Non-Goals

- Do not add a configurable UI for cheat codes.
- Do not add authentication, encryption, or permission enforcement.
- Do not add alternate cheat code input methods in this iteration.
- Do not show tooltips, helper text, badges, or other UI hints for the hidden entry.

## Title Indexes

The title source string is exactly:

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

Spaces render normally but are not clickable. Title sequences should use only clickable character indexes.

## Initial Cheat Code

The first registered cheat code replaces the current ten-logo-click behavior:

```ts
{
  name: "settings:repository-maintenance:enable",
  settingsTitleSequence: [0, 11, 8, 9],
  run: ({ enableRepositoryMaintenance }) => enableRepositoryMaintenance(),
}
```

This means: first `S`, second `S`, `A`, `I`.

## Architecture

Add a settings-local registry file at `desktop/src/modules/settings/cheat-codes.ts`.

It owns:

- the cheat code registry
- the source title string
- the list of clickable title parts for the settings title input binding
- registry validation helpers

Each cheat code contains:

- `name`: stable string identifier, for example `settings:repository-maintenance:enable`
- `settingsTitleSequence`: readonly number array of title indexes
- `run`: callback function that receives a small action context and executes the feature

The registry is the only place where cheat code names, title sequences, and callbacks are joined together.

Add a hook at `desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts`.

It owns:

- click buffer state
- ten-second reset timer
- maximum buffer length based on the longest registered title sequence
- suffix matching against registered title sequences
- clearing the buffer after a match

`AboutPanel` remains responsible for rendering and providing the callback context. It passes clicked title indexes into the hook. When the hook matches a cheat code, the registered `run` callback receives the context and can call the existing `onAdminModeChange(true)` through `enableRepositoryMaintenance`.

The title-sequence hook should depend on the registry interface, not on repository maintenance directly. This keeps the input method replaceable without changing cheat code identities.

## Agent Guidance

Implementation must add a concise `AGENTS.md` rule explaining that hidden entries should register through the cheat code layer instead of scattering click-count or sequence logic through components. The rule should describe:

- cheat code names as stable code-defined strings
- each registration joining the name, current input binding, and callback
- input bindings as replaceable details
- title-character input matching by index, not character value
- logging the cheat code name without logging the raw sequence

The guidance should not include the actual repository maintenance title sequence.

## Matching Rules

- A click contributes only the character index.
- Matching ignores the displayed character value.
- The buffer keeps only the latest `N` indexes, where `N` is the longest registered title sequence length.
- Each click checks whether the buffer suffix exactly equals a registered title sequence.
- Ten seconds without a click clears the buffer.
- A successful cheat code clears the buffer.
- Registry validation rejects:
  - empty cheat code names
  - empty title sequences
  - duplicate cheat code names
  - indexes outside the title string
  - indexes for non-clickable spaces
  - duplicate sequences
  - prefix conflicts between title sequences

Prefix conflicts are rejected so `[0, 11]` cannot accidentally trigger before `[0, 11, 8, 9]`.

## UI Behavior

The title should still read as normal text. Character click targets should not add visible button styling, hover decoration, helper text, or cursor hints. The logo should no longer trigger repository maintenance.

This hidden entry does not need to be advertised to assistive technologies because it is intentionally undiscoverable and not a primary navigation path. The resulting repository maintenance panel remains available through the normal settings sidebar after the command has been entered.

## Logging

When a cheat code triggers, log the cheat code name. Do not log the raw click buffer or full sequence.

## Testing

Add focused tests for:

- index matching distinguishes the first `S` from the second `S`
- the repository maintenance cheat code sequence enables admin mode
- the old logo-click behavior no longer enables admin mode
- incorrect sequences do not trigger cheat codes
- the ten-second timeout clears the buffer
- the buffer trims to the longest registered title sequence length
- registry validation rejects duplicate names, duplicate sequences, invalid indexes, space indexes, and prefix conflicts
- cheat code callbacks are registered through the centralized registry instead of inside `AboutPanel`

## Release Notes

Implementation should update `RELEASE_NOTES_PENDING.md` with a generic note that the hidden repository maintenance entry moved from logo clicks to the About page title. The release note must not include the sequence or cheat code name.

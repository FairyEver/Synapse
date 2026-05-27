# Cheat Code Title Sequence Design

## Context

The settings About page currently opens repository maintenance by clicking the Synapse logo ten times. Logo clicking should remain as a hidden gesture, but it should only arm cheat code entry. After ten quick logo clicks, the About page title becomes easier to click and the user can enter a title-character sequence.

A cheat code is a code-defined string such as `model:flow:disable`. The string is the stable command identity. The current title-character sequence is only one input binding for that identity. If Synapse later abandons title clicking, the cheat code names and callbacks can remain while a different input method is attached.

The title text `Synapse AI Studio` acts like an unadvertised click surface while cheat code entry is armed: a user who knows the private sequence can click specific character positions to execute a registered cheat code.

This is a discovery barrier, not a security boundary. Anyone who reads the code can find the commands.

## Goals

- Add a small cheat code layer whose stable identity is a code-defined string.
- Register each cheat code in one place with its stable definition, current settings title click binding, and callback.
- Support one-shot action cheat codes and persistent state cheat codes.
- Document the cheat code rules in `AGENTS.md` so later AI sessions know to reuse the cheat code layer.
- Repurpose ten logo clicks to arm title-sequence entry instead of directly enabling repository maintenance.
- Make each visible title character clickable while entry is armed.
- Widen the title letter spacing while entry is armed so individual characters are easier to click without making the whole title oversized.
- Show a temporary per-character color cycling effect while entry is armed, using Tailwind default text color utilities only.
- Scale and bold each armed title character on hover with a CSS transition.
- Match title input bindings by character index, not by character value. The first `S` and second `S` are different inputs.
- Replace the existing ten-logo-click repository maintenance entry with a title-sequence cheat code.
- Use one shared ten-second timeout constant for logo-click arming, armed-mode reset, and title-sequence inactivity reset.
- Keep the implementation small and local to the settings About page.

## Non-Goals

- Do not add a configurable UI for cheat codes.
- Do not add authentication, encryption, or permission enforcement.
- Do not add alternate cheat code input methods in this iteration.
- Do not build a full plugin platform for dynamic third-party cheat code registration.
- Do not show tooltips, helper text, badges, or other UI hints for the hidden entry.
- Do not use custom colors, hex/rgb/hsl literals, glow shadows, gradients, or CSS keyframes for the color cycling effect.

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

Add shared cheat code types and a small manager in the renderer/shared layer. The manager owns registration validation and trigger semantics, but it does not know about title indexes or any other input method.

Each cheat code definition contains:

- `name`: stable string identifier, for example `settings:repository-maintenance:enable`
- `kind`: `action` for one-shot commands or `state` for persistent toggles
- `run`: callback function that receives a small action context; state callbacks also receive `{ active }`

Each registration joins a definition with a current input binding. For settings title input, that binding contains the title index sequence. This keeps the stable command identity separate from the hidden gesture used to invoke it.

State cheat codes use a persistent DataRepository-backed state service:

- namespace: `cheat-code.states`
- shape: `{ schemaVersion: 1, states: Record<string, boolean> }`
- APIs: get states, set state, and toggle state
- event: `cheat-code.stateChanged` with only `{ name, active }`

The state service persists before a state callback runs. If persistence fails, the callback does not run. If the callback fails, persisted state is not rolled back.

Keep a settings-local registry file at `desktop/src/modules/settings/cheat-codes.ts`.

It owns:

- the settings cheat code registrations
- the shared `CHEAT_CODE_INTERACTION_RESET_DELAY` value, set to 10000 ms
- the source title string
- the list of clickable title parts for the settings title input binding
- the Tailwind default color classes used for armed title feedback
- settings title binding validation helpers

The registry is the only place where settings cheat code definitions, title sequences, and callbacks are joined together.

Add a hook at `desktop/src/modules/settings/hooks/use-cheat-code-title-sequence.ts`.

It owns:

- logo click counting for arming title-sequence entry
- armed-state tracking
- click buffer state
- ten-second reset timer using the shared delay constant
- maximum buffer length based on the longest registered title sequence
- suffix matching against registered title sequences
- clearing the buffer and leaving armed mode after a timeout or successful match

`AboutPanel` remains responsible for rendering and providing the callback context. It passes logo clicks and title index clicks into the hook. When the hook matches a cheat code, the hook delegates to the cheat code manager. The registered action callback receives the context and can call the existing `onAdminModeChange(true)` through `enableRepositoryMaintenance`.

The title-sequence hook should depend on the registry interface, not on repository maintenance directly. This keeps the input method replaceable without changing cheat code identities.

## Agent Guidance

Implementation must add a concise `AGENTS.md` rule explaining that hidden entries should register through the cheat code layer instead of scattering click-count or sequence logic through components. The rule should describe:

- cheat code names as stable code-defined strings
- each registration joining the stable definition, current input binding, and callback
- `action` as one-shot behavior and `state` as persistent toggle behavior
- state persistence through the shared state manager, not component-local state or `localStorage`
- input bindings as replaceable details
- title-character input matching by index, not character value
- logging the cheat code name and state result without logging the raw sequence

The guidance should not include the actual repository maintenance title sequence.

## Matching Rules

- Ten logo clicks arm title-sequence entry. They do not run a cheat code.
- Title index clicks are ignored until title-sequence entry is armed.
- A click contributes only the character index.
- Matching ignores the displayed character value.
- The buffer keeps only the latest `N` indexes, where `N` is the longest registered title sequence length.
- Each click checks whether the buffer suffix exactly equals a registered title sequence.
- Ten seconds without a logo click before arming resets the logo click count.
- Ten seconds after arming with no title click exits armed mode.
- Ten seconds between title clicks clears the buffer and exits armed mode.
- A successful cheat code clears the buffer and exits armed mode.
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

The title should read as normal text before entry is armed. Character click targets should not add visible button styling, hover decoration, helper text, or cursor hints.

After ten logo clicks, the title keeps its normal `text-lg` size, widens its letter spacing, and each visible character receives a cycling Tailwind default text color class. Armed characters scale up and become bold on hover. The spacing, scale, and weight changes must use CSS transitions so the feedback is smooth, not abrupt. The effect is intentionally temporary feedback for clickability, not a custom visual system. It must not use custom colors, glow, gradients, inline styles, or keyframes. Ten seconds without title input reverts the title to normal spacing and default text color.

The logo click gesture should no longer trigger repository maintenance directly. It only arms title-sequence input.

This hidden entry does not need to be advertised to assistive technologies because it is intentionally undiscoverable and not a primary navigation path. The resulting repository maintenance panel remains available through the normal settings sidebar after the command has been entered.

## Logging

When a cheat code triggers, log the cheat code name and, for state cheat codes, the new active state. Do not log the raw click buffer or full sequence.

## Testing

Add focused tests for:

- index matching distinguishes the first `S` from the second `S`
- ten logo clicks arm title entry and widen the title letter spacing
- armed title characters scale and bold on hover with a CSS transition
- armed title characters use only registered Tailwind default color classes
- the repository maintenance cheat code sequence enables admin mode
- logo clicks alone do not enable admin mode
- incorrect sequences do not trigger cheat codes
- the shared ten-second timeout clears the logo click count before arming
- the shared ten-second timeout exits armed mode before title input
- the shared ten-second timeout exits armed mode and clears the buffer between title clicks
- the buffer trims to the longest registered title sequence length
- registry validation rejects duplicate names, duplicate sequences, invalid indexes, space indexes, and prefix conflicts
- cheat code callbacks are registered through the centralized registry instead of inside `AboutPanel`

## Release Notes

Implementation should update `RELEASE_NOTES_PENDING.md` with a generic note that the hidden repository maintenance entry now uses a logo-armed title sequence. The release note must not include the sequence or cheat code name.

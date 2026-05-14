# Prompt Library Design

## Context

`auto` currently has one editable prompt stored in `prompt.md` and one shared runtime configuration stored in `state/ui-config.json`. Both the web console and `pnpm once` load that single prompt into `UiConfig.prompt`, and the runner sends it to every parallel worker.

The new requirement is to support saving multiple prompts as a prompt library. Runtime settings remain shared; this is not a run-profile system.

## Goals

- Store multiple named prompts.
- Keep each prompt as an editable Markdown file.
- Let users create, rename, switch, save, and delete prompts from the existing web console.
- Preserve the existing runner contract: workers still receive `UiConfig.prompt`.
- Migrate an existing `prompt.md` into the first library prompt on first use.

## Non-Goals

- No per-prompt runtime settings.
- No prompt duplication or "save as" action in the first version.
- No prompt metadata such as last updated time or last run time.
- No prompt history, undo, or trash folder.
- No continued `prompt.md` mirror after migration.

## Storage

Prompts live under:

```text
auto/prompts/
  <name>.md
```

The prompt name is the file name without `.md`. For example, the prompt named `夜间审查` is stored at `prompts/夜间审查.md`.

`state/ui-config.json` stores the shared runtime settings and the selected prompt name. It does not store prompt content.

On load:

1. Ensure `prompts/` exists.
2. If `prompts/` contains no prompt files and `prompt.md` contains non-empty content, write that content to `prompts/default.md`.
3. Select the name stored in `state/ui-config.json` when that prompt exists.
4. Otherwise select the first prompt by file-name order.
5. If no prompt exists and there is no legacy content to migrate, create `prompts/default.md` with empty content and select `default`.

After migration, `prompt.md` is no longer read as the active prompt source.

## Name Validation

The first version rejects invalid names instead of silently rewriting them.

Prompt names must:

- Be non-empty after trimming.
- Not be `.` or `..`.
- Not include `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, or `|`.
- Not end with `.md` in the UI input.
- Not duplicate an existing prompt name.

All file operations must resolve the final path and verify it remains inside `auto/prompts/`.

## Server API

The existing `/api/config` remains the main config endpoint.

`GET /api/config` returns:

- Shared runtime settings.
- `prompt`: the selected prompt content.
- `activePromptName`: the selected prompt name.
- `prompts`: sorted prompt names.

`PUT /api/config` validates shared runtime settings, validates `activePromptName`, saves the selected prompt content to `prompts/<activePromptName>.md`, and persists the selected name in `state/ui-config.json`.

Prompt management endpoints:

- `POST /api/prompts` creates a new empty prompt.
- `GET /api/prompts/:name` returns one prompt's content.
- `PUT /api/prompts/:name/rename` renames the prompt file and updates the selected name when needed.
- `DELETE /api/prompts/:name` deletes the prompt file after the client confirms the action.

The server returns concise error messages for invalid names, duplicate names, missing prompts, and unsafe paths.

## UI Behavior

The existing configuration view keeps the current layout. Above the prompt editor, add:

- A prompt selector.
- `新建`
- `重命名`
- `删除`

The prompt editor continues to be the main editing surface.

Switching prompts:

1. If the editor has no unsaved changes, load the selected prompt.
2. If the editor has unsaved changes, show a confirmation with three choices:
   - Save current prompt and switch.
   - Discard current changes and switch.
   - Cancel.

Deleting prompts:

- Always ask for confirmation before deleting.
- After deletion, select another existing prompt if one exists.
- If the deleted prompt was the last prompt, keep the UI usable with an empty prompt state.

Creating prompts:

- Ask for a name.
- Validate it on the server.
- Create an empty `.md` file.
- Select the new prompt and show an empty editor.

Renaming prompts:

- Ask for the new name.
- Validate it on the server.
- Rename the file.
- Keep the current editor content associated with the renamed prompt.

## Runner Behavior

`runBatch` and `runWorker` continue to use `UiConfig.prompt`.

`pnpm once` loads the selected prompt through the same config loader used by the web console, so it runs the active prompt library item.

## Testing

Add focused Node tests for:

- Migrating non-empty `prompt.md` into `prompts/default.md` when the library is empty.
- Not migrating `prompt.md` when the library already has prompts.
- Listing prompt names from `.md` files only.
- Loading the active prompt from `activePromptName`.
- Falling back when the saved active prompt is missing.
- Saving prompt content to the selected prompt file.
- Rejecting invalid, duplicate, and path-escaping names.
- Creating, renaming, and deleting prompt files.

Existing runner tests should continue to pass without broad changes.

## Open Decisions

No open product decisions remain for the first version.

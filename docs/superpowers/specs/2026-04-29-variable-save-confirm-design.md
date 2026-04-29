# Variable Save Confirmation Design

## Goal

Make variable substitution during content installation clear and reversible:

- The first dialog decides values used for this installation.
- A second dialog decides whether changed values are saved to the current repository's local variables.

This removes the confusing inline switch from the substitution dialog.

## Storage Meaning

Settings > Variables maps to `activeRepository.variables` in Synapse local config.

Product copy should call this "本机变量" and mention the current repository only when needed. Avoid "保存到仓库" because it can sound like writing into the Git/content repository.

## User Flow

1. User starts installing content that contains placeholders such as `${{ BARK_ID }}`.
2. Synapse opens the variable substitution dialog.
3. The user reviews or edits replacement values.
4. User clicks `继续安装`.
5. Synapse compares submitted values with current local variables.
6. If there are no new variables and no changed existing variables, installation continues directly.
7. If there are new or changed variables, Synapse opens a save confirmation dialog.
8. User chooses whether to save the changes.
9. Installation continues either way.

## Dialog 1: Variable Substitution

Purpose: choose replacement values for this installation only.

Title:

```text
变量替换
```

Description:

```text
留空则保留原文。
```

Fields:

- One field per detected placeholder.
- Existing local variables prefill their stored values.
- Missing variables start empty.
- The user can edit any value.

Footer:

- Remove the `保存新变量到仓库` switch.
- Primary action: `继续安装`.

Behavior:

- Non-empty values are used as substitutions for this installation.
- Empty values are not substituted and leave the placeholder unchanged.
- This dialog never saves variables by itself.

## Change Detection

After `继续安装`, Synapse computes two lists.

New variables:

- Placeholder name does not exist in current repository local variables, case-insensitive.
- Submitted value is non-empty.

Updated variables:

- Placeholder name exists in current repository local variables, case-insensitive.
- Submitted value is non-empty.
- Submitted value differs from the stored value.

Ignored variables:

- Empty submitted values.
- Existing variables whose value did not change.

If both computed lists are empty, skip the second dialog.

## Dialog 2: Save Variable Changes

Purpose: decide whether this installation's values should be saved for future reuse.

Title:

```text
保存变量变更
```

Description:

```text
这些变量可在当前仓库复用。
```

Sections:

- `新增变量`
- `更新变量`

Only render sections that have items.

Each item shows the variable name. Do not show the value in the list by default, because variables may contain tokens or secrets.

Footer actions:

- Secondary: `仅本次使用`
- Primary: `保存并继续`

Behavior:

- `仅本次使用`: continue installation with the submitted substitutions, without changing local variables.
- `保存并继续`: append new variables and update changed existing variables, then continue installation.
- If saving fails, show `变量未保存，安装会继续。` and continue installation.

## Existing Variable Example

Stored local variable:

```text
BARK_ID = old-value
```

User edits the substitution value to:

```text
BARK_ID = new-value
```

Result:

- This installation uses `new-value`.
- The second dialog shows `BARK_ID` under `更新变量`.
- `仅本次使用` leaves stored `BARK_ID` as `old-value`.
- `保存并继续` updates stored `BARK_ID` to `new-value`.

## New Variable Example

No stored local variable named:

```text
NEW_TOKEN
```

User enters a value.

Result:

- This installation uses the entered value.
- The second dialog shows `NEW_TOKEN` under `新增变量`.
- `仅本次使用` does not save `NEW_TOKEN`.
- `保存并继续` appends `NEW_TOKEN` to current repository local variables.

## Error Handling

- Failure to save variables should not block installation.
- The user should receive the existing warning copy: `变量未保存，安装会继续。`
- Installation errors remain handled by the existing install flow.

## Implementation Boundaries

- Keep variable persistence in the current repository config model.
- Do not introduce a global variable store in this change.
- Do not write variables into the content repository directory.
- Do not add a new dependency.
- Keep UI built from existing shadcn dialog, button, label, and separator primitives.
- Avoid custom colors and custom styling.

## Acceptance Criteria

- The substitution dialog no longer contains a save switch.
- Existing variables still prefill substitution fields.
- Changing an existing variable triggers the save confirmation dialog.
- Entering a value for a missing variable triggers the save confirmation dialog.
- Leaving missing variables empty does not trigger the save confirmation dialog.
- Unchanged existing variables do not trigger the save confirmation dialog.
- Choosing `仅本次使用` installs with submitted values but does not update settings variables.
- Choosing `保存并继续` saves new and changed variables, then installs.
- Save failure warns the user but installation continues.

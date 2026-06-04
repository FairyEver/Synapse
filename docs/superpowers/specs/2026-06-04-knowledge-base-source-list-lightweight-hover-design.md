# Knowledge Base Source List Lightweight Hover Design

## Context

The Knowledge Base source manager list currently uses horizontal dividers between rows. Directory navigation is attached only to the directory name button, which makes opening a folder require precise clicking. The row action button also has a small perceived target.

This design covers only the main source list row treatment in the source manager window. Toolbar, sidebar tree, upload flow, drag/drop behavior, and mutation dialogs stay unchanged except where row hit testing needs to keep existing behavior intact.

## Goals

- Remove the horizontal separators between source rows.
- Make rows feel lighter by using a subtle hover background instead of persistent dividers.
- Keep row contents visually padded inside the hover background, including the right action area.
- Make directory rows open when the user clicks the empty area of the row, not only the name.
- Keep checkbox, drag/drop, and the right actions from accidentally triggering directory open.
- Increase the right action button hit target while keeping the visual treatment quiet.

## Design

Use approach A from the visual brainstorm:

- The list container becomes a vertical stack with a small gap between rows instead of `divide-y`.
- Each row uses token-based classes only, with a rounded hover surface such as `hover:bg-muted` or the existing accent token if that matches the component baseline better.
- Row padding is applied to the row itself so the hover surface has breathing room around the checkbox, icon/text block, and right action button.
- The right dropdown trigger remains visually ghost-like. Its clickable box should be around 40-44 px tall/wide so it is easy to hit without adding a heavy button background by default.
- Directory rows receive a row-level click handler that opens the directory. File rows do not gain a primary row click action.
- Interactive children stop propagation where needed: checkbox, dropdown trigger, menu items, and drag/drop events must not open the directory.

## Interaction Rules

- Clicking a directory row's empty area opens that folder.
- Clicking the directory name still opens that folder.
- Clicking the checkbox only toggles selection.
- Clicking the right action button only opens the menu.
- Selecting any menu item only performs that menu action.
- Dragging and dropping on directory rows keeps the existing move behavior.
- Keyboard and accessible labels should remain equivalent to the current behavior.

## Testing

Add focused renderer tests around the changed row behavior:

- Directory row click opens the directory.
- Checkbox click on a directory row does not open the directory.
- More-action click on a directory row does not open the directory.
- Existing drag/drop directory move behavior still passes.

Run the source manager test file after implementation. A broader desktop typecheck can be used if the edit touches shared types or helpers, but the intended change is local to one renderer component and its tests.

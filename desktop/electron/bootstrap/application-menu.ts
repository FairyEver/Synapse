import { Menu, type MenuItemConstructorOptions } from "electron"

/**
 * The one place the application menu is defined.
 *
 * Synapse never set this before, so Electron's default menu was in charge — including
 * View → Reload, which owns `⌘R`. A reload tears the renderer down, and since the active app is
 * plain React state that is never persisted, the user lands back on the default dock app with the
 * terminal no longer in view. Reload is not a workflow this app supports, so the menu is explicit
 * now and simply does not carry it.
 *
 * That is also what frees `⌘R`: with no accelerator claiming it, the key reaches the renderer,
 * where the terminal claims it as the rename shortcut.
 *
 * Every item that stays mirrors what the default menu offered, so this is not a redesign of the
 * menu bar. `viewMenu` is spelled out by hand only because the built-in `viewMenu` role is the one
 * that carries the reload items.
 */
function buildApplicationMenuTemplate(): MenuItemConstructorOptions[] {
  const viewMenu: MenuItemConstructorOptions = {
    label: "View",
    submenu: [
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  }
  return process.platform === "darwin"
    ? [{ role: "appMenu" }, { role: "editMenu" }, viewMenu, { role: "windowMenu" }]
    : [{ role: "fileMenu" }, { role: "editMenu" }, viewMenu, { role: "windowMenu" }]
}

function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildApplicationMenuTemplate()))
}

export { buildApplicationMenuTemplate, installApplicationMenu }

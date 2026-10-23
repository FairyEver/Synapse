export interface ClipboardAdapter {
  readonly kind: "electron" | "unavailable"
  readText(): string | Promise<string>
  writeText(text: string): void | Promise<void>
}

export interface ElectronClipboardPort {
  readText(): string | Promise<string>
  writeText(text: string): void | Promise<void>
}

export function createElectronClipboardAdapter(
  clipboard: ElectronClipboardPort,
): ClipboardAdapter {
  try {
    if (
      !clipboard
      || typeof clipboard.readText !== "function"
      || typeof clipboard.writeText !== "function"
    ) {
      return createUnavailableClipboardAdapter()
    }
  } catch {
    return createUnavailableClipboardAdapter()
  }
  return {
    kind: "electron",
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  }
}

export function createUnavailableClipboardAdapter(): ClipboardAdapter {
  return {
    kind: "unavailable",
    readText() {
      throw new Error("Clipboard adapter unavailable.")
    },
    writeText() {
      throw new Error("Clipboard adapter unavailable.")
    },
  }
}

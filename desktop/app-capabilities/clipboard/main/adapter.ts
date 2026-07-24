export interface ClipboardAdapter {
  readonly kind: "electron" | "unavailable"
  readText(): string
  writeText(text: string): void
}

export interface ElectronClipboardPort {
  readText(): string
  writeText(text: string): void
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

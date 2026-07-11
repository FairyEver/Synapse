export function encodeTerminalCommandInput(command: string): string {
  const encoded = command
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r")

  return encoded.endsWith("\r") ? encoded : `${encoded}\r`
}

export function isBinaryDiff(text: string): boolean {
  return /^Binary files .+ differ$/m.test(text) || /^GIT binary patch$/m.test(text)
}

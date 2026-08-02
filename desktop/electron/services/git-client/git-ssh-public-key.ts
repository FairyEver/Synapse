import { createHash } from "node:crypto"
import path from "node:path"
import type { SynapseGitSshPublicKey } from "../../../src/types/git"

export type GitSshPublicKeyDetails = {
  readonly path: string | null
  readonly type: string | null
  readonly comment: string | null
  readonly fingerprint: string | null
}

export async function findCommonSshPublicKey(input: {
  readonly homeDir: string
  readonly pathExists: (filePath: string) => Promise<boolean>
  readonly readFile: (filePath: string) => Promise<string>
}): Promise<SynapseGitSshPublicKey | null> {
  const sshDirectory = path.join(input.homeDir, ".ssh")
  for (const name of ["id_ed25519.pub", "id_rsa.pub"] as const) {
    const filePath = path.join(sshDirectory, name)
    if (!(await input.pathExists(filePath))) continue
    const content = (await input.readFile(filePath)).trim()
    if (content) return { path: filePath, content }
  }
  return null
}

export function parseSshPublicKeyDetails(key: SynapseGitSshPublicKey | null): GitSshPublicKeyDetails {
  if (!key) return emptySshPublicKeyDetails()
  const fields = key.content.trim().split(/\s+/)
  const type = fields[0] || null
  const encodedKey = fields[1] || null
  const comment = fields.slice(2).join(" ") || null
  let fingerprint: string | null = null
  if (encodedKey) {
    try {
      fingerprint = `SHA256:${createHash("sha256")
        .update(Buffer.from(encodedKey, "base64"))
        .digest("base64")
        .replace(/=+$/u, "")}`
    } catch {
      fingerprint = null
    }
  }
  return { path: key.path, type, comment, fingerprint }
}

export function emptySshPublicKeyDetails(): GitSshPublicKeyDetails {
  return { path: null, type: null, comment: null, fingerprint: null }
}

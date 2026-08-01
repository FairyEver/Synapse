import type {
  SynapseGitProvider,
  SynapseGitProviderLinks,
  SynapseGitRemoteDescriptor,
} from "@/types/git"

const PROVIDER_LINKS: Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>> = {
  github: {
    credentialHelpUrl: "https://docs.github.com/en/get-started/git-basics/caching-your-github-credentials-in-git",
    sshKeysUrl: "https://github.com/settings/keys",
    tokenUrl: "https://github.com/settings/tokens",
  },
  gitee: {
    credentialHelpUrl: null,
    sshKeysUrl: "https://gitee.com/profile/sshkeys",
    tokenUrl: null,
  },
  gitlab: {
    credentialHelpUrl: null,
    sshKeysUrl: "https://gitlab.com/-/user_settings/ssh_keys",
    tokenUrl: null,
  },
  generic: {
    credentialHelpUrl: null,
    sshKeysUrl: null,
    tokenUrl: null,
  },
}

const SCP_LIKE_REMOTE_PATTERN = /^([^@\s]+)@([^:\s]+):.+$/

function detectProvider(host: string | null): SynapseGitProvider {
  if (host === "github.com") return "github"
  if (host === "gitee.com") return "gitee"
  if (host === "gitlab.com") return "gitlab"
  return "generic"
}

function normalizeHost(host: string): string {
  return host.toLowerCase()
}

function buildDescriptor(
  remoteUrl: string,
  host: string | null,
  protocol: SynapseGitRemoteDescriptor["protocol"],
  remoteKind: SynapseGitRemoteDescriptor["remoteKind"],
  username: string | null = null,
  port: number | null = null,
): SynapseGitRemoteDescriptor {
  return {
    host,
    normalizedUrl: remoteUrl,
    port,
    protocol,
    provider: detectProvider(host),
    remoteKind,
    username,
  }
}

export function buildGitProviderLinks(provider: SynapseGitProvider): SynapseGitProviderLinks {
  return PROVIDER_LINKS[provider]
}

export function getGitProviderLinks(): Readonly<Record<SynapseGitProvider, SynapseGitProviderLinks>> {
  return PROVIDER_LINKS
}

export function parseGitRemote(remoteUrl: string): SynapseGitRemoteDescriptor {
  const normalizedUrl = remoteUrl.trim()

  if (!normalizedUrl) {
    return buildDescriptor(normalizedUrl, null, "unknown", "unknown")
  }

  if (normalizedUrl.startsWith("/")) {
    return buildDescriptor(normalizedUrl, null, "file", "unknown")
  }

  try {
    const url = new URL(normalizedUrl)
    const host = normalizeHost(url.hostname)

    if (url.protocol === "https:" || url.protocol === "http:") {
      const protocol = url.protocol === "http:" ? "http" : "https"
      return buildDescriptor(
        normalizedUrl,
        host,
        protocol,
        protocol,
        url.username ? decodeURIComponent(url.username) : null,
        url.port ? Number(url.port) : null,
      )
    }

    if (url.protocol === "ssh:") {
      return buildDescriptor(
        normalizedUrl,
        host,
        "ssh",
        "ssh",
        url.username ? decodeURIComponent(url.username) : null,
        url.port ? Number(url.port) : null,
      )
    }

    if (url.protocol === "file:") {
      return buildDescriptor(normalizedUrl, null, "file", "unknown")
    }
  } catch {
    const scpLikeMatch = normalizedUrl.match(SCP_LIKE_REMOTE_PATTERN)
    if (scpLikeMatch?.[2]) {
      return buildDescriptor(normalizedUrl, normalizeHost(scpLikeMatch[2]), "ssh", "ssh", scpLikeMatch[1] ?? null)
    }
    return buildDescriptor(normalizedUrl, null, "unknown", "unknown")
  }

  return buildDescriptor(normalizedUrl, null, "unknown", "unknown")
}

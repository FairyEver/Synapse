/**
 * The window title, and the environment suffix on it.
 *
 * The point of the suffix is that someone looking at the window can tell which
 * environment they are actually running against. That is why it is derived from
 * the configuration the app connects with and not from which npm script was
 * invoked: a title claiming `dev:prod` while the app talks to `localhost` is
 * worse than no title at all, because it is the thing that misleads.
 */

/**
 * The production host.
 *
 * Declared rather than derived: nothing reaching the running app still knows
 * "which host is production". `dev:desktop:prod` passes the public URL in as an
 * environment variable when the config is generated, and by run time only the
 * generated URL is left.
 */
const productionHost = "synapse.d2.pub"

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

/**
 * What to append to the title, or an empty string when nothing should be.
 *
 * A packaged build is the production app, so it carries no suffix. Everything
 * else says where it is pointed: `dev` for a local server, `dev:prod` for
 * production, and the host itself for anything else — naming someone's own
 * server is honest, guessing `dev` for it would not be.
 */
export function resolveEnvironmentLabel(input: {
  readonly apiBaseUrl: string
  readonly isPackaged: boolean
}): string {
  if (input.isPackaged) return ""

  let host: string
  try {
    host = new URL(input.apiBaseUrl).hostname
  } catch {
    // An unparseable URL is not a reason to invent a label.
    return ""
  }

  if (!host) return ""
  if (loopbackHosts.has(host)) return "dev"
  if (host === productionHost) return "dev:prod"
  return host
}

export function resolveWindowTitle(input: {
  readonly version: string
  readonly apiBaseUrl: string
  readonly isPackaged: boolean
}): string {
  const base = `Synapse AI Studio ${input.version}`
  const label = resolveEnvironmentLabel(input)
  return label ? `${base} ${label}` : base
}

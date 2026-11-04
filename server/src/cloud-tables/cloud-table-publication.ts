import ipaddr from "ipaddr.js"

export function cloudTablePublicationStatus(configuredUrl: string | undefined) {
  const url = URL.parse(configuredUrl ?? "")
  if (!url || !["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    return { publicAppUrl: null, audience: "unconfigured" as const }
  }
  const host = url.hostname.replace(/^\[|\]$|\.$/gu, "").toLowerCase()
  const privateHost = ipaddr.isValid(host) ? ipaddr.process(host).range() !== "unicast"
    : !host.includes(".") || /\.(?:localhost|local|internal|test|invalid|example)$/u.test(host)
  return {
    publicAppUrl: url.origin,
    audience: privateHost ? "local_only" as const
      : url.protocol !== "https:" ? "https_required" as const : "external_verification_required" as const,
  }
}

import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, existsSync, lstatSync, readlinkSync, symlinkSync, unlinkSync, copyFileSync, chmodSync } from "node:fs"
import { createHash, X509Certificate, createPrivateKey, createPublicKey, randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { resolve, relative, join } from "node:path"
import { pathToFileURL } from "node:url"
const BEGIN = "# BEGIN SYNAPSE TUNNEL", END = "# END SYNAPSE TUNNEL"
const domainPattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u
function domain(value) { if (!domainPattern.test(value ?? "")) throw new Error("Invalid tunnel DNS suffix"); return value }
function safePath(value) { if (!/^\/[A-Za-z0-9_/.-]+$/u.test(value ?? "")) throw new Error("Invalid certificate path"); return value }
export function renderNginx({ domain: suffix, port, enabled = true }) {
  domain(suffix)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid ingress port")
  if (!enabled) return `# Tunnel namespace remains isolated while disabled.
server {
  listen 3000;
  server_name .${suffix};
  access_log off;
  error_log /dev/null crit;
  return 503;
}
`
  return `# Generated tunnel-only virtual host. All paths bypass platform routing.
server {
  listen 3000;
  server_name .${suffix};
  access_log off;
  error_log /dev/null crit;
  client_max_body_size 0;
  gzip off;
  location / {
    proxy_pass http://127.0.0.1:${port};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Synapse-Tunnel-Client-IP $http_x_synapse_tunnel_client_ip;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_cache off;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
  }
}
`
}
export function nginxConfigFromEnv(env) {
  const enabled = env.TUNNEL_ENABLED === "true"
  const suffix = env.TUNNEL_PUBLIC_DOMAIN || (enabled ? undefined : "tunnel.d2.pub")
  return renderNginx({ domain: suffix, port: Number(env.TUNNEL_INGRESS_PORT ?? 3002), enabled })
}
export function renderCaddy({ domain: suffix, cert, key, upstream }) {
  domain(suffix); safePath(cert); safePath(key)
  if (!/^127\.0\.0\.1:\d{1,5}$/u.test(upstream) || Number(upstream.split(":")[1]) > 65535) throw new Error("Upstream must be a loopback port")
  return `*.${suffix} {
  tls ${cert} ${key}
  log_skip
  handle_errors {
    respond "Tunnel unavailable" 503
  }
  reverse_proxy ${upstream} {
    header_up Host {http.request.host}
    header_up X-Synapse-Tunnel-Client-IP {http.request.remote.host}
    flush_interval 1ms
  }
}`
}
function markedRange(text) {
  const start = text.indexOf(BEGIN), end = text.indexOf(END)
  if ((start < 0) !== (end < 0) || (start >= 0 && (end < start || text.indexOf(BEGIN, start + 1) >= 0 || text.indexOf(END, end + 1) >= 0))) throw new Error("Ambiguous tunnel markers")
  return start < 0 ? null : [start, end + END.length]
}
export function replaceBlock(text, block) {
  const range = markedRange(text), wrapped = block ? `${BEGIN}\n${block}\n${END}` : ""
  return range ? text.slice(0, range[0]) + wrapped + text.slice(range[1]) : text + (text.endsWith("\n") ? "" : "\n") + wrapped + "\n"
}
function atomicWrite(file, content) { const temporary = file + ".tunnel-" + randomUUID(); writeFileSync(temporary, content, { mode: 0o600, flag: "wx" }); renameSync(temporary, file) }
export function applyConfig({ file, original, block, validate, reload }) {
  const lock = file + ".tunnel.lock"; mkdirSync(lock, { mode: 0o700 })
  try {
    if (readFileSync(file, "utf8") !== original) throw new Error("Caddyfile changed; check again")
    const candidate = replaceBlock(original, block)
    validate(candidate)
    if (readFileSync(file, "utf8") !== original) throw new Error("Caddyfile changed during validation")
    writeFileSync(file + ".tunnel-backup-" + Date.now(), original, { mode: 0o600, flag: "wx" })
    atomicWrite(file, candidate)
    try { reload(candidate) } catch (error) {
      const current = readFileSync(file, "utf8"), range = markedRange(current), desiredRange = markedRange(candidate)
      if (!range || !desiredRange || current.slice(...range) !== candidate.slice(...desiredRange)) throw new Error("Reload failed and tunnel block changed; manual rollback required")
      const previousRange = markedRange(original)
      const restored = current === candidate ? original : current.slice(0, range[0]) + (previousRange ? original.slice(...previousRange) : "") + current.slice(range[1])
      atomicWrite(file, restored); reload(restored); throw error
    }
  } finally { rmdirSync(lock) }
}
export function validateCertificate({ candidate, domain: suffix, minimumDays = 30, caFile }) {
  domain(suffix)
  const certFile = join(candidate, "fullchain.pem"), keyFile = join(candidate, "privkey.pem")
  const cert = new X509Certificate(readFileSync(certFile)), privateKey = createPrivateKey(readFileSync(keyFile))
  const sans = cert.subjectAltName?.split(/,\s*/u) ?? []
  if (!sans.includes(`DNS:*.${suffix}`)) throw new Error("Certificate wildcard SAN mismatch")
  if (Date.parse(cert.validFrom) > Date.now() || Date.parse(cert.validTo) - Date.now() < minimumDays * 86400000) throw new Error("Certificate expires too soon or is not valid yet")
  if (!cert.publicKey.export({ type: "spki", format: "der" }).equals(createPublicKey(privateKey).export({ type: "spki", format: "der" }))) throw new Error("Certificate private key mismatch")
  execFileSync("openssl", ["verify", ...(caFile ? ["-CAfile", caFile] : []), "-untrusted", certFile, "-verify_hostname", `certificate-probe.${suffix}`, certFile], { stdio: "pipe", timeout: 10000 })
  return { expiresAt: cert.validTo, daysRemaining: Math.floor((Date.parse(cert.validTo) - Date.now()) / 86400000) }
}
export function installCertificate({ candidate, root, domain: suffix, minimumDays, caFile, validate, reload }) {
  validateCertificate({ candidate, domain: suffix, minimumDays, caFile })
  const current = join(root, "current"), lock = join(root, ".renew-lock")
  mkdirSync(lock, { mode: 0o700 })
  try {
    if (existsSync(current) && !lstatSync(current).isSymbolicLink()) throw new Error("Certificate current must be a symlink")
    const old = existsSync(current) ? readlinkSync(current) : null
    const versions = join(root, "versions"); mkdirSync(versions, { recursive: true, mode: 0o700 })
    const directory = join(versions, randomUUID()); mkdirSync(directory, { mode: 0o700 })
    for (const name of ["fullchain.pem", "privkey.pem"]) { copyFileSync(join(candidate, name), join(directory, name)); chmodSync(join(directory, name), 0o600) }
    const switchTo = target => { const temporary = join(root, ".current-" + randomUUID()); symlinkSync(target, temporary); renameSync(temporary, current) }
    switchTo(relative(root, directory))
    try { validate(); reload() } catch (error) {
      if (old !== null) { switchTo(old); validate(); reload() } else unlinkSync(current)
      throw error
    }
    return validateCertificate({ candidate: current, domain: suffix, minimumDays, caFile })
  } finally { rmdirSync(lock) }
}
function args(values) {
  const result = {}
  for (let i = 0; i < values.length; i++) { const key = values[i]; if (!key.startsWith("--")) throw new Error("Invalid argument"); result[key.slice(2)] = values[i + 1] && !values[i + 1].startsWith("--") ? values[++i] : true }
  return result
}
export function caddyInvocation(command, container) { return ["exec", "-i", container, "caddy", command, ...(command === "reload" ? ["--force"] : []), "--config", "/dev/stdin", "--adapter", "caddyfile"] }
function caddy(command, candidate, container) { return execFileSync("docker", caddyInvocation(command, container), { input: candidate, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 }) }
function main() {
  const input = args(process.argv.slice(2)), suffix = input["render-nginx"] && process.env.TUNNEL_ENABLED !== "true" ? undefined : domain(input.domain ?? process.env.TUNNEL_PUBLIC_DOMAIN)
  if (input["render-nginx"]) {
    if (!input.apply || !input.output) throw new Error("Nginx generation needs --apply --output")
    const content = nginxConfigFromEnv(process.env)
    atomicWrite(resolve(input.output), content); return
  }
  const file = resolve(input.caddyfile ?? "/www/wwwroot/shared-caddy-edge/Caddyfile"), container = input.container ?? "shared-caddy-edge"
  const original = readFileSync(file, "utf8"), digest = createHash("sha256").update(original).digest("hex")
  const validate = candidate => caddy("validate", candidate ?? readFileSync(file, "utf8"), container)
  const reload = candidate => caddy("reload", candidate ?? readFileSync(file, "utf8"), container)
  if (input["install-certificate"]) {
    if (!input.apply || !input.candidate || !input.root) throw new Error("Certificate install needs --apply --candidate --root")
    const status = installCertificate({ candidate: resolve(input.candidate), root: resolve(input.root), domain: suffix, validate, reload }); process.stdout.write(JSON.stringify(status) + "\n"); return
  }
  if (input["check-certificate"]) { process.stdout.write(JSON.stringify(validateCertificate({ candidate: resolve(input.root, "current"), domain: suffix, minimumDays: input["minimum-days"] ? Number(input["minimum-days"]) : 14 })) + "\n"); return }
  const block = renderCaddy({ domain: suffix, cert: input.cert ?? "/certs/tunnel/current/fullchain.pem", key: input.key ?? "/certs/tunnel/current/privkey.pem", upstream: input.upstream ?? "127.0.0.1:3000" })
  if (input.apply) {
    if (input["expected-sha256"] !== digest) throw new Error("Caddyfile changed or missing reviewed --expected-sha256")
    applyConfig({ file, original, block, validate, reload })
    process.stdout.write("Tunnel block applied\n")
  } else { validate(replaceBlock(original, block)); process.stdout.write(`Caddyfile SHA256: ${digest}\n${block}\n`) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main() } catch (error) { process.stderr.write(`Tunnel configuration failed: ${error instanceof Error && !('stderr' in error) ? error.message : "external validation/reload failed; active configuration preserved where possible"}\n`); process.exitCode = 1 }
}

import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, symlinkSync, readlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, join } from "node:path"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { loadEnv } from "../config/env"
const moduleUrl = pathToFileURL(resolve("scripts/tunnel-edge-config.mjs")).href
let edge: Record<string, (...args: any[]) => any>
let fixture: string
beforeAll(async () => { edge = await import(moduleUrl); fixture = mkdtempSync(join(tmpdir(), "synapse-tunnel-cert-")) })
afterAll(() => { /* certificate fixture contains only test keys; retained outside the repository for inspection */ })
describe("tunnel deployment", () => {
  it("bounds configurable budgets and rejects public listeners", () => {
    const base = { DATABASE_URL: "postgresql://fixture/fixture", ADMIN_ACCESS_SECRET: "Qv2jY7mD9kL4sN8pR3tW6xZ1cF5hJ0uB7eG2iM9oK4A", USER_ACCESS_JWT_SECRET: "user-secret-with-enough-length-32chars" }
    const env = loadEnv(base)
    expect(env.tunnelMaxStreamsGlobal).toBe(256)
    expect(() => loadEnv({ ...base, TUNNEL_MAX_STREAMS_GLOBAL: "0" })).toThrow()
    expect(() => loadEnv({ ...base, TUNNEL_MAX_MAPPINGS_PER_USER: "101" })).toThrow()
    expect(() => loadEnv({ ...base, TUNNEL_INGRESS_HOST: "0.0.0.0" })).toThrow()
  })
  it("routes every tunnel path to an unbuffered private ingress and preserves the platform server", () => {
    const block = edge.renderNginx({ domain: "tunnel.d2.pub", port: 3002 })
    expect(block).toContain("127.0.0.1:3002")
    expect(block).toContain("location /")
    for (const line of ["proxy_request_buffering off", "proxy_buffering off", "proxy_cache off", "access_log off", "Upgrade $http_upgrade"]) expect(block).toContain(line)
    expect(() => edge.renderNginx({ domain: "evil;include x", port: 3002 })).toThrow()
    const compose = readFileSync("compose.yml", "utf8")
    expect(compose).toContain("TUNNEL_ENABLED:")
    expect(compose).not.toMatch(/- ["']?(?:127\.0\.0\.1:)?3002:3002/u)
    const caddy = edge.renderCaddy({ domain: "tunnel.d2.pub", cert: "/certs/tunnel/current/fullchain.pem", key: "/certs/tunnel/current/privkey.pem", upstream: "127.0.0.1:3000" })
    expect(caddy).toContain("*.tunnel.d2.pub"); expect(caddy).toContain("log_skip"); expect(caddy).toContain("flush_interval -1")
    const existing = "synapse.d2.pub { respond ok }\n"
    expect(edge.replaceBlock(existing, caddy)).toContain(existing)
  })
  it("refuses stale config and restores a failed reload without affecting other blocks", () => {
    const file = join(fixture, "Caddyfile"), original = "synapse.test { respond ok }\n"
    writeFileSync(file, original)
    expect(() => edge.applyConfig({ file, original: "stale", block: "candidate", validate: () => {}, reload: () => {} })).toThrow(/changed/u)
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(() => edge.applyConfig({ file, original, block: "candidate", validate: () => { throw new Error("invalid") }, reload: () => {} })).toThrow()
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(() => edge.applyConfig({ file, original, block: "candidate", validate: () => {}, reload: () => { throw new Error("reload") } })).toThrow()
    expect(readFileSync(file, "utf8")).toBe(original)
  })
  it("validates certificate key, SAN, lifetime and chain before switching the active pair", () => {
    const candidate = join(fixture, "candidate"), active = join(fixture, "active"); mkdirSync(candidate); mkdirSync(active)
    const cert = join(candidate, "fullchain.pem"), key = join(candidate, "privkey.pem")
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "40", "-subj", "/CN=*.tunnel.test", "-addext", "subjectAltName=DNS:*.tunnel.test", "-keyout", key, "-out", cert], { stdio: "ignore" })
    const pointer = join(fixture, "current"); symlinkSync("active", pointer)
    const before = readlinkSync(pointer)
    const options = { candidate, root: fixture, domain: "tunnel.test", caFile: cert, minimumDays: 30, validate: () => {}, reload: () => {} }
    expect(() => edge.installCertificate({ ...options, domain: "wrong.test" })).toThrow()
    expect(() => edge.installCertificate({ ...options, minimumDays: 90 })).toThrow()
    expect(readlinkSync(pointer)).toBe(before)
    const wrong = join(fixture, "wrong.pem"); execFileSync("openssl", ["genpkey", "-algorithm", "RSA", "-pkeyopt", "rsa_keygen_bits:2048", "-out", wrong], { stdio: "ignore" })
    const saved = readFileSync(key); writeFileSync(key, readFileSync(wrong))
    expect(() => edge.installCertificate(options)).toThrow(); expect(readlinkSync(pointer)).toBe(before)
    writeFileSync(key, saved)
    expect(() => edge.installCertificate({ ...options, reload: () => { throw new Error("reload") } })).toThrow(); expect(readlinkSync(pointer)).toBe(before)
    edge.installCertificate(options); expect(readlinkSync(pointer)).not.toBe(before)
  })
})

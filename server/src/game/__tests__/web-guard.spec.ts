import { describe, expect, it, vi, afterEach } from "vitest"
import { GameWebGuard } from "../game-web.guard"

function request(overrides: Record<string, unknown> = {}) {
  return { method: "POST", path: "/api/game/invoke", user: { id: "alice" },
    headers: { "x-synapse-game-user-id": "alice", origin: "https://synapse.test" },
    body: { operation: "app.game.hall.overview", params: {} }, ...overrides }
}
function check(r: ReturnType<typeof request>) {
  return new GameWebGuard().canActivate({ switchToHttp: () => ({ getRequest: () => r }) } as never)
}
afterEach(() => vi.unstubAllEnvs())

describe("浏览器游戏认证边界", () => {
  it("允许同源且绑定当前账号的普通UI调用", () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(check(request())).toBe(true)
  })
  it.each(["development", undefined])("本地环境%s允许固定公开地址访问游戏", nodeEnv => {
    vi.stubEnv("NODE_ENV", nodeEnv)
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:19700")
    expect(check(request({ headers: { "x-synapse-game-user-id": "alice", origin: "http://localhost:19700", "sec-fetch-site": "same-origin" } }))).toBe(true)
  })
  it.each(["http://localhost:19700", "https://synapse.test"])("生产环境配置%s时不接受额外本地来源", publicUrl => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_PUBLIC_URL", publicUrl)
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "alice", origin: "http://localhost:19799" } }))).toThrow("游戏请求来源无效。")
  })
  it("生产环境仍允许配置的精确来源", () => {
    vi.stubEnv("NODE_ENV", "production")
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(check(request())).toBe(true)
  })
  it("非本地公开地址不启用开发来源例外", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "alice", origin: "http://localhost:19799" } }))).toThrow("游戏请求来源无效。")
  })
  it.each(["https://evil.test", "http://localhost:19704", "https://localhost:19799", "http://localhost.evil.test:19799", "http://127.0.0.1:19799", "null"])("本地环境拒绝固定列表以外的来源%s", origin => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:19700")
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "alice", origin } }))).toThrow("游戏请求来源无效。")
  })
  it("本地固定来源不能绕过跨站拦截", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:19700")
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "alice", origin: "http://localhost:19700", "sec-fetch-site": "cross-site" } }))).toThrow("游戏请求来源无效。")
  })
  it("本地固定来源不能绕过账号绑定", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:19700")
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "bob", origin: "http://localhost:19700" } }))).toThrow("登录账号已变更，请重新载入。")
  })
  it("本地固定来源不能绕过invoke操作白名单", () => {
    vi.stubEnv("NODE_ENV", "development")
    vi.stubEnv("APP_PUBLIC_URL", "http://localhost:19700")
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "alice", origin: "http://localhost:19700" }, body: { operation: "app.game.poker.control.claim", params: {} } }))).toThrow("此操作不能通过浏览器调用。")
  })
  it.each([undefined, "bob"])("预期身份%s与Cookie身份不一致时拒绝，不能读写另一个账号", (identity) => {
    const r = request({ method: "GET", path: "/api/game/poker/rooms/1234/state", headers: { "x-synapse-game-user-id": identity } })
    try { check(r); expect.fail("应拒绝身份变更") } catch (error) {
      expect(error).toMatchObject({ response: { code: "GAME_IDENTITY_CHANGED" }, status: 409 })
    }
  })
  it.each(["https://evil.test", "null", undefined])("Cookie写入拒绝来源%s", (origin) => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(() => check(request({ headers: { "x-synapse-game-user-id": "alice", origin } }))).toThrow()
  })
  it("无Origin时仅接受同源浏览器元信息", () => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(check(request({ headers: { "x-synapse-game-user-id": "alice", "sec-fetch-site": "same-origin" } }))).toBe(true)
  })
  it.each(["app.game.poker.action.act", "app.game.poker.seat.join", "app.game.poker.seat.leave", "app.game.poker.seat.sit", "app.game.poker.table.state", "app.game.poker.table.events", "app.game.poker.table.wait", "app.game.poker.control.claim", "app.game.poker.checkpoint.get", "app.game.poker.checkpoint.save"])("Cookie invoke不能绕行%s", (operation) => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(() => check(request({ body: { operation, params: {} } }))).toThrow()
  })
  it("Bearer保持MCP与旧桌面兼容，不要求浏览器身份或来源", () => {
    expect(check(request({ headers: { authorization: "Bearer existing-token" }, body: { operation: "app.game.poker.action.act" } }))).toBe(true)
  })
  it.each(["/api/game/INVOKE", "/api/game/Invoke/"])("大小写路径%s同样不能绕过Cookie invoke白名单", path => {
    vi.stubEnv("APP_PUBLIC_URL", "https://synapse.test")
    expect(() => check(request({ path, body: { operation: "app.game.poker.control.claim", params: {} } }))).toThrow()
  })
})

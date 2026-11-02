import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
describe("cloud-table deployment privacy boundary", () => {
  it("turns off proxy/application access logging for both data surfaces and preserves structured 413 errors", () => {
    const nginx = readFileSync(resolve(process.cwd(), "nginx.conf"), "utf8")
    const module = readFileSync(resolve(process.cwd(), "src/app.module.ts"), "utf8")
    const block = nginx.slice(nginx.indexOf("location ~* ^/api/(?:open/v1|console)/tables"), nginx.indexOf("location /api/ {"))
    expect(block).toContain("access_log off;")
    expect(block).toContain("error_log /dev/null crit;")
    const tooLarge = nginx.slice(nginx.indexOf("location @cloud_table_too_large"), nginx.indexOf("# 云表只保留"))
    expect(tooLarge).toContain("access_log off;")
    expect(tooLarge).toContain("error_log /dev/null crit;")
    expect(block).toContain("error_page 413 = @cloud_table_too_large;")
    expect(nginx).toContain('"code":"REQUEST_TOO_LARGE"')
    expect(module).toContain('(?:open\\/v1|console)\\/tables')
    expect(block).not.toContain("limit_req")
  })
})

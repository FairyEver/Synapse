/** 对实际交付 HTML 做 DOM 交互检查，不启动浏览器或开发服务器。 */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const desktop = createRequire(resolve(directory, "../../../desktop/package.json"))
const { JSDOM, VirtualConsole } = desktop("jsdom")
const html = await readFile(resolve(directory, "index.html"), "utf8")
const runtimeErrors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on("jsdomError", error => runtimeErrors.push(error.message))
let copied = ""
const dom = new JSDOM(html.replace(/<style>[\s\S]*?<\/style>/, ""), {
  runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
  beforeParse(window) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText: async value => { copied = value } } })
  },
})
const document = dom.window.document
const settle = () => new Promise(done => setTimeout(done, 80))
const row = id => document.querySelector(`[data-item="${id}"]`)
const tag = (id, type) => row(id)?.querySelector(`[data-tag="${type}"]`)
const popup = () => document.querySelector('[data-slot="popover-content"]')
const button = (name, scope = document) => [...scope.querySelectorAll("button")].find(element => element.textContent.trim() === name)
async function click(element) { assert(element, "交互目标必须存在"); element.click(); await settle() }
async function escape() { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle() }

try {
  await settle()
  assert.equal(document.querySelectorAll("[data-item]").length, 10)
  assert.equal(row("plain").querySelectorAll("[data-tag]").length, 0)
  assert.equal(row("codex").querySelectorAll("[data-tag]").length, 2)
  // 连续切换时，旧弹窗不可恢复焦点并误关闭新弹窗。
  for (let index = 0; index < 4; index++) {
    await click(tag("codex", "share"))
    assert(popup().textContent.includes("分享详情"))
    await click(tag("codex", "sync"))
    assert.equal(document.querySelectorAll('[data-slot="popover-content"]').length, 1)
    assert(popup().textContent.includes("本机同步"))
    assert(popup().contains(document.activeElement))
    await escape()
    assert.equal(popup(), null)
    assert.equal(document.activeElement, tag("codex", "sync"))
  }
  await click(tag("project", "share"))
  assert.equal(document.querySelectorAll("[data-item]").length, 10)
  assert(popup().textContent.includes("指定 3 人可编辑"))
  await click(button("复制链接", popup()))
  assert.equal(copied, "https://example.invalid/share/demo-project")
  await escape()
  await click(button("项目资料", row("project")))
  await click(tag("requirements", "sync"))
  assert(popup().textContent.includes("随文件夹"))
  assert(popup().textContent.includes("/Users/demo/Documents/项目资料/需求说明.md"))
  await escape(); await click(button("素材", row("assets"))); await click(tag("image", "sync"))
  assert(popup().textContent.includes("/Users/demo/Documents/项目资料/素材/界面截图.png"))
  await escape(); await click(button("项目资料")); await click(tag("dist", "sync"))
  assert(popup().textContent.includes("dist/")); assert(!popup().textContent.includes("已同步"))
  await escape(); await click(button("根目录"))
  await click(tag("report", "sync")); await click(button("管理同步", popup())); await click(button("继续同步")); await escape()
  assert.equal(tag("report", "sync").textContent, "同步")
  await click(tag("conflict", "sync")); await click(button("处理冲突", popup())); await click(button("保留两个版本")); await escape()
  assert.equal(tag("conflict", "sync").textContent, "同步")
  await click(tag("archive", "sync")); assert(popup().textContent.includes("仅部分子项")); await escape()
  await click(button("在线")); assert.equal(tag("codex", "sync").textContent, "同步离线")
  await click(tag("codex", "sync")); await click(button("管理同步", popup()))
  assert(button("移除同步").disabled); assert(button("暂停同步").disabled)
  await escape(); await click(button("离线"))
  await click(tag("expired", "share")); assert(popup().textContent.includes("链接已失效"))
  await click(button("延长有效期", popup())); await click(button("延长至 10 月 23 日")); await escape()
  assert.equal(tag("expired", "share").textContent, "已分享")
  await click(tag("ds", "share")); await click(button("分享设置", popup())); await click(button("关闭分享"))
  await click(button("关闭分享", document.querySelector('[role="alertdialog"]')))
  assert.equal(tag("ds", "share"), null); assert(row("ds"))
  await click(tag("project", "sync")); await click(button("管理同步", popup())); await click(button("移除同步"))
  const confirmation = document.querySelector('[role="alertdialog"]')
  assert(confirmation.textContent.includes("所有子项")); assert(confirmation.textContent.includes("两端文件均保留"))
  await click(button("移除同步", confirmation))
  assert.equal(tag("project", "sync"), null)
  await click(button("项目资料", row("project"))); assert.equal(tag("requirements", "sync"), null); assert(row("requirements"))
  await click(button("重置示例")); assert.equal(document.querySelectorAll("[data-item]").length, 10)
  await click(document.querySelector('[aria-label="切换深色"]')); assert(document.documentElement.classList.contains("dark"))
  Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: undefined })
  await click(tag("ds", "share")); await click(button("复制链接", popup()))
  assert(document.querySelector('[aria-label="待复制内容"]'))
  assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"]').length, 0)
  assert([...document.querySelectorAll("img")].every(image => image.src.startsWith("data:")))
  assert(html.includes("connect-src 'none'"))
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join("\n"))
  process.stdout.write("交互检查通过：连续切换与焦点恢复、分享、同步继承、排除、暂停恢复、冲突、离线、移除、主题、复制回退和独立文件。\n")
} finally {
  dom.window.close()
}

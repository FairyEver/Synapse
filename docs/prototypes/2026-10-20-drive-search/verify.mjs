/** 对最终离线 HTML 验证交互，不启动浏览器或正式应用。 */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const directory = dirname(fileURLToPath(import.meta.url))
const desktop = createRequire(resolve(directory, "../../../desktop/package.json"))
const { JSDOM, VirtualConsole } = desktop("jsdom")
const html = await readFile(resolve(directory, "index.html"), "utf8")
const errors = []
const virtualConsole = new VirtualConsole()
virtualConsole.on("jsdomError", error => errors.push(error.message))
virtualConsole.on("error", (...args) => errors.push(args.join(" ")))
const dom = new JSDOM(html.replace(/<style>[\s\S]*?<\/style>/, ""), {
  runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
  beforeParse(window) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    window.HTMLElement.prototype.scrollIntoView = function () {}
  },
})
const document = dom.window.document
const settle = (ms = 70) => new Promise(done => setTimeout(done, ms))
const row = id => document.querySelector(`[data-item="${id}"]`)
const rows = () => [...document.querySelectorAll("[data-item]")]
const button = name => [...document.querySelectorAll("button")].find(element => element.textContent.trim() === name || element.getAttribute("aria-label") === name)
const select = name => document.querySelector(`select[aria-label="${name}"]`)
const input = () => document.querySelector("#file-search")
async function click(element) { assert(element, "点击目标必须存在"); element.click(); await settle() }
async function choose(name, value) {
  const element = select(name); assert(element, `必须存在 ${name}`)
  element.value = value; element.dispatchEvent(new dom.window.Event("change", { bubbles: true })); await settle()
}
async function type(value, wait = 330) {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input(), value)
  input().dispatchEvent(new dom.window.Event("input", { bubbles: true })); await settle(wait)
}
async function scenario(value) {
  const hash = `#scene=${value}`
  if (dom.window.location.hash === hash) dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"))
  else dom.window.location.hash = hash
  await settle(400)
}
async function escape() { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle() }

try {
  await settle()
  assert.equal(rows().length, 19)
  assert.equal(input(), null, "默认界面只增加入口，不常驻展开搜索表单")
  assert.equal(document.querySelector('[aria-label="原型演示控制"]'), null)
  assert.equal(document.querySelectorAll("[data-embedded-system-app-header]").length, 1, "复用实际 Dock 模式唯一顶栏")
  assert.equal(document.querySelectorAll("[data-system-app-window-toolbar]").length, 0, "内容内不得出现第二条应用顶栏")
  const toolbar = document.querySelector('[data-testid="drive-toolbar-actions"]')
  assert.deepEqual([...toolbar.querySelectorAll("button")].map(element => element.textContent.trim() || element.getAttribute("aria-label")), ["搜索", "同步管理", "新建", "刷新", "更多"], "搜索入口应位于现有同步管理左侧")
  const heads = [...document.querySelectorAll("thead th")]
  assert.deepEqual(heads.map(head => head.textContent), ["名称", "更新时间", ""], "保留实际三列表格")
  assert.deepEqual([...document.querySelectorAll("col")].map(col => col.className), ["w-auto", "w-40", "w-52"])
  assert.deepEqual([...document.querySelectorAll("[data-system-entry]")].map(element => element.textContent.trim()), ["公开素材-", "回收站-"])
  assert.deepEqual(rows().slice(0, 4).map(element => element.dataset.item), ["skill", "message", "ds", "codex"], "根目录保留截图中的文件顺序")
  assert.deepEqual([...row("skill").querySelectorAll("td:last-child button")].map(element => element.textContent), ["取消分享", "预览", "删除", "更多"])
  assert.equal(document.querySelectorAll('[data-track="app-shell-dock"] img').length, 9, "复用真实 Dock 与图标")
  await click(button("搜索文件")); assert.equal(document.activeElement, input()); assert(document.querySelector('[aria-label="最近搜索"]'))
  await type("云盘")
  assert.deepEqual(rows().map(element => element.dataset.item).sort(), ["erp-design", "layout", "old-search", "page", "search", "shot", "sync"], "全盘搜索必须包括深层子文件夹")
  assert(row("search")); assert(row("erp-design")); assert(row("old-search"))
  assert.equal(document.querySelectorAll("mark").length, 7, "关键词应在每个结果中高亮")
  assert(row("search").textContent.includes("项目资料 / Synapse"))
  assert(row("erp-design").textContent.includes("项目资料 / ERP"), "同名文件必须显示不同路径")
  await choose("文件类型", "image"); assert.deepEqual(rows().map(element => element.dataset.item).sort(), ["layout", "shot"])
  await choose("更新时间", "1"); assert.deepEqual(rows().map(element => element.dataset.item), ["shot"])
  await choose("分享状态", "shared"); assert(button("清除筛选")); assert.equal(rows().length, 0)
  assert(document.body.textContent.includes("未找到匹配的文件"))
  await click(button("清除筛选")); assert.equal(rows().length, 7); assert.equal(input().value, "云盘")
  await choose("分享状态", "shared"); assert.deepEqual(rows().map(element => element.dataset.item).sort(), ["erp-design", "page", "sync"])
  await choose("结果排序", "modified"); assert.equal(rows()[0].dataset.item, "page")
  await click(button("清除筛选"))
  await click(row("search")); assert(document.querySelector('[role="dialog"]').textContent.includes("云盘文件搜索设计"))
  await escape(); assert(!document.querySelector('[role="dialog"]')); assert.equal(input().value, "云盘")
  await click(row("search").querySelector('[aria-label^="打开所在文件夹"]'))
  assert.equal(select("文件类型"), null); assert(row("search").textContent.includes("已定位")); assert(button("返回搜索结果"))
  await click(button("返回搜索结果")); assert.equal(input().value, "云盘"); assert.equal(select("结果排序").value, "modified"); assert.equal(rows().length, 7)
  await type(".MD"); assert.equal(rows().length, 19); assert(document.body.textContent.includes("19 项"))
  await type("云盘 设计"); assert.equal(rows().length, 5, "多个关键词应共同匹配")
  await type("　ＴｅｓｔＫｉｔ　"); assert.deepEqual(rows().map(element => element.dataset.item), ["testkit"], "全角和大小写应归一化")
  await scenario("folder"); assert.equal(select("搜索范围").value, "folder")
  assert.equal(rows().length, 5); assert(!row("sync")); assert(!row("old-search"))
  await choose("搜索范围", "all"); assert(row("sync")); assert(row("old-search"))
  await choose("文件类型", "folder"); assert.deepEqual(rows().map(element => element.dataset.item), ["assets"])
  await click(row("assets")); assert(row("shot")); await click(button("返回搜索结果")); assert(row("assets")); assert.equal(select("文件类型").value, "folder")
  await scenario("folder"); await type("重设计"); assert.equal(rows().length, 0); await click(button("搜索整个云盘")); assert(row("sync"))
  await scenario("empty"); assert.equal(rows().length, 0); await click(button("修改关键词")); assert.equal(document.activeElement, input())
  await type("云盘"); assert.equal(rows().length, 7)
  await scenario("error"); assert(document.querySelector('[role="alert"]').textContent.includes("连接中断"))
  await click(button("重新搜索")); assert.equal(rows().length, 7); assert.equal(input().value, "云盘")
  // IME 中间态不提交；compositionend 后才更新搜索结果。
  input().dispatchEvent(new dom.window.CompositionEvent("compositionstart", { bubbles: true })); await settle()
  await type("不存在", 330); assert.equal(rows().length, 7)
  input().dispatchEvent(new dom.window.CompositionEvent("compositionend", { bubbles: true })); await settle(330)
  assert.equal(rows().length, 0)
  await click(button("退出搜索")); assert.equal(input(), null)
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true })); await settle()
  assert.equal(document.activeElement, input())
  await type("设计", 20); assert(document.querySelector('[aria-label="正在搜索"]')); await settle(330)
  input().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle()
  assert.equal(input(), null); assert.equal(rows().length, 19)
  await click(button("搜索文件")); await click(button("清空记录")); assert(!document.querySelector('[aria-label="最近搜索"]'))
  await scenario("folder"); await click(button("退出搜索")); await click(button("根目录")); await click(button("搜索文件")); assert.equal(select("搜索范围").value, "all")
  assert.equal(errors.length, 0, errors.join("\n"))
  assert(html.includes("connect-src 'none'"), "离线原型必须禁止网络请求")
  assert(html.includes("border-color:var(--border)"), "必须继承实际应用基础层的边框 token")
  assert(!/<script[^>]+src=/.test(html), "运行时必须内嵌")
  process.stdout.write("通过：实际页面壳层、顶栏入口顺序、原表格列宽与操作、系统目录和 Dock，以及全盘/递归搜索、组合筛选、高亮、预览定位返回、IME、失败重试与快捷键。\n")
} finally { dom.window.close() }

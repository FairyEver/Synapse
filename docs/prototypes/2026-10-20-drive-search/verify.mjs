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
async function scenario(value) { await choose("演示场景", value); await settle(300) }
async function escape() { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle() }

try {
  await settle()
  assert.equal(rows().length, 12, "根目录分页必须限制为 12 行")
  await click(button("下一页")); assert(row("branch")); await click(button("上一页"))
  input().focus(); await settle(); assert(document.querySelector('[aria-label="最近搜索"]'))
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
  await click(row("search").querySelector('[aria-label^="定位"]'))
  assert.equal(select("文件类型").value, "all"); assert(row("search").textContent.includes("已定位")); assert(button("返回搜索结果"))
  await click(button("返回搜索结果")); assert.equal(input().value, "云盘"); assert.equal(select("结果排序").value, "modified"); assert.equal(rows().length, 7)
  await type(".MD"); assert.equal(rows().length, 12); assert(document.body.textContent.includes("16 项"))
  await click(button("下一页")); assert(rows().length > 0)
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
  await click(button("退出搜索")); assert.equal(input().value, "")
  document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true })); await settle()
  assert.equal(document.activeElement, input())
  await type("设计", 20); assert(document.querySelector('[aria-label="正在搜索"]')); await settle(330)
  input().dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle()
  assert.equal(input().value, ""); assert.equal(rows().length, 12)
  input().focus(); await settle(); await click(button("清空记录")); assert(!document.querySelector('[aria-label="最近搜索"]'))
  await click(button("切换深色")); assert(document.documentElement.classList.contains("dark")); await click(button("切换浅色"))
  await scenario("folder"); await click(button("退出搜索")); await click(button("根目录")); assert.equal(select("搜索范围").value, "all")
  assert.equal(errors.length, 0, errors.join("\n"))
  assert(html.includes("connect-src 'none'"), "离线原型必须禁止网络请求")
  assert(!/<script[^>]+src=/.test(html), "运行时必须内嵌")
  process.stdout.write("通过：最终 HTML 的全盘/递归搜索、组合筛选、排序分页、高亮、同名路径、预览定位与返回、IME、空态/失败重试、快捷键和主题验证。\n")
} finally { dom.window.close() }

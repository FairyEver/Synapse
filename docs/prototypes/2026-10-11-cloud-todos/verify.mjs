/** 原型交互验收；不启动浏览器，不访问网络或真实账号。 */
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const sourceDir = dirname(fileURLToPath(import.meta.url))
const repository = resolve(sourceDir, "../../..")
const outputPath = process.argv[2]
if (!outputPath) throw new Error("提供构建输出目录")
const requireDesktop = createRequire(join(repository, "desktop/package.json"))
const { JSDOM, VirtualConsole } = requireDesktop("jsdom")
const faults = []
const virtualConsole = new VirtualConsole()
virtualConsole.on("jsdomError", error => faults.push(error.message))
virtualConsole.on("error", error => faults.push(String(error)))
const dom = new JSDOM(await readFile(join(sourceDir, "fragment.template.html"), "utf8"), {
  runScripts: "outside-only", pretendToBeVisual: true, url: "https://prototype.invalid", virtualConsole,
})
const { window } = dom
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
window.PointerEvent = window.MouseEvent
window.HTMLElement.prototype.scrollIntoView = function () {}
window.HTMLElement.prototype.hasPointerCapture = () => false
window.HTMLElement.prototype.setPointerCapture = function () {}
window.HTMLElement.prototype.releasePointerCapture = function () {}
let networkCalls = 0
window.fetch = async () => { networkCalls++; throw new Error("原型不应发起网络请求") }
window.openai = { setWidgetState: async () => {} }
window.addEventListener("error", event => faults.push(event.error?.message ?? event.message))
const fragment = await readFile(join(outputPath, "synapse-todos.html"), "utf8")
const script = fragment.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1]
assert.ok(script, "缺少内联原型脚本")
assert.ok(!/PROTOTYPE_COMPILED_(CSS|JS)/.test(fragment), "输出中仍有模板占位符")
window.eval(script)
const document = window.document
const settle = () => new Promise(resolve => window.setTimeout(resolve, 35))
function required(selector) { const element = document.querySelector(selector); assert.ok(element, `缺少元素 ${selector}`); return element }
function button(text) { const element = [...document.querySelectorAll("button")].find(item => item.textContent.trim() === text); assert.ok(element, `缺少按钮 ${text}`); return element }
async function click(element) { element.click(); await settle() }
async function tab(text) {
  const element = [...document.querySelectorAll('[role="tab"]')].find(item => item.textContent.trim() === text)
  assert.ok(element, `缺少标签 ${text}`)
  element.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }))
  await settle()
}
async function select(selector, value) {
  const element = required(selector)
  element.value = value
  element.dispatchEvent(new window.Event("change", { bubbles: true }))
  await settle()
}
async function input(selector, value) {
  const element = required(selector)
  const prototype = element.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value)
  element.dispatchEvent(new window.Event("input", { bubbles: true }))
  await settle()
}
async function submit() { required("#todo-editor-form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })); await settle() }
async function menu(title) {
  const element = required(`button[aria-label="更多：${title}"]`)
  element.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  await settle()
}
async function deleteMenuItem() {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.trim() === "删除")
  assert.ok(item, "缺少删除菜单")
  await click(item)
}
function rowCount() { return document.querySelectorAll("[data-todo-id]").length }

await settle()
assert.equal(rowCount(), 4)
assert.equal([...document.querySelectorAll('[role="tab"]')].find(tab => tab.textContent === "未完成").getAttribute("aria-selected"), "true")
assert.equal(document.querySelectorAll("[data-system-app-top-bar]").length, 1)
await click(required('button[aria-label="完成：确认待办事项原型"]'))
assert.equal(rowCount(), 3)
await tab("全部")
assert.equal(rowCount(), 5)
await click(required('button[aria-label="恢复：确认待办事项原型"]'))
await tab("未完成")
assert.equal(rowCount(), 4)
process.stdout.write("通过：单条顶栏、默认筛选、完成、全部历史、恢复\n")

await click(button("新建"))
await submit()
assert.match(required('[role="alert"]').textContent, /填写标题/)
await input("#todo-title", "原型新增事项")
await input("#todo-note", "检查独立提醒")
await select("#todo-reminder", "custom")
await input("#todo-remind-at", "2026-10-12T10:00")
await submit()
assert.equal(rowCount(), 5)
assert.ok(document.querySelector('button[aria-label="编辑：原型新增事项"]'))
assert.equal(document.querySelector('[role="dialog"]'), null)
process.stdout.write("通过：标题校验、备注、自定提醒、新建保存\n")

await click(required('button[aria-label="编辑：原型新增事项"]'))
await input("#todo-title", "原型编辑事项")
await select("#todo-reminder", "1h")
await submit()
assert.match(required('[role="alert"]').textContent, /设置截止时间/)
await input("#todo-due", "2026-10-11T10:30")
await submit()
assert.match(required('[role="alert"]').textContent, /晚于当前时间/)
await input("#todo-due", "2026-10-12T15:00")
await submit()
assert.match(required('button[aria-label="编辑：原型编辑事项"]').textContent, /提前 1 小时提醒/)
await menu("原型编辑事项")
await deleteMenuItem()
assert.ok(document.querySelector('[role="alertdialog"]'))
await click(button("取消"))
assert.equal(rowCount(), 5)
await menu("原型编辑事项")
await deleteMenuItem()
await click(button("删除"))
assert.equal(rowCount(), 4)
process.stdout.write("通过：编辑、相对提醒校验、过期提醒校验、删除确认与取消\n")

await tab("iPhone")
assert.match(document.body.textContent, /iOS 交互示意/)
await click(button("主页"))
assert.ok(button("待办事项"))
await click(button("待办事项"))
await click(required('button[aria-label="新建事项"]'))
assert.equal(required('[data-slot="sheet-content"]').getAttribute("data-side"), "bottom")
assert.ok(button("取消"))
assert.ok(button("添加"))
await click(button("取消"))
await click(required('button[aria-label="完成：提交报销单"]'))
assert.equal(rowCount(), 3)
await click(button("撤销"))
assert.equal(rowCount(), 4)
await tab("iPad")
assert.equal(rowCount(), 4)
await click(required('button[aria-label="新建事项"]'))
assert.ok(document.querySelector('[role="dialog"]'))
await click(button("取消"))
process.stdout.write("通过：iOS 主页入口、iPhone 表单、撤销、iPad 单列与表单\n")

await select('select[aria-label="预览状态"]', "signed-out")
assert.equal(rowCount(), 0)
assert.match(document.body.textContent, /登录后查看待办事项/)
await click(button("登录"))
assert.equal(rowCount(), 4)
await select('select[aria-label="预览状态"]', "offline")
assert.match(document.body.textContent, /加载失败/)
await click(button("重试"))
assert.equal(rowCount(), 4)
await select('select[aria-label="预览状态"]', "empty")
assert.equal(rowCount(), 0)
assert.match(document.body.textContent, /还没有待办事项/)
await select('select[aria-label="预览状态"]', "notifications-off")
assert.match(document.body.textContent, /提醒仍会出现在通知列表/)
assert.equal(networkCalls, 0)
assert.deepEqual(faults, [])
assert.ok(Buffer.byteLength(fragment) < 1000000)
process.stdout.write("通过：登录、加载失败与重试、空列表、通知权限、无网络调用及运行时错误\n")
window.close()

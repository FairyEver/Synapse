import {
  buildShareDriveReaderUrl,
  type DriveBrowserItemDto,
  type DriveBrowserSnapshotDto,
  type DriveMarkdownOutlineItemDto,
} from "@synapse/shared"

type ReaderPageInput = {
  readonly shareId: string
  readonly snapshot: DriveBrowserSnapshotDto
}

const readerPageCss = `
html {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 16px;
  line-height: 1.7;
}
body {
  margin: 0;
}
main {
  width: auto;
  max-width: 72ch;
  margin: 0 auto;
  padding: 3rem 1.25rem 2rem;
}
h1, h2, h3, h4, h5, h6 {
  line-height: 1.3;
}
h1 {
  font-size: 2rem;
  margin: 0 0 2rem;
}
h2 {
  font-size: 1.5rem;
  margin-top: 2.5rem;
}
h3 {
  font-size: 1.25rem;
  margin-top: 2rem;
}
p, ul, ol, blockquote, pre, table {
  margin-top: 1rem;
  margin-bottom: 1rem;
}
a {
  overflow-wrap: break-word;
  word-wrap: break-word;
}
img {
  max-width: 100%;
  height: auto;
}
pre {
  overflow-x: auto;
  padding: 1rem;
  border: 1px solid currentColor;
  font-family: Consolas, "Courier New", monospace;
  font-size: 0.875rem;
  line-height: 1.5;
}
code {
  font-family: Consolas, "Courier New", monospace;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 0.5rem;
  border: 1px solid currentColor;
  text-align: left;
  vertical-align: top;
}
blockquote {
  margin-left: 0;
  padding-left: 1rem;
  border-left: 1px solid currentColor;
}
[data-drive-markdown-table-scroll="true"] {
  overflow-x: auto;
}
.reader-breadcrumbs,
.reader-notice,
.reader-entry-meta,
.reader-footer,
.reader-pagination {
  font-size: 0.875rem;
}
.reader-breadcrumbs,
.reader-notice,
.reader-entry-meta {
  opacity: 0.72;
}
.reader-breadcrumbs {
  margin-bottom: 1.5rem;
}
.reader-entries {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid currentColor;
}
.reader-entry {
  border-bottom: 1px solid currentColor;
}
.reader-entry-link {
  display: block;
  padding: 0.75rem 0;
}
.reader-entry-meta {
  margin-left: 0.5rem;
}
.reader-image {
  margin: 0;
  text-align: center;
}
.reader-footer,
.reader-pagination {
  margin-top: 2.5rem;
  padding-top: 1rem;
  border-top: 1px solid currentColor;
}
.reader-pagination a + a {
  margin-left: 1.5rem;
}
.reader-password {
  max-width: 28rem;
}
.reader-password label,
.reader-password input,
.reader-password button {
  display: block;
}
.reader-password input {
  width: 100%;
  margin: 0.5rem 0 1rem;
  padding: 0.5rem;
  box-sizing: border-box;
  font: inherit;
}
.reader-password button {
  padding: 0.5rem 1rem;
  font: inherit;
}
@media (max-width: 480px) {
  main {
    padding-top: 1.5rem;
  }
  h1 {
    font-size: 1.625rem;
  }
}
@media print {
  main {
    max-width: none;
    padding: 0;
  }
  .reader-breadcrumbs,
  .reader-footer,
  .reader-pagination {
    display: none;
  }
}
`

export function renderDriveShareReaderPage(input: ReaderPageInput): string {
  const { snapshot } = input
  const body = snapshot.current.type === "folder"
    ? renderFolder(input)
    : renderFile(snapshot)
  const footer = renderDownloadFooter(snapshot)

  return renderDocument({
    title: snapshot.current.name,
    body: `${body}${footer}`,
  })
}

export function renderDriveShareReaderPasswordPage(input: { readonly actionPath: string; readonly error?: boolean }): string {
  const error = input.error
    ? `<p class="reader-notice" id="reader-password-error" role="alert">密码不正确，请重试。</p>`
    : ""
  const errorAttributes = input.error ? ` aria-invalid="true" aria-describedby="reader-password-error"` : ""
  return renderDocument({
    title: "此分享受密码保护",
    body: `<form class="reader-password" method="post" action="${escapeAttribute(input.actionPath)}">
  <h1>此分享受密码保护</h1>
  ${error}
  <label for="reader-password">密码</label>
  <input id="reader-password" name="password" type="password" autocomplete="current-password" required${errorAttributes}>
  <button type="submit">打开分享</button>
</form>`,
  })
}

export function renderDriveShareReaderStatusPage(input: { readonly title: string; readonly message: string }): string {
  return renderDocument({
    title: input.title,
    body: `<h1>${escapeHtml(input.title)}</h1>
<p>${escapeHtml(input.message)}</p>`,
  })
}

function renderFolder(input: ReaderPageInput): string {
  const { shareId, snapshot } = input
  const breadcrumbs = renderFolderBreadcrumbs(shareId, snapshot)
  const entries = snapshot.children.length > 0
    ? `<ul class="reader-entries">${snapshot.children.map((item) => renderFolderEntry(shareId, item)).join("")}</ul>`
    : `<p>文件夹为空。</p>`
  return `${breadcrumbs}<h1>${escapeHtml(snapshot.current.name)}</h1>
${entries}${renderPagination(shareId, snapshot)}`
}

function renderFolderBreadcrumbs(shareId: string, snapshot: DriveBrowserSnapshotDto): string {
  if (snapshot.breadcrumbs.length <= 1) return ""
  const links = snapshot.breadcrumbs.map((item, index) => {
    if (index === snapshot.breadcrumbs.length - 1) return `<span>${escapeHtml(item.name)}</span>`
    const itemId = index === 0 ? null : item.id
    return `<a href="${escapeAttribute(buildShareDriveReaderUrl(shareId, itemId))}">${escapeHtml(item.name)}</a>`
  })
  return `<nav class="reader-breadcrumbs" aria-label="当前位置">${links.join(" / ")}</nav>`
}

function renderFolderEntry(shareId: string, item: DriveBrowserItemDto): string {
  const label = item.type === "folder" ? "文件夹" : "文件"
  return `<li class="reader-entry"><a class="reader-entry-link" href="${escapeAttribute(buildShareDriveReaderUrl(shareId, item.id))}">${escapeHtml(item.name)}<span class="reader-entry-meta">${label}</span></a></li>`
}

function renderPagination(shareId: string, snapshot: DriveBrowserSnapshotDto): string {
  const page = snapshot.childrenPage
  if (!page || (page.offset === 0 && !page.hasMore)) return ""
  const rootId = snapshot.breadcrumbs[0]?.id
  const itemId = snapshot.current.id === rootId ? null : snapshot.current.id
  const baseUrl = buildShareDriveReaderUrl(shareId, itemId)
  const links: string[] = []
  if (page.offset > 0) {
    const previousOffset = Math.max(0, page.offset - page.limit)
    links.push(`<a href="${escapeAttribute(withChildrenOffset(baseUrl, previousOffset))}" rel="prev">上一页</a>`)
  }
  if (page.hasMore && page.nextOffset !== null) {
    links.push(`<a href="${escapeAttribute(withChildrenOffset(baseUrl, page.nextOffset))}" rel="next">下一页</a>`)
  }
  return links.length > 0 ? `<nav class="reader-pagination" aria-label="文件夹分页">${links.join("")}</nav>` : ""
}

function withChildrenOffset(url: string, offset: number): string {
  return offset > 0 ? `${url}?childrenOffset=${offset}` : url
}

function renderFile(snapshot: DriveBrowserSnapshotDto): string {
  const preview = snapshot.preview
  if (!preview) return `<h1>${escapeHtml(snapshot.current.name)}</h1>
<p>无法在浏览器中预览此文件。</p>`

  const truncated = preview.truncated
    ? `<p class="reader-notice" role="status">当前仅显示部分内容，请下载文件查看完整内容。</p>`
    : ""
  if (preview.kind === "markdown") {
    const heading = hasLevelOneHeading(preview.outline) ? "" : `<h1>${escapeHtml(snapshot.current.name)}</h1>`
    const content = preview.html ?? `<pre><code>${escapeHtml(preview.text ?? "")}</code></pre>`
    return `${heading}${truncated}<article>${content}</article>`
  }
  if (preview.kind === "text" || preview.kind === "html-source") {
    return `<h1>${escapeHtml(snapshot.current.name)}</h1>
${truncated}<pre><code>${escapeHtml(preview.text ?? "")}</code></pre>`
  }
  if (preview.kind === "image" && preview.imageUrl) {
    return `<h1>${escapeHtml(snapshot.current.name)}</h1>
<p class="reader-image"><img src="${escapeAttribute(preview.imageUrl)}" alt="${escapeAttribute(snapshot.current.name)}"></p>`
  }
  return `<h1>${escapeHtml(snapshot.current.name)}</h1>
<p>无法在浏览器中预览此文件。</p>`
}

function hasLevelOneHeading(outline: readonly DriveMarkdownOutlineItemDto[] | null | undefined): boolean {
  return outline?.some((item) => item.depth === 1) ?? false
}

function renderDownloadFooter(snapshot: DriveBrowserSnapshotDto): string {
  const downloadUrl = snapshot.current.downloadUrl
  if (!downloadUrl || (!snapshot.canDownload && !snapshot.canZip)) return ""
  const label = snapshot.current.type === "folder" ? "下载文件夹" : "下载文件"
  return `<footer class="reader-footer"><a href="${escapeAttribute(downloadUrl)}">${label}</a></footer>`
}

function renderDocument(input: { readonly title: string; readonly body: string }): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>${readerPageCss}</style>
</head>
<body>
<main>${input.body}</main>
</body>
</html>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[character] ?? character))
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

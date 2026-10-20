import { History, Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { DriveSearchController } from "./use-drive-search"

export function DriveSearchInput({ search }: { search: DriveSearchController }) {
  return <form role="search" className="w-full min-w-0 sm:w-80" onSubmit={event => { event.preventDefault(); search.submit() }}>
    <InputGroup>
      <InputGroupInput ref={search.inputRef} role="searchbox" aria-label="搜索文件名或扩展名" aria-controls="drive-file-results" aria-keyshortcuts="Meta+F Control+F"
        placeholder="搜索文件名或扩展名" maxLength={200} autoComplete="off" value={search.draft}
        onChange={event => search.setDraft(event.target.value)} onFocus={() => search.setFocused(true)} onBlur={() => search.setFocused(false)}
        onCompositionStart={() => search.setComposing(true)} onCompositionEnd={() => search.setComposing(false)}
        onKeyDown={event => {
          if (search.composing || event.nativeEvent.isComposing) { if (event.key === "Enter") event.preventDefault(); return }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); search.close() }
        }} />
      <InputGroupAddon><Search /></InputGroupAddon>
      {search.draft && <InputGroupAddon align="inline-end"><InputGroupButton aria-label="清除关键词" size="icon-xs" onClick={() => { search.submit(""); search.inputRef.current?.focus() }}><X /></InputGroupButton></InputGroupAddon>}
    </InputGroup>
  </form>
}

export function DriveSearchEmpty({ search }: { search: DriveSearchController }) {
  function editQuery() { search.inputRef.current?.focus(); search.inputRef.current?.select() }
  return <Empty className="min-h-64 border">
    <EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>未找到匹配的文件</EmptyTitle><EmptyDescription>尝试清除筛选、扩大范围或更换关键词。</EmptyDescription></EmptyHeader>
    <EmptyContent><div className="flex flex-wrap gap-2">
      {search.filtered && <Button variant="outline" onClick={search.clearFilters}>清除筛选</Button>}
      {search.filters.scope === "folder" && <Button variant="outline" onClick={() => search.updateFilter("scope", "all")}>搜索整个云盘</Button>}
      <Button variant="ghost" onClick={editQuery}>修改关键词</Button>
    </div></EmptyContent>
  </Empty>
}

export function DriveSearchFilters({ search, inFolder }: { search: DriveSearchController; inFolder: boolean }) {
  return <section aria-label="文件搜索筛选" className="flex flex-col gap-2 px-1">
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect aria-label="搜索范围" value={search.filters.scope} onChange={event => search.updateFilter("scope", event.target.value)}>
        <NativeSelectOption value="all">整个云盘</NativeSelectOption>
        {inFolder && <NativeSelectOption value="folder">当前文件夹及子文件夹</NativeSelectOption>}
      </NativeSelect>
      <NativeSelect aria-label="文件类型" value={search.filters.fileType} onChange={event => search.updateFilter("fileType", event.target.value)}>
        <NativeSelectOption value="all">全部类型</NativeSelectOption><NativeSelectOption value="folder">文件夹</NativeSelectOption><NativeSelectOption value="document">文档</NativeSelectOption>
        <NativeSelectOption value="image">图片</NativeSelectOption><NativeSelectOption value="archive">压缩包</NativeSelectOption><NativeSelectOption value="other">其他文件</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="更新时间" value={search.filters.days} onChange={event => search.updateFilter("days", event.target.value)}>
        <NativeSelectOption value="all">不限更新时间</NativeSelectOption><NativeSelectOption value="1">今天</NativeSelectOption><NativeSelectOption value="7">最近 7 天</NativeSelectOption><NativeSelectOption value="30">最近 30 天</NativeSelectOption>
      </NativeSelect>
      <NativeSelect aria-label="分享状态" value={search.filters.shareStatus} onChange={event => search.updateFilter("shareStatus", event.target.value)}>
        <NativeSelectOption value="all">全部分享状态</NativeSelectOption><NativeSelectOption value="shared">已分享</NativeSelectOption><NativeSelectOption value="private">未分享</NativeSelectOption>
      </NativeSelect>
      {search.filtered && <Button variant="ghost" onClick={search.clearFilters}>清除筛选</Button>}
      {search.active && <NativeSelect aria-label="结果排序" value={search.filters.sort} onChange={event => search.updateFilter("sort", event.target.value)}>
        <NativeSelectOption value="relevance">相关度优先</NativeSelectOption><NativeSelectOption value="modified">最近更新优先</NativeSelectOption><NativeSelectOption value="name">名称排序</NativeSelectOption>
      </NativeSelect>}
      <Button variant="ghost" onClick={search.close}>退出搜索</Button>
    </div>
    {search.focused && !search.draft && !search.active && search.history.length > 0 && <div aria-label="最近搜索" className="flex flex-wrap items-center gap-1 text-sm">
      <span className="mr-1 flex items-center gap-1.5 text-muted-foreground"><History className="size-3.5" />最近搜索</span>
      {search.history.map(value => <Button key={value} variant="secondary" size="sm" onMouseDown={event => event.preventDefault()} onClick={() => search.submit(value)}>{value}</Button>)}
      <Button variant="ghost" size="sm" onMouseDown={event => event.preventDefault()} onClick={search.clearHistory}>清空记录</Button>
    </div>}
  </section>
}

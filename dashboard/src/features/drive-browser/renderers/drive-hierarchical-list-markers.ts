export const DRIVE_HIERARCHICAL_LIST_MARKER_ATTRIBUTE = 'data-drive-list-marker'
export const DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME = '[&_ol>li::marker]:content-[attr(data-drive-list-marker)_"_"]!'

export function syncDriveHierarchicalListMarkers(root: ParentNode): void {
  const markerPaths = new Map<HTMLLIElement, readonly number[]>()

  for (const item of root.querySelectorAll<HTMLLIElement>(`[${DRIVE_HIERARCHICAL_LIST_MARKER_ATTRIBUTE}]`)) {
    item.removeAttribute(DRIVE_HIERARCHICAL_LIST_MARKER_ATTRIBUTE)
  }

  for (const list of root.querySelectorAll<HTMLOListElement>('ol')) {
    const ancestorPath = findOrderedAncestorPath(list, markerPaths, root)
    const items = Array.from(list.children).filter((child): child is HTMLLIElement => child instanceof HTMLLIElement)
    let current = list.start
    let renderedItemCount = 0
    let previousPath: readonly number[] | undefined

    items.forEach((item) => {
      if (isNestedListContainer(item)) {
        markerPaths.set(item, previousPath ?? ancestorPath)
        return
      }
      if (item.hasAttribute('value')) {
        current = item.value
      } else if (renderedItemCount > 0) {
        current += 1
      }
      const path = [...ancestorPath, current]
      markerPaths.set(item, path)
      previousPath = path
      renderedItemCount += 1
      item.setAttribute(
        DRIVE_HIERARCHICAL_LIST_MARKER_ATTRIBUTE,
        path.length === 1 ? `${current}.` : path.join('.')
      )
    })
  }
}

export function observeDriveHierarchicalListMarkers(root: HTMLElement): () => void {
  let active = true
  let scheduled = false
  const synchronize = () => {
    scheduled = false
    if (active) syncDriveHierarchicalListMarkers(root)
  }
  const scheduleSynchronize = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(synchronize)
  }

  syncDriveHierarchicalListMarkers(root)
  const observer = new MutationObserver(scheduleSynchronize)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['start', 'value'],
    childList: true,
    subtree: true,
  })

  return () => {
    active = false
    observer.disconnect()
  }
}

function findOrderedAncestorPath(
  list: HTMLOListElement,
  markerPaths: ReadonlyMap<HTMLLIElement, readonly number[]>,
  root: ParentNode,
): readonly number[] {
  let ancestor = list.parentElement
  while (ancestor && ancestor !== root) {
    if (ancestor instanceof HTMLLIElement) {
      const path = markerPaths.get(ancestor)
      if (path) return path
    }
    ancestor = ancestor.parentElement
  }
  return []
}

function isNestedListContainer(item: HTMLLIElement): boolean {
  let containsNestedList = false
  for (const child of item.childNodes) {
    if (child instanceof HTMLOListElement || child instanceof HTMLUListElement) {
      containsNestedList = true
      continue
    }
    if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) continue
    if (child.nodeType === Node.COMMENT_NODE) continue
    return false
  }
  return containsNestedList
}

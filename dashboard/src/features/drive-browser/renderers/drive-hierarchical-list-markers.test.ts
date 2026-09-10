// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import {
  DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME,
  observeDriveHierarchicalListMarkers,
  syncDriveHierarchicalListMarkers,
} from './drive-hierarchical-list-markers'

let root: HTMLDivElement | null = null

afterEach(() => {
  root?.remove()
  root = null
})

describe('Drive hierarchical list markers', () => {
  it('derives ordered paths without counting unordered ancestors', () => {
    root = document.createElement('div')
    root.innerHTML = [
      '<ol>',
      '<li>一级一</li>',
      '<li>一级二',
      '<ol><li>二级一</li><li>二级二<ol><li>三级一</li></ol></li></ol>',
      '<ul><li>无序项<ol><li>穿过无序层的有序项</li></ol></li></ul>',
      '</li>',
      '<li>一级三</li>',
      '</ol>',
    ].join('')

    syncDriveHierarchicalListMarkers(root)

    expect(markers(root)).toEqual([
      '1.',
      '2.',
      '2.1',
      '2.2',
      '2.2.1',
      null,
      '2.1',
      '3.',
    ])
    expect(DRIVE_HIERARCHICAL_LIST_MARKER_CLASSNAME).toContain('data-drive-list-marker')
  })

  it('preserves explicit ordered starts at every level', () => {
    root = document.createElement('div')
    root.innerHTML = '<ol start="3"><li>三级</li><li>四级<ol start="5"><li>四点五</li></ol></li></ol>'

    syncDriveHierarchicalListMarkers(root)

    expect(markers(root)).toEqual(['3.', '4.', '4.5'])
  })

  it('skips editor-only list containers and preserves real empty items', () => {
    root = document.createElement('div')
    root.innerHTML = [
      '<ol>',
      '<li>一级一</li>',
      '<li><ol><li>二级一</li></ol></li>',
      '<li></li>',
      '</ol>',
    ].join('')

    syncDriveHierarchicalListMarkers(root)

    expect(markers(root)).toEqual(['1.', null, '1.1', '2.'])
  })

  it('updates after list nesting changes without touching text content', async () => {
    root = document.createElement('div')
    root.innerHTML = '<ol><li>一级一</li><li>一级二</li></ol>'
    const stop = observeDriveHierarchicalListMarkers(root)

    const list = root.querySelector('ol')
    const second = list?.children[1]
    if (!(list instanceof HTMLOListElement) || !(second instanceof HTMLLIElement)) {
      throw new Error('ordered list fixture missing')
    }
    const nested = document.createElement('ol')
    nested.append(second)
    list.children[0]?.append(nested)
    await Promise.resolve()
    await Promise.resolve()

    expect(markers(root)).toEqual(['1.', '1.1'])
    expect(root.textContent).toBe('一级一一级二')
    stop()
  })

  it('updates Milkdown labels after ordered start and item value changes', async () => {
    root = document.createElement('div')
    root.innerHTML = [
      '<ol start="2"><div class="milkdown-list-item-block"><li>',
      '<div class="label-wrapper"><span class="label ordered">2.</span></div>',
      '<div><p>一级</p><ol start="4">',
      '<div class="milkdown-list-item-block"><li><div class="label-wrapper"><span class="label ordered">4.</span></div><p>二级一</p></li></div>',
      '<div class="milkdown-list-item-block"><li><div class="label-wrapper"><span class="label ordered">5.</span></div><p>二级二</p></li></div>',
      '</ol></div></li></div></ol>',
    ].join('')
    const stop = observeDriveHierarchicalListMarkers(root)

    expect(markers(root)).toEqual(['2.', '2.4', '2.5'])
    expect(renderedLabels(root)).toEqual(['2.', '2.4', '2.5'])

    const lists = root.querySelectorAll('ol')
    const nestedItems = lists[1]?.querySelectorAll('li')
    lists[1]?.setAttribute('start', '6')
    nestedItems?.[1]?.setAttribute('value', '8')
    await Promise.resolve()
    await Promise.resolve()

    expect(markers(root)).toEqual(['2.', '2.6', '2.8'])
    expect(renderedLabels(root)).toEqual(['2.', '2.6', '2.8'])
    stop()
  })
})

function markers(container: ParentNode) {
  return Array.from(container.querySelectorAll('li'), (item) => item.getAttribute('data-drive-list-marker'))
}

function renderedLabels(container: ParentNode) {
  return Array.from(container.querySelectorAll('.label.ordered'), (label) => label.textContent)
}

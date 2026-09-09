// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { DriveAnnotationThreadDto, DriveMarkdownProjectionDto } from '@synapse/shared'
import { findDriveEditorCommentImage } from './drive-editor-comment-geometry'

describe('Drive editor image comment geometry', () => {
  it('uses the Anchor V2 resolved source range when the legacy image id changed', () => {
    const root = imageRoot([
      { src: '/files/current.png', alt: 'current' },
    ])
    const thread = withImageAnchor(
      imageThread('legacy-image', 'file:current.png'),
      { start: 24, end: 48 },
      'file:current.png',
    )

    expect(findDriveEditorCommentImage(
      root,
      thread,
      imageProjection([
        image('current-image', 1, '/files/current.png', 'current'),
      ]),
      new Map(),
    )).toBe(root.querySelector('img[src="/files/current.png"]'))
  })

  it('does not locate an Anchor V2 image when its resource identity changed', () => {
    const root = imageRoot([
      { src: '/files/replacement.png', alt: 'replacement' },
    ])
    const thread = withImageAnchor(
      imageThread('legacy-image', 'file:original.png'),
      { start: 24, end: 48 },
      'file:original.png',
    )

    expect(findDriveEditorCommentImage(
      root,
      thread,
      imageProjection([
        image('replacement-image', 1, '/files/replacement.png', 'replacement'),
      ]),
      new Map(),
    )).toBeNull()
  })

  it('does not move an Anchor V2 duplicate image comment to the remaining image', () => {
    const root = imageRoot([
      { src: '/files/duplicate.png', alt: 'second' },
    ])
    const thread = withImageAnchor(
      imageThread('legacy-first'),
      { start: 0, end: 24 },
      'file:duplicate.png',
    )

    expect(findDriveEditorCommentImage(
      root,
      thread,
      imageProjection([
        image('current-first', 0, '/files/duplicate.png', 'first'),
        image('current-second', 1, '/files/duplicate.png', 'second'),
      ]),
      new Map(),
    )).toBeNull()
  })

  it.each(['source_deleted', 'ambiguous', 'orphaned'] as const)(
    'does not remount an image whose Anchor V2 position is %s',
    (positionStatus) => {
      const root = imageRoot([
        { src: '/files/current.png', alt: 'current' },
      ])
      const thread = withImageAnchor(
        imageThread('legacy-image', 'file:current.png'),
        { start: 0, end: 24 },
        'file:current.png',
        positionStatus,
      )

      expect(findDriveEditorCommentImage(
        root,
        thread,
        imageProjection([
          image('current-image', 0, '/files/current.png', 'current'),
        ]),
        new Map(),
      )).toBeNull()
    },
  )

  it('matches an Anchor V2 relative image through its DOM preview URL', () => {
    const root = imageRoot([
      { src: 'https://preview.test/image/current', alt: 'relative' },
    ])
    const thread = withImageAnchor(
      imageThread('legacy-image', 'relative:images/current.png'),
      { start: 0, end: 24 },
      'relative:images/current.png',
    )
    const previewUrls = new Map([['./images/current.png', 'https://preview.test/image/current']])

    expect(findDriveEditorCommentImage(
      root,
      thread,
      imageProjection([
        image('current-image', 0, './images/current.png', 'relative', 'relative:images/current.png'),
      ]),
      previewUrls,
    )).toBe(root.querySelector('img'))
  })

  it('does not move a first duplicate image comment to the remaining image after deletion', () => {
    const root = imageRoot([
      { src: '/files/duplicate.png', alt: 'second' },
    ])

    expect(findDriveEditorCommentImage(
      root,
      imageThread('image-first'),
      imageProjection([
        image('image-first', 0, '/files/duplicate.png', 'first'),
        image('image-second', 1, '/files/duplicate.png', 'second'),
      ]),
      new Map(),
    )).toBeNull()
  })

  it('does not move an image comment to a same-source image inserted before its target', () => {
    const root = imageRoot([
      { src: '/files/duplicate.png', alt: 'inserted' },
      { src: '/files/duplicate.png', alt: 'target' },
    ])

    expect(findDriveEditorCommentImage(
      root,
      imageThread('image-target'),
      imageProjection([
        image('image-target', 0, '/files/duplicate.png', 'target'),
      ]),
      new Map(),
    )).toBeNull()
  })

  it('does not use the old duplicate-source ordinal after images are reordered', () => {
    const root = imageRoot([
      { src: '/files/duplicate.png', alt: 'second' },
      { src: '/files/duplicate.png', alt: 'first' },
    ])

    expect(findDriveEditorCommentImage(
      root,
      imageThread('image-first'),
      imageProjection([
        image('image-first', 0, '/files/duplicate.png', 'first'),
        image('image-second', 1, '/files/duplicate.png', 'second'),
      ]),
      new Map(),
    )).toBeNull()
  })

  it('keeps locating an image whose source is unique in the projection and live DOM', () => {
    const root = imageRoot([
      { src: '/files/other.png', alt: 'other' },
      { src: '/files/unique.png', alt: 'edited target' },
    ])

    expect(findDriveEditorCommentImage(
      root,
      imageThread('image-target', 'file:unique.png'),
      imageProjection([
        image('image-other', 0, '/files/other.png', 'other'),
        image('image-target', 1, '/files/unique.png', 'target'),
      ]),
      new Map(),
    )).toBe(root.querySelector('img[src="/files/unique.png"]'))
  })

  it('keeps locating a distinguishable duplicate when the live image sequence is unchanged', () => {
    const root = imageRoot([
      { src: '/files/duplicate.png', alt: 'first' },
      { src: '/files/duplicate.png', alt: 'second' },
    ])

    expect(findDriveEditorCommentImage(
      root,
      imageThread('image-second'),
      imageProjection([
        image('image-first', 0, '/files/duplicate.png', 'first'),
        image('image-second', 1, '/files/duplicate.png', 'second'),
      ]),
      new Map(),
    )).toBe(root.querySelectorAll('img')[1])
  })

  it('returns null when duplicate images have no distinguishing projection evidence', () => {
    const root = imageRoot([
      { src: '/files/duplicate.png', alt: 'same' },
      { src: '/files/duplicate.png', alt: 'same' },
    ])

    expect(findDriveEditorCommentImage(
      root,
      imageThread('image-first'),
      imageProjection([
        image('image-first', 0, '/files/duplicate.png', 'same'),
        image('image-second', 1, '/files/duplicate.png', 'same'),
      ]),
      new Map(),
    )).toBeNull()
  })
})

function imageRoot(images: readonly { readonly src: string; readonly alt: string }[]): HTMLElement {
  const root = document.createElement('div')
  for (const value of images) {
    const image = document.createElement('img')
    image.src = value.src
    image.alt = value.alt
    root.append(image)
  }
  return root
}

function imageThread(imageId: string, resourceKey = 'file:duplicate.png'): DriveAnnotationThreadDto {
  return {
    id: 'thread-image',
    itemId: 'file',
    baseVersionId: 'version-1',
    targetKind: 'image',
    target: {
      schemaVersion: 1,
      kind: 'image',
      surface: 'markdownRenderedImage',
      imageId,
      resourceKey,
      source: { startOffset: 0, endOffset: 24 },
      snapshot: { src: '/files/duplicate.png', alt: 'first', title: null },
      blockHint: { blockId: 'block-image', blockIndex: 0, imageIndex: 0, headingPath: [] },
    },
    anchorStatus: 'attached',
    anchor: null,
    author: { id: 'user-1', email: null, handle: 'author' },
    comments: [],
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    permissions: { canDelete: true },
  }
}

function image(
  imageId: string,
  documentIndex: number,
  source: string,
  alt: string,
  resourceKey = `file:${source.slice('/files/'.length)}`,
): NonNullable<DriveMarkdownProjectionDto['images']>[number] {
  return {
    imageId,
    segmentId: `segment-${imageId}`,
    blockId: `block-${documentIndex}`,
    imageIndex: 0,
    documentIndex,
    sourceStart: documentIndex * 24,
    sourceEnd: (documentIndex + 1) * 24,
    renderedStart: 0,
    renderedEnd: 0,
    source,
    resourceKey,
    alt,
    title: null,
  }
}

function withImageAnchor(
  thread: DriveAnnotationThreadDto,
  resolvedSourceRange: { readonly start: number; readonly end: number },
  resourceKey: string,
  positionStatus: NonNullable<DriveAnnotationThreadDto['anchor']>['positionStatus'] = 'attached',
): DriveAnnotationThreadDto {
  if (thread.target.kind !== 'image') throw new Error('Expected image thread')
  return {
    ...thread,
    anchor: {
      schemaVersion: 2,
      baseVersionId: thread.baseVersionId,
      selectors: {
        schemaVersion: 2,
        kind: 'image',
        position: { start: thread.target.source.startOffset, end: thread.target.source.endOffset },
        semantic: {
          blockId: thread.target.blockHint.blockId,
          imageIndex: thread.target.blockHint.imageIndex,
          headingPath: thread.target.blockHint.headingPath,
        },
        identity: { imageId: thread.target.imageId, resourceKey },
      },
      positionStatus,
      quoteStatus: positionStatus === 'attached' ? 'exact' : 'deleted',
      resolvedSourceRange,
      resolvedRenderedRange: null,
      confidence: positionStatus === 'attached' ? 1 : 0,
      lastResolvedVersionId: 'version-2',
    },
  }
}

function imageProjection(images: NonNullable<DriveMarkdownProjectionDto['images']>): DriveMarkdownProjectionDto {
  return {
    schemaVersion: 1,
    parserVersion: 'test',
    sourceSha256: 'hash',
    blocks: [],
    segments: [],
    imageAnchorsVersion: 1,
    images,
  }
}

import type { ComponentProps } from 'react'
import { createDriveLazyComponent } from '../shared/drive-lazy-component'

export const DriveCodeRenderer = createDriveLazyComponent<ComponentProps<typeof import('./code-renderer').DriveCodeRenderer>>(() => import('./code-renderer').then((module) => ({ default: module.DriveCodeRenderer })))
export const DriveMDXeditorRenderer = createDriveLazyComponent<ComponentProps<typeof import('./mdxeditor-renderer').DriveMDXeditorRenderer>>(() => import('./mdxeditor-renderer').then((module) => ({ default: module.DriveMDXeditorRenderer })))
export const DriveFileVersionsDialog = createDriveLazyComponent<ComponentProps<typeof import('../drive-file-versions-dialog').DriveFileVersionsDialog>>(() => import('../drive-file-versions-dialog').then((module) => ({ default: module.DriveFileVersionsDialog })))

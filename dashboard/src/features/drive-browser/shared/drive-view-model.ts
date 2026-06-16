import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export type DriveHostMode = 'console' | 'standalone' | 'share'

export function getDriveBrowserActions(snapshot: DriveBrowserSnapshotDto) {
  return {
    downloadUrl: snapshot.current.downloadUrl,
    visitUrl: snapshot.preview?.visitUrl ?? null,
  }
}

export function getDriveFinderActions(snapshot: DriveBrowserSnapshotDto) {
  const isFolder = snapshot.current.type === 'folder'
  return {
    directoryDownloadUrl: isFolder ? snapshot.current.downloadUrl : null,
    fileDownloadUrl: isFolder ? null : snapshot.current.downloadUrl,
    fileOpenUrl: isFolder ? null : snapshot.current.browserUrl,
    visitUrl: isFolder ? null : snapshot.preview?.visitUrl ?? null,
  }
}

export function getDriveBrowserChildUrls(snapshot: DriveBrowserSnapshotDto) {
  return snapshot.children.map((item) => item.browserUrl)
}

export function shouldRenderDriveSingleFileReader(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.current.type === 'file'
}

export function shouldRenderDriveBodyRenderer(snapshot: DriveBrowserSnapshotDto): boolean {
  return snapshot.current.type === 'file' && (snapshot.context === 'share' || snapshot.surface === 'standalone')
}

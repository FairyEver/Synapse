import { buildOwnerDriveBrowserUrl, type DriveBrowserSnapshotDto } from '@synapse/shared'

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
    fileOpenUrl: isFolder ? null : getDriveStandaloneOpenUrl(snapshot),
    fileVersionItemId: isFolder || snapshot.context !== 'owner' ? null : snapshot.current.id,
    visitUrl: isFolder ? null : snapshot.preview?.visitUrl ?? null,
  }
}

export function getDriveFileVersionItemId(snapshot: DriveBrowserSnapshotDto): string | null {
  if (snapshot.context !== 'owner' || snapshot.current.type !== 'file') return null
  return snapshot.current.id
}

function getDriveStandaloneOpenUrl(snapshot: DriveBrowserSnapshotDto): string {
  if (snapshot.context !== 'owner' || snapshot.surface !== 'console') return snapshot.current.browserUrl
  const url = new URL(buildOwnerDriveBrowserUrl(snapshot.current.id), 'http://synapse.local')
  url.searchParams.set('surface', 'standalone')
  return `${url.pathname}${url.search}${url.hash}`
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

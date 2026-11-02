import type { DriveBrowserSnapshotDto } from '@synapse/shared'

export function shareSnapshotForSession(snapshot: DriveBrowserSnapshotDto, sessionReady: boolean): DriveBrowserSnapshotDto {
  if (snapshot.context !== 'share' || sessionReady) return snapshot
  return {
    ...snapshot,
    edit: snapshot.edit ? { ...snapshot.edit, canEdit: false, reason: 'login_required' } : null,
    annotation: snapshot.annotation ? { ...snapshot.annotation, canComment: false, reason: 'login_required' } : null,
    collaboration: snapshot.collaboration ? { ...snapshot.collaboration, enabled: false, canWrite: false, reason: 'login_required' } : null,
  }
}

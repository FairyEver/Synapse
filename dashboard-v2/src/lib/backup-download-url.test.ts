import { describe, expect, it } from 'vitest'

import { getBackupDownloadUrl } from './api'

describe('getBackupDownloadUrl', () => {
  it('encodes backup filenames for native browser downloads', () => {
    expect(getBackupDownloadUrl('backup 2026/06.tar.gz')).toBe(
      '/api/admin/backup/download/backup%202026%2F06.tar.gz'
    )
  })
})

export function getInvitationTeamsErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return '团队列表加载失败'
}

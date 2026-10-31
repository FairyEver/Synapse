import {
  createRootEditorSubscription$,
  realmPlugin,
  viewMode$,
  type ViewMode,
} from '@mdxeditor/editor'

type MdxEditorCommentObserverPluginParams = {
  readonly onEditorUpdate: () => void
  readonly onViewModeChange: (mode: ViewMode) => void
}

export const mdxEditorCommentObserverPlugin = realmPlugin<MdxEditorCommentObserverPluginParams>({
  init(realm, params) {
    if (!params) return
    realm.sub(viewMode$, params.onViewModeChange)
    realm.pub(createRootEditorSubscription$, (editor) => editor.registerUpdateListener(params.onEditorUpdate))
  },
})

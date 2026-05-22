import { useCallback, useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import {
  createContent,
  openContentDetailWindow,
  readContentEditorInitPayload,
  readDetail,
  updateContent,
} from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  ContentEditorBodyField,
  ContentPreviewPanel,
  PromptEditorMetaFields,
  RuleEditorMetaFields,
  SkillAttachmentManager,
  SkillEditorMetaFields,
} from "@/modules/content/components/content-editor-fields"
import { ContentEditorWindowLayout } from "@/modules/content/components/content-editor-window-layout"
import { useContentCreateForm, type ContentCreateFormConfig } from "@/modules/content/hooks/use-content-create-form"
import { useContentIconImage } from "@/modules/content/hooks/use-content-icon-image"
import {
  buildBaseContentInitialValue,
  createEmptyContentPayload,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"
import {
  createEmptyRulePayload,
  normalizeCreateRulePayload,
  validateCreateRulePayload,
} from "@/modules/rules/utils"
import type { CreateSkillPayload } from "@/modules/skills/types"
import {
  createEmptySkillPayload,
  normalizeCreateSkillPayload,
  serializeCreateSkillFiles,
  validateCreateSkillPayload,
} from "@/modules/skills/utils"
import type {
  SynapseContentDetail,
  SynapseContentType,
  SynapseContentWindowRequest,
  SynapseCreatePromptPayload,
  SynapseCreateRulePayload,
  SynapseOpenContentCreateWindowPayload,
  SynapseOpenContentEditWindowPayload,
} from "@/types/content"

type ContentEditorWindowPageProps = {
  request: Extract<SynapseContentWindowRequest, { kind: "create" | "edit" }>
}

type EditorInitPayload =
  | SynapseOpenContentCreateWindowPayload
  | SynapseOpenContentEditWindowPayload
  | null

const CONTENT_LABELS: Record<SynapseContentType, string> = {
  prompt: "提示词",
  rule: "Rule",
  skill: "Skill",
}

const PROMPT_FORM_CONFIG: ContentCreateFormConfig<SynapseCreatePromptPayload> = {
  createEmpty: () => createEmptyContentPayload<SynapseCreatePromptPayload>(),
  normalize: (payload) => normalizeContentPayload(payload),
  validate: (payload) => validateContentPayload(payload, {
    labels: {
      title: "请输入标题。",
      description: "请输入简介。",
      content: "请输入正文。",
    },
  }),
  errorFallbackMessage: "保存提示词失败。",
}

const RULE_FORM_CONFIG: ContentCreateFormConfig<SynapseCreateRulePayload> = {
  createEmpty: () => createEmptyRulePayload(),
  normalize: (payload) => normalizeCreateRulePayload(payload),
  validate: (payload) => validateCreateRulePayload(payload),
  errorFallbackMessage: "保存 Rule 失败。",
}

const SKILL_FORM_CONFIG: ContentCreateFormConfig<CreateSkillPayload> = {
  createEmpty: createEmptySkillPayload,
  normalize: normalizeCreateSkillPayload,
  validate: validateCreateSkillPayload,
  errorFallbackMessage: "保存 Skill 失败。",
}

function useEditorInitPayload(requestId?: string): EditorInitPayload {
  const [payload, setPayload] = useState<EditorInitPayload>(null)

  useEffect(() => {
    if (!requestId) {
      setPayload(null)
      return
    }

    let canceled = false
    void readContentEditorInitPayload(requestId)
      .then((result) => {
        if (!canceled) {
          setPayload(result)
        }
      })
      .catch(() => {
        if (!canceled) {
          setPayload(null)
        }
      })

    return () => {
      canceled = true
    }
  }, [requestId])

  return payload
}

function buildWindowTitle(
  contentType: SynapseContentType,
  mode: "create" | "edit",
): string {
  return `${mode === "create" ? "新建" : "编辑"} ${CONTENT_LABELS[contentType]}`
}

function buildEditInitialValue<T extends SynapseContentType>(
  contentType: T,
  detail: SynapseContentDetail<T>,
  initPayload: EditorInitPayload,
): T extends "skill" ? CreateSkillPayload : T extends "rule" ? SynapseCreateRulePayload : SynapseCreatePromptPayload {
  if (contentType === "skill") {
    const prefill = initPayload && "prefill" in initPayload ? initPayload.prefill : null
    const initialValue: CreateSkillPayload = {
      title: detail.title,
      name: detail.name ?? "",
      usage: detail.usage ?? "",
      description: detail.description,
      category: detail.category,
      icon: detail.icon,
      iconBg: detail.iconBg,
      iconType: detail.iconType || "icon",
      iconImage: detail.iconImage || "",
      content: prefill?.contentType === "skill" ? prefill.content : detail.content,
      files: prefill?.contentType === "skill"
        ? prefill.files
        : detail.attachments.map((attachment) => ({
            originalName: attachment.originalName,
            sha256: attachment.sha256,
            size: attachment.size,
          })),
    }

    return initialValue as never
  }

  const base = buildBaseContentInitialValue(detail)

  if (contentType === "rule") {
    const prefill = initPayload && "prefill" in initPayload ? initPayload.prefill : null
    return {
      ...base,
      name: detail.name ?? "",
      content: prefill?.contentType === "rule" ? prefill.content : base.content,
    } as never
  }

  return base as never
}

function EditorLoadingState({ title }: { title: string }) {
  return (
    <ContentEditorWindowLayout
      title={title}
      meta={null}
      body={(
        <Empty className="h-full rounded-none border-0 bg-transparent">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LoaderCircle className="animate-spin" />
            </EmptyMedia>
            <EmptyTitle>正在读取内容</EmptyTitle>
          </EmptyHeader>
        </Empty>
      )}
      auxiliary={null}
      footer={null}
    />
  )
}

function EditorFooter({
  isSubmitting,
  onCancel,
  submitError,
}: {
  isSubmitting: boolean
  onCancel: () => void
  submitError: string | null
}) {
  return (
    <div className="flex items-center gap-3">
      <FieldError className="mr-auto">{submitError}</FieldError>
      <Button type="button" variant="outline" disabled={isSubmitting} onClick={onCancel}>
        取消
      </Button>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "正在保存..." : "保存"}
      </Button>
    </div>
  )
}

function DiscardConfirmDialog({
  onDiscard,
  onOpenChange,
  open,
}: {
  onDiscard: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>放弃当前填写内容？</AlertDialogTitle>
          <AlertDialogDescription>关闭后，未保存的修改会丢失。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>继续编辑</AlertDialogCancel>
          <AlertDialogAction onClick={onDiscard}>放弃</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RuleEditorWindow({ request }: ContentEditorWindowPageProps) {
  const logger = useMemo(() => createRendererLogger("rules.editor.window"), [])
  const initPayload = useEditorInitPayload(request.requestId)
  const [detail, setDetail] = useState<SynapseContentDetail<"rule"> | null>(null)
  const [initialValue, setInitialValue] = useState<SynapseCreateRulePayload | null>(null)
  const mode = request.kind

  useEffect(() => {
    let canceled = false

    if (request.kind === "create") {
      const initial = initPayload && "initialValue" in initPayload && initPayload.contentType === "rule"
        ? initPayload.initialValue as SynapseCreateRulePayload | null
        : null
      setInitialValue(initial)
      return
    }

    void readDetail("rule", request.id)
      .then((nextDetail) => {
        if (canceled) return
        if (nextDetail.type !== "rule") {
          throw new Error("读取到的内容不是 Rule。")
        }
        setDetail(nextDetail)
        setInitialValue(buildEditInitialValue("rule", nextDetail, initPayload))
      })
      .catch((error) => {
        logger.error("Failed to load Rule editor detail.", { contentId: request.id, error })
      })

    return () => {
      canceled = true
    }
  }, [initPayload, logger, request])

  const formState = useContentCreateForm(RULE_FORM_CONFIG, {
    initialValue,
    logContext: { category: "rules.editor.window", contentId: request.kind === "edit" ? request.id : null, contentType: "rule", mode },
    onOpenChange: (open) => {
      if (!open) window.close()
    },
    onSubmit: async (payload) => {
      if (request.kind === "create") {
        const result = await createContent("rule", payload)
        if (result.status === "conflict") throw new Error("内容已更新，请刷新后再编辑。")
        window.close()
        return
      }

      if (!detail) throw new Error("内容尚未加载。")
      const result = await updateContent("rule", { ...payload, id: detail.id, baseHistoryDirname: detail.latestHistoryDirname })
      if (result.status === "conflict") throw new Error("内容已更新，请刷新后再编辑。")
      if (request.origin === "detail") {
        await openContentDetailWindow({ contentType: "rule", id: result.id, title: result.title, viewMode: "rendered" })
      }
      window.close()
    },
    open: true,
  })

  const iconImage = useContentIconImage({
    contentType: "rule",
    contentId: request.kind === "edit" ? request.id : null,
    iconType: formState.form.iconType,
    iconImage: formState.form.iconImage,
    mode,
    open: true,
    setErrors: formState.setErrors,
    updateField: formState.updateField,
  })
  const preparedForm = iconImage.prepareFormForSubmit(formState.form)

  if (request.kind === "edit" && !initialValue) {
    return <EditorLoadingState title={buildWindowTitle("rule", "edit")} />
  }

  return (
    <>
      <form className="contents" onSubmit={(event) => formState.handleSubmit(event, preparedForm)}>
        <ContentEditorWindowLayout
          title={buildWindowTitle("rule", mode)}
          meta={(
            <RuleEditorMetaFields
              errors={formState.errors}
              form={formState.form}
              updateField={formState.updateField}
              icon={formState.form.icon}
              iconBg={formState.form.iconBg}
              iconType={formState.form.iconType}
              iconImage={iconImage.iconImagePreview}
              onIconChange={(value) => formState.updateField("icon", value)}
              onIconBgChange={(value) => formState.updateField("iconBg", value)}
              onIconTypeChange={(value) => formState.updateField("iconType", value)}
              onIconImageChange={iconImage.handleIconImageChange}
              onIconImageRemove={iconImage.handleIconImageRemove}
            />
          )}
          body={(
            <ContentEditorBodyField
              label="正文"
              value={formState.form.content}
              error={formState.errors.content}
              onChange={(value) => formState.updateField("content", value)}
            />
          )}
          auxiliary={<ContentPreviewPanel content={formState.form.content} />}
          footer={(
            <EditorFooter
              isSubmitting={formState.isSubmitting}
              submitError={formState.submitError}
              onCancel={() => formState.handleDialogOpenChange(false)}
            />
          )}
        />
      </form>
      <DiscardConfirmDialog
        open={formState.isDiscardConfirmOpen}
        onOpenChange={formState.setIsDiscardConfirmOpen}
        onDiscard={formState.handleDiscard}
      />
    </>
  )
}

function PromptEditorWindow({ request }: ContentEditorWindowPageProps) {
  const logger = useMemo(() => createRendererLogger("prompts.editor.window"), [])
  const initPayload = useEditorInitPayload(request.requestId)
  const [detail, setDetail] = useState<SynapseContentDetail<"prompt"> | null>(null)
  const [initialValue, setInitialValue] = useState<SynapseCreatePromptPayload | null>(null)
  const mode = request.kind

  useEffect(() => {
    let canceled = false

    if (request.kind === "create") {
      const initial = initPayload && "initialValue" in initPayload && initPayload.contentType === "prompt"
        ? initPayload.initialValue as SynapseCreatePromptPayload | null
        : null
      setInitialValue(initial)
      return
    }

    void readDetail("prompt", request.id)
      .then((nextDetail) => {
        if (canceled) return
        if (nextDetail.type !== "prompt") {
          throw new Error("读取到的内容不是提示词。")
        }
        setDetail(nextDetail)
        setInitialValue(buildEditInitialValue("prompt", nextDetail, initPayload))
      })
      .catch((error) => {
        logger.error("Failed to load Prompt editor detail.", { contentId: request.id, error })
      })

    return () => {
      canceled = true
    }
  }, [initPayload, logger, request])

  const formState = useContentCreateForm(PROMPT_FORM_CONFIG, {
    initialValue,
    logContext: { category: "prompts.editor.window", contentId: request.kind === "edit" ? request.id : null, contentType: "prompt", mode },
    onOpenChange: (open) => {
      if (!open) window.close()
    },
    onSubmit: async (payload) => {
      if (request.kind === "create") {
        const result = await createContent("prompt", payload)
        if (result.status === "conflict") throw new Error("内容已更新，请刷新后再编辑。")
        window.close()
        return
      }

      if (!detail) throw new Error("内容尚未加载。")
      const result = await updateContent("prompt", { ...payload, id: detail.id, baseHistoryDirname: detail.latestHistoryDirname })
      if (result.status === "conflict") throw new Error("内容已更新，请刷新后再编辑。")
      if (request.origin === "detail") {
        await openContentDetailWindow({ contentType: "prompt", id: result.id, title: result.title, viewMode: "rendered" })
      }
      window.close()
    },
    open: true,
  })
  const iconImage = useContentIconImage({
    contentType: "prompt",
    contentId: request.kind === "edit" ? request.id : null,
    iconType: formState.form.iconType,
    iconImage: formState.form.iconImage,
    mode,
    open: true,
    setErrors: formState.setErrors,
    updateField: formState.updateField,
  })
  const preparedForm = iconImage.prepareFormForSubmit(formState.form)

  if (request.kind === "edit" && !initialValue) {
    return <EditorLoadingState title={buildWindowTitle("prompt", "edit")} />
  }

  return (
    <>
      <form className="contents" onSubmit={(event) => formState.handleSubmit(event, preparedForm)}>
        <ContentEditorWindowLayout
          title={buildWindowTitle("prompt", mode)}
          meta={(
            <PromptEditorMetaFields
              errors={formState.errors}
              form={formState.form}
              updateField={formState.updateField}
              icon={formState.form.icon}
              iconBg={formState.form.iconBg}
              iconType={formState.form.iconType}
              iconImage={iconImage.iconImagePreview}
              onIconChange={(value) => formState.updateField("icon", value)}
              onIconBgChange={(value) => formState.updateField("iconBg", value)}
              onIconTypeChange={(value) => formState.updateField("iconType", value)}
              onIconImageChange={iconImage.handleIconImageChange}
              onIconImageRemove={iconImage.handleIconImageRemove}
            />
          )}
          body={(
            <ContentEditorBodyField
              label="正文"
              value={formState.form.content}
              error={formState.errors.content}
              onChange={(value) => formState.updateField("content", value)}
            />
          )}
          auxiliary={<ContentPreviewPanel content={formState.form.content} />}
          footer={(
            <EditorFooter
              isSubmitting={formState.isSubmitting}
              submitError={formState.submitError}
              onCancel={() => formState.handleDialogOpenChange(false)}
            />
          )}
        />
      </form>
      <DiscardConfirmDialog
        open={formState.isDiscardConfirmOpen}
        onOpenChange={formState.setIsDiscardConfirmOpen}
        onDiscard={formState.handleDiscard}
      />
    </>
  )
}

function SkillEditorWindow({ request }: ContentEditorWindowPageProps) {
  const logger = useMemo(() => createRendererLogger("skills.editor.window"), [])
  const initPayload = useEditorInitPayload(request.requestId)
  const [detail, setDetail] = useState<SynapseContentDetail<"skill"> | null>(null)
  const [initialValue, setInitialValue] = useState<CreateSkillPayload | null>(null)
  const mode = request.kind

  useEffect(() => {
    let canceled = false

    if (request.kind === "create") {
      const initial = initPayload && "initialValue" in initPayload && initPayload.contentType === "skill"
        ? initPayload.initialValue as CreateSkillPayload | null
        : null
      setInitialValue(initial)
      return
    }

    void readDetail("skill", request.id)
      .then((nextDetail) => {
        if (canceled) return
        if (nextDetail.type !== "skill") {
          throw new Error("读取到的内容不是 Skill。")
        }
        setDetail(nextDetail)
        setInitialValue(buildEditInitialValue("skill", nextDetail, initPayload))
      })
      .catch((error) => {
        logger.error("Failed to load Skill editor detail.", { contentId: request.id, error })
      })

    return () => {
      canceled = true
    }
  }, [initPayload, logger, request])

  const formState = useContentCreateForm(SKILL_FORM_CONFIG, {
    initialValue,
    logContext: { category: "skills.editor.window", contentId: request.kind === "edit" ? request.id : null, contentType: "skill", mode },
    onOpenChange: (open) => {
      if (!open) window.close()
    },
    onSubmit: async (payload) => {
      const finalPayload = {
        ...payload,
        files: await serializeCreateSkillFiles(payload.files),
      }

      if (request.kind === "create") {
        const result = await createContent("skill", finalPayload)
        if (result.status === "conflict") throw new Error("内容已更新，请刷新后再编辑。")
        window.close()
        return
      }

      if (!detail) throw new Error("内容尚未加载。")
      const result = await updateContent("skill", { ...finalPayload, id: detail.id, baseHistoryDirname: detail.latestHistoryDirname })
      if (result.status === "conflict") throw new Error("内容已更新，请刷新后再编辑。")
      if (request.origin === "detail") {
        await openContentDetailWindow({ contentType: "skill", id: result.id, title: result.title, viewMode: "rendered" })
      }
      window.close()
    },
    open: true,
  })
  const iconImage = useContentIconImage({
    contentType: "skill",
    contentId: request.kind === "edit" ? request.id : null,
    iconType: formState.form.iconType,
    iconImage: formState.form.iconImage,
    mode,
    open: true,
    setErrors: formState.setErrors,
    updateField: formState.updateField,
  })
  const preparedForm = iconImage.prepareFormForSubmit(formState.form) as CreateSkillPayload

  if (request.kind === "edit" && !initialValue) {
    return <EditorLoadingState title={buildWindowTitle("skill", "edit")} />
  }

  return (
    <>
      <form className="contents" onSubmit={(event) => formState.handleSubmit(event, preparedForm)}>
        <ContentEditorWindowLayout
          title={buildWindowTitle("skill", mode)}
          meta={(
            <SkillEditorMetaFields
              errors={formState.errors}
              form={formState.form}
              updateField={formState.updateField}
              icon={formState.form.icon}
              iconBg={formState.form.iconBg}
              iconType={formState.form.iconType}
              iconImage={iconImage.iconImagePreview}
              onIconChange={(value) => formState.updateField("icon", value)}
              onIconBgChange={(value) => formState.updateField("iconBg", value)}
              onIconTypeChange={(value) => formState.updateField("iconType", value)}
              onIconImageChange={iconImage.handleIconImageChange}
              onIconImageRemove={iconImage.handleIconImageRemove}
            />
          )}
          body={(
            <ContentEditorBodyField
              label="主说明"
              value={formState.form.content}
              error={formState.errors.content}
              onChange={(value) => formState.updateField("content", value)}
            />
          )}
          auxiliary={(
            <SkillAttachmentManager
              files={formState.form.files}
              error={formState.errors.files}
              isSubmitting={formState.isSubmitting}
              onFilesChange={(files) => formState.updateField("files", files)}
            />
          )}
          footer={(
            <EditorFooter
              isSubmitting={formState.isSubmitting}
              submitError={formState.submitError}
              onCancel={() => formState.handleDialogOpenChange(false)}
            />
          )}
        />
      </form>
      <DiscardConfirmDialog
        open={formState.isDiscardConfirmOpen}
        onOpenChange={formState.setIsDiscardConfirmOpen}
        onDiscard={formState.handleDiscard}
      />
    </>
  )
}

function ContentEditorWindowPage({ request }: ContentEditorWindowPageProps) {
  if (request.contentType === "rule") {
    return <RuleEditorWindow request={request} />
  }

  if (request.contentType === "prompt") {
    return <PromptEditorWindow request={request} />
  }

  return <SkillEditorWindow request={request} />
}

export { ContentEditorWindowPage }

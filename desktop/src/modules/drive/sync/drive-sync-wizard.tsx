import { Plus, Pencil, Unlink, Folder, File, Upload, Download, Link, ListFilter, FolderInput, Cloud, RefreshCw } from "lucide-react"
import type { DriveSyncBindingDto } from "@synapse/shared"
import { GuidedChoices, GuidedFlow } from "@/components/guided-flow"
import { formatDriveBytes } from "@/lib/drive-format"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DialogFrameBody, DialogFrameFooter, DialogFrameHeader } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DriveSyncRemotePicker } from "./drive-sync-remote-picker"
import { alignmentActionLabels, type SyncWizardEdit, type SyncWizardOperation, type SyncWizardScenario } from "./drive-sync-flow"
import { useDriveSyncWizard, type DriveSyncWizardEntry } from "./use-drive-sync-wizard"
import type { DriveSyncController } from "./use-drive-sync"
export type { DriveSyncWizardEntry } from "./use-drive-sync-wizard"

export function DriveSyncWizard({ controller, entry, onBindingCreated, onClose, onViewBinding }: {
  readonly controller: DriveSyncController
  readonly entry: DriveSyncWizardEntry
  readonly onBindingCreated?: (binding: DriveSyncBindingDto) => void | Promise<void>
  readonly onClose: () => void
  readonly onViewBinding: (bindingId: string) => void
}) {
  const flow = useDriveSyncWizard(controller, entry, onBindingCreated)
  if (flow.result) return <>
    <DialogFrameHeader bordered title={flow.result.title} />
    <DialogFrameBody className="overflow-auto px-5 py-5">
      {flow.result.detail && <Alert><AlertDescription>{flow.result.detail}</AlertDescription></Alert>}
      {flow.error && <FieldError>{flow.error}</FieldError>}
    </DialogFrameBody>
    <DialogFrameFooter>
      <Button variant="outline" onClick={onClose}>返回同步列表</Button>
      {flow.result.binding && <Button onClick={() => onViewBinding(flow.result!.binding!.id)}>查看同步</Button>}
    </DialogFrameFooter>
  </>
  const finalLabel = flow.operation === "remove" ? "删除同步"
    : flow.operation === "edit" && flow.edit === "range" ? "保存同步范围"
    : flow.scenario === "local_to_remote" ? "上传并开始同步"
    : flow.scenario === "remote_to_local" ? "下载并开始同步"
    : flow.authority === "local" ? "更新云端并同步" : "更新本地并同步"
  return (
    <GuidedFlow title="同步向导" step={flow.step} steps={flow.steps} busy={flow.busy}
      hideNext={flow.choiceStep} canNext={flow.canNext} nextLabel={flow.step === "confirm" ? finalLabel : "下一步"}
      destructive={flow.step === "confirm" && flow.operation === "remove"}
      onBack={flow.step === "action" ? undefined : flow.back} onNext={flow.next} onCancel={onClose}>
      <FieldSet disabled={flow.busy}><FieldGroup>
        {controller.readOnly && <Alert><AlertDescription>{controller.offline ? "联网后可管理同步" : "登录后可管理同步"}</AlertDescription></Alert>}
        {(flow.error || controller.error) && <FieldError>{flow.error || controller.error}</FieldError>}
        {flow.step === "action" && <GuidedChoices disabled={!flow.canChoose} title="要进行什么操作？" value={flow.operation}
          onSelect={(value) => flow.chooseOperation(value as SyncWizardOperation)} options={[
            { value: "create", icon: <Plus aria-hidden="true" />, title: "新建同步", description: "连接一个本地对象与一个云端对象。" },
            { value: "edit", icon: <Pencil aria-hidden="true" />, title: "修改同步", description: flow.bindings.length ? "调整位置、同步范围或重新对齐内容。" : "暂无同步", disabled: !flow.bindings.length },
            { value: "remove", icon: <Unlink aria-hidden="true" />, title: "删除同步", description: flow.bindings.length ? "停止同步，保留本地和云端文件。" : "暂无同步", disabled: !flow.bindings.length },
          ]} />}
        {flow.step === "kind" && <GuidedChoices disabled={!flow.canChoose} title="同步什么？" value={flow.kind} onSelect={(value) => flow.chooseKind(value as "file" | "folder")}
          options={[{ value: "folder", icon: <Folder aria-hidden="true" />, title: "文件夹", description: "同步文件夹及其中的内容，可设置排除项。" }, { value: "file", icon: <File aria-hidden="true" />, title: "文件", description: "只同步选中的一个文件。" }]} />}
        {flow.step === "scenario" && <GuidedChoices disabled={!flow.canChoose} title="从哪边开始？" value={flow.scenario} onSelect={(value) => flow.chooseScenario(value as SyncWizardScenario)} options={[
          { value: "local_to_remote", icon: <Upload aria-hidden="true" />, title: "本地为基础，上传并同步", description: "选择本地内容，在云端新建对应对象。" },
          { value: "remote_to_local", icon: <Download aria-hidden="true" />, title: "云端为基础，下载并同步", description: "选择云端内容，下载到新的本地位置。" },
          { value: "bind_existing", icon: <Link aria-hidden="true" />, title: "本地和云端都存在", description: "选择两端已有对象，再选择一边更新另一边。" },
        ]} />}
        {flow.step === "binding" && <GuidedChoices disabled={!flow.canChoose} title="选择同步" value={flow.binding?.id ?? ""} onSelect={flow.chooseBinding}
          options={flow.bindings.map((item) => ({ value: item.id, icon: item.kind === "folder" ? <Folder aria-hidden="true" /> : <File aria-hidden="true" />, title: item.driveItemName, description: `本地 ${item.localPath}；云端 ${item.drivePathHint ?? item.driveItemName}` }))} />}
        {flow.step === "edit" && <GuidedChoices disabled={!flow.canChoose} title="修改什么？" value={flow.edit} onSelect={(value) => flow.chooseEdit(value as SyncWizardEdit)} options={[
          { value: "range", icon: <ListFilter aria-hidden="true" />, title: "同步范围", description: "调整排除规则，已排除的文件保留原状。", disabled: flow.kind !== "folder" },
          { value: "local", icon: <FolderInput aria-hidden="true" />, title: "本地位置", description: "选择另一个已有对象，原位置文件保留。" },
          { value: "remote", icon: <Cloud aria-hidden="true" />, title: "云端对象", description: "选择另一个已有对象，原云端内容保留。" },
          { value: "align", icon: <RefreshCw aria-hidden="true" />, title: "重新对齐", description: "重新选择一边为准，更新另一边。" },
        ]} />}
        {flow.step === "local" && <Field>
          <FieldLabel htmlFor="sync-local">{flow.scenario === "remote_to_local" ? "本地保存位置" : `本地${flow.kind === "folder" ? "文件夹" : "文件"}`}</FieldLabel>
          <Input id="sync-local" value={flow.localPath} onChange={(event) => flow.setLocalPath(event.target.value)} disabled={flow.busy} />
          <Button variant="outline" disabled={flow.busy} onClick={() => { void flow.pickLocal() }}>选择{flow.scenario === "remote_to_local" ? "保存位置" : flow.kind === "folder" ? "文件夹" : "文件"}</Button>
          {flow.scenario === "remote_to_local" && <FieldDescription>目标已存在时，请返回选择「本地和云端都存在」。</FieldDescription>}
        </Field>}
        {flow.step === "remote" && <>
          <DriveSyncRemotePicker controller={controller} kind={flow.kind || "folder"} chooseParent={flow.scenario === "local_to_remote"} onSelect={flow.setRemote} onParent={flow.setParent} />
          {flow.scenario === "local_to_remote" && <Field><FieldLabel htmlFor="sync-name">云端新建名称</FieldLabel><Input id="sync-name" value={flow.name} onChange={(event) => flow.setName(event.target.value)} /></Field>}
          <FieldDescription>已选云端位置：{flow.remotePath || "尚未选择"}</FieldDescription>
        </>}
        {flow.step === "authority" && <GuidedChoices disabled={!flow.canChoose} title="本次以哪边为准？" value={flow.authority} onSelect={(value) => flow.chooseAuthority(value as "local" | "remote")} options={[
          { value: "local", icon: <FolderInput aria-hidden="true" />, title: "以本地为准，更新云端", description: "覆盖云端不同内容；云端独有内容移入回收站。" },
          { value: "remote", icon: <Cloud aria-hidden="true" />, title: "以云端为准，更新本地", description: "替换本地不同内容；本地旧内容和独有内容移入回收站。" },
        ]} />}
        {flow.step === "range" && <FieldSet><FieldLegend>同步范围</FieldLegend><FieldGroup>
          <Field orientation="horizontal"><Checkbox id="sync-defaults" checked={flow.defaults} onCheckedChange={(value) => flow.setDefaults(value === true)} /><FieldLabel htmlFor="sync-defaults">{flow.operation === "edit" ? "保留当前默认排除项" : "排除依赖、构建产物和日志"}</FieldLabel></Field>
          <Field><FieldLabel htmlFor="sync-rules">自定义排除项</FieldLabel><Textarea id="sync-rules" value={flow.rulesText} onChange={(event) => flow.setRulesText(event.target.value)} /><FieldDescription>每行一条，例如 *.log 或 dist/。规则顺序会保留。</FieldDescription></Field>
          {flow.operation === "create" && <Field orientation="horizontal"><Checkbox id="sync-gitignore" checked={flow.importGitignore} onCheckedChange={(value) => flow.setImportGitignore(value === true)} /><FieldLabel htmlFor="sync-gitignore">一次性导入本地 .gitignore</FieldLabel></Field>}
          <FieldDescription>.git/ 和同步临时文件始终排除；排除项不会被覆盖或删除。</FieldDescription>
        </FieldGroup></FieldSet>}
        {flow.step === "confirm" && <>
          <Table><TableBody>
            <TableRow><TableCell>本地</TableCell><TableCell className="whitespace-normal break-all">{flow.localPath}</TableCell></TableRow>
            <TableRow><TableCell>云端</TableCell><TableCell className="whitespace-normal break-all">{flow.remotePath}</TableCell></TableRow>
            {flow.operation !== "remove" && <TableRow><TableCell>后续同步</TableCell><TableCell>双向同步；两边同时修改时处理冲突</TableCell></TableRow>}
          </TableBody></Table>
          {flow.operation === "remove" ? <Alert><AlertTitle>删除此同步？</AlertTitle><AlertDescription>两边文件都会保留，尚未完成的同步和冲突处理将停止。</AlertDescription></Alert>
            : flow.operation === "edit" && flow.edit === "range" ? <>
              <Alert><AlertTitle>保存同步范围</AlertTitle><AlertDescription>新排除的文件保留原状；重新纳入的内容会检查差异。</AlertDescription></Alert>
              <FieldDescription>排除：{[...(flow.binding?.excludeRules.forced ?? []), ...(flow.defaults ? flow.binding?.excludeRules.defaults ?? [] : []), ...(flow.binding?.excludeRules.importedGitignore ?? []), ...flow.rulesText.split("\n").filter(Boolean)].join("、") || "无"}</FieldDescription>
            </>
            : <>
              {flow.preview?.alignment && <>
                <FieldDescription>首次以{flow.authority === "local" ? "本地" : "云端"}为准。不变 {flow.preview.alignment.unchanged} 项；变更 {flow.preview.alignment.changes.length} 项。</FieldDescription>
                <Table><TableHeader><TableRow><TableHead>路径</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>
                  {flow.preview.alignment.changes.map((change) => <TableRow key={`${change.action}:${change.relativePath}`}><TableCell className="whitespace-normal break-all">{change.relativePath || flow.remote?.name}</TableCell><TableCell>{alignmentActionLabels[change.action]}</TableCell></TableRow>)}
                </TableBody></Table>
                {flow.preview.alignment.changes.length > 0 && <Field orientation="horizontal"><Checkbox id="sync-confirm" checked={flow.confirmed} onCheckedChange={(value) => flow.setConfirmed(value === true)} /><FieldLabel htmlFor="sync-confirm">确认以上覆盖及移入回收站操作</FieldLabel></Field>}
              </>}
              {flow.preview?.initialTransfer && <>
                <FieldDescription>首次{flow.scenario === "local_to_remote" ? "上传" : "下载"} {flow.preview.initialTransfer.fileCount} 个文件、{flow.preview.initialTransfer.folderCount} 个文件夹，共 {formatDriveBytes(flow.preview.initialTransfer.totalBytes)}。</FieldDescription>
                <Table><TableHeader><TableRow><TableHead>路径</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>
                  {flow.preview.initialTransfer.entries.map((item) => <TableRow key={item.relativePath}><TableCell className="whitespace-normal break-all">{item.relativePath}</TableCell><TableCell>{item.action === "upload_file" ? "上传文件" : item.action === "download_file" ? "下载文件" : item.action === "create_local_folder" ? "新建本地文件夹" : "新建云端文件夹"}</TableCell></TableRow>)}
                </TableBody></Table>
                {flow.preview.initialTransfer.truncated && <FieldDescription>共 {flow.preview.initialTransfer.totalEntries} 项，当前显示前 {flow.preview.initialTransfer.entries.length} 项。</FieldDescription>}
              </>}
              {flow.kind === "folder" && flow.preview && <FieldDescription>排除：{[...flow.preview.forcedExcludeRules, ...flow.preview.defaultExcludeRules, ...flow.preview.importedGitignoreRules, ...flow.rulesText.split("\n").filter(Boolean)].join("、")}</FieldDescription>}
              <Button variant="outline" disabled={flow.busy} onClick={flow.recheck}>重新检查</Button>
            </>}
        </>}
      </FieldGroup></FieldSet>
    </GuidedFlow>
  )
}

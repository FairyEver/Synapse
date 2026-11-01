import { TextField } from '@heroui/react';
import { AlertDialog, Button, Dropdown, Input, Label, Modal } from '@heroui/react';
import { useState } from 'react';
import type { SkillRepositoryFileContentDto } from '@synapse/shared';
import { Download, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { FileBrowserBreadcrumbs } from '../file-browser/finder/file-browser-breadcrumbs';
import { FileBrowserFullLayout, FileBrowserFileLayout } from '../file-browser/finder/file-browser-layout';
import { FileBrowserList } from '../file-browser/finder/file-browser-list';
import type { FileBrowserFileRow, FileBrowserTree } from '../file-browser/finder/file-browser-model';
import { FileBrowserCodeRenderer } from '../file-browser/renderers/code-renderer';
import { FileRendererShell, type FileRendererEditContext } from '../file-browser/renderers/renderer-shell';
import { isProtectedSkillRepositoryPath } from './skill-repository-view-model';
export function SkillRepositoryFileBrowser({ tree, selectedFilePath, fileContent, fileLoading, savingText, reloadingFile, onNavigateFolder, onOpenFile, onRenameFile, onDeleteFile, onDownloadFile, onReloadText, onSaveText, readonlyMode = false, }: {
    readonly tree: FileBrowserTree;
    readonly selectedFilePath: string | null;
    readonly fileContent: SkillRepositoryFileContentDto | null;
    readonly fileLoading: boolean;
    readonly savingText: boolean;
    readonly reloadingFile: boolean;
    readonly readonlyMode?: boolean;
    readonly onNavigateFolder: (path: string) => void;
    readonly onOpenFile: (path: string) => void;
    readonly onRenameFile: (input: {
        readonly fromPath: string;
        readonly toPath: string;
    }) => Promise<unknown>;
    readonly onDeleteFile: (input: {
        readonly path: string;
        readonly expectedSha256?: string | null;
    }) => Promise<unknown>;
    readonly onDownloadFile: (path: string) => string;
    readonly onReloadText: () => Promise<{
        readonly text: string;
        readonly baseVersionId: string;
    }>;
    readonly onSaveText: (input: {
        readonly text: string;
        readonly baseVersionId: string;
    }) => Promise<{
        readonly baseVersionId: string;
    }>;
}) {
    const [renameRow, setRenameRow] = useState<FileBrowserFileRow | null>(null);
    const [deleteRow, setDeleteRow] = useState<FileBrowserFileRow | null>(null);
    const [renamePath, setRenamePath] = useState('');
    const selectedName = lastPathSegment(selectedFilePath);
    const editContext: FileRendererEditContext | undefined = readonlyMode ? undefined : {
        reload: onReloadText,
        reloading: reloadingFile,
        saveText: onSaveText,
        savingText,
    };
    return (<section className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <FileBrowserBreadcrumbs breadcrumbs={tree.breadcrumbs} onNavigate={onNavigateFolder}/>
      </div>

      {selectedFilePath && fileContent ? (<FileBrowserFileLayout>
          {fileContent.file.kind === 'text' && fileContent.text !== null ? (<FileRendererShell title={selectedName ?? fileContent.file.path}>
              <FileBrowserCodeRenderer path={fileContent.file.path} text={fileContent.text} baseVersionId={fileContent.file.sha256} truncated={fileContent.truncated} editContext={editContext}/>
            </FileRendererShell>) : (<div className='flex h-full min-h-72 items-center justify-center text-sm text-muted'>
              不支持在线编辑
            </div>)}
        </FileBrowserFileLayout>) : (<FileBrowserFullLayout>
          {fileLoading ? (<div className='flex h-full min-h-72 items-center justify-center text-sm text-muted'>加载中</div>) : (<FileBrowserList rows={tree.rows} selectedPath={selectedFilePath} onOpenFolder={onNavigateFolder} onOpenFile={onOpenFile} renderFileActions={(row) => (<FileActions row={row} readonlyMode={readonlyMode} onDownload={() => downloadFile(onDownloadFile(row.file.path))} onRename={() => {
                        setRenameRow(row);
                        setRenamePath(row.file.path);
                    }} onDelete={() => setDeleteRow(row)}/>)}/>)}
        </FileBrowserFullLayout>)}

      <Modal.Backdrop isOpen={Boolean(renameRow)} onOpenChange={(open) => {
            if (!open)
                setRenameRow(null);
        }}><Modal.Container><Modal.Dialog>
          <form className='flex min-h-0 flex-1 flex-col' onSubmit={(event) => {
            event.preventDefault();
            if (!renameRow)
                return;
            void onRenameFile({ fromPath: renameRow.file.path, toPath: renamePath }).then(() => setRenameRow(null));
        }}>
            <Modal.Header>
              <Modal.Heading>重命名</Modal.Heading>
            </Modal.Header>
            <Modal.Body className='space-y-4'>
              <TextField className='grid gap-2'>
                <Label htmlFor='skill-repository-rename-path'>路径</Label>
                <Input id='skill-repository-rename-path' value={renamePath} onChange={(event) => setRenamePath(event.target.value)}></Input>
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button type='button' variant="outline" onPress={() => setRenameRow(null)}>取消</Button>
              <Button type='submit'>保存</Button>
            </Modal.Footer>
          </form>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>

      <AlertDialog.Backdrop isOpen={Boolean(deleteRow)} onOpenChange={(open) => {
            if (!open)
                setDeleteRow(null);
        }}><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Heading>删除文件？</AlertDialog.Heading>
            <p>
              {deleteRow?.file.path}
            </p>
          </AlertDialog.Header>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button onPress={() => {
            if (!deleteRow)
                return;
            void onDeleteFile({ path: deleteRow.file.path, expectedSha256: deleteRow.file.sha256 ?? null }).then(() => setDeleteRow(null));
        }}>
              删除
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
    </section>);
}
function FileActions({ row, readonlyMode, onDownload, onRename, onDelete, }: {
    readonly row: FileBrowserFileRow;
    readonly readonlyMode: boolean;
    readonly onDownload: () => void;
    readonly onRename: () => void;
    readonly onDelete: () => void;
}) {
    const protectedFile = isProtectedSkillRepositoryPath(row.file.path);
    return (<Dropdown>
      <>
        <Button type='button' variant="ghost" isIconOnly className='size-8' aria-label={`${row.name} 文件操作`}>
          <MoreHorizontal className='size-4'/>
        </Button>
      </>
      <Dropdown.Popover><Dropdown.Menu>
        <Dropdown.Item onAction={onDownload} id="action-7594">
          <Download data-icon='inline-start'/>
          下载
        </Dropdown.Item>
        {!readonlyMode && !protectedFile ? (<Dropdown.Item onAction={onRename} id="action-7767">
            <Pencil data-icon='inline-start'/>
            重命名
          </Dropdown.Item>) : null}
        {!readonlyMode && !protectedFile ? (<Dropdown.Item onAction={onDelete} variant="danger" id="action-7972">
            <Trash2 data-icon='inline-start'/>
            删除
          </Dropdown.Item>) : null}
      </Dropdown.Menu></Dropdown.Popover>
    </Dropdown>);
}
function downloadFile(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.rel = 'noopener noreferrer';
    anchor.click();
}
function lastPathSegment(path: string | null): string | null {
    if (!path)
        return path;
    const segments = path.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : path;
}

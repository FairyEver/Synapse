import { TextField } from '@heroui/react';
import { consoleHref } from '@/lib/console-href';
import { Link as HeroLink } from '@heroui/react';
import { AlertDialog, Button, Input, Label, ListBox, Modal, Select, TextArea } from '@heroui/react';
import { useEffect, useState } from 'react';
import type { SkillRepositoryDetailDto } from '@synapse/shared';
export function SkillRepositorySettingsDialog({ repository, open, saving, deleting, error, onOpenChange, onSave, onDelete, }: {
    readonly repository: SkillRepositoryDetailDto;
    readonly open: boolean;
    readonly saving: boolean;
    readonly deleting: boolean;
    readonly error: string | null;
    readonly onOpenChange: (open: boolean) => void;
    readonly onSave: (input: {
        readonly name: string;
        readonly title: string;
        readonly description: string | null;
        readonly visibility: 'private' | 'public';
    }) => Promise<void>;
    readonly onDelete: () => Promise<void>;
}) {
    const [name, setName] = useState(repository.name);
    const [title, setTitle] = useState(repository.title);
    const [description, setDescription] = useState(repository.description ?? '');
    const [visibility, setVisibility] = useState(repository.visibility);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState('');
    useEffect(() => {
        if (!open)
            return;
        setName(repository.name);
        setTitle(repository.title);
        setDescription(repository.description ?? '');
        setVisibility(repository.visibility);
        setDeleteConfirm('');
    }, [open, repository.description, repository.name, repository.title, repository.visibility]);
    const canDelete = deleteConfirm === repository.name;
    return (<>
      <Modal.Backdrop isOpen={open} onOpenChange={onOpenChange}><Modal.Container><Modal.Dialog>
          <form className='flex min-h-0 flex-1 flex-col' onSubmit={(event) => {
            event.preventDefault();
            void onSave({
                name,
                title,
                description: description.trim() ? description : null,
                visibility,
            });
        }}>
            <Modal.Header>
              <Modal.Heading>设置</Modal.Heading>
            </Modal.Header>
            <Modal.Body className='space-y-4'>
              <TextField className='grid gap-2'>
                <Label htmlFor='skill-repository-name'>仓库名</Label>
                <Input id='skill-repository-name' value={name} onChange={(event) => setName(event.target.value)}></Input>
              </TextField>
              <TextField className='grid gap-2'>
                <Label htmlFor='skill-repository-title'>标题</Label>
                <Input id='skill-repository-title' value={title} onChange={(event) => setTitle(event.target.value)}></Input>
              </TextField>
              <TextField className='grid gap-2'>
                <Label htmlFor='skill-repository-description'>描述</Label>
                <TextArea id='skill-repository-description' value={description} onChange={(event) => setDescription(event.target.value)}></TextArea>
              </TextField>
              <div className='grid gap-2'>
                <Label>可见性</Label>
                <Select value={visibility} onChange={(value) => {
              if (value === 'private' || value === 'public')
                  setVisibility(value);
          }}>
                  <Select.Trigger>
                    <Select.Value></Select.Value>
                  <Select.Indicator /></Select.Trigger>
                  <Select.Popover><ListBox>
                    <ListBox.Item id='private' textValue='private'>私有<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id='public' textValue='public'>公开<ListBox.ItemIndicator /></ListBox.Item>
                  </ListBox></Select.Popover>
                </Select>
              </div>
              {repository.forkedFromRepositoryId ? (<TextField className='grid gap-2'>
                  <Label>Fork 来源</Label>
                  <Input value={repository.forkedFromRepositoryId} readOnly></Input>
                </TextField>) : null}
              {error ? (<div className='flex items-center justify-between gap-3 text-sm text-danger'>
                  <span>{error}</span>
                  {error.includes('用户名') ? (<HeroLink href={consoleHref('/settings')}>设置</HeroLink>) : null}
                </div>) : null}
            </Modal.Body>
            <Modal.Footer className='gap-2 sm:justify-between'>
              <Button type='button' variant="danger" onPress={() => setDeleteOpen(true)}>
                删除
              </Button>
              <div className='flex gap-2'>
                <Button type='button' variant="outline" onPress={() => onOpenChange(false)}>取消</Button>
                <Button type='submit' isDisabled={saving}>{saving ? '保存中' : '保存'}</Button>
              </div>
            </Modal.Footer>
          </form>
        </Modal.Dialog></Modal.Container></Modal.Backdrop>
      <AlertDialog.Backdrop isOpen={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialog.Container><AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Heading>删除仓库？</AlertDialog.Heading>
            <p>
              输入仓库名确认删除。
            </p>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <Input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)}></Input>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button slot="close" variant="tertiary">取消</Button>
            <Button isDisabled={!canDelete || deleting} onPress={() => { void onDelete(); }}>
              {deleting ? '删除中' : '删除'}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog></AlertDialog.Container></AlertDialog.Backdrop>
    </>);
}

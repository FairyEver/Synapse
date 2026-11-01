import type { ReactNode } from 'react'
import { Checkbox, Input, Label, ListBox, Modal, Select, TextArea, TextField, Button } from '@heroui/react'

export function CloudInput({ label, value, onChange, required = false, disabled = false, multiline = false, variant = 'secondary' }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; disabled?: boolean; multiline?: boolean; variant?: 'primary' | 'secondary' }) {
  return <TextField isRequired={required} isDisabled={disabled} value={value} onChange={onChange}><Label>{label}</Label>{multiline ? <TextArea variant={variant} rows={5} /> : <Input variant={variant} />}</TextField>
}
export function CloudSelect({ label, value, items, onChange, variant = 'secondary' }: { label: string; value: string; items: { key: string; name: string }[]; onChange: (v: string) => void; variant?: 'primary' | 'secondary' }) {
  return <Select aria-label={label} selectedKey={value} onSelectionChange={key => key !== null && onChange(String(key))} variant={variant}><Label>{label}</Label><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox items={items}>{item => <ListBox.Item id={item.key} textValue={item.name}>{item.name}<ListBox.ItemIndicator /></ListBox.Item>}</ListBox></Select.Popover></Select>
}
export function CloudCheck({ label, selected, onChange }: { label: string; selected: boolean; onChange: (v: boolean) => void }) {
  return <Checkbox variant='secondary' isSelected={selected} onChange={onChange}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><Label>{label}</Label></Checkbox.Content></Checkbox>
}
export function CloudModal({ title, children, onClose, onSave, pending = false, saveLabel = '保存', danger = false }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void; pending?: boolean; saveLabel?: string; danger?: boolean }) {
  return <Modal.Backdrop isOpen onOpenChange={open => !open && !pending && onClose()}><Modal.Container size='lg'><Modal.Dialog><Modal.CloseTrigger /><form className='flex min-h-0 flex-1 flex-col' onSubmit={event => { event.preventDefault(); onSave() }}><Modal.Header className='pe-8'><Modal.Heading className='break-words'>{title}</Modal.Heading></Modal.Header><Modal.Body className='space-y-4'>{children}</Modal.Body><Modal.Footer className='flex-wrap'><Button type='button' variant='secondary' isDisabled={pending} onPress={onClose}>取消</Button><Button type='submit' variant={danger ? 'danger' : 'primary'} isPending={pending}>{saveLabel}</Button></Modal.Footer></form></Modal.Dialog></Modal.Container></Modal.Backdrop>
}

import { useState, type ComponentProps } from 'react';
import { Button, InputGroup } from '@heroui/react';
import { Eye, EyeOff } from 'lucide-react';
type PasswordInputProps = Omit<ComponentProps<typeof InputGroup.Input>, 'type' | 'className'> & {
    isDisabled?: boolean;
    className?: string;
};
export function PasswordInput({ className, disabled, isDisabled, ...props }: PasswordInputProps) {
    const [visible, setVisible] = useState(false);
    const blocked = disabled || isDisabled;
    return <InputGroup className={className}>
    <InputGroup.Input {...props} disabled={blocked} type={visible ? 'text' : 'password'}/>
    <InputGroup.Suffix><Button type='button' variant="ghost" isIconOnly isDisabled={blocked} aria-label={visible ? '隐藏密码' : '显示密码'} onPress={() => setVisible(!visible)}>{visible ? <EyeOff /> : <Eye />}</Button></InputGroup.Suffix>
  </InputGroup>;
}

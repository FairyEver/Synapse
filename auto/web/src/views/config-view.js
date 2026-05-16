import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { Play, Save } from 'lucide-react';
import { ConfigForm } from '../components/config-form';
export function ConfigView({ config, onChange, onSave, onStart }) {
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const handleSave = async () => {
        setSaving(true);
        try {
            await onSave();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        }
        finally {
            setSaving(false);
        }
    };
    return (_jsxs("div", { className: "max-w-2xl mx-auto space-y-6", children: [_jsx(ConfigForm, { config: config, onChange: onChange }), _jsxs("div", { className: "flex gap-3", children: [_jsxs("button", { type: "button", onClick: handleSave, disabled: saving, className: "flex-1 flex items-center justify-center gap-2 border border-border rounded-md py-2 px-4 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50", children: [_jsx(Save, { className: "h-4 w-4" }), saved ? '已保存 ✓' : saving ? '保存中…' : '保存配置'] }), _jsxs("button", { type: "button", onClick: onStart, className: "flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 px-4 text-sm font-medium hover:opacity-90 transition-opacity", children: [_jsx(Play, { className: "h-4 w-4" }), "\u4FDD\u5B58\u5E76\u8FD0\u884C"] })] })] }));
}

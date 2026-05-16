import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useCallback, useEffect } from 'react';
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react';
import * as api from '../api';
import { cn } from '../lib/utils';
export function PromptEditor({ config, onChange }) {
    const [guide, setGuide] = useState(null);
    const [showGuide, setShowGuide] = useState(false);
    const [renaming, setRenaming] = useState(null);
    const [newName, setNewName] = useState('');
    const [creating, setCreating] = useState(false);
    const [createName, setCreateName] = useState('');
    const switchPrompt = useCallback(async (name) => {
        const { prompt } = await api.fetchPrompt(name);
        onChange({ ...config, activePromptName: name, prompt });
    }, [config, onChange]);
    const handleRename = useCallback(async () => {
        if (!renaming || !newName.trim())
            return;
        const updated = await api.renamePrompt(renaming, newName.trim());
        onChange(updated);
        setRenaming(null);
        setNewName('');
    }, [renaming, newName, onChange]);
    const handleDelete = useCallback(async (name) => {
        if (!confirm(`确认删除 prompt "${name}"？`))
            return;
        const updated = await api.deletePrompt(name);
        onChange(updated);
    }, [onChange]);
    const handleCreate = useCallback(async () => {
        if (!createName.trim())
            return;
        const updated = await api.createPrompt(createName.trim());
        onChange(updated);
        setCreating(false);
        setCreateName('');
    }, [createName, onChange]);
    useEffect(() => {
        if (showGuide && !guide) {
            api.fetchGuide().then(g => setGuide(g.content));
        }
    }, [showGuide, guide]);
    return (_jsxs("div", { className: "space-y-3", children: [_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("label", { className: "text-sm font-medium", children: "Prompt" }), _jsx("select", { value: config.activePromptName, onChange: e => switchPrompt(e.target.value), className: "border border-input rounded-md px-2 py-1 text-sm bg-background", children: config.prompts.map(name => (_jsx("option", { value: name, children: name }, name))) }), _jsx("button", { type: "button", onClick: () => setCreating(true), className: "p-1 hover:bg-muted rounded-md", title: "\u65B0\u5EFA prompt", children: _jsx(Plus, { className: "h-4 w-4" }) }), _jsx("button", { type: "button", onClick: () => { setRenaming(config.activePromptName); setNewName(config.activePromptName); }, className: "p-1 hover:bg-muted rounded-md", title: "\u91CD\u547D\u540D", children: _jsx(Pencil, { className: "h-4 w-4" }) }), config.prompts.length > 1 && (_jsx("button", { type: "button", onClick: () => handleDelete(config.activePromptName), className: "p-1 hover:bg-muted rounded-md text-destructive", title: "\u5220\u9664", children: _jsx(Trash2, { className: "h-4 w-4" }) })), _jsx("button", { type: "button", onClick: () => setShowGuide(g => !g), className: cn('p-1 hover:bg-muted rounded-md ml-auto', showGuide && 'bg-muted'), title: "Prompt \u7F16\u5199\u6307\u5357", children: _jsx(BookOpen, { className: "h-4 w-4" }) })] }), creating && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { value: createName, onChange: e => setCreateName(e.target.value), placeholder: "\u65B0 prompt \u540D\u79F0", className: "border border-input rounded-md px-2 py-1 text-sm bg-background flex-1", onKeyDown: e => e.key === 'Enter' && handleCreate(), autoFocus: true }), _jsx("button", { type: "button", onClick: handleCreate, className: "text-sm px-2 py-1 bg-primary text-primary-foreground rounded-md", children: "\u521B\u5EFA" }), _jsx("button", { type: "button", onClick: () => setCreating(false), className: "text-sm px-2 py-1", children: "\u53D6\u6D88" })] })), renaming && (_jsxs("div", { className: "flex items-center gap-2", children: [_jsx("input", { value: newName, onChange: e => setNewName(e.target.value), className: "border border-input rounded-md px-2 py-1 text-sm bg-background flex-1", onKeyDown: e => e.key === 'Enter' && handleRename(), autoFocus: true }), _jsx("button", { type: "button", onClick: handleRename, className: "text-sm px-2 py-1 bg-primary text-primary-foreground rounded-md", children: "\u786E\u8BA4" }), _jsx("button", { type: "button", onClick: () => setRenaming(null), className: "text-sm px-2 py-1", children: "\u53D6\u6D88" })] })), _jsx("textarea", { value: config.prompt, onChange: e => onChange({ ...config, prompt: e.target.value }), rows: 12, className: "w-full border border-input rounded-md px-3 py-2 text-sm bg-background font-mono resize-y", placeholder: "\u8F93\u5165 prompt \u5185\u5BB9\u2026" }), showGuide && guide && (_jsx("pre", { className: "border border-border rounded-md p-3 text-xs bg-muted overflow-auto max-h-64 whitespace-pre-wrap", children: guide }))] }));
}

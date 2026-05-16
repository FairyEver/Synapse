import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { ChevronRight, CheckCircle, XCircle, Clock, Loader2, Circle } from 'lucide-react';
import { Terminal } from './terminal';
import { cn } from '../lib/utils';
function formatDuration(ms) {
    if (ms < 1000)
        return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    if (m === 0)
        return `${s}s`;
    return `${m}m ${s % 60}s`;
}
const statusConfig = {
    pending: { icon: Circle, className: 'text-muted-foreground', label: '等待中' },
    running: { icon: Loader2, className: 'text-blue-500 animate-spin', label: '运行中' },
    success: { icon: CheckCircle, className: 'text-green-500', label: '成功' },
    error: { icon: XCircle, className: 'text-destructive', label: '失败' },
    timeout: { icon: Clock, className: 'text-orange-500', label: '超时' },
};
export function WorkerPanel({ worker, lines, trimmedCount, defaultOpen = false }) {
    const [open, setOpen] = useState(defaultOpen);
    const cfg = statusConfig[worker.status] ?? statusConfig.pending;
    const Icon = cfg.icon;
    return (_jsxs("div", { className: "border border-border rounded-lg overflow-hidden", children: [_jsxs("button", { type: "button", onClick: () => setOpen(o => !o), className: "flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-muted/50 transition-colors", children: [_jsx(ChevronRight, { className: cn('h-4 w-4 transition-transform', open && 'rotate-90') }), _jsx(Icon, { className: cn('h-4 w-4', cfg.className) }), _jsxs("span", { className: "font-medium", children: ["Worker ", worker.id] }), _jsx("span", { className: cn('text-xs', cfg.className), children: cfg.label }), worker.durationMs > 0 && (_jsx("span", { className: "text-xs text-muted-foreground ml-auto", children: formatDuration(worker.durationMs) }))] }), open && (_jsx("div", { className: "h-64", children: lines.length > 0 ? (_jsx(Terminal, { lines: lines, trimmedCount: trimmedCount, className: "h-full" })) : (_jsx("div", { className: "h-full bg-terminal-bg flex items-center justify-center text-terminal-fg/50 text-xs font-mono", children: worker.lastMessage || '暂无输出' })) }))] }));
}

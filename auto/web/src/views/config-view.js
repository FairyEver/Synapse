import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Play } from 'lucide-react';
import { ConfigForm } from '../components/config-form';
export function ConfigView({ config, onChange, onStart }) {
    return (_jsxs("div", { className: "max-w-2xl mx-auto space-y-6", children: [_jsx(ConfigForm, { config: config, onChange: onChange }), _jsxs("button", { type: "button", onClick: onStart, className: "w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 px-4 text-sm font-medium hover:opacity-90 transition-opacity", children: [_jsx(Play, { className: "h-4 w-4" }), "\u5F00\u59CB\u8FD0\u884C"] })] }));
}

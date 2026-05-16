import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { PromptEditor } from './prompt-editor';
import { ProviderSettings } from './provider-settings';
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];
const INTERVAL_OPTIONS = [
    { value: 10, label: '10 秒' },
    { value: 60, label: '1 分钟' },
    { value: 600, label: '10 分钟' },
    { value: 1800, label: '30 分钟' },
    { value: 3600, label: '1 小时' },
];
const TIMEOUT_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
const MAX_LOGS_OPTIONS = [10, 20, 30, 50, 100, 200];
export function ConfigForm({ config, onChange }) {
    const update = (key, value) => {
        onChange({ ...config, [key]: value });
    };
    return (_jsxs("div", { className: "space-y-8", children: [_jsx(Section, { title: "Prompt", children: _jsx(PromptEditor, { config: config, onChange: onChange }) }), _jsx(Section, { title: "\u8FD0\u884C\u914D\u7F6E", children: _jsxs("div", { className: "grid grid-cols-2 gap-x-6 gap-y-4", children: [_jsx(Field, { label: "Provider", children: _jsxs("select", { value: config.provider, onChange: e => update('provider', e.target.value), className: "select-field", children: [_jsx("option", { value: "codex", children: "Codex" }), _jsx("option", { value: "claude-code", children: "Claude Code" })] }) }), _jsx(Field, { label: "\u5E76\u53D1\u6570", children: _jsx("select", { value: config.concurrency, onChange: e => update('concurrency', Number(e.target.value)), className: "select-field", children: CONCURRENCY_OPTIONS.map(n => (_jsxs("option", { value: n, children: [n, " worker", n > 1 ? 's' : ''] }, n))) }) }), _jsx(Field, { label: "\u5FAA\u73AF\u95F4\u9694", children: _jsx("select", { value: config.intervalSeconds, onChange: e => update('intervalSeconds', Number(e.target.value)), className: "select-field", children: INTERVAL_OPTIONS.map(o => (_jsx("option", { value: o.value, children: o.label }, o.value))) }) }), _jsx(Field, { label: "\u8D85\u65F6\u65F6\u95F4", children: _jsx("select", { value: config.timeoutMinutes, onChange: e => update('timeoutMinutes', Number(e.target.value)), className: "select-field", children: TIMEOUT_OPTIONS.map(n => (_jsxs("option", { value: n, children: [n, " \u5206\u949F"] }, n))) }) }), _jsx(Field, { label: "\u4FDD\u7559\u65E5\u5FD7", className: "col-span-1", children: _jsx("select", { value: config.maxLogs, onChange: e => update('maxLogs', Number(e.target.value)), className: "select-field", children: MAX_LOGS_OPTIONS.map(n => (_jsxs("option", { value: n, children: ["\u6700\u8FD1 ", n, " \u6B21"] }, n))) }) }), _jsx(Field, { label: "\u5DE5\u4F5C\u76EE\u5F55", className: "col-span-2", children: _jsx("input", { value: config.workingDirectory, onChange: e => update('workingDirectory', e.target.value), className: "w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background font-mono" }) })] }) }), _jsx(Section, { title: config.provider === 'codex' ? 'Codex 设置' : 'Claude Code 设置', children: _jsx(ProviderSettings, { config: config, onChange: onChange }) })] }));
}
function Section({ title, children }) {
    return (_jsxs("section", { children: [_jsx("h2", { className: "text-sm font-semibold text-foreground mb-3 pb-2 border-b border-border", children: title }), children] }));
}
function Field({ label, children, className }) {
    return (_jsxs("div", { className: className, children: [_jsx("label", { className: "text-xs font-medium text-muted-foreground mb-1.5 block", children: label }), children] }));
}

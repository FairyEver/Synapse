const BASE = '';
async function json(path, init) {
    const res = await fetch(`${BASE}${path}`, init);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? res.statusText);
    }
    return res.json();
}
export function fetchConfig() {
    return json('/api/config');
}
export function saveConfig(config) {
    return json('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
    });
}
export function startScheduler(config) {
    return json('/api/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
    });
}
export function stopAfterCurrent() {
    return json('/api/stop-after-current', { method: 'POST' });
}
export function fetchGuide() {
    return json('/api/guide');
}
export function fetchWorkerOutput() {
    return json('/api/workers/output');
}
export function createPrompt(name) {
    return json('/api/prompts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
    });
}
export function fetchPrompt(name) {
    return json(`/api/prompts/${encodeURIComponent(name)}`);
}
export function renamePrompt(name, newName) {
    return json(`/api/prompts/${encodeURIComponent(name)}/rename`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName }),
    });
}
export function deletePrompt(name) {
    return json(`/api/prompts/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

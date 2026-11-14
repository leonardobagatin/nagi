// api.js - Network and server communication layer

export async function fetchSessions() {
    const res = await fetch('/api/sessions');
    if (!res.ok) throw new Error('Failed to fetch sessions');
    return await res.json();
}

export async function fetchSessionHistory(sessionId) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error(`Failed to fetch history for session: ${sessionId}`);
    return await res.json();
}

export async function updateSession(sessionId, body) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Failed to update session: ${sessionId}`);
    return res;
}

export async function removeSession(sessionId) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete session: ${sessionId}`);
    return res;
}

// --- Saved Searches & Context API Wrappers ---
export async function fetchSavedSearches() {
    const res = await fetch('/api/searches');
    if (!res.ok) throw new Error('Failed to fetch saved searches');
    return await res.json();
}

export async function saveSearchPill(query, contextNote = '') {
    const res = await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context_note: contextNote })
    });
    if (!res.ok) throw new Error('Failed to save search pill');
    return res.json();
}

export async function removeSearchPill(query) {
    const res = await fetch(`/api/searches/${encodeURIComponent(query)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete search pill');
    return res.json();
}

export async function sendChatMessage(payload) {
    return fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
}

export async function retryChatMessage(sessionId, messageId) {
    return fetch(`/api/sessions/${encodeURIComponent(sessionId)}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: Number(messageId) })
    });
}

export async function forkSessionApi(sessionId, messageId) {
    const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message_id: Number(messageId) })
    });
    if (!res.ok) throw new Error("Failed to fork session");
    return await res.json();
}
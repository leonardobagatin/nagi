// searchContext.js - Manages the saved search pill context file drawer

import { fetchSavedSearchFile, updateSavedSearchFile } from './api.js';

export function setupSearchContextModule() {
    let activeSearchFileTerm = null;

    const drawer = document.getElementById('search-file-drawer');
    const titleEl = document.getElementById('search-file-title');
    const textareaEl = document.getElementById('search-file-textarea');
    const saveBtn = document.getElementById('save-search-file-btn');
    const closeBtn = document.getElementById('close-search-file-btn');

    if (closeBtn) {
        closeBtn.onclick = () => {
            if (drawer) drawer.classList.add('hidden');
            activeSearchFileTerm = null;
        };
    }

    if (saveBtn) {
        saveBtn.onclick = async () => {
            if (!activeSearchFileTerm) return;
            try {
                await updateSavedSearchFile(activeSearchFileTerm, textareaEl.value);
                saveBtn.textContent = 'Saved!';
                setTimeout(() => { saveBtn.textContent = 'Save'; }, 1500);
            } catch (err) {
                console.error("Failed to save search file", err);
                saveBtn.textContent = 'Error';
            }
        };
    }

    async function openDrawer(term) {
        activeSearchFileTerm = term;
        if (titleEl) titleEl.textContent = `Context: ${term}`;
        if (textareaEl) {
            textareaEl.value = 'Loading...';
            try {
                const content = await fetchSavedSearchFile(term);
                textareaEl.value = content;
            } catch (err) {
                textareaEl.value = '';
                console.error("Failed to load search file", err);
            }
        }
        if (drawer) drawer.classList.remove('hidden');
    }

    return {
        openDrawer
    };
}
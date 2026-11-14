// client.js - Unified chat, sessions, markdown, code copy, and tag autocompletion controller

import { 
    fetchSessions, 
    fetchSessionHistory, 
    updateSession, 
    removeSession, 
    forkSessionApi, 
    fetchSavedSearches, 
    saveSearchPill, 
    removeSearchPill,
    retryChatMessage 
} from './api.js';

export function setupClientModule({
    container,
    homeInput,
    homeSessionsList,
    chatCounter,
    savedSearchesContainer,
    chatTitleText,
    chatHeaderMenuContainer,
    emptyStateDiv,
    showChat,
    showGraph,
    loadGraph,
    requestGraphFrame,
    WRAPPER_CLASS,
    ICONS,
    onOpenContext
}) {
    // --- State ---
    let currentSessionId = null;
    let cachedSessions = [];
    let selectedSessionIndex = -1;
    let cachedSavedSearches = [];

    // --- Helper UI Components ---
    function createIconButton(svgMarkup, title) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = title;
        btn.className = 'text-theme-muted hover:text-theme-main transition p-1 rounded';
        btn.innerHTML = svgMarkup;
        return btn;
    }

    // --- Code Block Copy Buttons & Language Badge ---
    function attachCodeBlockCopyButtons(containerEl) {
        containerEl.querySelectorAll('pre').forEach(pre => {
            if (pre.querySelector('.code-copy-header')) return;
            const codeEl = pre.querySelector('code');
            if (!codeEl) return;

            let lang = 'Code';
            const classMatch = codeEl.className.match(/language-([^\s]+)/) || pre.className.match(/language-([^\s]+)/);
            if (classMatch && classMatch[1]) {
                lang = classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1);
            }

            const header = document.createElement('div');
            header.className = 'code-copy-header absolute top-0 left-0 right-0 h-9 px-3 flex items-center justify-between pointer-events-auto';

            const langSpan = document.createElement('span');
            langSpan.className = 'text-xs text-theme-muted select-none';
            langSpan.textContent = lang;

            const copyBtn = createIconButton(ICONS.copy, 'Copy code');
            copyBtn.className = 'code-copy-btn text-theme-muted hover:text-theme-main transition p-1 rounded';

            copyBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await navigator.clipboard.writeText(codeEl.innerText);
                    copyBtn.innerHTML = ICONS.check;
                    copyBtn.title = 'Copied!';
                    setTimeout(() => {
                        copyBtn.innerHTML = ICONS.copy;
                        copyBtn.title = 'Copy code';
                    }, 2000);
                } catch (err) {
                    console.error('Failed to copy code block', err);
                }
            };

            header.appendChild(langSpan);
            header.appendChild(copyBtn);
            pre.appendChild(header);
        });
    }

    // --- Message DOM Rendering ---
    function appendMessageDOM(msgId, text, role, { streamResponseInto }) {
        const wrapper = document.createElement('div');
        wrapper.className = WRAPPER_CLASS;
        if (msgId) wrapper.dataset.msgId = msgId;

        const actions = document.createElement('div');
        actions.className = 'flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition';
        const copyBtn = createIconButton(ICONS.copy, 'Copy');

        copyBtn.onclick = async () => {
            try {
                const targetText = role === 'user' ? wrapper.querySelector('p').textContent : wrapper.querySelector('.assistant-content').innerText;
                await navigator.clipboard.writeText(targetText);
                copyBtn.innerHTML = ICONS.check;
                copyBtn.title = 'Copied!';
            } catch (err) {
                console.error('Failed to copy message', err);
            }
        };

        actions.onmouseleave = () => {
            copyBtn.innerHTML = ICONS.copy;
            copyBtn.title = 'Copy';
        };

        if (role === 'user') {
            wrapper.className += ' flex flex-col items-end group relative py-2';
            const div = document.createElement('div');
            div.className = 'p-4 rounded-xl bg-custom-dark text-theme-main max-w-[85%]';
            
            const p = document.createElement('p');
            p.className = 'whitespace-pre-wrap text-base leading-[26px]';
            p.textContent = text;
            div.appendChild(p);

            actions.appendChild(copyBtn);
            wrapper.appendChild(div);
            wrapper.appendChild(actions);
        } else {
            wrapper.className += ' flex flex-col group relative py-2 text-theme-main';
            const p = document.createElement('p');
            p.className = 'assistant-content text-base leading-[26px] w-full';
            
            if (text && !text.includes('typing-dots')) {
                p.innerHTML = marked.parse(text);
                attachCodeBlockCopyButtons(p);
            } else {
                p.textContent = text;
            }

            const retryBtn = createIconButton(ICONS.retry, 'Retry');
            retryBtn.onclick = () => {
                const id = wrapper.dataset.msgId;
                if (!id || !currentSessionId) return;

                let sibling = wrapper.nextElementSibling;
                while (sibling) {
                    const toRemove = sibling;
                    sibling = sibling.nextElementSibling;
                    toRemove.remove();
                }

                p.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span>';
                streamResponseInto(p, wrapper, retryChatMessage(currentSessionId, id));
            };

            const forkBtn = createIconButton(ICONS.fork, 'Fork chat from this response');
            forkBtn.onclick = () => {
                const id = wrapper.dataset.msgId;
                if (id) forkSession(id);
            };

            actions.appendChild(copyBtn);
            actions.appendChild(retryBtn);
            actions.appendChild(forkBtn);

            wrapper.appendChild(p);
            wrapper.appendChild(actions);
        }

        container.appendChild(wrapper);
        container.scrollTop = container.scrollHeight;
        return { wrapper, p: wrapper.querySelector('p') };
    }

    // --- Saved Searches & Context Management ---
    async function loadSavedSearches() {
        try {
            cachedSavedSearches = await fetchSavedSearches();
            renderSavedSearches();
        } catch (err) {
            console.error("Failed to load saved searches from DB", err);
        }
    }

    function updateScrollFade() {
        if (!savedSearchesContainer) return;
        const { scrollLeft, scrollWidth, clientWidth } = savedSearchesContainer;
        const maxScrollLeft = scrollWidth - clientWidth;

        if (scrollWidth <= clientWidth + 2) {
            savedSearchesContainer.style.maskImage = 'none';
            savedSearchesContainer.style.WebkitMaskImage = 'none';
            return;
        }

        const atStart = scrollLeft <= 2;
        const atEnd = scrollLeft >= maxScrollLeft - 2;
        let mask = 'none';

        if (atStart) {
            mask = 'linear-gradient(to right, black 85%, transparent 100%)';
        } else if (atEnd) {
            mask = 'linear-gradient(to right, transparent 0%, black 15%)';
        } else {
            mask = 'linear-gradient(to right, transparent 0%, black 15%, black 85%, transparent 100%)';
        }

        savedSearchesContainer.style.maskImage = mask;
        savedSearchesContainer.style.WebkitMaskImage = mask;
    }

    if (savedSearchesContainer) {
        savedSearchesContainer.addEventListener('scroll', updateScrollFade);
        window.addEventListener('resize', updateScrollFade);
        savedSearchesContainer.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                savedSearchesContainer.scrollLeft += e.deltaY;
            }
        }, { passive: false });
    }

    function renderSavedSearches() {
        if (!savedSearchesContainer) return;
        savedSearchesContainer.innerHTML = '';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.title = 'Save current search query';
        addBtn.className = 'flex items-center justify-center px-2.5 py-1 rounded-lg bg-custom-dark text-theme-muted hover:text-theme-main hover-theme-bg transition text-xs flex-shrink-0';
        addBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
        addBtn.onclick = async () => {
            const query = homeInput.value.trim();
            if (!query) return;
            try {
                await saveSearchPill(query, '');
                await loadSavedSearches();
            } catch (err) {
                console.error("Failed to save search pill", err);
            }
        };
        savedSearchesContainer.appendChild(addBtn);

        cachedSavedSearches.forEach((itemData) => {
            const term = itemData.query;
            const pill = document.createElement('div');
            pill.className = 'group relative flex items-center px-2.5 py-1 rounded-lg bg-custom-dark text-theme-muted hover:text-theme-main hover-theme-bg transition text-xs flex-shrink-0 cursor-pointer whitespace-nowrap hover:pr-4';
            
            const span = document.createElement('span');
            span.className = 'truncate transition-all duration-150 group-hover:mr-3.5';
            span.textContent = term;
            span.onclick = () => {
                if (homeInput && homeInput.value.trim() === term) {
                    if (typeof onOpenContext === 'function') {
                        onOpenContext(term, itemData.context_note || '');
                    }
                    return;
                }

                homeInput.value = term;
                homeInput.style.height = 'auto';
                homeInput.style.height = homeInput.scrollHeight + 'px';
                renderSessions();
                requestGraphFrame();
                homeInput.focus();
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.title = 'Delete saved search';
            deleteBtn.className = 'absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition text-theme-faint hover:text-red-400 p-0.5 flex items-center justify-center';
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3 h-3"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    await removeSearchPill(term);
                    await loadSavedSearches();
                } catch (err) {
                    console.error("Failed to delete search pill", err);
                }
            };

            pill.appendChild(span);
            pill.appendChild(deleteBtn);
            savedSearchesContainer.appendChild(pill);
        });

        savedSearchesContainer.scrollLeft = 0;
        setTimeout(updateScrollFade, 0);
    }

    // --- Session Actions & Dropdown Menus ---
    function createMenuItem(label, dropdown, onClick, extraClass = '') {
        const el = document.createElement('div');
        el.className = `px-3 py-1.5 hover-theme-bg cursor-pointer flex items-center justify-between ${extraClass}`.trim();
        el.textContent = label;
        el.onclick = (ev) => {
            ev.stopPropagation();
            ev.preventDefault();
            onClick();
            dropdown.remove();
            renderChatHeaderMenu();
            renderSessions();
        };
        return el;
    }

    function renderChatHeaderMenu() {
        if (!chatHeaderMenuContainer) return;
        chatHeaderMenuContainer.innerHTML = '';

        if (!currentSessionId) return;
        const activeSession = cachedSessions.find(s => s.id === currentSessionId);
        if (!activeSession) return;

        const menuBtn = document.createElement('button');
        menuBtn.className = 'text-theme-muted hover:text-theme-main px-1.5 py-0.5 rounded transition text-base';
        menuBtn.innerHTML = '⋮';
        menuBtn.title = 'Session options';
        menuBtn.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.session-menu').forEach(m => m.remove());

            const dropdown = document.createElement('div');
            dropdown.className = 'session-menu absolute right-0 top-7 w-44 bg-app-dark rounded-lg shadow-xl z-50 py-1 text-xs text-theme-main';

            dropdown.appendChild(createMenuItem(activeSession.is_pinned ? 'Unpin' : 'Pin', dropdown, () => togglePin(activeSession.id, activeSession.is_pinned)));
            dropdown.appendChild(createMenuItem('Rename', dropdown, () => triggerRename(activeSession.id, activeSession.title)));
            dropdown.appendChild(createMenuItem('Delete', dropdown, () => deleteSession(activeSession.id), 'text-red-400'));

            chatHeaderMenuContainer.appendChild(dropdown);
        };

        chatHeaderMenuContainer.appendChild(menuBtn);
    }

    function renderSessions() {
        if (!homeSessionsList) return;
        homeSessionsList.innerHTML = '';
        selectedSessionIndex = -1;
        
        const q = homeInput.value.trim().toLowerCase();
        const filtered = q ? cachedSessions.filter(s => s.title.toLowerCase().includes(q)) : cachedSessions;

        if (chatCounter) chatCounter.textContent = `${filtered.length} chat${filtered.length === 1 ? '' : 's'}`;

        if (filtered.length === 0) {
            homeSessionsList.innerHTML = '<div class="text-theme-faint text-sm p-2 text-center">No matching chats</div>';
            return;
        }

        filtered.forEach(s => {
            const item = document.createElement('div');
            item.dataset.sessionId = s.id;
            item.className = 'group relative flex justify-between items-center py-2 px-2 rounded text-sm cursor-pointer transition text-theme-muted hover-theme-bg hover:text-theme-main';

            const titleSpan = document.createElement('span');
            titleSpan.className = 'truncate flex-1 pr-6';
            titleSpan.textContent = s.title;
            titleSpan.onclick = () => switchSession(s.id);
            titleSpan.ondblclick = (e) => {
                e.stopPropagation();
                triggerRename(s.id, s.title);
            };

            if (s.is_pinned) {
                const pinIndicator = document.createElement('span');
                pinIndicator.className = 'absolute right-2 text-xs text-theme-muted group-hover:opacity-0 transition-opacity flex items-center justify-center';
                pinIndicator.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" fill="currentColor" class="w-3 h-3.5 rotate-45"><path d="M298.028 214.267L285.793 96H328c13.255 0 24-10.745 24-24V24c0-13.255-10.745-24-24-24H56C42.745 0 32 10.745 32 24v48c0 13.255 10.745 24 24 24h42.207L85.972 214.267C37.465 236.82 0 277.261 0 328c0 13.255 10.745 24 24 24h136v104.007c0 1.242.289 2.467.845 3.578l24 48c2.941 5.882 11.365 5.897 14.311 0l24-48a8.008 8.008 0 0 0 .845-3.578V352h136c13.255 0 24-10.745 24-24-.001-51.183-37.983-91.42-85.973-113.733z"/></svg>`;
                item.appendChild(pinIndicator);
            }

            const menuBtn = document.createElement('button');
            menuBtn.className = 'absolute right-2 opacity-0 group-hover:opacity-100 text-theme-muted hover:text-theme-main px-1.5 py-0.5 rounded transition';
            menuBtn.innerHTML = '⋮';
            menuBtn.title = 'Session options';
            menuBtn.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.session-menu').forEach(m => m.remove());

                const dropdown = document.createElement('div');
                dropdown.className = 'session-menu absolute right-2 top-8 w-44 bg-app-dark rounded-lg shadow-xl z-50 py-1 text-xs text-theme-main';

                dropdown.appendChild(createMenuItem(s.is_pinned ? 'Unpin' : 'Pin', dropdown, () => togglePin(s.id, s.is_pinned)));
                dropdown.appendChild(createMenuItem('Rename', dropdown, () => triggerRename(s.id, s.title)));
                dropdown.appendChild(createMenuItem('Delete', dropdown, () => deleteSession(s.id), 'text-red-400'));

                item.appendChild(dropdown);
            };

            item.appendChild(titleSpan);
            item.appendChild(menuBtn);
            homeSessionsList.appendChild(item);
        });

        renderChatHeaderMenu();
    }

    async function loadSessions(isGraphActive) {
        try {
            cachedSessions = await fetchSessions();
            renderSessions();
            
            if (currentSessionId) {
                const active = cachedSessions.find(s => s.id === currentSessionId);
                if (active && chatTitleText) chatTitleText.textContent = active.title;
            }
            
            renderChatHeaderMenu();
            if (isGraphActive && typeof loadGraph === 'function') loadGraph();
        } catch (err) {
            console.error("Failed to load sessions", err);
        }
    }

    async function putSession(sessionId, body, isGraphActive) {
        try {
            await updateSession(sessionId, body);
            loadSessions(isGraphActive);
        } catch (err) {
            console.error("Failed to update session", err);
        }
    }

    function togglePin(sessionId, currentPinnedState, isGraphActive) {
        putSession(sessionId, { is_pinned: currentPinnedState ? 0 : 1 }, isGraphActive);
    }

    async function switchSession(sessionId, isGraphActive, streamResponseInto) {
        showChat();
        currentSessionId = sessionId;

        const activeSession = cachedSessions.find(s => s.id === sessionId);
        if (chatTitleText) chatTitleText.textContent = activeSession ? activeSession.title : 'Chat';
        renderChatHeaderMenu();

        if (container) container.innerHTML = '';
        try {
            const messages = await fetchSessionHistory(sessionId);

            if (messages.length === 0) {
                if (container) container.appendChild(emptyStateDiv('Empty session.'));
            } else {
                messages.forEach(m => {
                    const { p } = appendMessageDOM(m.id, m.content, m.role, { streamResponseInto });
                    if (m.role === 'assistant') {
                        attachCodeBlockCopyButtons(p);
                    }
                });
            }
            loadSessions(isGraphActive);
        } catch (err) {
            console.error("Failed to load session history", err);
        }
    }

    function triggerRename(sessionId, currentTitle, isGraphActive) {
        const newTitle = prompt('Rename session:', currentTitle);
        if (newTitle && newTitle.trim()) {
            putSession(sessionId, { title: newTitle.trim() }, isGraphActive);
        }
    }

    async function deleteSession(sessionId, isGraphActive) {
        try {
            await removeSession(sessionId);
            if (currentSessionId === sessionId) {
                currentSessionId = null;
                renderChatHeaderMenu();
                showGraph();
                return;
            }
            loadSessions(isGraphActive);
        } catch (err) {
            console.error("Failed to delete session", err);
        }
    }

    async function forkSession(messageId, isGraphActive, streamResponseInto) {
        if (!currentSessionId) return;
        try {
            const data = await forkSessionApi(currentSessionId, messageId);
            await switchSession(data.new_session_id, isGraphActive, streamResponseInto);
        } catch (err) {
            console.error("Fork error:", err);
            alert("Could not fork session.");
        }
    }

    function updateSelectedSessionHighlight(items) {
        items.forEach((item, idx) => {
            const isSelected = idx === selectedSessionIndex;
            item.classList.toggle('bg-custom-dark', isSelected);
            item.classList.toggle('text-theme-main', isSelected);
            item.classList.toggle('text-theme-muted', !isSelected);
            if (isSelected) item.scrollIntoView({ block: 'nearest' });
        });
    }

    // --- Micro-Synapse @Tag Autocomplete UI Logic ---
    function setupTagAutocomplete(textarea, dropdownEl) {
        if (!textarea || !dropdownEl) return;
        let savedSearchesCache = [];
        let selectedIndex = -1;
        let currentFilteredItems = [];
        let activeAtIdx = -1;

        fetchSavedSearches().then(data => {
            savedSearchesCache = data || [];
        }).catch(err => console.error("Failed to load saved search pills for autocomplete", err));

        textarea.addEventListener('input', async () => {
            const val = textarea.value;
            const cursorPos = textarea.selectionStart;
            const match = val.slice(0, cursorPos).match(/@(\w*)$/);

            if (match) {
                if (savedSearchesCache.length === 0) {
                    try {
                        savedSearchesCache = await fetchSavedSearches() || [];
                    } catch (e) {}
                }
                const query = match[1].toLowerCase();
                currentFilteredItems = savedSearchesCache.filter(item => 
                    (item.query || item.title || '').toLowerCase().includes(query)
                );

                if (currentFilteredItems.length > 0) {
                    activeAtIdx = match.index;
                    selectedIndex = -1;
                    renderDropdown();
                    return;
                }
            }
            hideDropdown();
        });

        textarea.addEventListener('keydown', (e) => {
            if (dropdownEl.style.display !== 'block' || currentFilteredItems.length === 0) return;

            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopImmediatePropagation();
                const len = currentFilteredItems.length;
                if (e.key === 'ArrowDown') {
                    selectedIndex = selectedIndex === -1 ? 0 : (selectedIndex + 1) % len;
                } else {
                    selectedIndex = selectedIndex <= 0 ? len - 1 : selectedIndex - 1;
                }
                updateHighlight();
            } else if (e.key === 'Enter' && selectedIndex >= 0) {
                e.preventDefault();
                e.stopImmediatePropagation();
                const item = currentFilteredItems[selectedIndex];
                if (item) {
                    selectTag(item.query || item.title || 'Untitled', textarea, activeAtIdx);
                    hideDropdown();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                hideDropdown();
            }
        }, true);

        document.addEventListener('click', (e) => {
            if (!textarea.contains(e.target) && !dropdownEl.contains(e.target)) {
                hideDropdown();
            }
        });

        function hideDropdown() {
            dropdownEl.style.display = 'none';
            activeAtIdx = -1;
            selectedIndex = -1;
        }

        function renderDropdown() {
            dropdownEl.innerHTML = '';
            dropdownEl.style.display = 'block';

            currentFilteredItems.forEach((item) => {
                const title = item.query || item.title || 'Untitled';
                const div = document.createElement('div');
                div.className = 'tag-option px-3 py-2 cursor-pointer text-theme-muted hover-theme-bg transition rounded-lg';
                div.textContent = `@${title}`;
                div.onclick = () => {
                    selectTag(title, textarea, activeAtIdx);
                    hideDropdown();
                };
                dropdownEl.appendChild(div);
            });
        }

        function updateHighlight() {
            dropdownEl.querySelectorAll('.tag-option').forEach((el, idx) => {
                const isSelected = idx === selectedIndex;
                el.classList.toggle('text-theme-main', isSelected);
                el.classList.toggle('bg-custom-dark', isSelected);
                el.classList.toggle('text-theme-muted', !isSelected);
            });
        }
    }

    function selectTag(tagTitle, textarea, atIndex) {
        const val = textarea.value;
        const cursorPos = textarea.selectionStart;
        textarea.value = val.slice(0, atIndex) + `@${tagTitle} ` + val.slice(cursorPos);
        textarea.focus();
        const newPos = atIndex + tagTitle.length + 2;
        textarea.setSelectionRange(newPos, newPos);
    }

    return {
        getCurrentSessionId: () => currentSessionId,
        setCurrentSessionId: (id) => { currentSessionId = id; },
        getCachedSessions: () => cachedSessions,
        setCachedSessions: (s) => { cachedSessions = s; },
        loadSavedSearches,
        renderSavedSearches,
        renderSessions,
        loadSessions,
        switchSession,
        togglePin,
        triggerRename,
        deleteSession,
        forkSession,
        updateSelectedSessionHighlight,
        getSelectedSessionIndex: () => selectedSessionIndex,
        setSelectedSessionIndex: (val) => { selectedSessionIndex = val; },
        attachCodeBlockCopyButtons,
        appendMessageDOM,
        setupTagAutocomplete
    };
}
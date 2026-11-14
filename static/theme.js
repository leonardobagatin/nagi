export function setupThemeModule() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    const themePopover = document.getElementById('theme-popover');
    const themeBgInput = document.getElementById('theme-bg-input');
    const themeAccentInput = document.getElementById('theme-accent-input');
    const themeNameInput = document.getElementById('theme-name-input');
    const themeSaveBtn = document.getElementById('theme-save-btn');
    const themePresetsList = document.getElementById('theme-presets-list');

    function hexToRgb(hex) {
        let cleanHex = hex.replace('#', '');
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.split('').map(c => c + c).join('');
        }
        const num = parseInt(cleanHex, 16);
        return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
    }

    function applyTheme(bgHex, accentRgb) {
        document.documentElement.style.setProperty('--bg-base', bgHex);
        document.documentElement.style.setProperty('--accent-rgb', accentRgb);
    }

    function loadSavedThemes() {
        try {
            return JSON.parse(localStorage.getItem('nagi_saved_themes') || '[]');
        } catch {
            return [];
        }
    }

    function renderThemePresets() {
        const themes = loadSavedThemes();
        themePresetsList.innerHTML = '';
        if (themes.length === 0) {
            themePresetsList.innerHTML = '<div class="text-[11px] text-theme-muted text-center py-2">No saved themes</div>';
            return;
        }
        themes.forEach((t, idx) => {
            const row = document.createElement('div');
            row.className = 'flex items-center justify-between p-1.5 rounded-lg hover-theme-bg cursor-pointer text-xs';
            row.innerHTML = `
                <div class="flex items-center gap-2 truncate">
                    <div class="flex -space-x-1 flex-shrink-0">
                        <span class="w-3 h-3 rounded-full border border-theme-subtle" style="background-color: ${t.bg}"></span>
                        <span class="w-3 h-3 rounded-full border border-theme-subtle" style="background-color: rgb(${t.accent})"></span>
                    </div>
                    <span class="truncate text-theme-main">${t.name}</span>
                </div>
                <button type="button" class="text-theme-faint hover:text-theme-main px-1 text-sm">&times;</button>
            `;
            row.addEventListener('click', (e) => {
                if (e.target.tagName === 'BUTTON') {
                    e.stopPropagation();
                    themes.splice(idx, 1);
                    localStorage.setItem('nagi_saved_themes', JSON.stringify(themes));
                    renderThemePresets();
                    return;
                }
                applyTheme(t.bg, t.accent);
                localStorage.setItem('nagi_active_theme', JSON.stringify({ bg: t.bg, accent: t.accent }));
            });
            themePresetsList.appendChild(row);
        });
    }

    // Boot theme load
    const activeThemeStr = localStorage.getItem('nagi_active_theme');
    if (activeThemeStr) {
        try {
            const active = JSON.parse(activeThemeStr);
            applyTheme(active.bg, active.accent);
        } catch {}
    }

    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            themePopover.classList.toggle('hidden');
            renderThemePresets();
        });
    }

    if (themeBgInput && themeAccentInput) {
        themeBgInput.addEventListener('input', (e) => {
            applyTheme(e.target.value, hexToRgb(themeAccentInput.value));
        });

        themeAccentInput.addEventListener('input', (e) => {
            applyTheme(themeBgInput.value, hexToRgb(e.target.value));
        });
    }

    if (themeSaveBtn) {
        themeSaveBtn.addEventListener('click', () => {
            const name = themeNameInput.value.trim() || 'Custom Theme';
            const bg = themeBgInput.value;
            const accent = hexToRgb(themeAccentInput.value);
            
            const themes = loadSavedThemes();
            themes.push({ name, bg, accent });
            localStorage.setItem('nagi_saved_themes', JSON.stringify(themes));
            localStorage.setItem('nagi_active_theme', JSON.stringify({ bg, accent }));
            themeNameInput.value = '';
            renderThemePresets();
        });
    }

    document.addEventListener('click', (e) => {
        if (themePopover && !themePopover.contains(e.target) && !themeToggleBtn.contains(e.target)) {
            themePopover.classList.add('hidden');
        }
    });
}
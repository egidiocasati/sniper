window.CSRF_TOKEN = '';
window.USER = null;
window.APP_SETTINGS = {};

function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (window.CSRF_TOKEN) {
        options.headers['X-CSRF-Token'] = window.CSRF_TOKEN;
    }
    if (options.body && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    return fetch(url, options);
}

async function initApp() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
            window.location.href = '/login';
            return;
        }
        const user = await res.json();
        window.CSRF_TOKEN = user.csrfToken;
        window.USER = user;

        document.getElementById('user-name').textContent = user.name;
        if (user.role === 'admin') {
            document.getElementById('admin-link').style.display = 'inline';
        }

        // Load public settings
        try {
            const settingsRes = await fetch('/api/settings/public');
            if (settingsRes.ok) {
                window.APP_SETTINGS = await settingsRes.json();
                if (window.APP_SETTINGS.app_subtitle) {
                    document.querySelector('header h1').textContent = `Sniper - ${window.APP_SETTINGS.app_subtitle}`;
                    document.title = `Sniper - ${window.APP_SETTINGS.app_subtitle}`;
                }
            }
        } catch (e) { /* ignore */ }

        const isMobile = window.innerWidth < 768;
        if (isMobile && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            document.getElementById('camera-section').style.display = 'block';
            initCamera();
        }

        loadPhotos();
    } catch (e) {
        console.error('Init error:', e);
        window.location.href = '/login';
    }
}

async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
}

document.addEventListener('DOMContentLoaded', initApp);

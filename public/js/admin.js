async function initAdmin() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const user = await res.json();
        if (user.role !== 'admin') { window.location.href = '/'; return; }
        window.CSRF_TOKEN = user.csrfToken;
        window.USER = user;
        document.getElementById('user-name').textContent = user.name;
        loadSettings();
        loadUsers();
        loadAdminPhotos();
    } catch (e) {
        window.location.href = '/login';
    }
}

async function loadUsers() {
    const res = await apiFetch('/api/admin/users');
    const users = await res.json();

    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = users.map(u => `
        <tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${u.role}</td>
            <td class="${u.active ? 'status-active' : 'status-inactive'}">
                ${u.active ? 'Attivo' : 'Disabilitato'}
            </td>
            <td>${formatDate(u.created_at)}</td>
            <td>
                ${u.role !== 'admin' ? `
                    <button class="btn btn-small ${u.active ? 'btn-danger' : 'btn-primary'}"
                            onclick="toggleUser(${u.id}, this)">
                        ${u.active ? 'Disabilita' : 'Abilita'}
                    </button>
                ` : ''}
            </td>
        </tr>
    `).join('');
}

async function toggleUser(id, btn) {
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/users/${id}/toggle`, { method: 'POST' });
        if (res.ok) loadUsers();
        else {
            const data = await res.json();
            alert(data.error || 'Errore');
        }
    } finally {
        btn.disabled = false;
    }
}

async function sendInvite(e) {
    e.preventDefault();
    const input = document.getElementById('invite-email');
    const email = input.value.trim();
    if (!email) return;

    const btn = document.getElementById('invite-btn');
    btn.disabled = true;

    try {
        const res = await apiFetch('/api/admin/invite', {
            method: 'POST',
            body: { email }
        });
        const data = await res.json();
        if (res.ok) {
            input.value = '';
            document.getElementById('invite-msg').textContent = `Invito inviato a ${email}`;
            document.getElementById('invite-msg').className = 'alert alert-success';
        } else {
            document.getElementById('invite-msg').textContent = data.error;
            document.getElementById('invite-msg').className = 'alert alert-error';
        }
    } catch (e) {
        document.getElementById('invite-msg').textContent = 'Errore di rete';
        document.getElementById('invite-msg').className = 'alert alert-error';
    } finally {
        btn.disabled = false;
    }
}

// --- Settings ---

async function loadSettings() {
    try {
        const res = await apiFetch('/api/admin/settings');
        const settings = await res.json();
        document.getElementById('setting-subtitle').value = settings.app_subtitle || '';
        document.getElementById('setting-confirm-min').value = settings.confirmation_min_minutes || '30';

        const countdownEnabled = settings.countdown_enabled !== 'false';
        document.getElementById('setting-countdown-enabled').checked = countdownEnabled;
        updateCountdownDisplay();

        // Update header
        const subtitle = settings.app_subtitle;
        if (subtitle) {
            document.querySelector('header h1').textContent = `Sniper - ${subtitle}`;
            document.title = `Sniper - ${subtitle} - Admin`;
        }
    } catch (e) {
        console.error('Load settings error:', e);
    }
}

async function saveSettings() {
    const msg = document.getElementById('settings-msg');
    try {
        const res = await apiFetch('/api/admin/settings', {
            method: 'PUT',
            body: {
                app_subtitle: document.getElementById('setting-subtitle').value,
                confirmation_min_minutes: document.getElementById('setting-confirm-min').value,
                countdown_enabled: document.getElementById('setting-countdown-enabled').checked ? 'true' : 'false',
            }
        });
        if (res.ok) {
            msg.textContent = 'Salvato';
            msg.style.color = 'var(--success)';
            loadSettings();
            setTimeout(() => { msg.textContent = ''; }, 3000);
        } else {
            msg.textContent = 'Errore';
            msg.style.color = 'var(--danger)';
        }
    } catch (e) {
        msg.textContent = 'Errore di rete';
        msg.style.color = 'var(--danger)';
    }
}

function updateCountdownDisplay() {
    const enabled = document.getElementById('setting-countdown-enabled').checked;
    const display = document.getElementById('countdown-value-display');
    if (enabled) {
        const minutes = parseInt(document.getElementById('setting-confirm-min').value, 10) || 30;
        const h = Math.floor(minutes / 60);
        const m = minutes % 60;
        const s = 0;
        const parts = [];
        if (h > 0) parts.push(`${h} or${h > 1 ? 'e' : 'a'}`);
        if (m > 0) parts.push(`${m} minut${m > 1 ? 'i' : 'o'}`);
        if (parts.length === 0) parts.push('0 minuti');
        document.getElementById('countdown-value-text').textContent =
            `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')} (${parts.join(' e ')})`;
        display.style.display = 'block';
    } else {
        display.style.display = 'none';
    }
}

// --- Photo management ---

let adminPhotoFilter = null;

async function loadAdminPhotos(status) {
    if (status !== undefined) adminPhotoFilter = status;
    const params = new URLSearchParams();
    if (adminPhotoFilter) params.set('status', adminPhotoFilter);

    try {
        const res = await apiFetch(`/api/admin/photos?${params}`);
        const photos = await res.json();
        renderAdminPhotos(photos);
    } catch (e) {
        console.error('Load admin photos error:', e);
    }
}

function renderAdminPhotos(photos) {
    const container = document.getElementById('admin-photo-list');
    if (!photos || photos.length === 0) {
        container.innerHTML = '<p class="empty-state">Nessuna foto trovata.</p>';
        return;
    }

    container.innerHTML = '<div style="overflow-x:auto"><table class="users-table"><thead><tr>' +
        '<th>Foto</th><th>Stato</th><th>Utente</th><th>Data</th><th>Note</th><th>Azioni</th>' +
        '</tr></thead><tbody>' +
        photos.map(p => `
            <tr>
                <td><img src="/api/photos/${p.uuid}/image" alt="" style="width:80px;height:60px;object-fit:cover;border-radius:4px;cursor:pointer" onclick="showAdminPhotoDetail('${p.uuid}')"></td>
                <td><span class="badge badge-${p.status.toLowerCase()}">${p.status}</span></td>
                <td>${escapeHtml(p.user_name)}<br><small style="color:var(--text-light)">${escapeHtml(p.user_email)}</small></td>
                <td style="white-space:nowrap">${formatDate(p.server_ts)}</td>
                <td>${p.notes ? escapeHtml(p.notes) : '<span style="color:var(--text-light)">-</span>'}</td>
                <td style="white-space:nowrap">
                    ${p.status !== 'SCARTO' ? `<button class="btn btn-small btn-secondary" onclick="discardPhoto('${p.uuid}', this)">Scarta</button> ` : ''}
                    <button class="btn btn-small btn-danger" onclick="deletePhoto('${p.uuid}', this)">Elimina</button>
                </td>
            </tr>
        `).join('') +
        '</tbody></table></div>';
}

function filterAdminPhotos(status, btn) {
    document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadAdminPhotos(status);
}

async function discardPhoto(uuid, btn) {
    if (!confirm('Vuoi forzare questa foto a SCARTO?')) return;
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/photos/${uuid}/discard`, { method: 'POST' });
        if (res.ok) loadAdminPhotos();
        else {
            const data = await res.json();
            alert(data.error || 'Errore');
        }
    } finally {
        btn.disabled = false;
    }
}

async function deletePhoto(uuid, btn) {
    if (!confirm('Eliminare definitivamente questa foto e le relative conferme? Azione irreversibile.')) return;
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/photos/${uuid}`, { method: 'DELETE' });
        if (res.ok) loadAdminPhotos();
        else {
            const data = await res.json();
            alert(data.error || 'Errore');
        }
    } finally {
        btn.disabled = false;
    }
}

async function showAdminPhotoDetail(uuid) {
    try {
        const res = await apiFetch(`/api/photos/${uuid}`);
        const photo = await res.json();
        const modal = document.getElementById('admin-photo-modal');
        let html = `
            <div class="modal-content">
                <button class="modal-close" onclick="document.getElementById('admin-photo-modal').style.display='none'">&times;</button>
                <img src="/api/photos/${uuid}/image" alt="Foto" />
                <div class="detail-info">
                    <h3><span class="badge badge-${photo.status.toLowerCase()}">${photo.status}</span></h3>
                    <p><strong>Data:</strong> ${formatDate(photo.server_ts)}</p>
                    <p><strong>Utente:</strong> ${escapeHtml(photo.user_name)}</p>
                    ${photo.notes ? `<p><strong>Note:</strong> ${escapeHtml(photo.notes)}</p>` : ''}`;
        if (photo.confirmed_photo_uuid) {
            html += `
                    <h4>Foto di conferma</h4>
                    <img src="/api/photos/${photo.confirmed_photo_uuid}/image" alt="Conferma" style="width:100%;border-radius:8px;margin:8px 0" />
                    <p><strong>Confermata:</strong> ${formatDate(photo.confirmed_at)}</p>`;
        }
        html += '</div></div>';
        modal.innerHTML = html;
        modal.style.display = 'flex';
    } catch (e) {
        console.error('Show detail error:', e);
    }
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.getElementById('admin-photo-modal').style.display = 'none';
    }
});

function apiFetch(url, options = {}) {
    options.headers = options.headers || {};
    if (window.CSRF_TOKEN) options.headers['X-CSRF-Token'] = window.CSRF_TOKEN;
    if (options.body && !(options.body instanceof FormData)) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(options.body);
    }
    return fetch(url, options);
}

function formatDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('it-IT', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
}

document.addEventListener('DOMContentLoaded', initAdmin);

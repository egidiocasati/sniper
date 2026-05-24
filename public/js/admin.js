async function initAdmin() {
    try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) { window.location.href = '/login'; return; }
        const user = await res.json();
        if (user.role !== 'admin' && user.role !== 'councilor') { window.location.href = '/'; return; }
        window.CSRF_TOKEN = user.csrfToken;
        window.USER = user;
        document.getElementById('user-name').textContent = user.name;
        if (user.role === 'admin') {
            loadSettings();
        } else {
            // Hide settings section for non-admin
            const settingsSection = document.getElementById('settings-section');
            if (settingsSection) settingsSection.style.display = 'none';
            const settingsHeading = settingsSection ? settingsSection.previousElementSibling : null;
            if (settingsHeading && settingsHeading.tagName === 'H2') settingsHeading.style.display = 'none';
        }
        loadInvites();
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
    const isAdmin = window.USER && window.USER.role === 'admin';
    tbody.innerHTML = users.map(u => {
        const canToggle = u.role !== 'admin' && (isAdmin || u.role !== 'councilor');
        const roleLabel = u.role === 'councilor' ? 'consigliere' : u.role;
        let actions = '';
        if (canToggle) {
            actions += `<button class="btn btn-small ${u.active ? 'btn-danger' : 'btn-primary'}"
                            onclick="toggleUser(${u.id}, this)">
                        ${u.active ? 'Disabilita' : 'Abilita'}
                    </button> `;
        }
        if (isAdmin && u.role !== 'admin') {
            actions += `<button class="btn btn-small btn-secondary"
                            onclick="toggleRole(${u.id}, this)">
                        ${u.role === 'councilor' ? 'Declassa a Utente' : 'Promuovi a Consigliere'}
                    </button>`;
        }
        return `<tr>
            <td>${escapeHtml(u.name)}</td>
            <td>${escapeHtml(u.email)}</td>
            <td>${roleLabel}</td>
            <td class="${u.active ? 'status-active' : 'status-inactive'}">
                ${u.active ? 'Attivo' : 'Disabilitato'}
            </td>
            <td>${formatDate(u.created_at)}</td>
            <td style="white-space:nowrap">${actions}</td>
        </tr>`;
    }).join('');
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

async function toggleRole(id, btn) {
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/users/${id}/role`, { method: 'POST' });
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
        const msgEl = document.getElementById('invite-msg');
        msgEl.style.display = '';
        if (res.ok) {
            input.value = '';
            msgEl.textContent = data.warning || `Invito inviato a ${email}`;
            msgEl.className = data.warning ? 'alert alert-error' : 'alert alert-success';
            loadInvites();
        } else {
            msgEl.textContent = data.error;
            msgEl.className = 'alert alert-error';
        }
    } catch (e) {
        const msgEl = document.getElementById('invite-msg');
        msgEl.style.display = '';
        msgEl.textContent = 'Errore di rete';
        msgEl.className = 'alert alert-error';
    } finally {
        btn.disabled = false;
    }
}

// --- Invites ---

async function loadInvites() {
    try {
        const res = await apiFetch('/api/admin/invites');
        const invites = await res.json();
        const tbody = document.getElementById('invites-tbody');

        if (!invites.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-light)">Nessun invito inviato</td></tr>';
            return;
        }

        tbody.innerHTML = invites.map(inv => {
            let badgeClass, badgeText;
            if (inv.status === 'accepted') { badgeClass = 'badge-infrazione'; badgeText = 'Accettato'; }
            else if (inv.status === 'expired') { badgeClass = 'badge-scarto'; badgeText = 'Scaduto'; }
            else { badgeClass = 'badge-pending'; badgeText = 'In attesa'; }

            const actions = inv.status === 'pending' ? `
                <button class="btn btn-small btn-primary" onclick="resendInvite(${inv.id}, this)">Re-invia</button>
                <button class="btn btn-small btn-danger" onclick="cancelInvite(${inv.id}, this)">Annulla</button>
            ` : '';

            return `<tr>
                <td>${escapeHtml(inv.email)}</td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td>${escapeHtml(inv.invited_by_name)}</td>
                <td style="white-space:nowrap">${formatDate(inv.created_at)}</td>
                <td style="white-space:nowrap">${formatDate(inv.expires_at)}</td>
                <td style="white-space:nowrap">${actions}</td>
            </tr>`;
        }).join('');
    } catch (e) {
        console.error('Load invites error:', e);
    }
}

async function cancelInvite(id, btn) {
    if (!confirm('Annullare questo invito?')) return;
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/invites/${id}`, { method: 'DELETE' });
        if (res.ok) {
            loadInvites();
        } else {
            const data = await res.json();
            alert(data.error || 'Errore');
        }
    } finally {
        btn.disabled = false;
    }
}

async function resendInvite(id, btn) {
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/invites/${id}/resend`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            if (data.warning) alert(data.warning);
            loadInvites();
        } else {
            alert(data.error || 'Errore');
        }
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
let adminShowArchived = false;

async function loadAdminPhotos(status, archived) {
    if (status !== undefined) adminPhotoFilter = status;
    if (archived !== undefined) adminShowArchived = archived;
    const params = new URLSearchParams();
    if (adminPhotoFilter) params.set('status', adminPhotoFilter);
    if (adminShowArchived) params.set('archived', '1');

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
                    ${p.status === 'INFRAZIONE' && !p.archived ? `<button class="btn btn-small btn-primary" onclick="archivePhoto('${p.uuid}', this)">Archivia</button> ` : ''}
                    ${p.archived ? `<button class="btn btn-small btn-primary" onclick="unarchivePhoto('${p.uuid}', this)">Ripristina</button> ` : ''}
                    <button class="btn btn-small btn-danger" onclick="deletePhoto('${p.uuid}', this)">Elimina</button>
                </td>
            </tr>
        `).join('') +
        '</tbody></table></div>';
}

function filterAdminPhotos(status, archived, btn) {
    document.querySelectorAll('.filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadAdminPhotos(status, !!archived);
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

async function archivePhoto(uuid, btn) {
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/photos/${uuid}/archive`, { method: 'POST' });
        if (res.ok) loadAdminPhotos();
        else {
            const data = await res.json();
            alert(data.error || 'Errore');
        }
    } finally {
        btn.disabled = false;
    }
}

async function unarchivePhoto(uuid, btn) {
    btn.disabled = true;
    try {
        const res = await apiFetch(`/api/admin/photos/${uuid}/unarchive`, { method: 'POST' });
        if (res.ok) loadAdminPhotos();
        else {
            const data = await res.json();
            alert(data.error || 'Errore');
        }
    } finally {
        btn.disabled = false;
    }
}

function downloadReport() {
    const params = new URLSearchParams();
    if (adminPhotoFilter) params.set('status', adminPhotoFilter);
    else params.set('status', 'INFRAZIONE');
    if (adminShowArchived) params.set('archived', '1');
    window.open(`/api/admin/photos/report?${params}`, '_blank');
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
        html += `
                    <div style="padding: 0 20px 18px; text-align:center;">
                        <button class="btn btn-secondary" onclick="closeAdminModal()" style="width:100%">Chiudi</button>
                    </div>
                </div>`;
        modal.innerHTML = html;
        modal.style.display = 'flex';

        modal.onclick = function(e) {
            if (e.target === modal) closeAdminModal();
        };
    } catch (e) {
        console.error('Show detail error:', e);
    }
}

function closeAdminModal() {
    const modal = document.getElementById('admin-photo-modal');
    modal.style.display = 'none';
    modal.onclick = null;
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAdminModal();
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

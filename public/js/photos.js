let currentFilter = null;
let countdownInterval = null;

async function loadPhotos(status) {
    if (status !== undefined) currentFilter = status;
    const params = new URLSearchParams();
    if (currentFilter) params.set('status', currentFilter);

    try {
        const res = await apiFetch(`/api/photos?${params}`);
        const data = await res.json();
        renderPhotoList(data.photos);
        startCountdowns();
    } catch (e) {
        console.error('Load photos error:', e);
    }
}

function renderPhotoList(photos) {
    const container = document.getElementById('photo-list');
    if (!photos || photos.length === 0) {
        container.innerHTML = '<p class="empty-state">Nessuna foto trovata.</p>';
        return;
    }

    const isMobile = window.innerWidth < 768;
    const minMs = (window.USER?.confirmationMinMinutes || 30) * 60 * 1000;

    container.innerHTML = photos.map(p => {
        const imgSrc = `/api/photos/${p.uuid}/image`;
        const isPending = p.status === 'PENDING';

        let confirmHtml = '';
        if (isPending) {
            const countdownEnabled = window.APP_SETTINGS?.countdown_enabled !== 'false';
            const unlockTime = new Date(p.server_ts).getTime() + minMs;
            const remaining = unlockTime - Date.now();

            if (!countdownEnabled || remaining <= 0) {
                // Ready to confirm (countdown disabled or time elapsed)
                confirmHtml = `
                <div class="photo-card-actions">
                    <button class="btn btn-primary btn-small btn-confirm-card"
                        data-uuid="${p.uuid}"
                        data-img="${imgSrc}"
                        data-notes="${escapeAttr(p.notes || '')}"
                        data-ts="${p.server_ts}"
                        data-user="${escapeAttr(p.user_name)}"
                        onclick="event.stopPropagation(); handleConfirmClick(this)">
                        ${isMobile ? 'Conferma infrazione' : 'Conferma infrazione (da mobile)'}
                    </button>
                </div>`;
            } else {
                // Countdown active
                confirmHtml = `
                <div class="photo-card-actions">
                    <button class="btn btn-small btn-confirm-card btn-countdown" disabled
                        data-uuid="${p.uuid}"
                        data-img="${imgSrc}"
                        data-notes="${escapeAttr(p.notes || '')}"
                        data-ts="${p.server_ts}"
                        data-user="${escapeAttr(p.user_name)}"
                        data-unlock="${unlockTime}">
                        Conferma tra <span class="countdown-text">${formatCountdown(remaining)}</span>
                    </button>
                </div>`;
            }
        }

        return `
        <div class="photo-card">
            <div onclick="showDetail('${p.uuid}')" style="cursor:pointer">
                <img src="${imgSrc}" alt="Foto" loading="lazy" />
                <div class="photo-info">
                    <span class="badge badge-${p.status.toLowerCase()}">${p.status}</span>
                    <span class="photo-time">${formatDate(p.server_ts)}</span>
                    <span class="photo-user">${escapeHtml(p.user_name)}</span>
                    ${p.notes ? `<p class="photo-notes">${escapeHtml(p.notes)}</p>` : ''}
                </div>
            </div>
            ${confirmHtml}
        </div>`;
    }).join('');
}

function formatCountdown(ms) {
    if (ms <= 0) return '0:00';
    const totalSec = Math.ceil(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

function startCountdowns() {
    if (countdownInterval) clearInterval(countdownInterval);

    countdownInterval = setInterval(() => {
        const buttons = document.querySelectorAll('.btn-countdown');
        if (buttons.length === 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            return;
        }

        const isMobile = window.innerWidth < 768;
        let anyUnlocked = false;

        buttons.forEach(btn => {
            const unlockTime = parseInt(btn.dataset.unlock, 10);
            const remaining = unlockTime - Date.now();

            if (remaining <= 0) {
                // Unlock the button
                btn.disabled = false;
                btn.classList.remove('btn-countdown');
                btn.classList.add('btn-primary');
                btn.textContent = isMobile ? 'Conferma infrazione' : 'Conferma infrazione (da mobile)';
                btn.onclick = function(e) {
                    e.stopPropagation();
                    handleConfirmClick(this);
                };
                anyUnlocked = true;
            } else {
                btn.querySelector('.countdown-text').textContent = formatCountdown(remaining);
            }
        });
    }, 1000);
}

async function showDetail(uuid) {
    try {
        const res = await apiFetch(`/api/photos/${uuid}`);
        const photo = await res.json();

        const modal = document.getElementById('photo-detail-modal');
        let html = `
            <div class="modal-content">
                <button class="modal-close" onclick="closeModal()">&times;</button>
                <img src="/api/photos/${uuid}/image" alt="Foto" />
                <div class="detail-info">
                    <h3><span class="badge badge-${photo.status.toLowerCase()}">${photo.status}</span></h3>
                    <p><strong>Data:</strong> ${formatDate(photo.server_ts)}</p>
                    <p><strong>Utente:</strong> ${escapeHtml(photo.user_name)}</p>
                    ${photo.notes ? `<p><strong>Note:</strong> ${escapeHtml(photo.notes)}</p>` : ''}`;

        if (photo.confirmed_photo_uuid) {
            html += `
                    <h4>Foto di conferma</h4>
                    <img src="/api/photos/${photo.confirmed_photo_uuid}/image" alt="Conferma" style="width:100%; border-radius:8px; margin:8px 0;" />
                    <p><strong>Confermata:</strong> ${formatDate(photo.confirmed_at)}</p>
                    ${photo.confirmed_notes ? `<p><strong>Note conferma:</strong> ${escapeHtml(photo.confirmed_notes)}</p>` : ''}`;
        }

        html += `
                    <div style="padding: 0 20px 18px; text-align:center;">
                        <button class="btn btn-secondary" onclick="closeModal()" style="width:100%">Chiudi</button>
                    </div>
                </div>`;
        modal.innerHTML = html;
        modal.style.display = 'flex';

        // Tap on overlay (outside modal-content) closes modal
        modal.onclick = function(e) {
            if (e.target === modal) closeModal();
        };

        // Swipe down to close
        let touchStartY = 0;
        const content = modal.querySelector('.modal-content');
        content.addEventListener('touchstart', function(e) {
            touchStartY = e.touches[0].clientY;
        }, { passive: true });
        content.addEventListener('touchend', function(e) {
            const deltaY = e.changedTouches[0].clientY - touchStartY;
            if (deltaY > 80) closeModal();
        }, { passive: true });
    } catch (e) {
        console.error('Show detail error:', e);
    }
}

function closeModal() {
    const modal = document.getElementById('photo-detail-modal');
    modal.style.display = 'none';
    modal.onclick = null;
}

function filterPhotos(status, btn) {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    loadPhotos(status);
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

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
}

function handleConfirmClick(btn) {
    startConfirmation(
        btn.dataset.uuid,
        btn.dataset.img,
        btn.dataset.notes,
        btn.dataset.ts,
        btn.dataset.user
    );
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

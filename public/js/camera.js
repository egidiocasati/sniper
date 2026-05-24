let cameraStream = null;
let videoEl, canvasEl, ctx;
let confirmingUuid = null; // UUID of the PENDING photo being confirmed

function initCameraElements() {
    videoEl = document.getElementById('camera-video');
    canvasEl = document.getElementById('camera-canvas');
    ctx = canvasEl.getContext('2d');
}

async function startCamera() {
    if (!videoEl) initCameraElements();

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            },
            audio: false
        });
        videoEl.srcObject = cameraStream;
        await videoEl.play();

        document.getElementById('camera-error').style.display = 'none';
        document.getElementById('camera-open').style.display = 'none';
        document.getElementById('camera-live').style.display = 'block';
    } catch (err) {
        console.error('Camera error:', err);
        document.getElementById('camera-error').textContent =
            'Accesso alla fotocamera negato. Verifica i permessi del browser.';
        document.getElementById('camera-error').style.display = 'block';
        document.getElementById('camera-live').style.display = 'none';
    }
}

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(t => t.stop());
        cameraStream = null;
    }
    if (videoEl) {
        videoEl.srcObject = null;
    }
}

function openCamera() {
    startCamera();
}

function closeCamera() {
    stopCamera();
    document.getElementById('camera-live').style.display = 'none';
    document.getElementById('camera-open').style.display = '';
}

function capturePhoto() {
    if (!videoEl || !videoEl.videoWidth) return;

    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    ctx.drawImage(videoEl, 0, 0);

    // Stop camera stream after capturing
    stopCamera();

    document.getElementById('preview-img').src = canvasEl.toDataURL('image/jpeg', 0.85);
    document.getElementById('preview-section').style.display = 'block';
    document.getElementById('camera-live').style.display = 'none';
}

function retakePhoto() {
    document.getElementById('preview-section').style.display = 'none';
    startCamera();
}

// Called from photo list when user taps "Conferma" on a PENDING card
function startConfirmation(uuid, imgSrc, notes, serverTs, userName) {
    confirmingUuid = uuid;

    // Show the reference banner
    const ref = document.getElementById('confirm-reference');
    ref.querySelector('.confirm-ref-img').src = imgSrc;
    ref.querySelector('.confirm-ref-info').innerHTML =
        `<strong>Stai confermando:</strong><br>` +
        `${formatDate(serverTs)} - ${escapeHtml(userName)}` +
        (notes ? `<br><em>${escapeHtml(notes)}</em>` : '');
    ref.style.display = 'flex';

    // Update button label
    document.getElementById('upload-btn').textContent = 'Conferma infrazione';

    // Open camera automatically for confirmation
    startCamera();

    // Scroll to camera
    document.getElementById('camera-section').scrollIntoView({ behavior: 'smooth' });
}

function cancelConfirmation() {
    confirmingUuid = null;
    document.getElementById('confirm-reference').style.display = 'none';
    document.getElementById('upload-btn').textContent = 'Carica';
}

async function doUpload() {
    const notes = document.getElementById('photo-notes').value.trim();

    const blob = await new Promise(resolve => {
        canvasEl.toBlob(resolve, 'image/jpeg', 0.85);
    });

    const formData = new FormData();
    formData.append('photo', blob, `capture_${Date.now()}.jpg`);
    if (notes) formData.append('notes', notes);

    let url = '/api/photos/upload';
    if (confirmingUuid) {
        url = `/api/photos/${confirmingUuid}/confirm`;
    }

    const btn = document.getElementById('upload-btn');
    btn.disabled = true;
    btn.textContent = 'Invio...';

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'X-CSRF-Token': window.CSRF_TOKEN },
            body: formData
        });
        const data = await res.json();
        if (!res.ok) {
            showToast(data.error || 'Errore durante il caricamento', 'error');
            return;
        }

        // Reset UI: hide preview, show open button
        document.getElementById('preview-section').style.display = 'none';
        document.getElementById('camera-live').style.display = 'none';
        document.getElementById('camera-open').style.display = '';
        document.getElementById('photo-notes').value = '';

        if (confirmingUuid) {
            cancelConfirmation();
            showToast('Infrazione confermata!', 'success');
        } else {
            showToast('Foto caricata. Torna tra 30 minuti per confermare.', 'info');
        }

        loadPhotos();
    } catch (e) {
        showToast('Errore di rete: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = confirmingUuid ? 'Conferma infrazione' : 'Carica';
    }
}

function showToast(message, type) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast toast-${type} toast-visible`;
    setTimeout(() => { toast.className = 'toast'; }, 4000);
}

window.addEventListener('beforeunload', () => {
    stopCamera();
});

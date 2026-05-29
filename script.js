let playlist = [];
let currentVideoId = null;
let currentVideoData = null;
let dragItem = null;
let modalConfirmCallback = null;

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    renderPlaylist();
    setupModal();
    setupResize();
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.dropdown-wrapper')) {
        closeDropdown();
    }
});

// ===== MODAL =====
function setupModal() {
    const overlay = document.getElementById('modalOverlay');
    const cancelBtn = document.getElementById('modalCancel');
    const confirmBtn = document.getElementById('modalConfirm');

    cancelBtn.addEventListener('click', hideModal);

    confirmBtn.addEventListener('click', () => {
        if (modalConfirmCallback) modalConfirmCallback();
        hideModal();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) hideModal();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overlay.classList.contains('show')) hideModal();
    });
}

function showModal(options) {
    document.getElementById('modalIcon').textContent = options.icon || 'warning';
    document.getElementById('modalTitle').textContent = options.title || 'Confirm';
    document.getElementById('modalMessage').textContent = options.message || 'Are you sure?';
    document.getElementById('modalConfirm').textContent = options.confirmText || 'Confirm';
    document.getElementById('modalCancel').textContent = options.cancelText || 'Cancel';
    modalConfirmCallback = options.onConfirm || null;
    document.getElementById('modalOverlay').classList.add('show');
}

function hideModal() {
    document.getElementById('modalOverlay').classList.remove('show');
    modalConfirmCallback = null;
}

// ===== RESIZE =====
function setupResize() {
    const handle = document.getElementById('resizeHandle');
    const panel = document.getElementById('playlistPanel');
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        handle.classList.add('active');
        document.body.classList.add('resizing');
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const delta = e.clientX - startX;
        const newWidth = Math.min(600, Math.max(200, startWidth + delta));
        panel.style.width = newWidth + 'px';
        updateCompactMode(newWidth);
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        handle.classList.remove('active');
        document.body.classList.remove('resizing');
    });
}

function updateCompactMode(width) {
    const panel = document.getElementById('playlistPanel');
    if (width < 260) {
        panel.setAttribute('data-compact', 'ultra');
    } else if (width < 340) {
        panel.setAttribute('data-compact', 'true');
    } else {
        panel.removeAttribute('data-compact');
    }
}

// ===== URL PARSING =====
function extractVideoId(url) {
    url = url.trim();
    const patterns = [
        /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
        /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
        /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
        /^([a-zA-Z0-9_-]{11})$/
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ===== FETCH INFO =====
async function fetchVideoInfo(videoId) {
    let title = `Video (${videoId})`;
    let channel = 'Unknown Channel';
    let duration = null;

    try {
        const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
        const data = await res.json();
        if (!data.error) {
            title = data.title || title;
            channel = data.author_name || channel;
        }
    } catch (e) {}

    duration = await fetchDuration(videoId);

    return {
        id: videoId,
        title,
        channel,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        duration,
        addedAt: Date.now()
    };
}

async function fetchDuration(videoId) {
    try {
        const res = await fetch(`https://www.youtube-nocookie.com/embed/${videoId}`, { mode: 'cors' });
        const html = await res.text();
        let m = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
        if (m) return formatDuration(parseInt(m[1]));
        m = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/);
        if (m) return formatDuration(Math.floor(parseInt(m[1]) / 1000));
    } catch (e) {}

    const proxies = [
        `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
        `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`
    ];

    for (const proxyUrl of proxies) {
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(proxyUrl, { signal: ctrl.signal });
            clearTimeout(t);
            const html = await res.text();

            let m = html.match(/"lengthSeconds"\s*:\s*"(\d+)"/);
            if (m) return formatDuration(parseInt(m[1]));
            m = html.match(/"approxDurationMs"\s*:\s*"(\d+)"/);
            if (m) return formatDuration(Math.floor(parseInt(m[1]) / 1000));

            const pt = html.match(/"duration"\s*:\s*"PT(\d+H)?(\d+M)?(\d+S)?"/);
            if (pt) {
                const h = pt[1] ? parseInt(pt[1]) : 0;
                const mn = pt[2] ? parseInt(pt[2]) : 0;
                const s = pt[3] ? parseInt(pt[3]) : 0;
                const total = h * 3600 + mn * 60 + s;
                if (total > 0) return formatDuration(total);
            }
        } catch (e) { continue; }
    }
    return null;
}

function formatDuration(sec) {
    if (!sec || sec <= 0) return null;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// ===== ADD VIDEO =====
async function addVideo() {
    const input = document.getElementById('urlInput');
    const errorMsg = document.getElementById('errorMsg');
    const addBtn = document.getElementById('addBtn');
    const url = input.value.trim();

    errorMsg.textContent = '';

    if (!url) { errorMsg.textContent = 'Please enter a YouTube URL'; return; }

    const videoId = extractVideoId(url);
    if (!videoId) { errorMsg.textContent = 'Invalid YouTube URL'; return; }

    if (playlist.find(v => v.id === videoId) || (currentVideoData && currentVideoData.id === videoId)) {
        errorMsg.textContent = 'This video is already in your playlist';
        return;
    }

    addBtn.disabled = true;
    addBtn.innerHTML = '<span class="loading-spinner"></span>';

    try {
        const info = await fetchVideoInfo(videoId);
        playlist.push(info);
        renderPlaylist();
        input.value = '';
        showToast('Video added to Watch Later');
    } catch (e) {
        errorMsg.textContent = 'Failed to add video';
    }

    addBtn.disabled = false;
    addBtn.innerHTML = '<span class="material-icons" style="font-size:18px">add</span><span class="action-label">Add</span>';
}

// ===== RENDER =====
function renderPlaylist() {
    const list = document.getElementById('videoList');
    const emptyState = document.getElementById('emptyState');
    const countEl = document.getElementById('videoCount');
    const playAllBtn = document.getElementById('playAllBtn');
    const shuffleBtn = document.getElementById('shuffleBtn');

    const total = playlist.length + (currentVideoData ? 1 : 0);
    countEl.textContent = `${total} video${total !== 1 ? 's' : ''}`;
    playAllBtn.disabled = playlist.length === 0 && !currentVideoData;
    shuffleBtn.disabled = playlist.length < 2;

    list.querySelectorAll('.video-item').forEach(i => i.remove());

    emptyState.style.display = playlist.length === 0 ? 'flex' : 'none';

    // Now playing section
    const npSection = document.getElementById('nowPlayingSection');
    if (currentVideoData) {
        npSection.style.display = 'block';
        document.getElementById('nowPlayingThumb').src = currentVideoData.thumbnail;
        document.getElementById('nowPlayingTitle').textContent = currentVideoData.title;
        document.getElementById('nowPlayingChannel').textContent = currentVideoData.channel;
        const durEl = document.getElementById('nowPlayingDuration');
        durEl.textContent = currentVideoData.duration || '';
        durEl.style.display = currentVideoData.duration ? 'block' : 'none';
    } else {
        npSection.style.display = 'none';
    }

    playlist.forEach((video, idx) => {
        const item = document.createElement('div');
        item.className = 'video-item';
        item.setAttribute('data-id', video.id);
        item.draggable = true;

        const durHtml = video.duration ? `<span class="duration-badge">${video.duration}</span>` : '';

        item.innerHTML = `
            <span class="video-index">${idx + 1}</span>
            <span class="drag-handle">
                <span class="material-icons" style="font-size:18px">drag_indicator</span>
            </span>
            <div class="thumbnail-container">
                <img src="${video.thumbnail}" alt="" loading="lazy"
                    onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 320 180%22><rect fill=%22%23222%22 width=%22320%22 height=%22180%22/></svg>'">
                ${durHtml}
                <button class="remove-btn" onclick="event.stopPropagation();showRemoveVideoModal('${video.id}')" title="Remove">
                    <span class="material-icons">close</span>
                </button>
            </div>
            <div class="video-info">
                <div class="video-title">${escapeHtml(video.title)}</div>
                <div class="video-channel">${escapeHtml(video.channel)}</div>
            </div>
        `;

        item.addEventListener('click', (e) => {
            if (e.target.closest('.remove-btn') || e.target.closest('.drag-handle')) return;
            playVideo(video.id);
        });

        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);

        list.appendChild(item);
    });
}

// ===== PLAY VIDEO =====
function playVideo(videoId) {
    const idx = playlist.findIndex(v => v.id === videoId);
    if (idx === -1) return;

    const video = playlist[idx];

    // Remove from playlist permanently
    playlist.splice(idx, 1);

    // Set as current
    currentVideoId = videoId;
    currentVideoData = { ...video };

    const container = document.getElementById('playerContainer');
    const placeholder = document.getElementById('playerPlaceholder');

    const existing = container.querySelector('iframe');
    if (existing) existing.remove();
    placeholder.style.display = 'none';

    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0&enablejsapi=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    container.appendChild(iframe);

    renderPlaylist();
    showToast(`Now playing: ${video.title}`);
}

// ===== REMOVE MODALS =====
function showRemoveVideoModal(videoId) {
    const video = playlist.find(v => v.id === videoId);
    if (!video) return;

    showModal({
        icon: 'remove_circle_outline',
        title: 'Remove Video',
        message: `Remove "${video.title}" from Watch Later?`,
        confirmText: 'Remove',
        cancelText: 'Keep',
        onConfirm: () => {
            playlist = playlist.filter(v => v.id !== videoId);
            renderPlaylist();
            showToast('Video removed');
        }
    });
}

function showStopPlayingModal() {
    if (!currentVideoData) return;

    showModal({
        icon: 'stop_circle',
        title: 'Stop Playing',
        message: `Stop playing "${currentVideoData.title}" and remove it from Watch Later?`,
        confirmText: 'Stop & Remove',
        cancelText: 'Keep Playing',
        onConfirm: () => {
            currentVideoId = null;
            currentVideoData = null;

            const container = document.getElementById('playerContainer');
            const iframe = container.querySelector('iframe');
            if (iframe) iframe.remove();
            document.getElementById('playerPlaceholder').style.display = 'flex';

            renderPlaylist();
            showToast('Video removed');
        }
    });
}

function showClearAllModal() {
    closeDropdown();
    const total = playlist.length + (currentVideoData ? 1 : 0);
    if (total === 0) { showToast('No videos to remove'); return; }

    showModal({
        icon: 'delete_forever',
        title: 'Remove All Videos',
        message: `Remove all ${total} video${total !== 1 ? 's' : ''} from Watch Later? This cannot be undone.`,
        confirmText: 'Remove All',
        cancelText: 'Cancel',
        onConfirm: clearAllVideos
    });
}

function clearAllVideos() {
    playlist = [];
    currentVideoId = null;
    currentVideoData = null;

    const container = document.getElementById('playerContainer');
    const iframe = container.querySelector('iframe');
    if (iframe) iframe.remove();
    document.getElementById('playerPlaceholder').style.display = 'flex';

    renderPlaylist();
    showToast('All videos removed');
}

// ===== PLAYBACK =====
function playAll() {
    if (playlist.length === 0) return;
    playVideo(playlist[0].id);
}

function shufflePlaylist() {
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
    renderPlaylist();
    showToast('Playlist shuffled');
}

// ===== DRAG & DROP =====
function handleDragStart(e) {
    dragItem = this;
    this.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = this.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    this.classList.remove('drag-over-top', 'drag-over-bottom');
    this.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
}

function handleDragEnter(e) { e.preventDefault(); }

function handleDragLeave() {
    this.classList.remove('drag-over-top', 'drag-over-bottom');
}

function handleDrop(e) {
    e.preventDefault();
    this.classList.remove('drag-over-top', 'drag-over-bottom');
    if (dragItem === this) return;

    const fromId = dragItem.getAttribute('data-id');
    const toId = this.getAttribute('data-id');
    const fromIdx = playlist.findIndex(v => v.id === fromId);
    const toIdx = playlist.findIndex(v => v.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;

    const rect = this.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    const [moved] = playlist.splice(fromIdx, 1);
    let newIdx = playlist.findIndex(v => v.id === toId);
    if (!before) newIdx++;
    playlist.splice(newIdx, 0, moved);

    renderPlaylist();
    showToast('Playlist reordered');
}

function handleDragEnd() {
    this.classList.remove('dragging');
    document.querySelectorAll('.video-item').forEach(i => {
        i.classList.remove('drag-over-top', 'drag-over-bottom');
    });
}

// ===== EXPORT / IMPORT =====
function exportPlaylist() {
    const all = [...playlist];
    if (currentVideoData) all.unshift(currentVideoData);

    if (all.length === 0) { showToast('No videos to export'); closeDropdown(); return; }

    const data = {
        name: 'Watch Later',
        exportedAt: new Date().toISOString(),
        videoCount: all.length,
        videos: all
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `watch-later-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeDropdown();
    showToast(`Exported ${all.length} videos`);
}

function importPlaylist(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            let videos = Array.isArray(data) ? data : (data.videos || []);
            if (!Array.isArray(videos)) throw new Error();

            let added = 0;
            const existingIds = new Set(playlist.map(v => v.id));
            if (currentVideoData) existingIds.add(currentVideoData.id);

            videos.forEach(v => {
                if (v.id && !existingIds.has(v.id)) {
                    playlist.push({
                        id: v.id,
                        title: v.title || `Video (${v.id})`,
                        channel: v.channel || 'Unknown',
                        thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.id}/mqdefault.jpg`,
                        duration: v.duration || null,
                        addedAt: v.addedAt || Date.now()
                    });
                    existingIds.add(v.id);
                    added++;
                }
            });

            renderPlaylist();
            showToast(`Imported ${added} video${added !== 1 ? 's' : ''}`);
        } catch (err) {
            showToast('Failed to import — invalid file');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
    closeDropdown();
}

// ===== DROPDOWN =====
function toggleDropdown(e) {
    e.stopPropagation();
    document.getElementById('dropdownMenu').classList.toggle('show');
}

function closeDropdown() {
    document.getElementById('dropdownMenu').classList.remove('show');
}

// ===== UTILITIES =====
function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t);
    t._t = setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = text;
    return d.innerHTML;
}
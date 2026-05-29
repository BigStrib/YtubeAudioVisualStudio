(function () {
    'use strict';

    // ── State ──
    let playlist = [];
    let visualizers = [];
    let currentSongIndex = -1;
    let currentVizIndex = -1;
    let audioCtx = null;
    let analyser = null;
    let animFrameId = null;
    let previewAnimId = null;
    let videoHidden = false;
    let editingVizIndex = -1;
    let mainVizPaused = false;
    let importFileData = null;

    // ── DOM ──
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => document.querySelectorAll(s);

    const canvas = $('#vizCanvas');
    const ctx = canvas.getContext('2d');
    const previewCanvas = $('#previewCanvas');
    const previewCtx = previewCanvas.getContext('2d');
    const videoContainer = $('#videoContainer');
    const videoFrame = $('#videoFrame');
    const songInput = $('#songInput');
    const addSongBtn = $('#addSongBtn');
    const playlistList = $('#playlistList');
    const vizList = $('#vizList');
    const vizModal = $('#vizModal');
    const importModal = $('#importModal');
    const exportModal = $('#exportModal');
    const hideVideoBtn = $('#hideVideoBtn');
    const showVideoBtn = $('#showVideoBtn');
    const videoOpacitySlider = $('#videoOpacitySlider');
    const importBtn = $('#importBtn');
    const exportBtn = $('#exportBtn');
    const saveVizBtn = $('#saveVizBtn');
    const manageVizList = $('#manageVizList');
    const presetWidthSlider = $('#presetWidth');
    const presetWidthVal = $('#presetWidthVal');
    const presetSensitivitySlider = $('#presetSensitivity');
    const presetSensitivityVal = $('#presetSensitivityVal');
    const trackCountBadge = $('#trackCount');
    const npTitle = $('#npTitle');
    const npSub = $('#npSub');
    const importFile = $('#importFile');
    const fileDropZone = $('#fileDropZone');
    const fileNameDisplay = $('#fileNameDisplay');

    // ── Canvas sizing ──
    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function sizePreviewCanvas() {
        const rect = previewCanvas.getBoundingClientRect();
        previewCanvas.width = Math.floor(rect.width * (window.devicePixelRatio || 1));
        previewCanvas.height = Math.floor(rect.height * (window.devicePixelRatio || 1));
    }

    // ── Color Theming ──
    function hexToRgb(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        return {
            r: parseInt(hex.substring(0, 2), 16),
            g: parseInt(hex.substring(2, 4), 16),
            b: parseInt(hex.substring(4, 6), 16)
        };
    }

    function hexToHsl(hex) {
        const { r, g, b } = hexToRgb(hex);
        const rr = r / 255, gg = g / 255, bb = b / 255;
        const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
        let h, s, l = (max + min) / 2;
        if (max === min) { h = s = 0; }
        else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case rr: h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6; break;
                case gg: h = ((bb - rr) / d + 2) / 6; break;
                case bb: h = ((rr - gg) / d + 4) / 6; break;
            }
        }
        return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
    }

    function applyThemeColor(hex) {
        const { r, g, b } = hexToRgb(hex);
        const { h, s, l } = hexToHsl(hex);
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-r', r);
        document.documentElement.style.setProperty('--accent-g', g);
        document.documentElement.style.setProperty('--accent-b', b);
        document.documentElement.style.setProperty('--accent-hover', `hsl(${h}, ${s}%, ${Math.min(l + 12, 85)}%)`);
        document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.25)`);
    }

    function updateThemeFromCurrentViz() {
        if (currentVizIndex >= 0 && currentVizIndex < visualizers.length) {
            const viz = visualizers[currentVizIndex];
            if (viz.overrides?.color && viz.presetColor) applyThemeColor(viz.presetColor);
        }
    }

    // ── Audio ──
    function initAudioContext() {
        if (audioCtx) return;
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
    }

    // ── YouTube URL Parsing ──
    function extractYouTubeVideoId(url) {
        url = url.trim();
        const patterns = [
            /(?:youtube\.com\/watch\?.*v=)([A-Za-z0-9_-]{11})/,
            /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/,
            /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/,
            /(?:youtube\.com\/v\/)([A-Za-z0-9_-]{11})/,
            /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/,
            /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/,
            /(?:youtube-nocookie\.com\/embed\/)([A-Za-z0-9_-]{11})/,
            /(?:m\.youtube\.com\/watch\?.*v=)([A-Za-z0-9_-]{11})/,
            /(?:music\.youtube\.com\/watch\?.*v=)([A-Za-z0-9_-]{11})/,
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) return m[1];
        }
        if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
        return null;
    }

    function extractYouTubePlaylistId(url) {
        const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
        return m ? m[1] : null;
    }

    // ── noembed / oembed for free metadata ──
    async function fetchVideoMeta(videoId) {
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        try {
            const res = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
            if (!res.ok) return null;
            const data = await res.json();
            if (data.error) return null;
            return {
                title: data.title || null,
                author: data.author_name || null,
                thumbnail: data.thumbnail_url || null
            };
        } catch (e) {
            return null;
        }
    }

    async function fetchVideoMetaBatch(videoIds) {
        const results = {};
        // Run in parallel batches of 6 to avoid hammering
        for (let i = 0; i < videoIds.length; i += 6) {
            const batch = videoIds.slice(i, i + 6);
            const promises = batch.map(async (id) => {
                const meta = await fetchVideoMeta(id);
                results[id] = meta;
            });
            await Promise.all(promises);
        }
        return results;
    }

    // ── Scrape playlist video IDs via oembed + page scraping fallback ──
    async function fetchPlaylistVideoIds(playlistId) {
        // Method: fetch the playlist page HTML through a CORS proxy and parse video IDs
        const proxies = [
            (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
            (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        ];

        const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

        for (const proxyFn of proxies) {
            try {
                const res = await fetch(proxyFn(playlistUrl));
                if (!res.ok) continue;
                const html = await res.text();

                // Extract video IDs from the HTML
                const ids = [];
                const seen = new Set();

                // Pattern 1: "videoId":"XXXXXXXXXXX"
                const regex1 = /"videoId":"([A-Za-z0-9_-]{11})"/g;
                let match;
                while ((match = regex1.exec(html)) !== null) {
                    if (!seen.has(match[1])) {
                        seen.add(match[1]);
                        ids.push(match[1]);
                    }
                }

                // Pattern 2: watch?v=XXXXXXXXXXX within playlist context
                if (ids.length === 0) {
                    const regex2 = /watch\?v=([A-Za-z0-9_-]{11})(?:&|")/g;
                    while ((match = regex2.exec(html)) !== null) {
                        if (!seen.has(match[1])) {
                            seen.add(match[1]);
                            ids.push(match[1]);
                        }
                    }
                }

                if (ids.length > 0) return ids;
            } catch (e) {
                continue;
            }
        }

        return [];
    }

    // ── Duration fetching via page scrape ──
    async function fetchDurationFromPage(videoId) {
        const proxies = [
            (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
            (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
        ];

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        for (const proxyFn of proxies) {
            try {
                const res = await fetch(proxyFn(videoUrl));
                if (!res.ok) continue;
                const html = await res.text();

                // Try to find "lengthSeconds":"123"
                const m = html.match(/"lengthSeconds":"(\d+)"/);
                if (m) return parseInt(m[1]);

                // Try approxDurationMs
                const m2 = html.match(/"approxDurationMs":"(\d+)"/);
                if (m2) return Math.round(parseInt(m2[1]) / 1000);

                return null;
            } catch (e) {
                continue;
            }
        }
        return null;
    }

    async function fetchDurationsBatch(videoIds) {
        const results = {};
        // Only fetch a few at a time to be polite to CORS proxies
        for (let i = 0; i < videoIds.length; i += 4) {
            const batch = videoIds.slice(i, i + 4);
            const promises = batch.map(async (id) => {
                const sec = await fetchDurationFromPage(id);
                results[id] = sec;
            });
            await Promise.all(promises);
            updateLoadingProgress(Math.min(i + 4, videoIds.length), videoIds.length);
        }
        return results;
    }

    // ── Formatting ──
    function formatDurationSeconds(totalSec) {
        if (!totalSec || totalSec <= 0) return '';
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    // ── Song creation ──
    function createSongEntry(videoId, title, durationSec, channel, thumbnail) {
        return {
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            title: title || `Video · ${videoId}`,
            url: `https://www.youtube.com/watch?v=${videoId}`,
            youtubeId: videoId,
            durationSec: durationSec || 0,
            durationDisplay: formatDurationSeconds(durationSec || 0),
            channel: channel || '',
            thumbnail: thumbnail || ''
        };
    }

    // ── Loading indicators ──
    function showLoading(msg) {
        npTitle.textContent = msg || 'Loading...';
        npSub.textContent = 'Please wait';
    }

    function updateLoadingProgress(current, total) {
        npSub.textContent = `Fetching details... ${current}/${total}`;
    }

    function hideLoading() {
        if (currentSongIndex >= 0 && currentSongIndex < playlist.length) {
            const song = playlist[currentSongIndex];
            npTitle.textContent = song.title;
            const parts = [];
            if (song.channel) parts.push(song.channel);
            if (song.durationDisplay) parts.push(song.durationDisplay);
            parts.push(`Track ${currentSongIndex + 1} of ${playlist.length}`);
            npSub.textContent = parts.join(' · ');
        } else {
            npTitle.textContent = playlist.length > 0 ? 'Ready' : 'No track loaded';
            npSub.textContent = playlist.length > 0
                ? `${playlist.length} tracks${getTotalDuration() ? ' · ' + getTotalDuration() + ' total' : ''}`
                : 'Add videos to get started';
        }
    }

    // ── Add videos ──
    async function addVideosByIds(videoIds) {
        if (!videoIds.length) return 0;

        // Deduplicate against existing playlist
        const existingIds = new Set(playlist.map(s => s.youtubeId).filter(Boolean));
        videoIds = videoIds.filter(id => !existingIds.has(id));
        if (!videoIds.length) return 0;

        showLoading(`Fetching info for ${videoIds.length} video(s)...`);

        // Fetch titles via noembed (fast, no proxy needed)
        const metaMap = await fetchVideoMetaBatch(videoIds);

        // Add all songs with titles first so user sees them right away
        const newEntries = [];
        for (const vid of videoIds) {
            const meta = metaMap[vid];
            const entry = createSongEntry(
                vid,
                meta?.title || null,
                0,
                meta?.author || '',
                meta?.thumbnail || ''
            );
            newEntries.push(entry);
            playlist.push(entry);
        }

        renderPlaylist();
        saveState();

        // Now try to fetch durations in background
        showLoading(`Fetching durations for ${videoIds.length} video(s)...`);
        const durMap = await fetchDurationsBatch(videoIds);

        let updated = false;
        for (const entry of newEntries) {
            const sec = durMap[entry.youtubeId];
            if (sec && sec > 0) {
                entry.durationSec = sec;
                entry.durationDisplay = formatDurationSeconds(sec);
                updated = true;
            }
        }

        if (updated) {
            renderPlaylist();
            saveState();
        }

        hideLoading();
        return videoIds.length;
    }

    async function addPlaylistById(playlistId) {
        showLoading('Fetching playlist contents...');

        const videoIds = await fetchPlaylistVideoIds(playlistId);

        if (!videoIds.length) {
            showLoading('Could not fetch playlist. Try pasting individual URLs.');
            setTimeout(hideLoading, 3000);
            return 0;
        }

        showLoading(`Found ${videoIds.length} videos. Fetching info...`);
        const count = await addVideosByIds(videoIds);
        hideLoading();
        return count;
    }

    async function processInput(text) {
        const lines = text.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
        let totalAdded = 0;
        const videoIdsToFetch = [];
        const playlistIdsToFetch = [];
        const seenPlaylists = new Set();

        for (const line of lines) {
            // Check for playlist
            const plId = extractYouTubePlaylistId(line);
            if (plId && !seenPlaylists.has(plId)) {
                seenPlaylists.add(plId);
                playlistIdsToFetch.push(plId);

                // If URL also contains a video, the playlist takes priority
                // but we won't double-add the video since playlist will include it
                continue;
            }

            // Check for video
            const vidId = extractYouTubeVideoId(line);
            if (vidId) {
                videoIdsToFetch.push(vidId);
                continue;
            }

            // Unknown URL
            if (line.startsWith('http')) {
                playlist.push({
                    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
                    title: line,
                    url: line,
                    youtubeId: null,
                    durationSec: 0,
                    durationDisplay: '',
                    channel: '',
                    thumbnail: ''
                });
                totalAdded++;
            }
        }

        // Process playlists first
        for (const plId of playlistIdsToFetch) {
            const count = await addPlaylistById(plId);
            totalAdded += count;
        }

        // Then individual videos
        if (videoIdsToFetch.length > 0) {
            const count = await addVideosByIds(videoIdsToFetch);
            totalAdded += count;
        }

        if (totalAdded > 0) {
            renderPlaylist();
            saveState();
        }

        hideLoading();
        return totalAdded;
    }

    function removeSong(index) {
        playlist.splice(index, 1);
        if (currentSongIndex === index) {
            currentSongIndex = -1;
            videoFrame.src = '';
            hideLoading();
        } else if (currentSongIndex > index) {
            currentSongIndex--;
        }
        renderPlaylist();
        saveState();
    }

    function getYouTubeEmbedUrl(videoId) {
        return `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&disablekb=1&fs=0&playsinline=1`;
    }

    function playSong(index) {
        if (index < 0 || index >= playlist.length) return;
        currentSongIndex = index;
        const song = playlist[index];

        videoFrame.src = song.youtubeId
            ? getYouTubeEmbedUrl(song.youtubeId)
            : song.url;

        npTitle.textContent = song.title;
        const parts = [];
        if (song.channel) parts.push(song.channel);
        if (song.durationDisplay) parts.push(song.durationDisplay);
        parts.push(`Track ${index + 1} of ${playlist.length}`);
        npSub.textContent = parts.join(' · ');

        try {
            initAudioContext();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { }

        if (!mainVizPaused) startVisualizerLoop();
        renderPlaylist();

        if (videoHidden) {
            videoHidden = false;
            videoContainer.classList.remove('hidden-video');
            showVideoBtn.classList.remove('visible');
        }
    }

    function playNext() {
        if (!playlist.length) return;
        playSong((currentSongIndex + 1) % playlist.length);
    }

    function playPrev() {
        if (!playlist.length) return;
        playSong(currentSongIndex <= 0 ? playlist.length - 1 : currentSongIndex - 1);
    }

    function getTotalDuration() {
        const total = playlist.reduce((sum, s) => sum + (s.durationSec || 0), 0);
        return total > 0 ? formatDurationSeconds(total) : '';
    }

    function renderPlaylist() {
        playlistList.innerHTML = '';
        trackCountBadge.textContent = playlist.length;

        playlist.forEach((song, i) => {
            const li = document.createElement('li');
            if (i === currentSongIndex) li.classList.add('active');

            const titleSpan = document.createElement('span');
            titleSpan.className = 'song-title';

            const indexSpan = document.createElement('span');
            indexSpan.className = 'song-index';

            if (i === currentSongIndex) {
                const eq = document.createElement('span');
                eq.className = 'now-playing-eq';
                eq.innerHTML = '<span></span><span></span><span></span><span></span>';
                indexSpan.appendChild(eq);
            } else {
                indexSpan.textContent = String(i + 1).padStart(2, '0');
            }

            titleSpan.appendChild(indexSpan);

            const infoWrap = document.createElement('span');
            infoWrap.className = 'song-info-wrap';

            const nameEl = document.createElement('span');
            nameEl.className = 'song-name';
            nameEl.textContent = song.title;
            infoWrap.appendChild(nameEl);

            if (song.channel || song.durationDisplay) {
                const metaEl = document.createElement('span');
                metaEl.className = 'song-meta';
                const parts = [];
                if (song.channel) parts.push(song.channel);
                if (song.durationDisplay) parts.push(song.durationDisplay);
                metaEl.textContent = parts.join(' · ');
                infoWrap.appendChild(metaEl);
            }

            titleSpan.appendChild(infoWrap);

            const actions = document.createElement('span');
            actions.className = 'song-actions';

            if (song.durationDisplay) {
                const durSpan = document.createElement('span');
                durSpan.className = 'song-duration-badge';
                durSpan.textContent = song.durationDisplay;
                actions.appendChild(durSpan);
            }

            const renameBtn = document.createElement('button');
            renameBtn.textContent = 'Rename';
            renameBtn.onclick = (e) => {
                e.stopPropagation();
                const n = prompt('Rename track:', song.title);
                if (n && n.trim()) {
                    song.title = n.trim();
                    renderPlaylist();
                    if (i === currentSongIndex) npTitle.textContent = song.title;
                    saveState();
                }
            };

            const removeBtn = document.createElement('button');
            removeBtn.textContent = 'Remove';
            removeBtn.className = 'remove-btn';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeSong(i);
            };

            actions.appendChild(renameBtn);
            actions.appendChild(removeBtn);
            li.appendChild(titleSpan);
            li.appendChild(actions);
            li.addEventListener('click', () => playSong(i));
            playlistList.appendChild(li);
        });

        if (currentSongIndex < 0) {
            const dur = getTotalDuration();
            npSub.textContent = playlist.length > 0
                ? `${playlist.length} tracks${dur ? ' · ' + dur + ' total' : ''}`
                : 'Add videos to get started';
        }
    }

    addSongBtn.addEventListener('click', async () => {
        const val = songInput.value.trim();
        if (!val) return;
        addSongBtn.disabled = true;
        addSongBtn.style.opacity = '0.5';
        songInput.value = '';

        try {
            const count = await processInput(val);
            if (count === 0) {
                npTitle.textContent = 'No valid URLs found';
                npSub.textContent = 'Paste YouTube video or playlist URLs';
                setTimeout(hideLoading, 2000);
            }
        } catch (e) {
            console.error(e);
            npTitle.textContent = 'Error adding videos';
            npSub.textContent = e.message;
            setTimeout(hideLoading, 3000);
        }

        addSongBtn.disabled = false;
        addSongBtn.style.opacity = '';
    });

    songInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addSongBtn.click();
        }
    });

    songInput.addEventListener('paste', () => {
        setTimeout(() => {
            const val = songInput.value.trim();
            if (val && (val.includes('youtube.com') || val.includes('youtu.be'))) {
                setTimeout(() => addSongBtn.click(), 150);
            }
        }, 50);
    });

    $('#prevTrackBtn').addEventListener('click', playPrev);
    $('#nextTrackBtn').addEventListener('click', playNext);
    $('#playPauseBtn').addEventListener('click', () => {
        if (currentSongIndex < 0 && playlist.length > 0) playSong(0);
        else if (currentSongIndex >= 0) playSong(currentSongIndex);
    });

    // ── Default Visualizers ──
    const defaultVisualizers = [
        {
            name: 'Prism Bars',
            code: `ctx.fillStyle = BGCOLOR;\nctx.fillRect(0, 0, WIDTH, HEIGHT);\nconst barW = BAR_WIDTH || (WIDTH / bufferLength) * 2.5;\nlet x = 0;\nfor (let i = 0; i < bufferLength; i++) {\n    const h = dataArray[i] * (HEIGHT / 256);\n    ctx.fillStyle = COLOR;\n    ctx.shadowColor = COLOR;\n    ctx.shadowBlur = 8;\n    ctx.fillRect(x, HEIGHT - h, barW, h);\n    x += barW + 1;\n}\nctx.shadowBlur = 0;`,
            overrides: { color: true, bgColor: true, width: true, sensitivity: true },
            presetColor: '#6366f1', presetBgColor: '#0a0a0f', presetWidth: 4, presetSensitivity: 256
        },
        {
            name: 'Orbital',
            code: `ctx.fillStyle = BGCOLOR;\nctx.fillRect(0, 0, WIDTH, HEIGHT);\nconst cx = WIDTH / 2, cy = HEIGHT / 2;\nconst radius = Math.min(WIDTH, HEIGHT) * 0.2;\nfor (let r = 0; r < 3; r++) {\n    ctx.beginPath();\n    for (let i = 0; i < bufferLength; i++) {\n        const angle = (i / bufferLength) * Math.PI * 2;\n        const amp = dataArray[i] / 256;\n        const rad = radius * (0.5 + r * 0.4) + amp * radius * 0.8;\n        const px = cx + Math.cos(angle + r * 0.5) * rad;\n        const py = cy + Math.sin(angle + r * 0.5) * rad;\n        if (i === 0) ctx.moveTo(px, py);\n        else ctx.lineTo(px, py);\n    }\n    ctx.closePath();\n    ctx.strokeStyle = COLOR;\n    ctx.globalAlpha = 0.4 + r * 0.2;\n    ctx.lineWidth = 1.5;\n    ctx.shadowColor = COLOR;\n    ctx.shadowBlur = 15;\n    ctx.stroke();\n}\nctx.globalAlpha = 1;\nctx.shadowBlur = 0;`,
            overrides: { color: true, bgColor: true, width: false, sensitivity: true },
            presetColor: '#a855f7', presetBgColor: '#0a0a0f', presetWidth: 2, presetSensitivity: 256
        },
        {
            name: 'Silk Wave',
            code: `ctx.fillStyle = BGCOLOR;\nctx.fillRect(0, 0, WIDTH, HEIGHT);\nfor (let w = 0; w < 3; w++) {\n    ctx.beginPath();\n    ctx.lineWidth = BAR_WIDTH || 2;\n    ctx.strokeStyle = COLOR;\n    ctx.globalAlpha = 0.3 + w * 0.2;\n    ctx.shadowColor = COLOR;\n    ctx.shadowBlur = 12;\n    const sliceW = WIDTH / bufferLength;\n    let x = 0;\n    for (let i = 0; i < bufferLength; i++) {\n        const v = dataArray[i] / 128.0;\n        const y = (v * HEIGHT) / 2 + w * 15;\n        if (i === 0) ctx.moveTo(x, y);\n        else {\n            const cpx = x - sliceW / 2;\n            ctx.quadraticCurveTo(cpx, y, x, y);\n        }\n        x += sliceW;\n    }\n    ctx.stroke();\n}\nctx.globalAlpha = 1;\nctx.shadowBlur = 0;`,
            overrides: { color: true, bgColor: true, width: true, sensitivity: true },
            presetColor: '#22d3ee', presetBgColor: '#0a0a0f', presetWidth: 2, presetSensitivity: 512
        },
        {
            name: 'Ember',
            code: `ctx.fillStyle = 'rgba(10,10,15,0.12)';\nctx.fillRect(0, 0, WIDTH, HEIGHT);\nfor (let i = 0; i < bufferLength; i += 2) {\n    const amp = dataArray[i] / 256;\n    if (amp < 0.08) continue;\n    const x = (i / bufferLength) * WIDTH + (Math.random() - 0.5) * 40;\n    const y = HEIGHT - amp * HEIGHT * 0.8 + (Math.random() - 0.5) * 20;\n    const size = amp * (BAR_WIDTH || 4) * 1.5;\n    ctx.beginPath();\n    ctx.arc(x, y, size, 0, Math.PI * 2);\n    ctx.fillStyle = COLOR;\n    ctx.shadowColor = COLOR;\n    ctx.shadowBlur = 20;\n    ctx.globalAlpha = amp * 0.9;\n    ctx.fill();\n}\nctx.globalAlpha = 1;\nctx.shadowBlur = 0;`,
            overrides: { color: true, bgColor: false, width: true, sensitivity: true },
            presetColor: '#f97316', presetBgColor: '#0a0a0f', presetWidth: 4, presetSensitivity: 256
        },
        {
            name: 'Mirror Bars',
            code: `ctx.fillStyle = BGCOLOR;\nctx.fillRect(0, 0, WIDTH, HEIGHT);\nconst mid = HEIGHT / 2;\nconst barW = BAR_WIDTH || 3;\nconst gap = 1;\nconst totalBars = Math.floor(WIDTH / (barW + gap));\nconst step = Math.max(1, Math.floor(bufferLength / totalBars));\nfor (let i = 0; i < totalBars; i++) {\n    const val = dataArray[Math.min(i * step, bufferLength - 1)] || 0;\n    const h = (val / 256) * mid;\n    ctx.fillStyle = COLOR;\n    ctx.shadowColor = COLOR;\n    ctx.shadowBlur = 6;\n    ctx.fillRect(i * (barW + gap), mid - h, barW, h);\n    ctx.fillRect(i * (barW + gap), mid, barW, h);\n}\nctx.shadowBlur = 0;`,
            overrides: { color: true, bgColor: true, width: true, sensitivity: true },
            presetColor: '#ec4899', presetBgColor: '#0a0a0f', presetWidth: 3, presetSensitivity: 256
        }
    ];

    function loadDefaultVisualizers() {
        if (visualizers.length === 0) {
            visualizers = JSON.parse(JSON.stringify(defaultVisualizers));
            saveState();
        }
    }

    function renderVizList() {
        vizList.innerHTML = '';
        visualizers.forEach((viz, i) => {
            const li = document.createElement('li');
            if (i === currentVizIndex) li.classList.add('active');
            const titleSpan = document.createElement('span');
            titleSpan.className = 'viz-title';
            titleSpan.textContent = viz.name;
            li.appendChild(titleSpan);
            li.addEventListener('click', () => {
                currentVizIndex = i;
                applyVisualizerSettings(viz);
                updateThemeFromCurrentViz();
                renderVizList();
                saveState();
            });
            vizList.appendChild(li);
        });
    }

    function renderManageVizList() {
        manageVizList.innerHTML = '';
        visualizers.forEach((viz, i) => {
            const li = document.createElement('li');
            const name = document.createElement('span');
            name.textContent = viz.name;
            name.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';

            const actions = document.createElement('span');
            actions.className = 'manage-actions';

            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => loadVizIntoEditor(i);

            const renameBtn = document.createElement('button');
            renameBtn.textContent = 'Rename';
            renameBtn.onclick = () => {
                const n = prompt('Rename visualizer:', viz.name);
                if (n && n.trim()) { viz.name = n.trim(); renderVizList(); renderManageVizList(); saveState(); }
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'delete-viz';
            deleteBtn.onclick = () => {
                if (!confirm(`Delete "${viz.name}"?`)) return;
                visualizers.splice(i, 1);
                if (currentVizIndex === i) currentVizIndex = visualizers.length > 0 ? 0 : -1;
                else if (currentVizIndex > i) currentVizIndex--;
                updateThemeFromCurrentViz(); renderVizList(); renderManageVizList(); saveState();
            };

            actions.appendChild(editBtn);
            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);
            li.appendChild(name);
            li.appendChild(actions);
            manageVizList.appendChild(li);
        });
    }

    function loadVizIntoEditor(index) {
        editingVizIndex = index;
        const viz = visualizers[index];
        $('#vizName').value = viz.name;
        $('#vizCode').value = viz.code;
        $('#overrideColor').checked = viz.overrides?.color || false;
        $('#overrideBgColor').checked = viz.overrides?.bgColor || false;
        $('#overrideWidth').checked = viz.overrides?.width || false;
        $('#overrideSensitivity').checked = viz.overrides?.sensitivity || false;
        $('#presetColor').value = viz.presetColor || '#6366f1';
        $('#presetBgColor').value = viz.presetBgColor || '#0a0a0f';
        const fft = viz.presetSensitivity || 256;
        presetSensitivitySlider.value = Math.max(5, Math.min(11, Math.round(Math.log2(fft))));
        presetSensitivityVal.textContent = fft;
        presetWidthSlider.value = viz.presetWidth || 5;
        presetWidthVal.textContent = viz.presetWidth || 5;
    }

    function applyVisualizerSettings(viz) {
        if (analyser) {
            const fft = viz.overrides?.sensitivity ? (viz.presetSensitivity || 256) : 256;
            try { analyser.fftSize = Math.pow(2, Math.max(5, Math.min(15, Math.round(Math.log2(fft))))); } catch (e) { }
        }
    }

    // ── Visualization Engine ──
    let simPhase = 0;
    let simulatedData = new Uint8Array(128);

    function generateSimulatedData() {
        simPhase += 0.04;
        for (let i = 0; i < simulatedData.length; i++) {
            simulatedData[i] = Math.max(0, Math.min(255, Math.floor(
                128 + 80 * Math.sin(simPhase + i * 0.12) +
                50 * Math.sin(simPhase * 1.7 + i * 0.25) +
                30 * Math.sin(simPhase * 3.1 + i * 0.08) +
                15 * Math.random()
            )));
        }
    }

    function getAudioData() {
        if (analyser && audioCtx && audioCtx.state === 'running') {
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteFrequencyData(dataArray);
            let hasData = false;
            for (let i = 0; i < dataArray.length; i++) { if (dataArray[i] > 0) { hasData = true; break; } }
            if (hasData) return { dataArray, bufferLength };
        }
        generateSimulatedData();
        return { dataArray: simulatedData, bufferLength: simulatedData.length };
    }

    function executeVizCode(targetCtx, targetCanvas, vizData, width, height) {
        const { dataArray, bufferLength } = getAudioData();
        const COLOR = vizData.overrides?.color ? vizData.presetColor : '#6366f1';
        const BGCOLOR = vizData.overrides?.bgColor ? vizData.presetBgColor : '#0a0a0f';
        const BAR_WIDTH = vizData.overrides?.width ? (vizData.presetWidth || 5) : 0;
        try {
            const fn = new Function(
                'ctx', 'canvas', 'analyser', 'dataArray', 'bufferLength',
                'WIDTH', 'HEIGHT', 'COLOR', 'BGCOLOR', 'BAR_WIDTH',
                vizData.code
            );
            fn(targetCtx, targetCanvas, analyser, dataArray, bufferLength, width, height, COLOR, BGCOLOR, BAR_WIDTH);
        } catch (e) {
            targetCtx.fillStyle = '#0a0a0f';
            targetCtx.fillRect(0, 0, width, height);
            targetCtx.fillStyle = '#ef4444';
            targetCtx.font = '12px Inter, sans-serif';
            targetCtx.fillText('Error: ' + e.message, 10, height / 2);
        }
    }

    function drawDefaultViz(targetCtx, width, height) {
        const { dataArray, bufferLength } = getAudioData();
        targetCtx.fillStyle = '#0a0a0f';
        targetCtx.fillRect(0, 0, width, height);
        const barW = (width / bufferLength) * 2.5;
        let x = 0;
        for (let i = 0; i < bufferLength; i++) {
            const h = dataArray[i] * (height / 256);
            targetCtx.fillStyle = `hsla(${240 + (i / bufferLength) * 60}, 80%, 65%, 0.8)`;
            targetCtx.shadowColor = `hsla(${240 + (i / bufferLength) * 60}, 80%, 65%, 0.5)`;
            targetCtx.shadowBlur = 6;
            targetCtx.fillRect(x, height - h, barW, h);
            x += barW + 1;
        }
        targetCtx.shadowBlur = 0;
    }

    function drawVisualization() {
        animFrameId = requestAnimationFrame(drawVisualization);
        if (mainVizPaused) {
            ctx.fillStyle = '#0a0a0f';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            return;
        }
        if (currentVizIndex >= 0 && currentVizIndex < visualizers.length) {
            executeVizCode(ctx, canvas, visualizers[currentVizIndex], canvas.width, canvas.height);
        } else {
            drawDefaultViz(ctx, canvas.width, canvas.height);
        }
    }

    function startVisualizerLoop() {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        drawVisualization();
    }

    function pauseMainViz() { mainVizPaused = true; }
    function resumeMainViz() { mainVizPaused = false; if (!animFrameId) startVisualizerLoop(); }

    // ── Preview ──
    function drawPreview() {
        previewAnimId = requestAnimationFrame(drawPreview);
        sizePreviewCanvas();
        executeVizCode(previewCtx, previewCanvas, getEditorVizData(), previewCanvas.width, previewCanvas.height);
    }

    function startPreviewLoop() { if (previewAnimId) cancelAnimationFrame(previewAnimId); drawPreview(); }
    function stopPreviewLoop() { if (previewAnimId) { cancelAnimationFrame(previewAnimId); previewAnimId = null; } }

    function getEditorVizData() {
        return {
            code: $('#vizCode').value,
            overrides: {
                color: $('#overrideColor').checked,
                bgColor: $('#overrideBgColor').checked,
                width: $('#overrideWidth').checked,
                sensitivity: $('#overrideSensitivity').checked
            },
            presetColor: $('#presetColor').value,
            presetBgColor: $('#presetBgColor').value,
            presetWidth: parseInt(presetWidthSlider.value) || 5,
            presetSensitivity: Math.pow(2, parseInt(presetSensitivitySlider.value) || 8)
        };
    }

    // ── Video controls ──
    hideVideoBtn.addEventListener('click', () => {
        videoHidden = true;
        videoContainer.classList.add('hidden-video');
        showVideoBtn.classList.add('visible');
    });

    showVideoBtn.addEventListener('click', () => {
        videoHidden = false;
        videoContainer.classList.remove('hidden-video');
        showVideoBtn.classList.remove('visible');
        videoContainer.style.opacity = '1';
        videoOpacitySlider.value = 100;
    });

    videoOpacitySlider.addEventListener('input', () => {
        const val = videoOpacitySlider.value / 100;
        videoContainer.style.opacity = val;
        if (val === 0) {
            videoHidden = true;
            videoContainer.classList.add('hidden-video');
            showVideoBtn.classList.add('visible');
        }
    });

    // ── Dragging ──
    function makeDraggable(element, handle) {
        let isDragging = false, startX, startY, origX, origY;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;
            isDragging = true;
            startX = e.clientX; startY = e.clientY;
            const rect = element.getBoundingClientRect();
            origX = rect.left; origY = rect.top;
            element.style.transition = 'none';
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
            e.preventDefault();
        });
        function onDrag(e) {
            if (!isDragging) return;
            element.style.left = Math.max(0, Math.min(window.innerWidth - 50, origX + e.clientX - startX)) + 'px';
            element.style.top = Math.max(0, Math.min(window.innerHeight - 50, origY + e.clientY - startY)) + 'px';
            element.style.right = 'auto'; element.style.bottom = 'auto'; element.style.transform = 'none';
        }
        function stopDrag() {
            isDragging = false; element.style.transition = '';
            document.removeEventListener('mousemove', onDrag);
            document.removeEventListener('mouseup', stopDrag);
        }
    }

    makeDraggable($('#playlistPanel'), $('#playlistPanel .panel-header'));
    makeDraggable($('#vizPanel'), $('#vizPanel .panel-header'));
    makeDraggable(videoContainer, $('#videoDragHandle'));

    // ── Video Resize ──
    const resizeHandle = videoContainer.querySelector('.resize-handle');
    let isResizing = false, rsX, rsY, rsW, rsH;
    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true; rsX = e.clientX; rsY = e.clientY;
        rsW = videoContainer.offsetWidth; rsH = videoContainer.offsetHeight;
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault(); e.stopPropagation();
    });
    function onResize(e) {
        if (!isResizing) return;
        videoContainer.style.width = Math.max(200, rsW + e.clientX - rsX) + 'px';
        videoContainer.style.height = Math.max(120, rsH + e.clientY - rsY) + 'px';
    }
    function stopResize() {
        isResizing = false;
        document.removeEventListener('mousemove', onResize);
        document.removeEventListener('mouseup', stopResize);
    }

    // ── Modals ──
    function openModal(modal) {
        modal.classList.remove('hidden');
        if (modal === vizModal) { pauseMainViz(); startPreviewLoop(); }
    }
    function closeModal(modal) {
        modal.classList.add('hidden');
        if (modal === vizModal) { stopPreviewLoop(); resumeMainViz(); }
    }
    $$('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => closeModal(btn.closest('.modal')));
    });
    $$('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(modal); });
    });

    // ── Viz Editor ──
    $('#vizSettingsBtn').addEventListener('click', () => {
        editingVizIndex = -1;
        $('#vizName').value = '';
        $('#vizCode').value = '';
        $('#overrideColor').checked = true;
        $('#overrideBgColor').checked = true;
        $('#overrideWidth').checked = false;
        $('#overrideSensitivity').checked = false;
        $('#presetColor').value = '#6366f1';
        $('#presetBgColor').value = '#0a0a0f';
        presetWidthSlider.value = 5; presetWidthVal.textContent = '5';
        presetSensitivitySlider.value = 8; presetSensitivityVal.textContent = '256';
        renderManageVizList();
        openModal(vizModal);
    });

    presetWidthSlider.addEventListener('input', () => { presetWidthVal.textContent = presetWidthSlider.value; });
    presetSensitivitySlider.addEventListener('input', () => {
        presetSensitivityVal.textContent = Math.pow(2, parseInt(presetSensitivitySlider.value));
    });

    saveVizBtn.addEventListener('click', () => {
        const name = $('#vizName').value.trim() || 'Untitled';
        const vizData = { name, ...getEditorVizData() };
        if (editingVizIndex >= 0) {
            visualizers[editingVizIndex] = vizData;
            if (currentVizIndex === editingVizIndex) applyVisualizerSettings(vizData);
        } else {
            visualizers.push(vizData);
            currentVizIndex = visualizers.length - 1;
            applyVisualizerSettings(vizData);
        }
        updateThemeFromCurrentViz(); renderVizList(); renderManageVizList(); saveState();
        editingVizIndex = -1;
        saveVizBtn.textContent = '✓ Saved';
        saveVizBtn.style.background = '#22c55e';
        setTimeout(() => { saveVizBtn.textContent = 'Save Visualizer'; saveVizBtn.style.background = ''; }, 1500);
    });

    // ── Import Tabs ──
    $$('.import-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.import-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            $('#importPasteArea').classList.toggle('hidden', tab.dataset.tab !== 'paste');
            $('#importFileArea').classList.toggle('hidden', tab.dataset.tab !== 'file');
        });
    });

    fileDropZone.addEventListener('click', () => importFile.click());
    fileDropZone.addEventListener('dragover', (e) => { e.preventDefault(); fileDropZone.classList.add('dragover'); });
    fileDropZone.addEventListener('dragleave', () => fileDropZone.classList.remove('dragover'));
    fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault(); fileDropZone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
    });
    importFile.addEventListener('change', () => { if (importFile.files[0]) handleImportFile(importFile.files[0]); });

    function handleImportFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => { importFileData = e.target.result; fileNameDisplay.textContent = file.name; };
        reader.readAsText(file);
    }

    // ── Import / Export ──
    importBtn.addEventListener('click', () => {
        $('#importData').value = ''; importFileData = null; fileNameDisplay.textContent = ''; importFile.value = '';
        openModal(importModal);
    });

    exportBtn.addEventListener('click', () => {
        $('#exportData').value = JSON.stringify({
            version: 1, exportedAt: new Date().toISOString(),
            playlist, visualizers, currentVizIndex
        }, null, 2);
        openModal(exportModal);
    });

    $('#doImportBtn').addEventListener('click', () => {
        const activeTab = $('.import-tab.active')?.dataset.tab || 'paste';
        const jsonStr = (activeTab === 'paste' ? $('#importData').value : importFileData || '').trim();
        if (!jsonStr) { alert('No data to import.'); return; }
        try {
            const data = JSON.parse(jsonStr);
            if (data.playlist && Array.isArray(data.playlist)) { playlist = data.playlist; currentSongIndex = -1; }
            if (data.visualizers && Array.isArray(data.visualizers)) {
                visualizers = data.visualizers;
                currentVizIndex = typeof data.currentVizIndex === 'number' ? data.currentVizIndex : 0;
            }
            renderPlaylist(); renderVizList(); updateThemeFromCurrentViz(); saveState();
            closeModal(importModal);
            npTitle.textContent = 'Session imported';
            npSub.textContent = `${playlist.length} tracks, ${visualizers.length} visualizers`;
        } catch (e) { alert('Invalid JSON: ' + e.message); }
    });

    $('#copyExportBtn').addEventListener('click', () => {
        navigator.clipboard.writeText($('#exportData').value).then(() => {
            const btn = $('#copyExportBtn');
            btn.textContent = '✓ Copied';
            setTimeout(() => { btn.textContent = 'Copy to Clipboard'; }, 2000);
        });
    });

    $('#downloadExportBtn').addEventListener('click', () => {
        const blob = new Blob([$('#exportData').value], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = `visu-session-${Date.now()}.json`; a.click();
        URL.revokeObjectURL(url);
    });

    // ── Persistence ──
    function saveState() {
        try { localStorage.setItem('visuState', JSON.stringify({ playlist, visualizers, currentVizIndex })); }
        catch (e) { console.warn('Save error:', e); }
    }

    function loadState() {
        try {
            const data = JSON.parse(localStorage.getItem('visuState'));
            if (data) {
                playlist = data.playlist || [];
                visualizers = data.visualizers || [];
                currentVizIndex = typeof data.currentVizIndex === 'number' ? data.currentVizIndex : -1;
            }
        } catch (e) { }
        loadDefaultVisualizers();
        if (currentVizIndex < 0 && visualizers.length > 0) currentVizIndex = 0;
    }

    // ── Dynamic CSS ──
    const dynamicStyle = document.createElement('style');
    dynamicStyle.textContent = `
        .song-info-wrap {
            display: flex;
            flex-direction: column;
            min-width: 0;
            flex: 1;
        }
        .song-name {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            font-size: 12px;
            line-height: 1.4;
        }
        .song-meta {
            font-size: 10px;
            color: var(--text-muted);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            line-height: 1.3;
        }
        .song-duration-badge {
            font-size: 10px;
            color: var(--text-muted);
            font-family: var(--font-mono);
            font-variant-numeric: tabular-nums;
            margin-right: 4px;
            white-space: nowrap;
        }
        #playlistList li {
            padding: 6px 10px;
            min-height: 38px;
        }
    `;
    document.head.appendChild(dynamicStyle);

    // ── Init ──
    loadState();
    renderPlaylist();
    renderVizList();
    updateThemeFromCurrentViz();
    startVisualizerLoop();

    npSub.textContent = playlist.length > 0
        ? `${playlist.length} tracks in library`
        : 'Add videos to get started';

    document.addEventListener('click', () => {
        try { initAudioContext(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { }
    }, { once: true });

})();

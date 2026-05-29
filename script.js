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

        if (max === min) {
            h = s = 0;
        } else {
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

        // Main accent
        document.documentElement.style.setProperty('--accent', hex);
        document.documentElement.style.setProperty('--accent-r', r);
        document.documentElement.style.setProperty('--accent-g', g);
        document.documentElement.style.setProperty('--accent-b', b);

        // Lighter hover
        const hoverL = Math.min(l + 12, 85);
        document.documentElement.style.setProperty('--accent-hover', `hsl(${h}, ${s}%, ${hoverL}%)`);

        // Glow
        document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.25)`);
    }

    function updateThemeFromCurrentViz() {
        if (currentVizIndex >= 0 && currentVizIndex < visualizers.length) {
            const viz = visualizers[currentVizIndex];
            if (viz.overrides?.color && viz.presetColor) {
                applyThemeColor(viz.presetColor);
            }
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

    // ── YouTube ──
    function extractYouTubeId(url) {
        const patterns = [
            /(?:youtube\.com\/watch\?v=)([^&\s]+)/,
            /(?:youtu\.be\/)([^?\s]+)/,
            /(?:youtube\.com\/embed\/)([^?\s]+)/,
            /(?:youtube\.com\/shorts\/)([^?\s]+)/
        ];
        for (const p of patterns) {
            const m = url.trim().match(p);
            if (m) return m[1];
        }
        return null;
    }

    function getYouTubeEmbedUrl(videoId) {
        return `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=0&modestbranding=1&rel=0&showinfo=0&iv_load_policy=3&disablekb=1&fs=0&playsinline=1`;
    }

    // ── Playlist ──
    function addSong(title, url) {
        const id = extractYouTubeId(url);
        if (!id && !url) return;
        playlist.push({
            id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
            title: title || (id ? `Video · ${id}` : url),
            url: url.trim(),
            youtubeId: id
        });
        renderPlaylist();
        saveState();
    }

    function addMultipleSongs(text) {
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        let added = 0;
        lines.forEach(line => {
            const ytId = extractYouTubeId(line);
            if (ytId || line.startsWith('http')) {
                const title = ytId ? `Video · ${ytId}` : line;
                playlist.push({
                    id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
                    title,
                    url: line.trim(),
                    youtubeId: ytId
                });
                added++;
            }
        });
        if (added > 0) {
            renderPlaylist();
            saveState();
        }
        return added;
    }

    function removeSong(index) {
        playlist.splice(index, 1);
        if (currentSongIndex === index) {
            currentSongIndex = -1;
            videoFrame.src = '';
            npTitle.textContent = 'No track loaded';
            npSub.textContent = `${playlist.length} tracks in library`;
        } else if (currentSongIndex > index) {
            currentSongIndex--;
        }
        renderPlaylist();
        saveState();
    }

    function playSong(index) {
        if (index < 0 || index >= playlist.length) return;
        currentSongIndex = index;
        const song = playlist[index];

        videoFrame.src = song.youtubeId
            ? getYouTubeEmbedUrl(song.youtubeId)
            : song.url;

        npTitle.textContent = song.title;
        npSub.textContent = `Track ${index + 1} of ${playlist.length}`;

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
            titleSpan.appendChild(document.createTextNode(song.title));

            const actions = document.createElement('span');
            actions.className = 'song-actions';

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
    }

    addSongBtn.addEventListener('click', () => {
        const val = songInput.value.trim();
        if (!val) return;
        const count = addMultipleSongs(val);
        if (count === 0) addSong(val, val);
        songInput.value = '';
    });

    songInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            addSongBtn.click();
        }
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
                if (n && n.trim()) {
                    viz.name = n.trim();
                    renderVizList();
                    renderManageVizList();
                    saveState();
                }
            };

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.className = 'delete-viz';
            deleteBtn.onclick = () => {
                if (!confirm(`Delete "${viz.name}"?`)) return;
                visualizers.splice(i, 1);
                if (currentVizIndex === i) currentVizIndex = visualizers.length > 0 ? 0 : -1;
                else if (currentVizIndex > i) currentVizIndex--;
                updateThemeFromCurrentViz();
                renderVizList();
                renderManageVizList();
                saveState();
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

        // Convert stored fftSize to power exponent for slider
        const fft = viz.presetSensitivity || 256;
        const exp = Math.round(Math.log2(fft));
        presetSensitivitySlider.value = exp;
        presetSensitivityVal.textContent = fft;

        presetWidthSlider.value = viz.presetWidth || 5;
        presetWidthVal.textContent = viz.presetWidth || 5;
    }

    function applyVisualizerSettings(viz) {
        if (analyser) {
            const fft = viz.overrides?.sensitivity ? (viz.presetSensitivity || 256) : 256;
            // Clamp to valid power of 2
            const validFft = Math.pow(2, Math.max(5, Math.min(15, Math.round(Math.log2(fft)))));
            analyser.fftSize = validFft;
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
            for (let i = 0; i < dataArray.length; i++) {
                if (dataArray[i] > 0) { hasData = true; break; }
            }
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
            fn(targetCtx, targetCanvas, analyser, dataArray, bufferLength,
                width, height, COLOR, BGCOLOR, BAR_WIDTH);
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
            const hue = 240 + (i / bufferLength) * 60;
            targetCtx.fillStyle = `hsla(${hue}, 80%, 65%, 0.8)`;
            targetCtx.shadowColor = `hsla(${hue}, 80%, 65%, 0.5)`;
            targetCtx.shadowBlur = 6;
            targetCtx.fillRect(x, height - h, barW, h);
            x += barW + 1;
        }
        targetCtx.shadowBlur = 0;
    }

    function drawVisualization() {
        animFrameId = requestAnimationFrame(drawVisualization);

        if (mainVizPaused) {
            // Draw a static dark frame when paused
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

    function pauseMainViz() {
        mainVizPaused = true;
    }

    function resumeMainViz() {
        mainVizPaused = false;
        if (!animFrameId) startVisualizerLoop();
    }

    // ── Preview ──
    function drawPreview() {
        previewAnimId = requestAnimationFrame(drawPreview);
        sizePreviewCanvas();
        const W = previewCanvas.width;
        const H = previewCanvas.height;

        const tempViz = getEditorVizData();
        executeVizCode(previewCtx, previewCanvas, tempViz, W, H);
    }

    function startPreviewLoop() {
        if (previewAnimId) cancelAnimationFrame(previewAnimId);
        drawPreview();
    }

    function stopPreviewLoop() {
        if (previewAnimId) {
            cancelAnimationFrame(previewAnimId);
            previewAnimId = null;
        }
    }

    function getEditorVizData() {
        const fftExp = parseInt(presetSensitivitySlider.value) || 8;
        const fftSize = Math.pow(2, fftExp);
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
            presetSensitivity: fftSize
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
        let isDragging = false;
        let startX, startY, origX, origY;

        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = element.getBoundingClientRect();
            origX = rect.left;
            origY = rect.top;
            element.style.transition = 'none';
            document.addEventListener('mousemove', onDrag);
            document.addEventListener('mouseup', stopDrag);
            e.preventDefault();
        });

        function onDrag(e) {
            if (!isDragging) return;
            const newX = Math.max(0, Math.min(window.innerWidth - 50, origX + e.clientX - startX));
            const newY = Math.max(0, Math.min(window.innerHeight - 50, origY + e.clientY - startY));
            element.style.left = newX + 'px';
            element.style.top = newY + 'px';
            element.style.right = 'auto';
            element.style.bottom = 'auto';
            element.style.transform = 'none';
        }

        function stopDrag() {
            isDragging = false;
            element.style.transition = '';
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
        isResizing = true;
        rsX = e.clientX; rsY = e.clientY;
        rsW = videoContainer.offsetWidth;
        rsH = videoContainer.offsetHeight;
        document.addEventListener('mousemove', onResize);
        document.addEventListener('mouseup', stopResize);
        e.preventDefault();
        e.stopPropagation();
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
        if (modal === vizModal) {
            pauseMainViz();
            startPreviewLoop();
        }
    }

    function closeModal(modal) {
        modal.classList.add('hidden');
        if (modal === vizModal) {
            stopPreviewLoop();
            resumeMainViz();
        }
    }

    $$('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            closeModal(btn.closest('.modal'));
        });
    });

    $$('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal(modal);
        });
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
        presetWidthSlider.value = 5;
        presetWidthVal.textContent = '5';
        presetSensitivitySlider.value = 8;
        presetSensitivityVal.textContent = '256';
        renderManageVizList();
        openModal(vizModal);
    });

    presetWidthSlider.addEventListener('input', () => {
        presetWidthVal.textContent = presetWidthSlider.value;
    });

    presetSensitivitySlider.addEventListener('input', () => {
        const exp = parseInt(presetSensitivitySlider.value);
        const fft = Math.pow(2, exp);
        presetSensitivityVal.textContent = fft;
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

        updateThemeFromCurrentViz();
        renderVizList();
        renderManageVizList();
        saveState();
        editingVizIndex = -1;

        saveVizBtn.textContent = '✓ Saved';
        saveVizBtn.style.background = '#22c55e';
        setTimeout(() => {
            saveVizBtn.textContent = 'Save Visualizer';
            saveVizBtn.style.background = '';
        }, 1500);
    });

    // ── Import Tabs ──
    $$('.import-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            $$('.import-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            const target = tab.dataset.tab;
            if (target === 'paste') {
                $('#importPasteArea').classList.remove('hidden');
                $('#importFileArea').classList.add('hidden');
            } else {
                $('#importPasteArea').classList.add('hidden');
                $('#importFileArea').classList.remove('hidden');
            }
        });
    });

    // File import
    fileDropZone.addEventListener('click', () => importFile.click());

    fileDropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileDropZone.classList.add('dragover');
    });

    fileDropZone.addEventListener('dragleave', () => {
        fileDropZone.classList.remove('dragover');
    });

    fileDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        fileDropZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleImportFile(file);
    });

    importFile.addEventListener('change', () => {
        if (importFile.files[0]) handleImportFile(importFile.files[0]);
    });

    function handleImportFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            importFileData = e.target.result;
            fileNameDisplay.textContent = file.name;
        };
        reader.readAsText(file);
    }

    // ── Import / Export ──
    importBtn.addEventListener('click', () => {
        $('#importData').value = '';
        importFileData = null;
        fileNameDisplay.textContent = '';
        importFile.value = '';
        openModal(importModal);
    });

    exportBtn.addEventListener('click', () => {
        const data = {
            version: 1,
            exportedAt: new Date().toISOString(),
            playlist,
            visualizers,
            currentVizIndex
        };
        $('#exportData').value = JSON.stringify(data, null, 2);
        openModal(exportModal);
    });

    $('#doImportBtn').addEventListener('click', () => {
        const activeTab = $('.import-tab.active')?.dataset.tab || 'paste';
        let jsonStr = '';

        if (activeTab === 'paste') {
            jsonStr = $('#importData').value.trim();
        } else {
            jsonStr = importFileData || '';
        }

        if (!jsonStr) {
            alert('No data to import.');
            return;
        }

        try {
            const data = JSON.parse(jsonStr);
            if (data.playlist && Array.isArray(data.playlist)) {
                playlist = data.playlist;
                currentSongIndex = -1;
            }
            if (data.visualizers && Array.isArray(data.visualizers)) {
                visualizers = data.visualizers;
                currentVizIndex = typeof data.currentVizIndex === 'number' ? data.currentVizIndex : 0;
            }
            renderPlaylist();
            renderVizList();
            updateThemeFromCurrentViz();
            saveState();
            closeModal(importModal);
            npTitle.textContent = 'Session imported';
            npSub.textContent = `${playlist.length} tracks, ${visualizers.length} visualizers`;
        } catch (e) {
            alert('Invalid JSON: ' + e.message);
        }
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
        const a = document.createElement('a');
        a.href = url;
        a.download = `visu-session-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    // ── Persistence ──
    function saveState() {
        localStorage.setItem('visuState', JSON.stringify({
            playlist, visualizers, currentVizIndex
        }));
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
        try {
            initAudioContext();
            if (audioCtx.state === 'suspended') audioCtx.resume();
        } catch (e) { }
    }, { once: true });

})();
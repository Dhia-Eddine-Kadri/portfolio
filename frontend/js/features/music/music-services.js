import { escapeHtml } from '../../utils/escape-html.js';
export function initMusicServices(options) {
    const sb = options.sb;
    const getCurrentUser = options.getCurrentUser;
    const applyUserTypeUI = options.applyUserTypeUI;
    const showToast = options.showToast ||
        function (title, sub) {
            if (typeof window.showToast === 'function')
                window.showToast(title, sub);
        };
    const SPOTIFY_CLIENT_ID = '';
    const SPOTIFY_SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
    const SPOTIFY_REDIRECT = window.location.origin + window.location.pathname;
    let spToken = null;
    let spRefresh = null;
    let spPollTimer = null;
    let ytPlaylistsCache = null;
    function spChallenge(verifier) {
        return crypto.subtle
            .digest('SHA-256', new TextEncoder().encode(verifier))
            .then((buf) => {
            return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf))))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=/g, '');
        });
    }
    function spRandom(len) {
        const arr = new Uint8Array(len);
        crypto.getRandomValues(arr);
        return btoa(String.fromCharCode.apply(null, Array.from(arr)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g, '')
            .slice(0, len);
    }
    function spConnect() {
        let cid = localStorage.getItem('ss_spotify_cid') || SPOTIFY_CLIENT_ID;
        if (!cid) {
            const entered = prompt('Enter your Spotify App Client ID (get one free at developer.spotify.com):');
            if (!entered)
                return;
            cid = entered.trim();
            localStorage.setItem('ss_spotify_cid', cid);
        }
        const verifier = spRandom(64);
        localStorage.setItem('ss_sp_verifier', verifier);
        void spChallenge(verifier).then((challenge) => {
            const params = new URLSearchParams({
                response_type: 'code',
                client_id: cid,
                scope: SPOTIFY_SCOPES,
                redirect_uri: SPOTIFY_REDIRECT,
                code_challenge_method: 'S256',
                code_challenge: challenge,
                state: 'spotify_pkce',
            });
            window.location.href = 'https://accounts.spotify.com/authorize?' + params.toString();
        });
    }
    function spExchangeCode(code, cid) {
        const verifier = localStorage.getItem('ss_sp_verifier') || '';
        fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: SPOTIFY_REDIRECT,
                client_id: cid,
                code_verifier: verifier,
            }),
        })
            .then((r) => r.json())
            .then((d) => {
            if (d.access_token) {
                spToken = d.access_token;
                localStorage.setItem('ss_sp_token', spToken);
                if (d.refresh_token) {
                    spRefresh = d.refresh_token;
                    localStorage.setItem('ss_sp_refresh', spRefresh);
                }
                localStorage.removeItem('ss_sp_verifier');
                history.replaceState(null, '', window.location.pathname);
                spUpdateUI(true);
                spPollPlayback();
            }
        })
            .catch((e) => {
            console.error('Spotify token exchange failed', e);
        });
    }
    function spApi(path, method, body) {
        if (!spToken)
            return Promise.reject(new Error('no token'));
        return fetch('https://api.spotify.com/v1/' + path, {
            method: method || 'GET',
            headers: { Authorization: 'Bearer ' + spToken, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        }).then((r) => {
            if (r.status === 401) {
                spToken = null;
                localStorage.removeItem('ss_sp_token');
                spUpdateUI(false);
                return null;
            }
            if (r.status === 204 || r.status === 202)
                return null;
            return r.json();
        });
    }
    function applyCurrentlyPlaying(d, includePlayPause) {
        if (!d || !d.item)
            return;
        const name = document.getElementById('spotifyTrackName');
        const artist = document.getElementById('spotifyArtist');
        const thumb = document.getElementById('spotifyThumb');
        if (name)
            name.textContent = d.item.name || '-';
        if (artist) {
            artist.textContent =
                (d.item.artists || []).map((a) => a.name).join(', ') || '-';
        }
        if (thumb && d.item.album && d.item.album.images && d.item.album.images[0]) {
            thumb.src = d.item.album.images[0].url;
        }
        if (includePlayPause) {
            const ppBtn = document.getElementById('spotifyPlayPause');
            if (ppBtn)
                ppBtn.textContent = d.is_playing ? '⏸' : '▶';
        }
    }
    function spPollPlayback() {
        if (spPollTimer !== null)
            clearInterval(spPollTimer);
        spPollTimer = setInterval(() => {
            void spApi('me/player/currently-playing').then((d) => {
                applyCurrentlyPlaying(d, true);
            });
        }, 5000);
        void spApi('me/player/currently-playing').then((d) => {
            applyCurrentlyPlaying(d, false);
        });
    }
    function spUpdateUI(connected) {
        const statusEl = document.getElementById('spotifyStatus');
        const btn = document.getElementById('spotifyConnectBtn');
        const player = document.getElementById('spotifyPlayer');
        if (statusEl) {
            statusEl.textContent = connected ? 'Connected ✓' : 'Not connected';
            statusEl.className = 'music-service-status' + (connected ? ' connected' : '');
        }
        if (btn) {
            btn.textContent = connected ? 'Reconnect' : 'Connect';
            btn.className = 'music-connect-btn' + (connected ? ' connected' : '');
        }
        if (player)
            player.style.display = connected ? 'flex' : 'none';
    }
    function spDisconnect() {
        if (spPollTimer !== null)
            clearInterval(spPollTimer);
        spToken = null;
        spRefresh = null;
        localStorage.removeItem('ss_sp_token');
        localStorage.removeItem('ss_sp_refresh');
        localStorage.removeItem('ss_spotify_cid');
        spUpdateUI(false);
    }
    function ytGetPlaylists() {
        if (ytPlaylistsCache)
            return ytPlaylistsCache;
        try {
            return JSON.parse(localStorage.getItem('ss_yt_playlists') || '[]');
        }
        catch {
            return [];
        }
    }
    async function ytSavePlaylists(arr) {
        ytPlaylistsCache = arr;
        localStorage.setItem('ss_yt_playlists', JSON.stringify(arr));
        const currentUser = getCurrentUser();
        const uid = currentUser && (currentUser.id || currentUser.sub);
        if (!uid) {
            console.warn('[Playlists] No user id - saved locally only');
            return;
        }
        try {
            const result = await sb
                .from('settings')
                .upsert({ id: uid, yt_playlists: arr, updated_at: new Date().toISOString() });
            if (result && result.error) {
                console.error('[Playlists] DB save error:', JSON.stringify(result.error));
                showToast('Playlist save failed', result.error.message || 'Check console for details');
            }
        }
        catch (e) {
            console.error('[Playlists] DB save exception:', e);
            showToast('Playlist save failed', 'Network error - saved locally only');
        }
    }
    function ytRenderList() {
        const list = document.getElementById('youtubePlaylists');
        if (!list)
            return;
        list.innerHTML = '';
        const playlists = ytGetPlaylists();
        playlists.forEach((pl, i) => {
            const row = document.createElement('div');
            row.className = 'yt-playlist-row';
            row.innerHTML =
                '<div><div class="yt-pl-name">' +
                    escapeHtml(pl.name) +
                    '</div>' +
                    '<div class="yt-pl-id">' +
                    escapeHtml(pl.id.slice(0, 20)) +
                    '...</div></div>' +
                    '<button class="yt-pl-remove" data-idx="' +
                    i +
                    '" title="Remove">x</button>';
            list.appendChild(row);
        });
        const st = document.getElementById('youtubeStatus');
        if (st) {
            if (playlists.length) {
                st.textContent =
                    playlists.length + ' playlist' + (playlists.length > 1 ? 's' : '') + ' saved';
                st.className = 'music-service-status connected';
            }
            else {
                st.textContent = 'No playlists saved';
                st.className = 'music-service-status';
            }
        }
        ytRenderSelect();
    }
    function ytRenderSelect() {
        const sel = document.getElementById('stPlaylistSelect');
        if (!sel)
            return;
        const playlists = ytGetPlaylists();
        const prev = sel.value;
        sel.innerHTML = '';
        playlists.forEach((pl) => {
            const opt = document.createElement('option');
            opt.value = pl.id;
            opt.textContent = pl.name;
            sel.appendChild(opt);
        });
        if (prev)
            sel.value = prev;
    }
    function ytExtractId(url) {
        try {
            const u = new URL(url);
            return u.searchParams.get('list') || '';
        }
        catch {
            return '';
        }
    }
    function ytAdd() {
        const nameEl = document.getElementById('ytPlaylistName');
        const urlEl = document.getElementById('ytPlaylistUrl');
        if (!nameEl || !urlEl)
            return;
        const name = nameEl.value.trim() || 'Playlist';
        const id = ytExtractId(urlEl.value.trim());
        if (!id) {
            showToast('Invalid URL', 'Paste a YouTube playlist URL with ?list=...');
            return;
        }
        const playlists = ytGetPlaylists();
        if (playlists.find((p) => p.id === id)) {
            showToast('Already saved', 'This playlist is already in your list');
            return;
        }
        playlists.unshift({ name: name, id: id });
        void ytSavePlaylists(playlists);
        nameEl.value = '';
        urlEl.value = '';
        ytRenderList();
        showToast('Playlist added', 'Saved: ' + name);
    }
    function ytRemove(idx) {
        const playlists = ytGetPlaylists();
        playlists.splice(idx, 1);
        void ytSavePlaylists(playlists);
        ytRenderList();
    }
    window._ytApplyFromDB = function (playlists) {
        if (!Array.isArray(playlists))
            return;
        ytPlaylistsCache = playlists;
        localStorage.setItem('ss_yt_playlists', JSON.stringify(playlists));
        ytRenderList();
        ytRenderSelect();
    };
    window.addEventListener('ss-ready', () => {
        const currentUser = getCurrentUser();
        const earlyUid = (currentUser && currentUser.id) || '';
        if (earlyUid) {
            const earlyType = localStorage.getItem('ss_user_type_' + earlyUid);
            if (earlyType) {
                window._userType = earlyType;
                window._germanTest = localStorage.getItem('ss_german_test_' + earlyUid) || '';
                window._germanLevel = localStorage.getItem('ss_german_level_' + earlyUid) || '';
            }
        }
        applyUserTypeUI();
        const storedToken = localStorage.getItem('ss_sp_token');
        if (storedToken) {
            spToken = storedToken;
            spRefresh = localStorage.getItem('ss_sp_refresh');
            spUpdateUI(true);
            spPollPlayback();
        }
        const params = new URLSearchParams(window.location.search);
        if (params.get('state') === 'spotify_pkce' && params.get('code')) {
            const cid = localStorage.getItem('ss_spotify_cid') || SPOTIFY_CLIENT_ID;
            const code = params.get('code');
            if (cid && code)
                spExchangeCode(code, cid);
        }
        ytRenderList();
        const spBtn = document.getElementById('spotifyConnectBtn');
        if (spBtn)
            spBtn.addEventListener('click', spConnect);
        const spDisc = document.getElementById('spotifyDisconnect');
        if (spDisc)
            spDisc.addEventListener('click', spDisconnect);
        const spPrev = document.getElementById('spotifyPrev');
        if (spPrev) {
            spPrev.addEventListener('click', () => {
                void spApi('me/player/previous', 'POST');
                setTimeout(spPollPlayback, 500);
            });
        }
        const spNext = document.getElementById('spotifyNext');
        if (spNext) {
            spNext.addEventListener('click', () => {
                void spApi('me/player/next', 'POST');
                setTimeout(spPollPlayback, 500);
            });
        }
        const spPP = document.getElementById('spotifyPlayPause');
        if (spPP) {
            spPP.addEventListener('click', () => {
                void spApi('me/player').then((d) => {
                    if (d && d['is_playing'])
                        void spApi('me/player/pause', 'PUT');
                    else
                        void spApi('me/player/play', 'PUT');
                    setTimeout(spPollPlayback, 600);
                });
            });
        }
        const ytAddBtn = document.getElementById('ytSaveBtn');
        if (ytAddBtn)
            ytAddBtn.addEventListener('click', ytAdd);
        const ytList = document.getElementById('ytPlaylistList');
        if (ytList) {
            ytList.addEventListener('click', (e) => {
                const target = e.target;
                const btn = target ? target.closest('.yt-pl-remove') : null;
                if (btn) {
                    const idxAttr = btn.dataset['idx'];
                    if (idxAttr !== undefined)
                        ytRemove(parseInt(idxAttr, 10));
                }
            });
        }
    });
    window._getMusicPlaylistId = function () {
        const sel = document.getElementById('stPlaylistSelect');
        if (sel && sel.value)
            return sel.value;
        const playlists = ytGetPlaylists();
        return playlists.length && playlists[0] ? playlists[0].id : null;
    };
    window._ytRenderSelect = ytRenderSelect;
    document.addEventListener('change', (e) => {
        const target = e.target;
        if (target &&
            target.id === 'stPlaylistSelect' &&
            window._stRunning &&
            window._stMusicSrc === 'youtube') {
            if (typeof window._stStopMusic === 'function')
                window._stStopMusic();
            if (typeof window._stPlayMusic === 'function')
                window._stPlayMusic();
        }
    });
    window._spIsConnected = function () {
        return !!spToken;
    };
    window._spPlayResume = function () {
        void spApi('me/player/play', 'PUT').catch(() => {
            /* ignore */
        });
        setTimeout(spPollPlayback, 800);
    };
}
//# sourceMappingURL=music-services.js.map
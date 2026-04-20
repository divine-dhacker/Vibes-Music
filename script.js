/* ═══════════════════════════════════════════════════════════════════
   MOVIESTREAK — SCRIPT.JS
   Personalized Feed · Genre Discovery Sliders (mid-feed inject)
   Selection Slide (Quick Pick) · IG 9:16 Reel Format
   Global Skeleton System · Adaptive Theme Engine
   Firebase RTDB Listeners Preserved · Component Architecture
   ═══════════════════════════════════════════════════════════════════ */

// ────────────────────────────────────────────────────────────────
// FIREBASE CONFIGURATION
// ────────────────────────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyAd_eJ8Y-rmBLa9dAEXLgT4oaK_PX3pMM",
    authDomain: "moviespark-9663d.firebaseapp.com",
    databaseURL: "https://moviespark-9663d-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "moviespark-9663d",
    storageBucket: "moviespark-9663d.firebasestorage.app",
    messagingSenderId: "827433785766",
    appId: "1:827433785766:web:9b5cb5336011330b3dd767"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

// ────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ────────────────────────────────────────────────────────────────
let currentUserId     = localStorage.getItem('currentUserId');
let currentUserName   = localStorage.getItem('currentUserName');
let currentUserPic    = localStorage.getItem('currentUserPic');

let allMovies          = [];   // full Firebase dataset
let movieUsers         = {};
let currentStreakCount = 0;
let movieDiscoveryPool = [];
let currentDiscoveryMovieKey = null;
let tmdbSearchResults  = [];
let currentEditKey     = null;
let youtubePlayerReady = false;

// Reel pool cache
let cachedReelPool  = [];
let reelPoolFetching = false;

let sessionBlacklist = new Set();
let feedPage = 0;
let searchTimeout;
let discoveryPage = 1;
let isFetchingNextPage = false;
let hasMoreMovies = true;

// Genre sliders injected into feed
const GENRE_INJECT_INTERVAL = 4;    // inject a genre slider every N posts
const REEL_INJECT_INTERVAL  = 7;    // inject a standalone reel every N posts
// Probability that a reel card inside a slider is 9:16 tall format
const IG_REEL_PROBABILITY   = 0.3;  // 30% of video entries go tall/IG

// Genre pools for mid-feed sliders
const FEATURED_GENRES = ['Action', 'Comedy', 'Horror', 'Drama', 'Science Fiction', 'Thriller', 'Animation', 'Romance'];

let currentFilter = JSON.parse(localStorage.getItem('movieFilters')) || {
    genre: 'all',
    sort: 'random',
    myMovies: false,
    watchedMovies: false,
    wannaWatchMovies: false,
    search: ''
};

// ────────────────────────────────────────────────────────────────
// TMDB CONFIG
// ────────────────────────────────────────────────────────────────
const tmdbApiKey         = '05d7badb06e5f091941f127ce4bc8947';
const tmdbBaseUrl        = 'https://api.themoviedb.org/3';
const tmdbImageBase      = 'https://image.tmdb.org/t/p/w500';
const tmdbActorImageBase = 'https://image.tmdb.org/t/p/w185';

const tmdbGenreMap = {
    'Action': 28, 'Adventure': 12, 'Animation': 16, 'Comedy': 35,
    'Crime': 80, 'Documentary': 99, 'Drama': 18, 'Family': 10751,
    'Fantasy': 14, 'History': 36, 'Horror': 27, 'Music': 10402,
    'Mystery': 9648, 'Romance': 10749, 'Science Fiction': 878,
    'Thriller': 53, 'War': 10752, 'Western': 37
};

// ════════════════════════════════════════════════════════════════
// SECTION 1 — SKELETON SYSTEM
// ════════════════════════════════════════════════════════════════

/**
 * Dismiss the global skeleton overlay and reveal real content.
 * Called after Firebase data is ready and DOM is rendered.
 */
function dismissSkeleton() {
    document.body.classList.remove('loading');
    // The CSS transition on .skeleton-overlay and .main-content handles the fade.
}

// ════════════════════════════════════════════════════════════════
// SECTION 2 — ADAPTIVE THEME ENGINE
// ════════════════════════════════════════════════════════════════

function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ms-theme', theme);
    updateThemeToggleIcon(theme);
}

function toggleTheme() {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    showToast(next === 'dark' ? 'OLED Dark mode' : 'Light mode');
}

function updateThemeToggleIcon(theme) {
    const icon = document.getElementById('themeToggleIcon');
    if (icon) icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}

function initSystemThemeListener() {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', (e) => {
        if (!localStorage.getItem('ms-theme')) setTheme(e.matches ? 'dark' : 'light');
    });
}

// ════════════════════════════════════════════════════════════════
// SECTION 3 — YOUTUBE IFrame API
// ════════════════════════════════════════════════════════════════

function onYouTubeIframeAPIReady() { youtubePlayerReady = true; }

async function fetchYouTubeTrailerId(movieTitle, tmdbId = null) {
    try {
        let id = tmdbId;
        if (!id) {
            const r = await fetch(`${tmdbBaseUrl}/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(movieTitle)}`);
            const d = await r.json();
            if (!d.results || !d.results.length) return null;
            id = d.results[0].id;
        }
        const vr   = await fetch(`${tmdbBaseUrl}/movie/${id}/videos?api_key=${tmdbApiKey}`);
        const vd   = await vr.json();
        if (!vd.results) return null;
        const t = vd.results.find(v => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
        return t ? t.key : null;
    } catch { return null; }
}

async function prefetchReelPool(count = 8) {
    if (reelPoolFetching || cachedReelPool.length >= count) return;
    reelPoolFetching = true;
    try {
        const page = Math.floor(Math.random() * 15) + 1;
        const res  = await fetch(`${tmdbBaseUrl}/movie/popular?api_key=${tmdbApiKey}&page=${page}`);
        const data = await res.json();
        const pool = shuffleArray((data.results || []).filter(m => m.poster_path)).slice(0, count * 2);
        const ids  = [];
        for (const movie of pool) {
            if (ids.length >= count) break;
            const vid = await fetchYouTubeTrailerId(movie.title, movie.id);
            if (vid) ids.push({ id: vid, title: movie.title, poster: movie.poster_path ? `${tmdbImageBase}${movie.poster_path}` : null, tmdbId: movie.id });
        }
        cachedReelPool = ids;
    } catch {}
    finally { reelPoolFetching = false; }
}

// ════════════════════════════════════════════════════════════════
// SECTION 4 — FIREBASE REALTIME LISTENERS (preserved intact)
// ════════════════════════════════════════════════════════════════

function loadMovies() {
    const moviesRef = db.ref('movies');
    const usersRef  = db.ref('users');

    usersRef.on('value', userSnap => {
        movieUsers = userSnap.val() || {};

        let maxStreak = 0, streakLeaderId = null;
        Object.entries(movieUsers).forEach(([uid, u]) => {
            const s = u.streak?.count || 0;
            if (s > maxStreak) { maxStreak = s; streakLeaderId = uid; }
        });
        movieUsers.streakLeaderId = streakLeaderId;
        updateStreakDisplay(currentStreakCount);

        moviesRef.limitToLast(10).on('value', movieSnap => {
            allMovies = [];
            const genres = new Set(['All']);

            movieSnap.forEach(child => {
                const movie = { key: child.key, ...child.val() };
                allMovies.push(movie);
                if (movie.genre) movie.genre.split(', ').forEach(g => genres.add(g.trim()));
            });
            // Reverse so newest are at the top for personal interleave
            allMovies.reverse();

            updateGenreFilter(Array.from(genres).sort());

            // Reset and render feed
            feedPage = 0;
            hasMoreMovies = true;
            renderFeed(true).then(() => {
                renderDiscoverySliders();
                dismissSkeleton();
            });

            updateStreak();
        });
    });
}

// ════════════════════════════════════════════════════════════════
// SECTION 5 — PERSONALIZED FEED
// Shows ONLY the current user's own movies + interactions.
// Other users' content lives exclusively in discovery sliders.
// ════════════════════════════════════════════════════════════════

/**
 * Fisher-Yates shuffle
 */
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * Async feed renderer.
 * Prioritizes Discovery-First algorithm: fetches from TMDb and interleaves Personal movies.
 */
async function renderFeed(reset = false) {
    if (isFetchingNextPage) return;
    isFetchingNextPage = true;

    const feed = document.getElementById('feedContainer');
    if (reset) {
        feed.innerHTML = '';
        feedPage = 0;
        discoveryPage = 1;
        hasMoreMovies = true;
    }

    // 1. Fetch Discovery movies from TMDb
    let discoveryItems = [];
    try {
        const page = discoveryPage;
        const res = await fetch(`${tmdbBaseUrl}/discover/movie?api_key=${tmdbApiKey}&page=${page}&sort_by=popularity.desc&include_adult=false`);
        const data = await res.json();
        discoveryItems = (data.results || []).filter(m => m.poster_path && !sessionBlacklist.has(m.id));
        discoveryPage++;
        if (discoveryItems.length === 0) hasMoreMovies = false;
    } catch (e) {
        console.error("Discovery fetch failed", e);
        hasMoreMovies = false;
    }

    // 2. Interleave Personal movies (tracked)
    // We take a few from allMovies (which is limited to latest 20)
    const personal = allMovies.filter(m => !discoveryItems.some(di => di.id === m.tmdbId)).slice(feedPage * 2, (feedPage + 1) * 2);

    // Mix them
    let pageItems = discoveryItems.slice(0, 8).map(m => {
        const tracked = allMovies.find(am => am.tmdbId === m.id);
        if (tracked) return { ...tracked, isTracked: true };
        return {
            name: m.title,
            poster: `${tmdbImageBase}${m.poster_path}`,
            tmdbId: m.id,
            genre: '',
            likes: {}, watchedBy: {}, wannaWatchBy: {},
            isDiscovery: true
        };
    });

    // Inject personal ones at random spots
    personal.forEach(p => {
        const idx = Math.floor(Math.random() * pageItems.length);
        pageItems.splice(idx, 0, { ...p, isTracked: true });
    });

    if (pageItems.length === 0 && reset) {
        feed.appendChild(buildEmptyState());
        isFetchingNextPage = false;
        return;
    }

    if (cachedReelPool.length === 0) prefetchReelPool(8);

    let reelQueue        = shuffleArray([...cachedReelPool]);
    let genreQueue       = shuffleArray([...FEATURED_GENRES]);
    let postIndex        = feedPage * 10;
    let genreSliderCount = Math.floor(postIndex / GENRE_INJECT_INTERVAL);

    for (const movie of pageItems) {
        if (sessionBlacklist.has(movie.tmdbId)) continue;

        // Randomly inject Quick Pick directly into feed
        if (Math.random() < 0.1) {
             const qpContainer = document.createElement('div');
             qpContainer.className = 'quick-pick-in-feed';
             feed.appendChild(qpContainer);
             renderQuickPickInFeed(qpContainer);
        }

        let youtubeId = null;
        if (movie.tmdbId) {
            youtubeId = await fetchYouTubeTrailerId(movie.name, movie.tmdbId);
        }

        const useIgReel = youtubeId && Math.random() < IG_REEL_PROBABILITY;
        const card = createPostCard(movie, { youtubeId, useIgReel });
        feed.appendChild(card);
    observeCardForMemoryManagement(card);
        postIndex++;

        if (postIndex % GENRE_INJECT_INTERVAL === 0) {
            const genre = genreQueue[genreSliderCount % genreQueue.length];
            genreSliderCount++;
            const genreSection = await createFeedGenreSlider(genre);
            if (genreSection) {
                feed.appendChild(genreSection);
                observeCardForMemoryManagement(genreSection);
            }
        }

        if (postIndex % REEL_INJECT_INTERVAL === 0 && reelQueue.length > 0) {
            const reel = reelQueue.shift();
            const reelEl = createInlineFeedReel(reel.id, reel.title);
            feed.appendChild(reelEl);
            observeCardForMemoryManagement(reelEl);
        }
    }

    feedPage++;
    isFetchingNextPage = false;
    setupInfiniteScroll();
}

let scrollObserver;
function setupInfiniteScroll() {
    if (scrollObserver) scrollObserver.disconnect();

    scrollObserver = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && hasMoreMovies && !isFetchingNextPage) {
            renderFeed();
        }
    }, { rootMargin: '200px' });

    const lastChild = document.getElementById('feedContainer').lastElementChild;
    if (lastChild) scrollObserver.observe(lastChild);
}

async function renderQuickPickInFeed(container) {
    container.innerHTML = '<div class="slider-skeleton" style="width:100%; aspect-ratio:16/9;"></div>';
    // Similar to openSelectionSlide but embedded
    try {
        const page = Math.floor(Math.random() * 50) + 1;
        const url  = `${tmdbBaseUrl}/discover/movie?api_key=${tmdbApiKey}&sort_by=popularity.desc&include_adult=false&page=${page}&language=en-US`;
        const res  = await fetch(url);
        const data = await res.json();
        const movies  = shuffleArray((data.results || []).filter(m => m.poster_path)).slice(0, 3);

        container.innerHTML = `
            <div class="section-divider"><span>Quick Pick</span></div>
            <div class="discovery-slider"></div>
        `;
        const slider = container.querySelector('.discovery-slider');
        movies.forEach(m => {
            slider.appendChild(createSliderCard({
                name: m.title, poster: `${tmdbImageBase}${m.poster_path}`,
                genre: '', tmdbId: m.id, isExternalTmdb: true
            }));
        });
    } catch (e) {
        container.remove();
    }
}

// ════════════════════════════════════════════════════════════════
// SECTION 6 — GENRE DISCOVERY SLIDERS (mid-feed injection)
// ════════════════════════════════════════════════════════════════

/**
 * Fetch TMDb movies for a specific genre and return a
 * .feed-genre-section element to be injected into the vertical feed.
 */
async function createFeedGenreSlider(genreName) {
    const genreId = tmdbGenreMap[genreName];
    if (!genreId) return null;

    try {
        const page = Math.floor(Math.random() * 20) + 1;
        const res  = await fetch(
            `${tmdbBaseUrl}/discover/movie?api_key=${tmdbApiKey}&with_genres=${genreId}&sort_by=popularity.desc&include_adult=false&page=${page}&language=en-US`
        );
        const data = await res.json();
        const movies = shuffleArray((data.results || []).filter(m => m.poster_path)).slice(0, 10);
        if (movies.length === 0) return null;

        const section = document.createElement('div');
        section.className = 'feed-genre-section';

        const header = document.createElement('div');
        header.className = 'feed-genre-header';
        header.innerHTML = `
            <div class="feed-genre-title-wrap">
                <span class="feed-genre-name">${escHtml(genreName)}</span>
                <span class="feed-genre-sub">Discover more</span>
            </div>
        `;

        const slider = document.createElement('div');
        slider.className = 'discovery-slider';

        // Grab a reel from cache to inject randomly in the slider
        let reelInjected = false;
        const reelInjectAt = Math.floor(Math.random() * movies.length);

        movies.forEach((movie, idx) => {
            // Inject a reel card at random position in genre slider
            if (!reelInjected && idx === reelInjectAt && cachedReelPool.length > 0) {
                const reel  = cachedReelPool[Math.floor(Math.random() * cachedReelPool.length)];
                const isIg  = Math.random() < IG_REEL_PROBABILITY;
                slider.appendChild(isIg
                    ? createTallReelCard(reel.id, reel.title)
                    : createSliderReelCard(reel.id, reel.title)
                );
                reelInjected = true;
            }

            const existing = allMovies.find(m => m.name === movie.title);
            slider.appendChild(createSliderCard({
                name:           movie.title,
                poster:         `${tmdbImageBase}${movie.poster_path}`,
                genre:          genreName,
                tmdbId:         movie.id,
                key:            existing ? existing.key : null,
                isExternalTmdb: !existing,
                likes:          existing ? existing.likes        : {},
                watchedBy:      existing ? existing.watchedBy    : {},
                wannaWatchBy:   existing ? existing.wannaWatchBy : {}
            }));
        });

        section.append(header, slider);
        return section;
    } catch (e) {
        console.error('Genre slider error:', genreName, e);
        return null;
    }
}

// ════════════════════════════════════════════════════════════════
// SECTION 7 — DISCOVERY SLIDER SECTIONS (top / community / random)
// ════════════════════════════════════════════════════════════════

async function renderDiscoverySliders() {
    await renderTopTrendingSlider();
    renderCommunitySlider();
    await renderRandomDiscoverySlider();
}

async function renderTopTrendingSlider() {
    const slider  = document.getElementById('topDiscoverySlider');
    const section = document.getElementById('topDiscoverySection');
    if (!slider) return;

    slider.innerHTML = '';
    for (let i = 0; i < 5; i++) { const s = document.createElement('div'); s.className = 'slider-skeleton'; slider.appendChild(s); }

    try {
        const page = Math.floor(Math.random() * 20) + 1;
        const res  = await fetch(`${tmdbBaseUrl}/movie/popular?api_key=${tmdbApiKey}&page=${page}`);
        const data = await res.json();
        const movies = shuffleArray((data.results || []).filter(m => m.poster_path)).slice(0, 12);

        slider.innerHTML = '';

        // Inject a tall IG reel at the start of trending
        if (cachedReelPool.length > 0 && Math.random() > 0.5) {
            const reel = cachedReelPool[Math.floor(Math.random() * cachedReelPool.length)];
            slider.appendChild(Math.random() < IG_REEL_PROBABILITY
                ? createTallReelCard(reel.id, reel.title)
                : createSliderReelCard(reel.id, reel.title)
            );
        }

        movies.forEach(movie => {
            const existing = allMovies.find(m => m.name === movie.title);
            slider.appendChild(createSliderCard({
                name: movie.title,
                poster: `${tmdbImageBase}${movie.poster_path}`,
                genre: '', tmdbId: movie.id,
                key: existing ? existing.key : null,
                isExternalTmdb: true,
                likes:        existing ? existing.likes        : {},
                watchedBy:    existing ? existing.watchedBy    : {},
                wannaWatchBy: existing ? existing.wannaWatchBy : {}
            }));
        });
        section.style.display = 'block';
    } catch (e) {
        console.error('Top slider error:', e);
        section.style.display = 'none';
    }
}

function renderCommunitySlider() {
    const slider  = document.getElementById('communityDiscoverySlider');
    const section = document.getElementById('communitySliderSection');
    if (!slider || !section) return;

    if (!currentUserId || allMovies.length < 3) { section.style.display = 'none'; return; }

    let suggestions = allMovies.filter(movie => {
        const h = (movie.likes && movie.likes[currentUserId]) ||
                  (movie.watchedBy && movie.watchedBy[currentUserId]) ||
                  (movie.wannaWatchBy && movie.wannaWatchBy[currentUserId]);
        return !h;
    });

    if (suggestions.length === 0) { section.style.display = 'none'; return; }

    suggestions.forEach(m => { m._score = Object.keys(m.likes || {}).length + Object.keys(m.wannaWatchBy || {}).length * 1.5; });
    suggestions.sort((a, b) => b._score - a._score);
    const top  = suggestions.slice(0, Math.ceil(suggestions.length / 2));
    const rest = suggestions.slice(Math.ceil(suggestions.length / 2));
    suggestions = [...shuffleArray(top), ...shuffleArray(rest)].slice(0, 12);

    slider.innerHTML = '';
    suggestions.forEach(m => slider.appendChild(createSliderCard(m)));
    section.style.display = 'block';
}

async function renderRandomDiscoverySlider() {
    const slider  = document.getElementById('randomDiscoverySlider');
    const section = document.getElementById('randomDiscoverySection');
    if (!slider || !section) return;

    if (Math.random() < 0.4) { section.style.display = 'none'; return; }

    slider.innerHTML = '';
    for (let i = 0; i < 4; i++) { const s = document.createElement('div'); s.className = 'slider-skeleton'; slider.appendChild(s); }

    try {
        const page = Math.floor(Math.random() * 100) + 1;
        const res  = await fetch(`${tmdbBaseUrl}/discover/movie?api_key=${tmdbApiKey}&sort_by=popularity.desc&include_adult=false&page=${page}`);
        const data = await res.json();
        const movies = shuffleArray((data.results || []).filter(m => m.poster_path)).slice(0, 10);

        if (!movies.length) { section.style.display = 'none'; return; }
        slider.innerHTML = '';

        if (cachedReelPool.length > 0 && Math.random() > 0.4) {
            const reel = cachedReelPool[Math.floor(Math.random() * cachedReelPool.length)];
            slider.appendChild(Math.random() < IG_REEL_PROBABILITY
                ? createTallReelCard(reel.id, reel.title)
                : createSliderReelCard(reel.id, reel.title)
            );
        }

        movies.forEach(movie => {
            const existing = allMovies.find(m => m.name === movie.title);
            slider.appendChild(createSliderCard({
                name: movie.title, poster: `${tmdbImageBase}${movie.poster_path}`,
                genre: '', tmdbId: movie.id,
                key: existing ? existing.key : null, isExternalTmdb: true,
                likes:        existing ? existing.likes        : {},
                watchedBy:    existing ? existing.watchedBy    : {},
                wannaWatchBy: existing ? existing.wannaWatchBy : {}
            }));
        });
        section.style.display = 'block';
    } catch { section.style.display = 'none'; }
}

// ════════════════════════════════════════════════════════════════
// SECTION 8 — CARD COMPONENT FUNCTIONS
// ════════════════════════════════════════════════════════════════

/**
 * Compact slider card (9:16 poster)
 */
function createSliderCard(movie) {
    const isWatched    = !!(movie.watchedBy && movie.watchedBy[currentUserId]);
    const isWannaWatch = !!(movie.wannaWatchBy && movie.wannaWatchBy[currentUserId]);
    const isTracked    = isWatched || isWannaWatch;

    const card = document.createElement('div');
    card.className = 'slider-card';
    if (isTracked) card.classList.add('is-tracked');

    const img = document.createElement('img');
    img.className = 'slider-card-poster';
    // Use low-res placeholder then swap to HD
    img.src = movie.poster ? movie.poster.replace('w500', 'w92') : 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=92';
    img.alt = movie.name || '';
    img.loading = 'lazy';

    const hdImage = new Image();
    hdImage.src = movie.poster || 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=300';
    hdImage.onload = () => { img.src = hdImage.src; };

    const xBtn = document.createElement('button');
    xBtn.className = 'not-interested-btn';
    xBtn.innerHTML = '<i class="fas fa-times"></i>';
    xBtn.onclick = (e) => {
        e.stopPropagation();
        sessionBlacklist.add(movie.tmdbId);
        card.classList.add('fadeOut');
        setTimeout(() => card.remove(), 500);
    };
    card.appendChild(xBtn);

    const body = document.createElement('div');
    body.className = 'slider-card-body';

    const titleEl = document.createElement('div');
    titleEl.className = 'slider-card-title truncate';
    titleEl.textContent = movie.name || '';

    const metaEl = document.createElement('div');
    metaEl.className = 'slider-card-meta truncate';
    metaEl.textContent = movie.isExternalTmdb ? 'TMDb' : 'Added';

    body.append(titleEl, metaEl);
    card.append(img, body);

    card.addEventListener('click', () => {
        if (movie.key && !movie.isExternalTmdb) showMovieDetails(movie.key);
        else if (movie.tmdbId) showMovieDetailsFromTmdbId(movie.tmdbId);
    });
    return card;
}

/**
 * Standard 16:9 reel card for use in sliders
 */
function createSliderReelCard(youtubeId, title) {
    const card = document.createElement('div');
    card.className = 'slider-reel-card';
    const iframe = document.createElement('iframe');
    iframe.className = 'slider-reel-frame';
    iframe.src = `https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&enablejsapi=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.loading = 'lazy';

    iframe.onload = () => {
        if (window.YT && YT.Player) {
            new YT.Player(iframe, {
                events: {
                    'onStateChange': (e) => { if (e.data === YT.PlayerState.PLAYING) pauseOtherVideos(iframe); }
                }
            });
        }
    };

    const label = document.createElement('div');
    label.className = 'slider-reel-label truncate';
    label.textContent = title || 'Trailer';
    card.append(iframe, label);
    return card;
}

/**
 * Instagram/TikTok-style TALL 9:16 reel card for sliders.
 * Applied to IG_REEL_PROBABILITY fraction of video entries.
 */
function createTallReelCard(youtubeId, title) {
    const card = document.createElement('div');
    card.className = 'slider-reel-card-tall';

    const badge = document.createElement('div');
    badge.className = 'reel-tall-badge';
    badge.textContent = 'Reel';

    const iframe = document.createElement('iframe');
    iframe.className = 'slider-reel-frame-tall';
    iframe.src = `https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&enablejsapi=1`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.loading = 'lazy';

    iframe.onload = () => {
        if (window.YT && YT.Player) {
            new YT.Player(iframe, {
                events: {
                    'onStateChange': (e) => { if (e.data === YT.PlayerState.PLAYING) pauseOtherVideos(iframe); }
                }
            });
        }
    };

    const label = document.createElement('div');
    label.className = 'reel-tall-label truncate';
    label.textContent = title || 'Trailer';

    card.append(badge, iframe, label);
    return card;
}

/**
 * Full post card — social feed (personalized feed only)
 * @param {Object} movie
 * @param {Object} opts  { youtubeId, useIgReel }
 */
function createPostCard(movie, opts = {}) {
    const { youtubeId = null, useIgReel = false } = opts;

    const isLiked      = !!(movie.likes && movie.likes[currentUserId]);
    const isWatched    = !!(movie.watchedBy && movie.watchedBy[currentUserId]);
    const isWannaWatch = !!(movie.wannaWatchBy && movie.wannaWatchBy[currentUserId]);
    const isTracked    = isWatched || isWannaWatch || movie.isTracked;

    const article = document.createElement('article');
    article.className = 'post-card';
    if (isTracked) article.classList.add('is-tracked');
    article.dataset.key = movie.key || '';
    article.dataset.tmdbId = movie.tmdbId || '';

    const xBtn = document.createElement('button');
    xBtn.className = 'not-interested-btn';
    xBtn.innerHTML = '<i class="fas fa-times"></i>';
    xBtn.onclick = (e) => {
        e.stopPropagation();
        sessionBlacklist.add(movie.tmdbId);
        article.classList.add('fadeOut');
        setTimeout(() => article.remove(), 500);
    };
    article.appendChild(xBtn);

    // ── Media ──
    const media = document.createElement('div');

    if (youtubeId) {
        if (useIgReel) {
            media.className = 'post-media post-media-reel';
            const iframe = document.createElement('iframe');
            iframe.className = 'post-youtube-frame';
            iframe.src = `https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&enablejsapi=1`;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            iframe.allowFullscreen = true; iframe.loading = 'lazy';
            const badge = document.createElement('div');
            badge.className = 'post-reel-badge';
            badge.textContent = 'Reel';
            media.append(iframe, badge);

            iframe.onload = () => {
                const player = new YT.Player(iframe, {
                    events: {
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.PLAYING) {
                                pauseOtherVideos(iframe);
                                trackImplicitInteraction(movie.tmdbId, 'play');
                            }
                        }
                    }
                });
            };
        } else {
            media.className = 'post-media post-media-wide';
            const iframe = document.createElement('iframe');
            iframe.className = 'post-youtube-frame';
            iframe.src = `https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&enablejsapi=1`;
            iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
            iframe.allowFullscreen = true; iframe.loading = 'lazy';
            media.appendChild(iframe);

            iframe.onload = () => {
                const player = new YT.Player(iframe, {
                    events: {
                        'onStateChange': (event) => {
                            if (event.data === YT.PlayerState.PLAYING) {
                                pauseOtherVideos(iframe);
                                trackImplicitInteraction(movie.tmdbId, 'play');
                            }
                        }
                    }
                });
            };
        }
    } else {
        media.className = 'post-media';
        media.addEventListener('click', () => showMovieDetails(movie.key));
        const posterImg = document.createElement('img');
        posterImg.className = 'post-poster';
        // Low-res placeholder
        posterImg.src = movie.poster ? movie.poster.replace('w500', 'w92') : 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=92';
        posterImg.alt = movie.name || ''; posterImg.loading = 'lazy';

        const hdImage = new Image();
        hdImage.src = movie.poster || 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=400';
        hdImage.onload = () => { posterImg.src = hdImage.src; };

        const overlay = document.createElement('div');
        overlay.className = 'post-media-overlay';
        overlay.innerHTML = '<i class="fas fa-expand post-media-play"></i>';
        media.append(posterImg, overlay);
    }

    // ── Caption ──
    const caption = document.createElement('div');
    caption.className = 'post-caption';
    const titleEl = document.createElement('div');
    titleEl.className = 'post-movie-title';
    titleEl.textContent = movie.name || '';
    caption.appendChild(titleEl);

    if (movie.genre) {
        const g = document.createElement('span');
        g.className = 'post-genre-chip';
        g.textContent = movie.genre.split(', ')[0];
        caption.appendChild(g);
    }

    // ── Actions ──
    const actions = document.createElement('div');
    actions.className = 'post-actions';

    const likeBtn = document.createElement('button');
    likeBtn.className = `post-action-btn${isLiked ? ' liked' : ''}`;
    likeBtn.innerHTML = `<i class="fas fa-heart"></i>`;
    likeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(movie.key); });

    const watchedBtn = document.createElement('button');
    watchedBtn.className = `post-action-btn${isWatched ? ' watched-active' : ''}`;
    watchedBtn.innerHTML = `<i class="fas ${isWatched ? 'fa-check-circle' : 'fa-circle'}"></i>`;
    watchedBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleWatched(movie.key); });

    const wannaBtn = document.createElement('button');
    wannaBtn.className = `post-action-btn${isWannaWatch ? ' wanna-active' : ''}`;
    wannaBtn.innerHTML = '<i class="fas fa-bookmark"></i>';
    wannaBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleWannaWatch(movie.key); });

    const spacer = document.createElement('div'); spacer.className = 'post-actions-spacer';

    actions.append(likeBtn, watchedBtn, wannaBtn, spacer);
    article.append(media, caption, actions);
    return article;
}

/**
 * Monitor implicit interactions for Discovery Engine
 */
function trackImplicitInteraction(movieId, type) {
    if (!movieId) return;
    // For now, session-based implicit tracking
    // We can fetch related movies based on this
    fetchRelatedMovies(movieId);
}

async function fetchRelatedMovies(movieId) {
    try {
        const res = await fetch(`${tmdbBaseUrl}/movie/${movieId}/recommendations?api_key=${tmdbApiKey}&language=en-US&page=1`);
        const data = await res.json();
        const related = data.results || [];
        // Inject these into a special slider or the feed
        if (related.length > 0) {
            injectRelatedSlider(related);
        }
    } catch (e) {}
}

function injectRelatedSlider(movies) {
    const feed = document.getElementById('feedContainer');
    const section = document.createElement('div');
    section.className = 'feed-genre-section';
    section.innerHTML = `
        <div class="feed-genre-header">
            <div class="feed-genre-title-wrap">
                <span class="feed-genre-name" style="background:var(--accent-tracked); color:#000;">Because you searched/watched</span>
            </div>
        </div>
        <div class="discovery-slider"></div>
    `;
    const slider = section.querySelector('.discovery-slider');
    movies.slice(0, 10).forEach(m => {
        slider.appendChild(createSliderCard({
            name: m.title, poster: `${tmdbImageBase}${m.poster_path}`,
            genre: '', tmdbId: m.id, isExternalTmdb: true
        }));
    });
    // Insert at current position (top of feed for now)
    feed.insertBefore(section, feed.firstChild);
}

let memoryObserver;

function observeCardForMemoryManagement(el) {
    if (!memoryObserver) {
        memoryObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const target = entry.target;
                if (entry.isIntersecting) {
                    target.style.visibility = 'visible';
                    // Re-enable heavy components if needed
                    const posters = target.querySelectorAll('.post-poster, .slider-card-poster');
                    posters.forEach(p => { if (p.dataset.src) { p.src = p.dataset.src; delete p.dataset.src; } });
                } else {
                    target.style.visibility = 'hidden';
                    // Optimization: offload images but keep DOM structure to preserve listeners
                    const posters = target.querySelectorAll('.post-poster, .slider-card-poster');
                    posters.forEach(p => { if (p.src && !p.dataset.src) { p.dataset.src = p.src; p.src = ''; } });
                }
            });
        }, { rootMargin: '1000px' });
    }
    memoryObserver.observe(el);
}

function pauseOtherVideos(currentIframe) {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iface => {
        if (iface !== currentIframe && iface.contentWindow) {
            iface.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
        }
    });
}

function makeMenuBtn(iconClass, title, handler) {
    const btn = document.createElement('button');
    btn.className = 'post-menu-btn';
    btn.title = title;
    btn.innerHTML = `<i class="fas ${iconClass}"></i>`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
    return btn;
}

function createInlineFeedReel(youtubeId, title) {
    const card = document.createElement('div');
    card.className = 'discovery-reel-card';
    card.innerHTML = `
        <div class="discovery-reel-label"><i class="fas fa-play-circle"></i> Discovery Reel</div>
        <iframe class="discovery-reel-frame" src="https://www.youtube.com/embed/${youtubeId}?rel=0&modestbranding=1&enablejsapi=1"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen loading="lazy"></iframe>
        <div class="discovery-reel-title">${escHtml(title)}</div>
    `;
    const iframe = card.querySelector('iframe');
    iframe.onload = () => {
        if (window.YT && YT.Player) {
            new YT.Player(iframe, {
                events: {
                    'onStateChange': (e) => { if (e.data === YT.PlayerState.PLAYING) pauseOtherVideos(iframe); }
                }
            });
        }
    };
    return card;
}

function buildEmptyState() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML = `<i class="fas fa-film"></i><strong>Your feed is empty.</strong><br>Search for a movie above to start tracking, or use Quick Pick to discover new films.`;
    return div;
}

// ════════════════════════════════════════════════════════════════
// SECTION 9 — SELECTION SLIDE (Quick Pick)
// Fullscreen swipe interface for rapid movie triage.
// Touch + mouse drag support.
// ════════════════════════════════════════════════════════════════

let selPool          = [];   // pool of TMDb movies to swipe through
let selIndex         = 0;
let selTotal         = 0;
const SEL_POOL_SIZE  = 20;

// Drag state
let selDragStart     = null;
let selDragCurrent   = null;
let selIsDragging    = false;

async function openSelectionSlide() {
    selPool  = [];
    selIndex = 0;
    document.getElementById('selSlideCounter').textContent = 'Loading...';
    document.getElementById('selCardTitle').textContent   = 'Finding Movies...';
    document.getElementById('selCardGenre').textContent   = '';
    document.getElementById('selPosterImg').src = 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=400';

    document.getElementById('selectionSlideModal').classList.add('visible');

    try {
        const page = Math.floor(Math.random() * 50) + 1;
        const gid  = currentFilter.genre !== 'all' ? (tmdbGenreMap[currentFilter.genre] || '') : '';
        const url  = `${tmdbBaseUrl}/discover/movie?api_key=${tmdbApiKey}&sort_by=popularity.desc&include_adult=false&page=${page}&language=en-US${gid ? `&with_genres=${gid}` : ''}`;
        const res  = await fetch(url);
        const data = await res.json();
        selPool  = shuffleArray((data.results || []).filter(m => m.poster_path)).slice(0, SEL_POOL_SIZE);
        selTotal = selPool.length;

        if (!selPool.length) { showToast('No movies found.'); closeSelectionSlide(); return; }
        renderSelCard();
    } catch (e) {
        console.error('Selection slide error:', e);
        showToast('Error loading movies.');
        closeSelectionSlide();
    }
}

function closeSelectionSlide() {
    document.getElementById('selectionSlideModal').classList.remove('visible');
    selPool = []; selIndex = 0; selIsDragging = false; selDragStart = null;
}

function renderSelCard() {
    if (selIndex >= selPool.length) {
        showToast('All caught up! 🎬');
        closeSelectionSlide();
        return;
    }

    const movie   = selPool[selIndex];
    const card    = document.getElementById('selCurrentCard');
    const counter = document.getElementById('selSlideCounter');

    counter.textContent = `${selIndex + 1} / ${selTotal}`;

    // Update progress bar
    let progressBar = document.querySelector('.sel-progress-fill');
    if (!progressBar) {
        const bar = document.createElement('div');
        bar.className = 'sel-progress-bar';
        const fill = document.createElement('div');
        fill.className = 'sel-progress-fill';
        bar.appendChild(fill);
        document.querySelector('.sel-card-stage').insertBefore(bar, document.querySelector('.sel-card-stage').firstChild);
        progressBar = fill;
    }
    progressBar.style.width = `${((selIndex) / selTotal) * 100}%`;

    // Animate card entry
    card.classList.remove('exit-left', 'exit-right', 'exit-up', 'entering');
    void card.offsetWidth; // force reflow
    card.classList.add('entering');
    card.style.transform = '';
    card.style.opacity   = '';

    // Remove all drag hint classes
    card.classList.remove('dragging-left', 'dragging-right', 'dragging-up');

    // Populate content
    document.getElementById('selPosterImg').src    = `${tmdbImageBase}${movie.poster_path}`;
    document.getElementById('selCardTitle').textContent = movie.title;
    const genreNames = (movie.genre_ids || []).map(id =>
        Object.keys(tmdbGenreMap).find(k => tmdbGenreMap[k] === id)
    ).filter(Boolean).slice(0, 2).join(' · ');
    document.getElementById('selCardGenre').textContent = genreNames || '';

    // Remove entering class after animation
    setTimeout(() => card.classList.remove('entering'), 280);

    // Attach drag events
    attachSelDrag(card);
}

function attachSelDrag(card) {
    // Remove old listeners by cloning
    const newCard = card.cloneNode(true);
    card.parentNode.replaceChild(newCard, card);
    const c = document.getElementById('selCurrentCard');

    // Re-attach poster image reference
    document.getElementById('selPosterImg').src = selPool[selIndex]
        ? `${tmdbImageBase}${selPool[selIndex].poster_path}`
        : '';

    // Mouse
    c.addEventListener('mousedown', selDragBegin, { passive: true });
    window.addEventListener('mousemove', selDragMove, { passive: true });
    window.addEventListener('mouseup', selDragEnd);

    // Touch
    c.addEventListener('touchstart', selDragBegin, { passive: true });
    c.addEventListener('touchmove', selDragMove, { passive: true });
    c.addEventListener('touchend', selDragEnd, { passive: true });
}

function selGetXY(e) {
    if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

function selDragBegin(e) {
    selDragStart   = selGetXY(e);
    selDragCurrent = selGetXY(e);
    selIsDragging  = true;
}

function selDragMove(e) {
    if (!selIsDragging || !selDragStart) return;
    selDragCurrent = selGetXY(e);
    const dx = selDragCurrent.x - selDragStart.x;
    const dy = selDragCurrent.y - selDragStart.y;
    const card = document.getElementById('selCurrentCard');

    card.style.transform  = `translate(${dx}px, ${dy}px) rotate(${dx * 0.06}deg)`;
    card.style.transition = 'none';

    // Show hints
    card.classList.remove('dragging-left', 'dragging-right', 'dragging-up');
    if (Math.abs(dy) < 60) {
        if (dx < -40) card.classList.add('dragging-left');
        if (dx >  40) card.classList.add('dragging-right');
    } else {
        if (dy < -40) card.classList.add('dragging-up');
    }
}

function selDragEnd() {
    if (!selIsDragging || !selDragStart || !selDragCurrent) return;
    selIsDragging = false;

    const dx = selDragCurrent.x - selDragStart.x;
    const dy = selDragCurrent.y - selDragStart.y;

    selDragStart   = null;
    selDragCurrent = null;

    const card = document.getElementById('selCurrentCard');
    card.style.transition = '';

    const THRESHOLD = 80;

    if (Math.abs(dy) > THRESHOLD && dy < 0 && Math.abs(dy) > Math.abs(dx)) {
        // Swipe UP = watched
        selAction('watched');
    } else if (dx < -THRESHOLD) {
        // Swipe LEFT = skip
        selAction('skip');
    } else if (dx > THRESHOLD) {
        // Swipe RIGHT = watchlist
        selAction('wanna');
    } else {
        // Snap back
        card.style.transform = '';
        card.classList.remove('dragging-left', 'dragging-right', 'dragging-up');
    }
}

async function selAction(action) {
    if (selIndex >= selPool.length) return;
    const movie = selPool[selIndex];
    const card  = document.getElementById('selCurrentCard');

    // Exit animation
    if (action === 'watched') card.classList.add('exit-up');
    else if (action === 'wanna') card.classList.add('exit-right');
    else card.classList.add('exit-left');

    // Update progress fill
    const fill = document.querySelector('.sel-progress-fill');
    if (fill) fill.style.width = `${((selIndex + 1) / selTotal) * 100}%`;

    // Firebase update
    if (action !== 'skip' && currentUserId) {
        const existing = allMovies.find(m => m.name === movie.title);
        if (existing) {
            if (action === 'watched')      toggleWatched(existing.key);
            else if (action === 'wanna')   toggleWannaWatch(existing.key);
        } else {
            const details = await fetchMovieDetailsFromTMDb(movie.id);
            const entry = {
                name: details.name, poster: details.poster, genre: details.genre,
                plot: details.plot, actors: details.actors, tmdbId: movie.id,
                owner: currentUserId, ownerName: currentUserName, ownerPic: currentUserPic,
                likes: {}, watchedBy: {}, wannaWatchBy: {}, lastUpdated: Date.now()
            };
            if (action === 'watched')    entry.watchedBy[currentUserId]    = true;
            if (action === 'wanna')      entry.wannaWatchBy[currentUserId] = true;
            await db.ref('movies').push(entry);
        }
        showToast(action === 'watched' ? `Marked "${movie.title}" watched ✓` : `Added "${movie.title}" to watchlist →`);
        updateStreak(true);
    }

    selIndex++;
    await delay(300); // wait for exit animation
    renderSelCard();
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ════════════════════════════════════════════════════════════════
// SECTION 10 — SEARCH & SUGGESTIONS
// ════════════════════════════════════════════════════════════════

const movieNameInput  = document.getElementById('movieName');
const suggestionsList = document.getElementById('suggestionsList');

movieNameInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = movieNameInput.value.trim();
    if (q.length < 2) { suggestionsList.style.display = 'none'; return; }
    searchTimeout = setTimeout(() => searchMoviesTMDb(q), 500);
});

movieNameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitMovie(); });

async function searchMoviesTMDb(query) {
    try {
        const res  = await fetch(`${tmdbBaseUrl}/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(query)}`);
        const data = await res.json();
        tmdbSearchResults = data.results || [];
        displaySuggestions(tmdbSearchResults, query);
    } catch { }
}

function displaySuggestions(results, query) {
    suggestionsList.innerHTML = '';
    const lq = query.toLowerCase();
    if (!results.length) { suggestionsList.style.display = 'none'; return; }

    results.sort((a, b) => {
        const aE = a.title.toLowerCase() === lq;
        const bE = b.title.toLowerCase() === lq;
        return aE === bE ? 0 : aE ? -1 : 1;
    });

    results.slice(0, 6).forEach(movie => {
        const li   = document.createElement('li');
        li.addEventListener('click', () => selectSuggestion(movie));
        const img  = document.createElement('img');
        img.src    = movie.poster_path ? `${tmdbImageBase}${movie.poster_path}` : 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=200';
        img.alt    = movie.title;
        const info = document.createElement('div');
        info.className = 'suggestion-info';
        const year = movie.release_date ? movie.release_date.slice(0, 4) : '';
        info.innerHTML = `<span class="suggestion-title">${escHtml(movie.title)}${year ? ` <span style="color:var(--text-tertiary);font-weight:400">${year}</span>` : ''}</span><span class="suggestion-meta">${movie.vote_average ? `★ ${movie.vote_average.toFixed(1)}` : 'No rating'}</span>`;
        li.append(img, info);
        suggestionsList.appendChild(li);
    });
    suggestionsList.style.display = 'block';
}

async function selectSuggestion(movie) {
    const existing = allMovies.find(m => m.name === movie.title);
    if (existing) { showToast(`"${movie.title}" is already in your feed.`); movieNameInput.value = ''; suggestionsList.style.display = 'none'; return; }
    const details = await fetchMovieDetailsFromTMDb(movie.id);
    await db.ref('movies').push({
        name: movie.title, poster: details.poster, genre: details.genre,
        plot: details.plot, actors: details.actors, tmdbId: movie.id,
        owner: currentUserId, ownerName: currentUserName, ownerPic: currentUserPic,
        likes: {}, watchedBy: {}, wannaWatchBy: {}, lastUpdated: Date.now()
    }).then(() => {
        showToast(`"${movie.title}" added.`);
        addActivity(`added <strong>${escHtml(movie.title)}</strong>`);
        movieNameInput.value = '';
        suggestionsList.style.display = 'none';
        updateStreak(true);
    }).catch(() => showToast('Error adding movie.'));
}

function submitMovie() {
    const val = movieNameInput.value.trim();
    if (!val) return;
    const match = tmdbSearchResults.find(m => m.title.toLowerCase() === val.toLowerCase());
    if (match) selectSuggestion(match);
    else searchMoviesTMDb(val).then(() => {
        if (tmdbSearchResults.length > 0) selectSuggestion(tmdbSearchResults[0]);
        else showToast('No movie found.');
    });
}

// ════════════════════════════════════════════════════════════════
// SECTION 11 — DATABASE PURGE
// ════════════════════════════════════════════════════════════════

function confirmPurgeMovies() { closeFilterPanel(); document.getElementById('purgeModal').classList.add('visible'); }

async function purgeMoviesDatabase() {
    try {
        await db.ref('movies').remove();
        closeModal('purgeModal');
        showToast('All movies cleared. User data intact.');
        addActivity('purged the movie database');
        allMovies = [];
        renderFeed();
        renderDiscoverySliders();
    } catch { showToast('Error purging movies.'); }
}

// ════════════════════════════════════════════════════════════════
// SECTION 12 — FIREBASE MUTATIONS
// ════════════════════════════════════════════════════════════════

function toggleLike(movieKey) {
    db.ref(`movies/${movieKey}/likes`).once('value', snap => {
        const likes = snap.val() || {};
        const movie = allMovies.find(m => m.key === movieKey);
        if (likes[currentUserId]) { delete likes[currentUserId]; showToast('Like removed.'); }
        else { likes[currentUserId] = true; showToast('Liked ♥'); addActivity(`liked <strong>${escHtml(movie?.name || '')}</strong>`); updateStreak(true); }
        db.ref(`movies/${movieKey}`).update({ likes, lastUpdated: Date.now() });
    });
}

function toggleWatched(movieKey) {
    db.ref(`movies/${movieKey}`).once('value', snap => {
        const movie = snap.val() || {};
        const wb    = movie.watchedBy || {};
        if (wb[currentUserId]) { delete wb[currentUserId]; showToast('Removed from watched.'); }
        else { wb[currentUserId] = true; showToast('Marked as watched ✓'); addActivity(`watched <strong>${escHtml(movie.name || '')}</strong>`); updateStreak(true); }
        db.ref(`movies/${movieKey}`).update({ watchedBy: wb, lastUpdated: Date.now() });
    });
}

function toggleWannaWatch(movieKey) {
    db.ref(`movies/${movieKey}`).once('value', snap => {
        const movie = snap.val() || {};
        const wb    = movie.wannaWatchBy || {};
        if (wb[currentUserId]) { delete wb[currentUserId]; showToast('Removed from watchlist.'); }
        else { wb[currentUserId] = true; showToast('Added to watchlist →'); addActivity(`added <strong>${escHtml(movie.name || '')}</strong> to watchlist`); updateStreak(true); }
        db.ref(`movies/${movieKey}`).update({ wannaWatchBy: wb, lastUpdated: Date.now() });
    });
}

// ════════════════════════════════════════════════════════════════
// SECTION 13 — EDIT / DELETE
// ════════════════════════════════════════════════════════════════

function editMovieName(key, name) { currentEditKey = key; document.getElementById('editNameInput').value = name; document.getElementById('editNameModal').classList.add('visible'); }
function confirmNameEdit() { const n = document.getElementById('editNameInput').value.trim(); if (currentEditKey && n) db.ref(`movies/${currentEditKey}`).update({ name: n, lastUpdated: Date.now() }).then(() => { closeModal('editNameModal'); showToast('Title updated.'); }); }
function editMoviePoster(key) { currentEditKey = key; document.getElementById('editPosterUrlInput').value = ''; document.getElementById('posterPreview').src = ''; document.getElementById('editPosterModal').classList.add('visible'); }
function previewPoster(e) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { document.getElementById('posterPreview').src = ev.target.result; }; r.readAsDataURL(f); }
function confirmPosterEdit() { const u = document.getElementById('editPosterUrlInput').value.trim(); const p = document.getElementById('posterPreview').src; if (u) saveNewPoster(u); else if (p && p !== window.location.href) saveNewPoster(p); else showToast('Provide a URL or upload a file.'); }
function saveNewPoster(url) { if (!currentEditKey) return; db.ref(`movies/${currentEditKey}`).update({ poster: url, lastUpdated: Date.now() }).then(() => { closeModal('editPosterModal'); showToast('Poster updated.'); }); }
function showDeleteConfirm(key) { document.getElementById('confirmModal').classList.add('visible'); document.getElementById('confirmDeleteButton').onclick = () => deleteMovie(key); }
function deleteMovie(key) { db.ref(`movies/${key}`).remove().then(() => { closeModal('confirmModal'); showToast('Post deleted.'); addActivity('deleted a movie'); }).catch(() => showToast('Error deleting.')); }
function closeModal(id) {
    document.getElementById(id).classList.remove('visible');
    currentEditKey = null;
    if (id === 'movieDetailsModal') {
        document.getElementById('detailTrailerFrame').src = '';
    }
}

// ════════════════════════════════════════════════════════════════
// SECTION 14 — MOVIE DETAILS MODAL
// ════════════════════════════════════════════════════════════════

async function showMovieDetailsFromTmdbId(tmdbId) {
    const details = await fetchMovieDetailsFromTMDb(tmdbId);
    renderDetails(details, tmdbId);
}

async function showMovieDetails(movieKey) {
    const movie = allMovies.find(m => m.key === movieKey);
    if (!movie) return;
    renderDetails(movie, movie.tmdbId);
}

async function renderDetails(data, tmdbId) {
    document.getElementById('detailTitle').textContent       = data.name || data.title || '';
    document.getElementById('detailPoster').src              = data.poster || '';
    document.getElementById('detailDescription').textContent = data.plot || 'No description available.';
    document.getElementById('detailGenre').textContent       = data.genre || 'Unknown';

    const castList = document.getElementById('castList');
    const castSection = document.getElementById('castSection');
    castList.innerHTML = '';
    if (data.actors && data.actors.length > 0) {
        castSection.style.display = 'block';
        for (const actor of data.actors) {
            const url = await fetchActorProfile(actor);
            const el = document.createElement('div'); el.className = 'cast-member';
            el.innerHTML = `<img src="${url}" alt="${escHtml(actor)}" loading="lazy"><span>${escHtml(actor)}</span>`;
            castList.appendChild(el);
        }
    } else castSection.style.display = 'none';

    const trailerSection = document.getElementById('trailerSection');
    const trailerFrame = document.getElementById('detailTrailerFrame');
    const youtubeId = await fetchYouTubeTrailerId(data.name || data.title, tmdbId);
    if (youtubeId) {
        trailerSection.style.display = 'block';
        trailerFrame.src = `https://www.youtube.com/embed/${youtubeId}?rel=0`;
    } else {
        trailerSection.style.display = 'none';
        trailerFrame.src = '';
    }

    document.getElementById('movieDetailsModal').classList.add('visible');
}

// ════════════════════════════════════════════════════════════════
// SECTION 15 — TMDB HELPERS
// ════════════════════════════════════════════════════════════════

async function fetchMovieDetailsFromTMDb(tmdbId) {
    try {
        const res  = await fetch(`${tmdbBaseUrl}/movie/${tmdbId}?api_key=${tmdbApiKey}&append_to_response=credits`);
        const data = await res.json();
        return {
            name:   data.title,
            poster: data.poster_path ? `${tmdbImageBase}${data.poster_path}` : 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=400',
            genre:  (data.genres || []).map(g => g.name).join(', ') || 'Unknown',
            plot:   data.overview || 'No description available.',
            actors: (data.credits?.cast || []).slice(0, 5).map(a => a.name)
        };
    } catch { return { name: 'Unknown', poster: 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=400', genre: 'Unknown', plot: '', actors: [] }; }
}

async function fetchActorProfile(name) {
    try {
        const res  = await fetch(`${tmdbBaseUrl}/search/person?api_key=${tmdbApiKey}&query=${encodeURIComponent(name)}`);
        const data = await res.json();
        const p    = data.results?.[0]?.profile_path;
        return p ? `${tmdbActorImageBase}${p}` : generateAvatarUrl(name);
    } catch { return generateAvatarUrl(name); }
}

// ════════════════════════════════════════════════════════════════
// SECTION 16 — GENRE FILTER UI
// ════════════════════════════════════════════════════════════════

function updateGenreFilter(genres) {
    const sel = document.getElementById('genreFilter');
    const prev = sel.value;
    sel.innerHTML = '';
    genres.forEach(g => { const o = document.createElement('option'); o.value = g.toLowerCase(); o.textContent = g; sel.appendChild(o); });
    sel.value = prev || currentFilter.genre;
}

// ════════════════════════════════════════════════════════════════
// SECTION 17 — ACTIVITY FEED
// ════════════════════════════════════════════════════════════════

function addActivity(message) {
    const list = document.getElementById('activityList');
    const item = document.createElement('div');
    item.className = 'activity-item';
    item.innerHTML = `<i class="fas fa-user-circle"></i><span>You ${message}</span><span class="time">${timeSince(Date.now())} ago</span>`;
    list.insertBefore(item, list.firstChild);
    while (list.children.length > 10) list.removeChild(list.lastChild);
}

// ════════════════════════════════════════════════════════════════
// SECTION 18 — STREAK / GAMIFICATION
// ════════════════════════════════════════════════════════════════

function updateStreak(actionTaken = false) {
    if (!currentUserId) return;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayStr = today.toDateString();
    const oneDayMs = 86400000;

    db.ref(`users/${currentUserId}/streak`).once('value', snap => {
        let streak = snap.val() || { count: 0, lastDate: null };
        const last = streak.lastDate ? new Date(streak.lastDate) : null;

        if (actionTaken) {
            if (last && last.toDateString() === todayStr) {}
            else if (last && (today - last) < oneDayMs * 2) { streak.count++; streak.lastDate = todayStr; checkMilestones(streak.count); showToast(`🔥 ${streak.count} day streak!`, 'colorful'); }
            else { streak.count = 1; streak.lastDate = todayStr; showToast('New streak started!', 'colorful'); }
        } else {
            if (!last || (today - last) >= oneDayMs * 2) { if (streak.count > 0) showToast(`Streak of ${streak.count} lost.`, 'streak-reset'); streak.count = 0; }
        }

        currentStreakCount = streak.count;
        db.ref(`users/${currentUserId}/streak`).set(streak);
        updateStreakDisplay(streak.count);
    });
}

function updateStreakDisplay(count) {
    document.getElementById('streakCountModal').textContent = count;
    const fire = document.getElementById('streakFireIcon');
    fire.className = 'fas fa-fire streak-fire';
    if (count >= 30)      fire.classList.add('streak-level-30');
    else if (count >= 15) fire.classList.add('streak-level-15');
    else if (count >= 7)  fire.classList.add('streak-level-7');
    const boost = document.getElementById('discoveryBoostBtn');
    if (boost) boost.style.display = count >= 7 ? 'flex' : 'none';
    if (count >= 7)   document.getElementById('badge-7')?.classList.add('unlocked');
    if (count >= 30)  document.getElementById('badge-30')?.classList.add('unlocked');
    if (count >= 100) document.getElementById('badge-100')?.classList.add('unlocked');
}

function checkMilestones(count) {
    if (count === 7)   showToast('Milestone: 7-Day Streak 🎉', 'streak-milestone');
    if (count === 30)  showToast('Milestone: 30-Day Streak 🏆', 'streak-milestone');
    if (count === 100) showToast('Milestone: 100-Day Streak 👑', 'streak-milestone');
}

// ════════════════════════════════════════════════════════════════
// SECTION 19 — DISCOVERY GAME
// ════════════════════════════════════════════════════════════════

async function fetchRandomMoviesFromTMDb(count = 10) {
    const page = Math.floor(Math.random() * 50) + 1;
    const gid  = currentFilter.genre !== 'all' ? (tmdbGenreMap[currentFilter.genre] || '') : '';
    const url  = `${tmdbBaseUrl}/discover/movie?api_key=${tmdbApiKey}&sort_by=popularity.desc&include_adult=false&page=${page}&language=en-US${gid ? `&with_genres=${gid}` : ''}`;
    try {
        const res = await fetch(url);
        const d   = await res.json();
        movieDiscoveryPool = shuffleArray((d.results || []).filter(m => m.poster_path)).slice(0, count);
        if (movieDiscoveryPool.length) loadNextDiscoveryMovie();
        else { showToast('No movies found.'); closeDiscoveryGame(); }
    } catch { showToast('Error fetching movies.'); closeDiscoveryGame(); }
}

async function startDiscoveryGame(extra = 0) {
    movieDiscoveryPool = [];
    document.getElementById('gameMovieTitle').textContent = 'Finding Movies...';
    document.getElementById('gameMoviePoster').src = 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=400';
    document.getElementById('discoveryGameModal').classList.add('visible');
    await fetchRandomMoviesFromTMDb(10 + extra);
}

function loadNextDiscoveryMovie() {
    if (!movieDiscoveryPool.length) { showToast('All done! Check back later.'); closeDiscoveryGame(); return; }
    const movie = movieDiscoveryPool.shift();
    currentDiscoveryMovieKey = movie.id;
    document.getElementById('gameMoviePoster').src = movie.poster_path ? `${tmdbImageBase}${movie.poster_path}` : 'https://images.unsplash.com/photo-1596727147705-61849a613f17?q=80&w=400';
    document.getElementById('gameMovieTitle').textContent = movie.title;
}

async function handleGameAction(action) {
    if (!currentDiscoveryMovieKey) return;
    const movieName = document.getElementById('gameMovieTitle').textContent;
    const existing  = allMovies.find(m => m.name === movieName);
    if (existing) {
        if (action === 'watched') toggleWatched(existing.key);
        else if (action === 'wanna-watch') toggleWannaWatch(existing.key);
    } else if (action !== 'not-interested') {
        const details = await fetchMovieDetailsFromTMDb(currentDiscoveryMovieKey);
        await db.ref('movies').push({
            name: details.name, poster: details.poster, genre: details.genre,
            plot: details.plot, actors: details.actors, tmdbId: currentDiscoveryMovieKey,
            owner: currentUserId, ownerName: currentUserName, ownerPic: currentUserPic,
            likes: {},
            watchedBy:    action === 'watched'      ? { [currentUserId]: true } : {},
            wannaWatchBy: action === 'wanna-watch'  ? { [currentUserId]: true } : {},
            lastUpdated: Date.now()
        });
        showToast(`"${details.name}" added.`);
    }
    updateStreak(true);
    loadNextDiscoveryMovie();
}

function closeDiscoveryGame() { document.getElementById('discoveryGameModal').classList.remove('visible'); currentDiscoveryMovieKey = null; movieDiscoveryPool = []; }

// ════════════════════════════════════════════════════════════════
// SECTION 20 — SHARE
// ════════════════════════════════════════════════════════════════

function shareContent(text, url) { if (navigator.share) navigator.share({ title: 'MovieStreak', text, url }).catch(() => {}); else prompt('Copy this link:', url); }
function shareFirebaseMovie(name) { shareContent(`Check out "${name}" on MovieStreak!`, window.location.href); }

// ════════════════════════════════════════════════════════════════
// SECTION 21 — TOAST
// ════════════════════════════════════════════════════════════════

let _t1, _t2;
function showToast(message, type = 'normal') {
    const t = document.getElementById('toast');
    t.innerHTML = message;
    t.className = 'toast';
    if (type === 'colorful')         t.classList.add('colorful');
    if (type === 'streak-reset')     t.classList.add('streak-reset');
    if (type === 'streak-milestone') t.classList.add('streak-milestone');
    t.style.display = 'block'; t.style.opacity = '1';
    clearTimeout(_t1); clearTimeout(_t2);
    _t1 = setTimeout(() => { t.style.opacity = '0'; }, 2600);
    _t2 = setTimeout(() => { t.style.display = 'none'; }, 3100);
}

// ════════════════════════════════════════════════════════════════
// SECTION 22 — FILTER PANEL
// ════════════════════════════════════════════════════════════════

function saveFilters() { localStorage.setItem('movieFilters', JSON.stringify(currentFilter)); }
function openFilterPanel()  { document.getElementById('filtersPanel').classList.add('open'); document.getElementById('panelOverlay').classList.add('visible'); }
function closeFilterPanel() { document.getElementById('filtersPanel').classList.remove('open'); document.getElementById('panelOverlay').classList.remove('visible'); }

function resetFilters() {
    currentFilter = { genre: 'all', sort: 'random', myMovies: false, watchedMovies: false, wannaWatchMovies: false, search: '' };
    saveFilters(); initFilterUI(); renderFeed(); showToast('Filters reset.');
}

function initFilterUI() {
    document.getElementById('genreFilter').value  = currentFilter.genre;
    document.getElementById('sortOptions').value  = currentFilter.sort;
    document.getElementById('searchBox').value    = currentFilter.search;
    document.getElementById('myMoviesButton').classList.toggle('active', currentFilter.myMovies);
    document.getElementById('watchedMoviesButton').classList.toggle('active', currentFilter.watchedMovies);
    document.getElementById('wannaWatchMoviesButton').classList.toggle('active', currentFilter.wannaWatchMovies);
}

// ════════════════════════════════════════════════════════════════
// SECTION 23 — AUTH
// ════════════════════════════════════════════════════════════════

function showLoginModal()  { document.getElementById('loginModal').classList.add('visible'); }
function closeLoginModal() { document.getElementById('loginModal').classList.remove('visible'); }
function showProfileModal() { if (!currentUserId) return; document.getElementById('profilePicModal').src = currentUserPic || ''; document.getElementById('profileNameModal').textContent = currentUserName || ''; document.getElementById('streakCountModal').textContent = currentStreakCount; document.getElementById('profileModal').classList.add('visible'); }

function showMainAppUI() {
    const pic = currentUserPic || generateAvatarUrl(currentUserName || 'User');
    const nav  = document.getElementById('profileIcon');
    const navi = document.getElementById('navProfileIcon');
    nav.src = pic; nav.style.display = 'block'; if (navi) navi.style.display = 'none';
    const mob  = document.getElementById('mobileProfileIcon');
    const mobi = document.getElementById('mobileNavProfileIcon');
    if (mob) { mob.src = pic; mob.style.display = 'block'; }
    if (mobi) mobi.style.display = 'none';
    const ca = document.getElementById('composerAvatar');
    if (ca) ca.src = pic;
    const inp = document.getElementById('movieName');
    if (inp && currentUserName) inp.placeholder = `What did you watch today, ${currentUserName}?`;
}

function logout() { localStorage.removeItem('currentUserId'); localStorage.removeItem('currentUserName'); localStorage.removeItem('currentUserPic'); location.reload(); }
function previewProfilePic(e) { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { document.getElementById('profilePicPreview').src = ev.target.result; }; r.readAsDataURL(f); }

async function handleLoginButtonClick() {
    const name     = document.getElementById('loginNameInput').value.trim();
    const password = document.getElementById('loginPasswordInput').value.trim();
    const picFile  = document.getElementById('profilePicFile').files[0];
    if (!name || !password) { showToast('Please enter name and password.'); return; }

    const snap = await db.ref('users').orderByChild('name').equalTo(name).once('value');
    if (snap.exists()) {
        const data = snap.val(); const key = Object.keys(data)[0]; const user = data[key];
        if (user.password === password) {
            currentUserId = key; currentUserName = user.name; currentUserPic = user.picUrl;
            _persistUser(); closeLoginModal(); loadMovies(); showMainAppUI(); showToast(`Welcome back, ${currentUserName}.`);
        } else showToast('Incorrect password.');
    } else {
        let newPic = generateAvatarUrl(name);
        if (picFile) { const r = new FileReader(); r.onload = async ev => { await createUser(name, password, ev.target.result); }; r.readAsDataURL(picFile); }
        else await createUser(name, password, newPic);
    }
}

async function createUser(name, password, picUrl) {
    const ref = db.ref('users').push();
    await ref.set({ name, password, picUrl, streak: { count: 0, lastDate: null } });
    currentUserId = ref.key; currentUserName = name; currentUserPic = picUrl;
    _persistUser(); closeLoginModal(); loadMovies(); showMainAppUI(); showToast(`Welcome, ${currentUserName}.`);
}

function _persistUser() { localStorage.setItem('currentUserId', currentUserId); localStorage.setItem('currentUserName', currentUserName); localStorage.setItem('currentUserPic', currentUserPic); }
function generateAvatarUrl(name) { return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=111&color=fff&size=128&bold=true&font-size=0.5`; }

// ════════════════════════════════════════════════════════════════
// SECTION 24 — UTILITIES
// ════════════════════════════════════════════════════════════════

function timeSince(date) {
    if (!date) return 'just now';
    const s = Math.floor((Date.now() - date) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 2592000) return `${Math.floor(s / 86400)}d`;
    return `${Math.floor(s / 2592000)}mo`;
}

function escHtml(str) { const el = document.createElement('div'); el.appendChild(document.createTextNode(str || '')); return el.innerHTML; }

// ════════════════════════════════════════════════════════════════
// SECTION 25 — EVENT LISTENERS
// ════════════════════════════════════════════════════════════════

// Theme
document.getElementById('themeToggleBtn').addEventListener('click', (e) => { e.preventDefault(); toggleTheme(); });
document.getElementById('mobileThemeToggle')?.addEventListener('click', toggleTheme);

// Filter panel
document.getElementById('navFilterToggle').addEventListener('click', (e) => { e.preventDefault(); openFilterPanel(); });
document.getElementById('filterPanelClose').addEventListener('click', closeFilterPanel);
document.getElementById('panelOverlay').addEventListener('click', closeFilterPanel);
document.getElementById('mobileFilterToggle')?.addEventListener('click', openFilterPanel);

// Profile
document.getElementById('navProfileBtn').addEventListener('click', (e) => { e.preventDefault(); showProfileModal(); });
document.getElementById('mobileProfileIcon')?.addEventListener('click', showProfileModal);
document.getElementById('mobileNavProfileIcon')?.addEventListener('click', showProfileModal);

// Quick Pick
document.getElementById('mobileQuickPick')?.addEventListener('click', openSelectionSlide);

// Slider refresh
document.getElementById('refreshTopSlider')?.addEventListener('click', function () { this.classList.add('spinning'); renderTopTrendingSlider().then(() => this.classList.remove('spinning')); });
document.getElementById('refreshCommunitySlider')?.addEventListener('click', function () { this.classList.add('spinning'); renderCommunitySlider(); setTimeout(() => this.classList.remove('spinning'), 400); });
document.getElementById('refreshRandomSlider')?.addEventListener('click', function () { this.classList.add('spinning'); renderRandomDiscoverySlider().then(() => this.classList.remove('spinning')); });

// Password toggle
document.getElementById('passwordToggle').addEventListener('click', () => {
    const inp = document.getElementById('loginPasswordInput');
    const tog = document.getElementById('passwordToggle');
    if (inp.type === 'password') { inp.type = 'text'; tog.classList.replace('fa-eye', 'fa-eye-slash'); }
    else { inp.type = 'password'; tog.classList.replace('fa-eye-slash', 'fa-eye'); }
});

// Filter controls
document.getElementById('genreFilter').addEventListener('change', (e) => { currentFilter.genre = e.target.value; saveFilters(); renderFeed(); });
document.getElementById('sortOptions').addEventListener('change', (e) => { currentFilter.sort = e.target.value; saveFilters(); renderFeed(); });
document.getElementById('myMoviesButton').addEventListener('click', (e) => { currentFilter.myMovies = !currentFilter.myMovies; e.target.classList.toggle('active', currentFilter.myMovies); saveFilters(); renderFeed(); });
document.getElementById('watchedMoviesButton').addEventListener('click', (e) => { currentFilter.watchedMovies = !currentFilter.watchedMovies; e.target.classList.toggle('active', currentFilter.watchedMovies); saveFilters(); renderFeed(); });
document.getElementById('wannaWatchMoviesButton').addEventListener('click', (e) => { currentFilter.wannaWatchMovies = !currentFilter.wannaWatchMovies; e.target.classList.toggle('active', currentFilter.wannaWatchMovies); saveFilters(); renderFeed(); });
document.getElementById('searchBox').addEventListener('input', (e) => { currentFilter.search = e.target.value; renderFeed(); });

// Search toggle
const openSearch = () => {
    document.getElementById('searchOverlay').classList.add('visible');
    document.getElementById('globalSearchInput').focus();
};
const closeSearch = () => {
    document.getElementById('searchOverlay').classList.remove('visible');
};

document.getElementById('searchFab')?.addEventListener('click', openSearch);
document.getElementById('mobileSearchToggle')?.addEventListener('click', openSearch);
document.getElementById('closeSearchBtn')?.addEventListener('click', closeSearch);

const globalSearchInput = document.getElementById('globalSearchInput');
const searchResultsDropdown = document.getElementById('searchResultsDropdown');

globalSearchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = globalSearchInput.value.trim();
    if (q.length < 2) { searchResultsDropdown.innerHTML = ''; return; }
    searchTimeout = setTimeout(async () => {
        const res  = await fetch(`${tmdbBaseUrl}/search/movie?api_key=${tmdbApiKey}&query=${encodeURIComponent(q)}`);
        const data = await res.json();
        const results = data.results || [];
        searchResultsDropdown.innerHTML = '';
        results.slice(0, 10).forEach(movie => {
            const div = document.createElement('div');
            div.className = 'activity-item';
            div.style.padding = '10px';
            div.style.cursor = 'pointer';
            div.innerHTML = `<strong>${movie.title}</strong> (${movie.release_date?.slice(0,4)})`;
            div.onclick = () => {
                closeSearch();
                showMovieDetailsFromTmdbId(movie.id);
                // Implicit tracking
                trackImplicitInteraction(movie.id, 'search');
                sessionBlacklist.add(movie.id);
            };
            searchResultsDropdown.appendChild(div);
        });
    }, 500);
});

// Close suggestions on outside click
window.addEventListener('click', (e) => {
    const sugg = document.getElementById('suggestionsList'); const input = document.getElementById('movieName');
    if (!sugg.contains(e.target) && !input.contains(e.target)) sugg.style.display = 'none';
});

// ════════════════════════════════════════════════════════════════
// SECTION 26 — DOMContentLoaded BOOTSTRAP
// ════════════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
    updateThemeToggleIcon(getTheme());
    initSystemThemeListener();

    if (currentUserId) {
        closeLoginModal();
        loadMovies();      // Skeleton dismissed inside loadMovies → renderFeed().then(dismissSkeleton)
        initFilterUI();
        showMainAppUI();
        prefetchReelPool(8);
    } else {
        showLoginModal();
        // Show top slider for unauthenticated users; dismiss skeleton after
        renderTopTrendingSlider().then(dismissSkeleton);
        prefetchReelPool(4);
    }

// ── Pull to Refresh Logic ──
    let touchstartY = 0;
    const mainContent = document.getElementById('mainContent');
    const ptr = document.getElementById('ptr');
    const ptrSpinner = document.getElementById('ptrSpinner');

    window.addEventListener('touchstart', e => {
        if (window.scrollY === 0) {
            touchstartY = e.touches[0].screenY;
        }
    }, { passive: true });

    window.addEventListener('touchmove', e => {
        const touchY = e.touches[0].screenY;
        const pullDistance = touchY - touchstartY;

        if (window.scrollY === 0 && pullDistance > 0) {
            // High friction / resistance
            const resistance = 0.25;
            const move = Math.min(pullDistance * resistance, 80);
            ptr.style.transform = `translateY(${move}px)`;
            ptrSpinner.style.transform = `rotate(${pullDistance * 1.5}deg)`;

            // Haptic-style feedback feel via scale
            if (move >= 70) ptrSpinner.style.transform += ' scale(1.1)';
        }
    }, { passive: true });

    window.addEventListener('touchend', () => {
        const transform = window.getComputedStyle(ptr).getPropertyValue('transform');
        const matrix = new DOMMatrix(transform);
        if (matrix.m42 >= 75) {
            ptrSpinner.classList.add('refreshing');
            // Refresh logic
            setTimeout(() => {
                location.reload();
            }, 800);
        } else {
            ptr.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            ptr.style.transform = 'translateY(0)';
            setTimeout(() => { ptr.style.transition = ''; }, 400);
        }
    });

// ── Mobile bottom nav (REMOVED) ──

    // Responsive padding
    const updatePadding = () => {
        const main = document.getElementById('mainContent');
        if (main) main.style.paddingBottom = window.innerWidth <= 740 ? '80px' : '';
    };
    updatePadding();
    window.addEventListener('resize', updatePadding);
});

/* ============================================================
   LASER FOCUS — script.js
   ============================================================ */

// ── CONFIG — 포크 시 이 블록만 수정하세요 ───────────────────────
const CONFIG = {
  // ── 브랜딩 ─────────────────────────────────────────────────
  title:          'LASER FOCUS',       // 앱 이름 (탭·사이드바·알림에 반영)
  startBtnLabel:  'START',             // 시작 버튼 텍스트

  // ── 저장소 ─────────────────────────────────────────────────
  storageKey:     'laserfocus_tasks',  // 포크 시 다른 이름으로 변경 권장 (기존 데이터와 충돌 방지)

  // ── 기본값 ─────────────────────────────────────────────────
  defaultLang:    'ko',                // 기본 언어: 'ko' | 'en' | 'ja'
  defaultMinutes: 25,
  maxTaskChars:   { ko: 20, en: 40, ja: 25 },
  defaultVolume:  60,

  // ── 플레이리스트 ────────────────────────────────────────────
  // Your own Gist URL (see README → "Set up your playlist Gist")
  // Default points to a public demo Gist — works out of the box, but replace with your own playlists
  gistUrl: 'https://gist.githubusercontent.com/kibeom-key/3b8f49b3f7f8c048303243c910e103dd/raw/playlists.json',
  playlists: [
    { id: 'MY6Hzxk2P4E', title: 'Ambient' },
    { id: 'c4yew6jyUQc', title: 'Lo-Fi / Laid Back' },
    { id: 'DfviQ1qhvcs', title: 'Bossa Nova' },
  ],
};

// ── STRINGS (i18n) ───────────────────────────────────────────
const STRINGS = {
  ko: {
    prompt:      '지금 가장 중요한 한 가지는?',
    placeholder: '태스크 이름',
    min:         '분',
    completeBtn: '완료',
    stopBtn:     '중단',
    timeUpPrompt:'작업을 완료하셨나요?',
    yesDone:     '완료했어요',
    notYet:      '아직 못했어요',
    completedHeader: (n) => `완료됨 (${n}개)`,
    modalTitle:  '플레이리스트 선택',
    loading:     '불러오는 중...',
    gistError:   '플레이리스트를 불러오지 못했습니다',
    noGist:      'Gist URL이 설정되지 않았습니다',
    notifBody:   (n) => `"${n}" 집중 시간이 끝났습니다!`,
  },
  en: {
    prompt:      "What matters most right now?",
    placeholder: 'Task name',
    min:         'min',
    completeBtn: 'Complete',
    stopBtn:     'Stop',
    timeUpPrompt:'Did you finish the task?',
    yesDone:     'Yes, done',
    notYet:      'Not yet',
    completedHeader: (n) => `Completed (${n})`,
    modalTitle:  'Select Playlist',
    loading:     'Loading...',
    gistError:   'Failed to load playlists',
    noGist:      'Gist URL not configured',
    notifBody:   (n) => `"${n}" session complete!`,
  },
  ja: {
    prompt:      '今、最も大切な一つのことは？',
    placeholder: 'タスク名',
    min:         '分',
    completeBtn: '完了',
    stopBtn:     '中断',
    timeUpPrompt:'作業は完了しましたか？',
    yesDone:     '完了した',
    notYet:      'まだです',
    completedHeader: (n) => `完了 (${n}件)`,
    modalTitle:  'プレイリストを選択',
    loading:     '読み込み中...',
    gistError:   'プレイリストを読み込めませんでした',
    noGist:      'Gist URL が設定されていません',
    notifBody:   (n) => `「${n}」の集中時間が終わりました！`,
  },
};

const LOCALE_MAP = { ko: 'ko-KR', en: 'en-US', ja: 'ja-JP' };
const DATE_OPTS = {
  ko: { weekday: 'long', month: 'long',  day: 'numeric' },
  en: { weekday: 'long', month: 'short', day: 'numeric' },
  ja: { weekday: 'long', month: 'long',  day: 'numeric' },
};

// ── STATE ────────────────────────────────────────────────────
let lang           = CONFIG.defaultLang;
let sidebarOpen    = true;
let taskActive     = false;
let taskName       = '';
let targetSeconds  = 0;
let elapsedSeconds = 0;
let timerInterval  = null;
let playlists      = [];
let playlistsLoaded = false;

let ytPlayer       = null;
let ytApiReady     = false;
let pendingVideoId = null;

let beepIntervalId = null;
let beepTimeoutId  = null;
let audioCtx       = null;
let sessionPhase   = 'running'; // 'running' | 'timeup'
let _plTooltipEl   = null;
let ytVolume       = CONFIG.defaultVolume;
let ytMuted        = false;
let volumeBeforeMute = CONFIG.defaultVolume;

// ── DOM ──────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── ANALYTICS ────────────────────────────────────────────────
function gaEvent(name, params) {
  if (typeof gtag !== 'function') return;
  gtag('event', name, params);
}

// ── BOOT ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initLang();
  applyStrings();
  $('sidebar-title').textContent  = CONFIG.title;
  $('yt-brand-text').textContent  = CONFIG.title;
  document.title                  = CONFIG.title;
  renderDate();
  loadAndRenderTasks();
  $('task-input').addEventListener('input', onTaskInputChange);
  $('btn-start').disabled = true;
  requestNotifPermission();
  $('main').classList.add('stage-a');
  ytVolume = loadVolume();
  $('volume-slider').value = ytVolume;
  document.querySelector('.modal-body')?.addEventListener('scroll', hidePlTooltip);
  await loadRemotePlaylists();
  if (playlists.length > 0) selectPlaylist(playlists[0].id);

  // Fallback: YT API already loaded but onYouTubeIframeAPIReady was missed
  if (!ytPlayer && pendingVideoId && window.YT?.Player) {
    ytApiReady = true;
    createYTPlayer(pendingVideoId);
    pendingVideoId = null;
  }
});

// ── LANG ─────────────────────────────────────────────────────
function initLang() {
  const p = new URLSearchParams(location.search).get('lang');
  if (p && STRINGS[p]) lang = p;
  document.documentElement.setAttribute('lang', lang);
}

function s() { return STRINGS[lang]; }
function maxChars() { return CONFIG.maxTaskChars[lang]; }

function applyStrings() {
  $('txt-prompt').textContent      = CONFIG.title;
  $('task-input').placeholder      = s().prompt;
  $('task-input').maxLength        = maxChars();
  $('txt-min').textContent         = s().min;
  $('txt-start').textContent       = CONFIG.startBtnLabel;
  updateActionUI();
  $('txt-modal-title').textContent = s().modalTitle;
  $('playlist-loading').textContent = s().loading;
  $('input-footer').textContent = `© ${new Date().getFullYear()} MUMU LYST 무무 플리. Open-source & Browser-based.`;
}

// ── DATE ─────────────────────────────────────────────────────
function renderDate() {
  $('date-display').textContent = new Date().toLocaleDateString('en-US', DATE_OPTS.en);
}

// ── TASK INPUT ───────────────────────────────────────────────
function onTaskInputChange() {
  const len = $('task-input').value.length;
  $('char-count').textContent = `${len}/${maxChars()}`;
  $('btn-start').disabled = len === 0;
}

function updateTimeDisplay(val) {
  $('time-display').textContent = val;
}

function setTime(val) {
  $('time-slider').value = val;
  updateTimeDisplay(val);
}

function closeSidebarIfOpen() {
  if (!sidebarOpen) return;
  sidebarOpen = false;
  $('sidebar').classList.add('collapsed');
}

// ── START TASK ───────────────────────────────────────────────
function startTask() {
  const name = $('task-input').value.trim();
  if (!name) return;

  closeSidebarIfOpen();

  sessionPhase = 'running';
  updateActionUI();

  taskName      = name;
  targetSeconds = parseInt($('time-slider').value, 10) * 60;
  elapsedSeconds = 0;
  taskActive    = true;

  $('timer-task-name').textContent = name;
  updateTimerDisplay(targetSeconds);
  $('progress-bar').style.width = '100%';
  $('progress-bar').style.transition = 'none';
  requestAnimationFrame(() => {
    $('progress-bar').style.transition = 'width 1s linear';
  });

  const main = $('main');
  main.classList.remove('stage-a', 'stage-b', 'stage-d');
  main.classList.add('stage-a');
  main.classList.add('timer-active');

  showView('timer');
  $('reset-area').classList.add('hidden');

  timerInterval = setInterval(tick, 1000);
  gaEvent('task_started', { task_name: taskName, target_min: targetSeconds / 60 });
}

function tick() {
  elapsedSeconds++;
  const remaining = targetSeconds - elapsedSeconds;
  updateTimerDisplay(remaining);
  updateProgress(remaining);

  const pct = elapsedSeconds / targetSeconds;
  const stage = pct <= 0.30 ? 'stage-a' : pct <= 0.90 ? 'stage-b' : 'stage-d';
  const mainEl = $('main');
  if (!mainEl.classList.contains(stage)) {
    mainEl.classList.remove('stage-a', 'stage-b', 'stage-d');
    mainEl.classList.add(stage);
  }

  if (remaining <= 0) {
    clearInterval(timerInterval);
    onTimeUp();
  }
}

function updateTimerDisplay(sec) {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.max(0, sec) % 60;
  $('timer-display').textContent = `${pad(m)}:${pad(s)}`;
}

function updateProgress(remaining) {
  $('progress-bar').style.width = `${Math.max(0, (remaining / targetSeconds) * 100)}%`;
}

function pad(n) { return String(n).padStart(2, '0'); }

function onTimeUp() {
  sessionPhase = 'timeup';
  updateActionUI();
  document.body.classList.add('time-up');
  sendNotif();
  startBeeping();
}

function updateActionUI() {
  const prompt = $('timer-action-prompt');
  if (sessionPhase === 'timeup') {
    prompt.textContent = s().timeUpPrompt;
    prompt.classList.remove('hidden');
    $('txt-complete').textContent = s().yesDone;
    $('txt-stop').textContent     = s().notYet;
  } else {
    prompt.classList.add('hidden');
    $('txt-complete').textContent = s().completeBtn;
    $('txt-stop').textContent     = s().stopBtn;
  }
}

// ── COMPLETE / STOP ──────────────────────────────────────────
function completeTask() { finishTask('done'); }
function stopTask()     { finishTask('stopped'); }

function finishTask(status) {
  clearInterval(timerInterval);
  gaEvent('task_finished', {
    task_name:   taskName,
    target_min:  targetSeconds / 60,
    elapsed_min: Math.round(elapsedSeconds / 60),
    status,
  });
  stopBeeping();
  document.body.classList.remove('time-up');
  sessionPhase = 'running';
  updateActionUI();

  saveTask({
    name:          taskName,
    targetSeconds,
    actualSeconds: elapsedSeconds,
    status,
    date:          todayStr(),
  });

  taskActive     = false;
  taskName       = '';
  elapsedSeconds = 0;

  $('task-input').value         = '';
  $('char-count').textContent   = `0/${maxChars()}`;
  $('btn-start').disabled       = true;
  $('time-slider').value        = CONFIG.defaultMinutes;
  updateTimeDisplay(CONFIG.defaultMinutes);

  loadAndRenderTasks();
  $('reset-area').classList.remove('hidden');

  const mainEl = $('main');
  mainEl.classList.remove('stage-a', 'stage-b', 'stage-d');
  mainEl.classList.add('stage-a');
  mainEl.classList.remove('timer-active');

  showView('input');
}

// ── VIEW SWITCHING ───────────────────────────────────────────
function showView(name) {
  const input = $('view-input');
  const timer = $('view-timer');

  if (name === 'timer') {
    input.classList.add('hidden');
    input.classList.remove('flex');
    timer.classList.remove('hidden');
    timer.classList.add('flex', 'fade-in');
    $('input-footer').classList.add('hidden');
    setTimeout(() => timer.classList.remove('fade-in'), 400);
  } else {
    timer.classList.add('hidden');
    timer.classList.remove('flex');
    input.classList.remove('hidden');
    input.classList.add('flex', 'fade-in');
    $('input-footer').classList.remove('hidden');
    setTimeout(() => input.classList.remove('fade-in'), 400);
  }
}

// ── STORAGE ──────────────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

function loadTasks() {
  try { return JSON.parse(localStorage.getItem(CONFIG.storageKey) || '[]'); }
  catch { return []; }
}

function saveTask(record) {
  const all = loadTasks();
  all.push(record);
  localStorage.setItem(CONFIG.storageKey, JSON.stringify(all));
}

function resetAllData() {
  localStorage.removeItem(CONFIG.storageKey);
  loadAndRenderTasks();
}

function loadAndRenderTasks() {
  const today = todayStr();
  const done = loadTasks()
    .filter(t => t.date === today && t.status === 'done')
    .reverse();
  renderCompletedList(done);
}

function formatDuration(sec) {
  const mins = Math.floor(sec / 60);
  const secs = sec % 60;
  if (mins > 0) return secs ? `${mins}m ${secs}s` : `${mins}m`;
  return `${secs}s`;
}

function renderCompletedList(tasks) {
  const section = $('completed-section');
  const list    = $('completed-list');

  if (tasks.length === 0) {
    section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  $('txt-completed-header').textContent = s().completedHeader(tasks.length);
  list.innerHTML = '';

  tasks.forEach(task => {
    const el = document.createElement('div');
    el.className = 'completed-item';
    el.innerHTML =
      `<span class="completed-check" aria-hidden="true">✓</span>` +
      `<div class="completed-item-body">` +
        `<div class="completed-item-name">${esc(task.name)}</div>` +
        `<div class="completed-item-duration">${formatDuration(task.actualSeconds)}</div>` +
      `</div>`;
    list.appendChild(el);
  });
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── SIDEBAR ──────────────────────────────────────────────────
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  $('sidebar').classList.toggle('collapsed', !sidebarOpen);
}

// ── YOUTUBE / PLAYLIST ───────────────────────────────────────
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  if (pendingVideoId) {
    createYTPlayer(pendingVideoId);
    pendingVideoId = null;
  }
};

function createYTPlayer(videoId) {
  $('yt-placeholder').classList.add('hidden');
  $('yt-player').classList.remove('hidden');
  ytPlayer = new YT.Player('yt-player', {
    videoId,
    width: '100%',
    height: '100%',
    playerVars: {
      controls: 0,
      modestbranding: 1,
      rel: 0,
      autoplay: 1,
      fs: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: onYTReady,
      onStateChange: onYTStateChange,
    },
  });
}

function volumeStorageKey() {
  return `${CONFIG.storageKey}_volume`;
}

function loadVolume() {
  const v = parseInt(localStorage.getItem(volumeStorageKey()), 10);
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : CONFIG.defaultVolume;
}

function applyVolumeToPlayer() {
  if (!ytPlayer?.setVolume) return;
  if (ytMuted || ytVolume === 0) {
    ytPlayer.mute();
  } else {
    ytPlayer.unMute();
    ytPlayer.setVolume(ytVolume);
  }
  updateVolumeIcons();
}

function setYtVolume(val) {
  ytVolume = parseInt(val, 10);
  ytMuted = ytVolume === 0;
  if (ytVolume > 0) volumeBeforeMute = ytVolume;
  localStorage.setItem(volumeStorageKey(), ytVolume);
  applyVolumeToPlayer();
}

function toggleYtMute() {
  if (!ytPlayer) return;
  ytMuted = !ytMuted;
  if (ytMuted) {
    volumeBeforeMute = ytVolume || CONFIG.defaultVolume;
    ytPlayer.mute();
  } else {
    if (ytVolume === 0) {
      ytVolume = volumeBeforeMute || CONFIG.defaultVolume;
      $('volume-slider').value = ytVolume;
      localStorage.setItem(volumeStorageKey(), ytVolume);
    }
    ytPlayer.unMute();
    ytPlayer.setVolume(ytVolume);
  }
  updateVolumeIcons();
}

function updateVolumeIcons() {
  const muted = ytMuted || ytVolume === 0;
  $('icon-volume-on').classList.toggle('hidden', muted);
  $('icon-volume-off').classList.toggle('hidden', !muted);
}

function onYTReady() {
  ytVolume = loadVolume();
  ytMuted = ytVolume === 0;
  $('volume-slider').value = ytVolume;
  applyVolumeToPlayer();
}

function onYTStateChange(event) {
  $('btn-toggle').classList.toggle('playing', event.data === YT.PlayerState.PLAYING);
  if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.CUED) {
    applyVolumeToPlayer();
  }
}

function selectPlaylist(id) {
  closePlaylistModal();
  gaEvent('playlist_selected', { playlist_id: id });
  if (!ytApiReady) { pendingVideoId = id; return; }
  if (!ytPlayer)   { createYTPlayer(id); }
  else             { ytPlayer.loadVideoById(id); }
}

function openPlaylistModal() {
  $('modal-playlist').classList.remove('hidden');
  renderPlaylists(playlists);
}

function closePlaylistModal() {
  hidePlTooltip();
  $('modal-playlist').classList.add('hidden');
}

function resolvePlaylistDesc(pl) {
  const raw = pl.desc;
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  return raw[lang] || raw.ko || raw.en || '';
}

function getPlTooltip() {
  if (!_plTooltipEl) {
    _plTooltipEl = document.createElement('div');
    _plTooltipEl.className = 'pl-tooltip';
    document.body.appendChild(_plTooltipEl);
  }
  return _plTooltipEl;
}

function hidePlTooltip() {
  if (_plTooltipEl) _plTooltipEl.classList.remove('visible');
}

function bindPlaylistTooltips() {
  $('playlist-grid').querySelectorAll('.playlist-card[data-pl-desc]').forEach(el => {
    el.addEventListener('mouseenter', () => {
      const desc = el.dataset.plDesc;
      if (!desc) return;
      const tt = getPlTooltip();
      tt.textContent = desc;
      tt.style.setProperty('--arrow-shift', '0px');

      const r = el.getBoundingClientRect();
      const centerX = r.left + r.width / 2;
      tt.style.left = centerX + 'px';
      tt.style.top  = r.top + 'px';
      tt.classList.add('visible');

      void tt.offsetWidth;

      const tr = tt.getBoundingClientRect();
      const pad = 8;
      let shift = 0;
      if (tr.left < pad) shift = pad - tr.left;
      else if (tr.right > window.innerWidth - pad) shift = (window.innerWidth - pad) - tr.right;
      if (shift !== 0) {
        tt.style.left = (centerX + shift) + 'px';
        tt.style.setProperty('--arrow-shift', (-shift) + 'px');
      }
    });
    el.addEventListener('mouseleave', hidePlTooltip);
  });
}

async function loadRemotePlaylists() {
  try {
    const url = `${CONFIG.gistUrl}?t=${Date.now()}`;
    const res = await Promise.race([
      fetch(url, { cache: 'no-cache' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
    ]);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      playlists = data;
    } else {
      playlists = CONFIG.playlists;
    }
  } catch (e) {
    console.warn('[LaserFocus] 플레이리스트: Gist fetch 실패, 하드코딩 사용', e.message);
    playlists = CONFIG.playlists;
  }
  playlistsLoaded = true;
}

function renderPlaylists(data) {
  const grid = $('playlist-grid');
  grid.innerHTML = '';
  $('playlist-loading').classList.add('hidden');
  $('playlist-error').classList.add('hidden');

  if (!data || data.length === 0) {
    showPlaylistError(s().gistError);
    return;
  }

  data.forEach(p => {
    const card = document.createElement('div');
    card.className = 'playlist-card';
    card.onclick = () => selectPlaylist(p.id);
    const desc = resolvePlaylistDesc(p);
    if (desc) card.dataset.plDesc = desc;
    const thumbUrl = `https://img.youtube.com/vi/${p.id}/mqdefault.jpg`;
    const name = p.title || p.name || '';
    card.innerHTML =
      `<img src="${esc(thumbUrl)}" alt="${esc(name)}" loading="lazy">` +
      `<div class="playlist-card-name">${esc(name)}</div>`;
    grid.appendChild(card);
  });
  bindPlaylistTooltips();
}

function showPlaylistError(msg) {
  const el = $('playlist-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

// ── BEEP ─────────────────────────────────────────────────────
function playBeep() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc  = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.4);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + 0.4);
}

function startBeeping() {
  playBeep();
  beepIntervalId = setInterval(playBeep, 1500);
  beepTimeoutId  = setTimeout(stopBeeping, 10000);
}

function stopBeeping() {
  clearInterval(beepIntervalId);
  clearTimeout(beepTimeoutId);
  beepIntervalId = beepTimeoutId = null;
}

// ── NOTIFICATIONS ────────────────────────────────────────────
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendNotif() {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(CONFIG.title, { body: s().notifBody(taskName) });
  }
}

/**
 * المصحف المرتل المتزامن - Tarteel Sync
 * مبني على mp3quran API v4 (Staging Preview)
 */

(function () {
  'use strict';

  // API Configuration
  const API_BASE = 'https://api-staging.mp3quran.net/v4';

  // Application State
  const state = {
    reciters: [],
    surahs: [],
    currentReciter: null,
    currentRecitation: null,
    currentSurah: 1,
    currentQuality: localStorage.getItem('tarteel_quality') || 'original',
    syncOffset: parseInt(localStorage.getItem('tarteel_sync_offset') || '-25', 10),
    autoScroll: localStorage.getItem('tarteel_autoscroll') !== 'false',
    highlightScope: localStorage.getItem('tarteel_highlight_scope') || 'ayah', // 'ayah' | 'breath'
    playbackRate: parseFloat(localStorage.getItem('tarteel_speed') || '1.0'),
    theme: localStorage.getItem('tarteel_theme') || 'dark',

    // Data Cache
    surahCache: {},
    timingsCache: {},

    // Current Playback / Timings Data
    surahData: null,
    timingsData: null,
    timingIntervals: [], // Array of { ayah, word, startMs, endMs, text, breathGroupId }
    silenceSegments: [], // Array of { kind, start_ms, end_ms }
    activeInterval: null,
    activeBreathGroup: null,
    timingMode: 'none', // 'word' | 'ayah' | 'none'
    timingRelease: 'N/A',

    // UI State
    activeSidebarTab: 'reciters', // 'reciters' | 'surahs'
    reciterFilter: 'all', // 'all' | 'timings' | 'hafs' | 'warsh'
    searchQuery: '',
    isDrawerOpen: false,
    isSidebarOpen: false
  };

  // DOM Elements Cache
  const $ = selector => document.querySelector(selector);
  const $$ = selector => document.querySelectorAll(selector);

  const els = {
    audio: $('#mainAudio'),
    viewport: $('#mushafViewport'),
    ayahsContainer: $('#ayahsContainer'),
    surahTitle: $('#surahBannerTitle'),
    surahInfo: $('#surahBannerInfo'),
    basmalahBox: $('#basmalahFrame'),

    // Player Elements
    btnPlayPause: $('#btnPlayPause'),
    playIcon: $('#playIcon'),
    pauseIcon: $('#pauseIcon'),
    scrubberBar: $('#scrubberBar'),
    scrubberFill: $('#scrubberFill'),
    scrubberKnob: $('#scrubberKnob'),
    scrubberBuffered: $('#scrubberBuffered'),
    timeNow: $('#timeNow'),
    timeTotal: $('#timeTotal'),
    btnPrevAyah: $('#btnPrevAyah'),
    btnNextAyah: $('#btnNextAyah'),
    playerSurahName: $('#playerSurahName'),
    playerReciterName: $('#playerReciterName'),
    playerRiwayahTag: $('#playerRiwayahTag'),
    btnQuality: $('#btnQuality'),
    btnSpeed: $('#btnSpeed'),
    volumeSlider: $('#volumeSlider'),
    btnMute: $('#btnMute'),

    // Sidebar & Lists
    sidebar: $('#appSidebar'),
    sidebarBackdrop: $('#sidebarBackdrop'),
    btnToggleSidebar: $('#btnToggleSidebar'),
    tabReciters: $('#tabReciters'),
    tabSurahs: $('#tabSurahs'),
    searchInput: $('#searchInput'),
    searchClear: $('#searchClear'),
    filterChips: $$('.filter-chip'),
    recitersList: $('#recitersList'),
    surahsList: $('#surahsList'),

    // Header & Tools
    btnTimingTools: $('#btnTimingTools'),
    timingDrawer: $('#timingDrawer'),
    btnCloseDrawer: $('#btnCloseDrawer'),
    btnAutoScroll: $('#btnAutoScroll'),
    btnHighlightScope: $('#btnHighlightScope'),
    highlightScopeLabel: $('#highlightScopeLabel'),
    breathIndicator: $('#breathIndicator'),
    btnThemeToggle: $('#btnThemeToggle'),
    liveOffsetLabel: $('#liveOffsetLabel'),
    timingOffsetSlider: $('#timingOffsetSlider'),
    btnCopyFeedback: $('#btnCopyFeedback'),
    timingStatusBadge: $('#timingStatusBadge'),
    statCurrentMs: $('#statCurrentMs'),
    statWordText: $('#statWordText'),
    statAyahWord: $('#statAyahWord'),
    statTimingsRange: $('#statTimingsRange'),
    statRelease: $('#statRelease'),
    toast: $('#toastNotification')
  };

  // ==========================================================================
  // Arabic Text Normalization & Helpers
  // ==========================================================================
  const AR_FOLD = [
    [/[ً-ْٰـ]/g, ''],
    [/[أإآٱ]/g, 'ا'],
    [/ى/g, 'ي'],
    [/ة/g, 'ه'],
    [/ؤ/g, 'و'],
    [/ئ/g, 'ي']
  ];

  function normalizeArabic(text) {
    if (!text) return '';
    let t = String(text).toLowerCase();
    for (const [re, to] of AR_FOLD) {
      t = t.replace(re, to);
    }
    return t.trim();
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, '0')}`;
  }

  function toArabicDigits(num) {
    const id = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    return String(num).replace(/[0-9]/g, w => id[+w]);
  }

  function showToast(msg, duration = 3000) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(() => {
      els.toast.classList.remove('show');
    }, duration);
  }

  // ==========================================================================
  // Initialization & Bootstrapping
  // ==========================================================================
  async function initApp() {
    initTheme();
    initEventListeners();
    initSettingsUI();

    // 1. Load Surahs Index (metadata of 114 surahs)
    await loadSurahsIndex();

    // 2. Load Reciters List (API with offline fallback)
    await loadReciters();

    // 3. Select default reciter: Mishary Alafasy or first reciter
    const defaultReciter =
      state.reciters.find(r => r.code === 'mishary-alafasy') ||
      state.reciters.find(r => r.recitations && r.recitations.some(rec => rec.has_ayah_timings)) ||
      state.reciters[0];

    if (defaultReciter) {
      selectReciter(defaultReciter);
    }

    // 4. Open Surah 1 by default
    await openSurah(1);
  }

  function initTheme() {
    if (state.theme === 'sepia') {
      document.body.classList.add('theme-sepia');
    } else {
      document.body.classList.remove('theme-sepia');
    }
  }

  function initSettingsUI() {
    els.btnQuality.textContent = getQualityLabel(state.currentQuality);
    els.btnSpeed.textContent = `${state.playbackRate}x`;
    els.timingOffsetSlider.value = state.syncOffset;
    els.liveOffsetLabel.textContent = `${state.syncOffset > 0 ? '+' : ''}${state.syncOffset} ms`;
    els.btnAutoScroll.classList.toggle('active', state.autoScroll);
    updateHighlightScopeUI();
  }

  function updateHighlightScopeUI() {
    if (state.highlightScope === 'breath') {
      els.highlightScopeLabel.textContent = 'التظليل: مقطع النَّفَس';
      els.btnHighlightScope.classList.add('active');
    } else {
      els.highlightScopeLabel.textContent = 'التظليل: الآية كاملة';
      els.btnHighlightScope.classList.remove('active');
    }
  }

  function toggleHighlightScope() {
    state.highlightScope = state.highlightScope === 'ayah' ? 'breath' : 'ayah';
    localStorage.setItem('tarteel_highlight_scope', state.highlightScope);
    updateHighlightScopeUI();
    showToast(state.highlightScope === 'breath' ? 'تفعيل التظليل حسب نَفَس القارئ' : 'تفعيل التظليل للآية كاملة');

    // Re-apply highlight to current position
    if (state.activeInterval) {
      applyHighlight(state.activeInterval);
    }
  }

  function getQualityLabel(quality) {
    switch (quality) {
      case 'opus_48':
        return 'Opus 48k';
      case 'mp3_64':
        return 'MP3 64k';
      case 'original':
      default:
        return 'أصلية Original';
    }
  }

  // ==========================================================================
  // Data Fetching: Surahs & Reciters
  // ==========================================================================
  async function loadSurahsIndex() {
    try {
      const res = await fetch('data/surahs-index.json');
      state.surahs = await res.json();
    } catch (e) {
      console.warn('Could not load local surahs-index.json, falling back to API /v4/surahs');
      try {
        const res = await fetch(`${API_BASE}/surahs`);
        const json = await res.json();
        state.surahs = json.data;
      } catch (err) {
        console.error('Failed to load surahs list:', err);
      }
    }
    renderSurahsList();
  }

  async function loadReciters() {
    try {
      // First try live API v4
      const res = await fetch(`${API_BASE}/reciters?all=true`);
      if (!res.ok) throw new Error(`Status ${res.status}`);
      const json = await res.json();
      state.reciters = json.data;
    } catch (err) {
      console.warn('Falling back to local data/reciters.json:', err.message);
      try {
        const res = await fetch('data/reciters.json');
        const json = await res.json();
        state.reciters = json.data;
      } catch (e) {
        console.error('Failed to load reciters:', e);
      }
    }
    renderRecitersList();
  }

  // ==========================================================================
  // Rendering Lists: Reciters & Surahs
  // ==========================================================================
  function renderRecitersList() {
    const q = normalizeArabic(state.searchQuery);
    const filter = state.reciterFilter;

    const filtered = state.reciters.filter(r => {
      // Search matching (Arabic and Latin name)
      const matchesSearch =
        !q ||
        normalizeArabic(r.name).includes(q) ||
        (r.name_latin && r.name_latin.toLowerCase().includes(q.toLowerCase()));

      if (!matchesSearch) return false;

      // Filter types
      if (filter === 'timings') {
        return r.recitations && r.recitations.some(rec => rec.has_ayah_timings);
      }
      if (filter === 'hafs') {
        return r.recitations && r.recitations.some(rec => rec.riwayahs.some(rw => rw.code.includes('hafs')));
      }
      if (filter === 'warsh') {
        return r.recitations && r.recitations.some(rec => rec.riwayahs.some(rw => rw.code.includes('warsh')));
      }
      return true;
    });

    els.recitersList.innerHTML = '';

    if (!filtered.length) {
      els.recitersList.innerHTML = `
        <div class="state-container" style="padding: 40px 10px;">
          <p>لا يوجد قارئ يطابق البحث</p>
        </div>`;
      return;
    }

    filtered.forEach(r => {
      const isSelected = state.currentReciter && state.currentReciter.id === r.id;
      const hasTimings = r.recitations && r.recitations.some(rec => rec.has_ayah_timings);

      const card = document.createElement('div');
      card.className = `reciter-card ${isSelected ? 'active' : ''}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      let riwayahsHtml = '';
      if (r.recitations && r.recitations.length > 0) {
        riwayahsHtml = `
          <div class="riwayah-chips-container">
            ${r.recitations
              .map(rec => {
                const rName = rec.riwayahs && rec.riwayahs[0] ? rec.riwayahs[0].name : rec.style || 'تلاوة';
                const isRecActive = isSelected && state.currentRecitation && state.currentRecitation.id === rec.id;
                return `
                <span class="riwayah-pill ${isRecActive ? 'active' : ''}" 
                      data-reciter-id="${r.id}" 
                      data-recitation-id="${rec.id}">
                  ${rec.style === 'mujawwad' ? `${rName} (مجود)` : rName}
                </span>`;
              })
              .join('')}
          </div>`;
      }

      card.innerHTML = `
        <div class="reciter-header-row">
          <span class="reciter-name">${r.name}</span>
          <div class="reciter-badges">
            ${
              hasTimings
                ? `<span class="badge-timing" title="يدعم محاذاة وتوقيتات الكلمات والآيات">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm-1 14.5v-9l6 4.5-6 4.5z"/></svg>
                    تزامن لحظي
                   </span>`
                : ''
            }
          </div>
        </div>
        <div class="reciter-sub">
          <span>${r.name_latin || ''}</span>
          <span>${r.recitations ? r.recitations.length : 0} تلاوة</span>
        </div>
        ${riwayahsHtml}
      `;

      card.addEventListener('click', e => {
        const pill = e.target.closest('.riwayah-pill');
        if (pill) {
          e.stopPropagation();
          const recId = parseInt(pill.dataset.recitationId, 10);
          const chosenRecitation = r.recitations.find(x => x.id === recId);
          selectReciter(r, chosenRecitation);
        } else {
          selectReciter(r);
        }
      });

      els.recitersList.appendChild(card);
    });
  }

  function renderSurahsList() {
    const q = normalizeArabic(state.searchQuery);

    const filtered = state.surahs.filter(s => {
      if (!q) return true;
      return (
        normalizeArabic(s.name_ar).includes(q) ||
        (s.name_en && s.name_en.toLowerCase().includes(q.toLowerCase())) ||
        String(s.number) === q
      );
    });

    els.surahsList.innerHTML = '';

    filtered.forEach(s => {
      const isSelected = state.currentSurah === s.number;
      const card = document.createElement('div');
      card.className = `surah-card ${isSelected ? 'active' : ''}`;
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      card.innerHTML = `
        <div class="surah-card-left">
          <div class="surah-num">${s.number}</div>
          <div class="surah-title-meta">
            <span class="surah-card-name">${s.name_ar}</span>
            <span class="surah-card-sub">${s.name_en} · ${s.ayah_count} آية</span>
          </div>
        </div>
        <span class="surah-card-type">${s.revelation === 'makki' ? 'مكية' : 'مدنية'}</span>
      `;

      card.addEventListener('click', () => {
        openSurah(s.number);
        if (window.innerWidth <= 900) {
          closeSidebar();
        }
      });

      els.surahsList.appendChild(card);
    });
  }

  // ==========================================================================
  // Reciter & Recitation Selection
  // ==========================================================================
  function selectReciter(reciter, specificRecitation = null) {
    state.currentReciter = reciter;

    // Pick specified recitation or the best one (preferring murattal with timings)
    if (specificRecitation) {
      state.currentRecitation = specificRecitation;
    } else if (reciter.recitations && reciter.recitations.length > 0) {
      state.currentRecitation =
        reciter.recitations.find(r => r.has_ayah_timings) ||
        reciter.recitations.find(r => r.style === 'murattal') ||
        reciter.recitations[0];
    } else {
      state.currentRecitation = null;
    }

    // Update Player Info
    updatePlayerInfo();
    renderRecitersList();

    // Reload Audio & Timings for current surah
    loadSurahAudioAndTimings();
  }

  function updatePlayerInfo() {
    const s = state.surahs.find(x => x.number === state.currentSurah);
    els.playerSurahName.textContent = s ? `سورة ${s.name_ar}` : `سورة ${state.currentSurah}`;

    if (state.currentReciter) {
      els.playerReciterName.innerHTML = `
        <span>${state.currentReciter.name}</span>
      `;
      if (state.currentRecitation && state.currentRecitation.riwayahs && state.currentRecitation.riwayahs[0]) {
        els.playerRiwayahTag.textContent = state.currentRecitation.riwayahs[0].name;
        els.playerRiwayahTag.style.display = 'inline-block';
      } else {
        els.playerRiwayahTag.style.display = 'none';
      }
    }
  }

  // ==========================================================================
  // Surah Loading & Text Rendering
  // ==========================================================================
  async function openSurah(surahNumber) {
    state.currentSurah = surahNumber;
    renderSurahsList();
    updatePlayerInfo();

    // Reset active highlight
    clearActiveWord();

    // Load Text
    await loadSurahText(surahNumber);

    // Load Audio and Timings for current reciter + surah
    await loadSurahAudioAndTimings();
  }

  async function loadSurahText(surahNumber) {
    els.ayahsContainer.innerHTML = `
      <div class="state-container">
        <div class="spinner"></div>
        <p>جاري تحميل النص القرآني الشريف...</p>
      </div>`;

    let data = state.surahCache[surahNumber];
    if (!data) {
      try {
        const res = await fetch(`data/surahs/${surahNumber}.json`);
        data = await res.json();
        state.surahCache[surahNumber] = data;
      } catch (e) {
        console.error('Error fetching surah json:', e);
        els.ayahsContainer.innerHTML = '<div class="state-container"><p>تعذر تحميل نص السورة</p></div>';
        return;
      }
    }

    state.surahData = data;
    renderSurahView(data);
  }

  function renderSurahView(data) {
    // Header Banner
    els.surahTitle.textContent = `سُورَةُ ${data.name_ar}`;
    els.surahInfo.innerHTML = `
      <span>${data.revelation === 'makki' ? 'مَكِّيَّة' : 'مَدَنِيَّة'}</span>
      <span class="banner-dot"></span>
      <span>${toArabicDigits(data.ayah_count)} آيَات</span>
      <span class="banner-dot"></span>
      <span>رقم السورة: ${toArabicDigits(data.number)}</span>
    `;

    // Basmalah (Surah 9 At-Tawbah does NOT have basmalah, Surah 1 has it as verse 1)
    if (data.number !== 9 && data.number !== 1) {
      els.basmalahBox.style.display = 'block';
      els.basmalahBox.textContent = 'بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ';
    } else {
      els.basmalahBox.style.display = 'none';
    }

    // Build Ayahs & Words Flow
    const frag = document.createDocumentFragment();

    data.ayahs.forEach((wordsArray, ayahIndex) => {
      const ayahNumber = ayahIndex + 1;

      const ayahSpan = document.createElement('span');
      ayahSpan.className = 'q-ayah';
      ayahSpan.dataset.ayah = ayahNumber;
      ayahSpan.id = `ayah-${ayahNumber}`;

      wordsArray.forEach((wordText, wordIndex) => {
        const wordNumber = wordIndex + 1;
        const wSpan = document.createElement('span');
        wSpan.className = 'q-word';
        wSpan.dataset.ayah = ayahNumber;
        wSpan.dataset.word = wordNumber;
        wSpan.textContent = wordText;

        // Click on word to seek
        wSpan.addEventListener('click', e => {
          e.stopPropagation();
          seekToWord(ayahNumber, wordNumber);
        });

        ayahSpan.appendChild(wSpan);
      });

      // Ayah End Symbol
      const endMarker = document.createElement('span');
      endMarker.className = 'ayah-end-marker';
      endMarker.dataset.ayah = ayahNumber;
      endMarker.title = `تشغيل الآية ${ayahNumber}`;
      endMarker.innerHTML = `<span class="ayah-num-inner">${toArabicDigits(ayahNumber)}</span>`;

      endMarker.addEventListener('click', e => {
        e.stopPropagation();
        seekToAyah(ayahNumber);
      });

      ayahSpan.appendChild(endMarker);
      frag.appendChild(ayahSpan);
    });

    els.ayahsContainer.innerHTML = '';
    els.ayahsContainer.appendChild(frag);

    // Scroll to top of viewport
    els.viewport.scrollTop = 0;
  }

  // ==========================================================================
  // Audio & Word Timings Engine
  // ==========================================================================
  async function loadSurahAudioAndTimings() {
    if (!state.currentRecitation) return;

    const surahStr = String(state.currentSurah).padStart(3, '0');
    const recCode = state.currentRecitation.code; // e.g. "mishary-alafasy/r1"

    // Construct Audio URL based on quality
    const audioBase = state.currentRecitation.audio.base;
    const files = state.currentRecitation.audio.files;
    let fileTemplate = files[state.currentQuality] || files.original || '{surah:03d}.mp3';
    const audioFileName = fileTemplate.replace('{surah:03d}', surahStr);
    const audioUrl = audioBase + audioFileName;

    // Load Audio Source
    const wasPlaying = !els.audio.paused && els.audio.currentTime > 0;
    els.audio.src = audioUrl;
    els.audio.playbackRate = state.playbackRate;

    if (wasPlaying) {
      els.audio.play().catch(() => {});
    }

    // Fetch Timings Data
    await fetchTimingsData(recCode, state.currentSurah);
  }

  async function fetchTimingsData(recitationCode, surahNum) {
    state.timingsData = null;
    state.timingIntervals = [];
    state.timingMode = 'none';
    state.timingRelease = 'N/A';
    updateTimingBadge();

    const cacheKey = `${recitationCode}-${surahNum}`;
    if (state.timingsCache[cacheKey]) {
      processTimings(state.timingsCache[cacheKey]);
      return;
    }

    try {
      // 1. Try Word Timings first with segments & held_too_long
      const res = await fetch(`${API_BASE}/recitations/${recitationCode}/surahs/${surahNum}/word-timings?include=segments,held_too_long`);
      if (res.ok) {
        const json = await res.json();
        if (json.data && json.data.ayahs) {
          state.timingsCache[cacheKey] = { mode: 'word', data: json.data };
          processTimings(state.timingsCache[cacheKey]);
          return;
        }
      }

      // 2. Fallback to Ayah Timings (/v4/recitations/{id}/surahs/{n}/ayah-timings)
      const resAyah = await fetch(`${API_BASE}/recitations/${recitationCode}/surahs/${surahNum}/ayah-timings`);
      if (resAyah.ok) {
        const jsonAyah = await resAyah.json();
        if (jsonAyah.data && jsonAyah.data.ayahs) {
          state.timingsCache[cacheKey] = { mode: 'ayah', data: jsonAyah.data };
          processTimings(state.timingsCache[cacheKey]);
          return;
        }
      }

      // 3. No timings available
      state.timingMode = 'none';
      updateTimingBadge();
    } catch (e) {
      console.warn('Timings request error:', e);
      state.timingMode = 'none';
      updateTimingBadge();
    }
  }

  function processTimings(cached) {
    state.timingMode = cached.mode;
    state.timingsData = cached.data;
    state.timingIntervals = [];
    state.silenceSegments = cached.data.segments || cached.data.timings?.segments || [];

    if (cached.data.alignment && cached.data.alignment.release) {
      state.timingRelease = cached.data.alignment.release;
    } else {
      state.timingRelease = 'Zipformer v4';
    }

    if (cached.mode === 'word') {
      const ayahsObj = cached.data.ayahs;
      // ayahsObj: { "1": { "1": [[start, end]], "2": [[start, end]] }, ... }
      for (const [aNumStr, wordsObj] of Object.entries(ayahsObj)) {
        const aNum = parseInt(aNumStr, 10);
        for (const [wNumStr, timeSegments] of Object.entries(wordsObj)) {
          const wNum = parseInt(wNumStr, 10);
          if (Array.isArray(timeSegments) && timeSegments.length > 0) {
            // Note: If word repeated, timeSegments has multiple [start, end] pairs!
            timeSegments.forEach(seg => {
              const startMs = seg[0];
              const endMs = seg[1];

              // Get word text if surahData loaded
              let wText = '';
              if (state.surahData && state.surahData.ayahs[aNum - 1]) {
                wText = state.surahData.ayahs[aNum - 1][wNum - 1] || '';
              }

              state.timingIntervals.push({
                ayah: aNum,
                word: wNum,
                startMs,
                endMs,
                text: wText,
                breathGroupId: 1
              });
            });
          }
        }
      }

      // Sort by startMs
      state.timingIntervals.sort((a, b) => a.startMs - b.startMs);

      // Group words into Breath Segments (مقاطع النَّفَس)
      let currentGroupId = 1;
      for (let i = 0; i < state.timingIntervals.length; i++) {
        const cur = state.timingIntervals[i];
        cur.breathGroupId = currentGroupId;

        if (i < state.timingIntervals.length - 1) {
          const next = state.timingIntervals[i + 1];
          const gap = next.startMs - cur.endMs;
          const hasSilence = state.silenceSegments.some(
            s => s.kind === 'silence' && s.start_ms >= cur.endMs - 120 && s.end_ms <= next.startMs + 120
          );

          // If pause is 350ms or more, or silence segment detected -> new breath group!
          if (gap >= 350 || hasSilence) {
            currentGroupId++;
          }
        }
      }
    } else if (cached.mode === 'ayah') {
      // cached.data.ayahs: [ [ayahNum, startMs, endMs], ... ]
      cached.data.ayahs.forEach((item, idx) => {
        state.timingIntervals.push({
          ayah: item[0],
          word: null,
          startMs: item[1],
          endMs: item[2],
          text: `الآية ${item[0]}`,
          breathGroupId: idx + 1
        });
      });
      state.timingIntervals.sort((a, b) => a.startMs - b.startMs);
    }

    updateTimingBadge();
  }

  function updateTimingBadge() {
    if (state.timingMode === 'word') {
      els.timingStatusBadge.textContent = 'تزامن الكلمات اللحظي (v4)';
      els.timingStatusBadge.style.color = 'var(--emerald-accent)';
      els.timingStatusBadge.style.background = 'rgba(16, 185, 129, 0.12)';
    } else if (state.timingMode === 'ayah') {
      els.timingStatusBadge.textContent = 'تزامن الآيات';
      els.timingStatusBadge.style.color = 'var(--blue-accent)';
      els.timingStatusBadge.style.background = 'rgba(56, 189, 248, 0.12)';
    } else {
      els.timingStatusBadge.textContent = 'تشغيل صوتي عادي';
      els.timingStatusBadge.style.color = 'var(--text-muted)';
      els.timingStatusBadge.style.background = 'var(--bg-surface-elevated)';
    }

    els.statRelease.textContent = state.timingRelease;
  }

  // ==========================================================================
  // Real-time Frame Loop (60fps Word Synchronization)
  // ==========================================================================
  let rafId = null;

  function startSyncLoop() {
    if (rafId) cancelAnimationFrame(rafId);

    function frame() {
      if (!els.audio.paused && !els.audio.ended) {
        updateSyncHighlight();
        rafId = requestAnimationFrame(frame);
      }
    }

    rafId = requestAnimationFrame(frame);
  }

  function stopSyncLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function updateSyncHighlight() {
    if (!state.timingIntervals.length) return;

    // Current Audio Time in ms with fine-tune calibration offset
    const currentAudioMs = Math.round(els.audio.currentTime * 1000);
    const calibratedMs = currentAudioMs + state.syncOffset;

    // Update Live Stat in Drawer
    els.statCurrentMs.textContent = `${calibratedMs} ms`;

    // Find active interval
    const interval = findActiveInterval(calibratedMs);

    // Detect if reciter is currently in silence / taking a breath
    const isPlaying = !els.audio.paused && !els.audio.ended;
    const isExplicitSilence = state.silenceSegments.some(
      s => s.kind === 'silence' && calibratedMs >= s.start_ms && calibratedMs < s.end_ms
    );
    const isBreathPause = isPlaying && (isExplicitSilence || (!interval && calibratedMs > 500));

    if (els.breathIndicator) {
      els.breathIndicator.style.display = isBreathPause ? 'inline-flex' : 'none';
    }

    if (interval) {
      if (state.activeInterval !== interval) {
        state.activeInterval = interval;
        applyHighlight(interval);
      }
    } else {
      // In a pause: remove active word highlight, but keep breath group visible if in breath mode
      if (state.activeInterval) {
        const prevWord = els.ayahsContainer.querySelector('.q-word.active');
        if (prevWord) prevWord.classList.remove('active');
        state.activeInterval = null;
      }
    }
  }

  function findActiveInterval(ms) {
    const list = state.timingIntervals;
    if (!list.length) return null;

    // Binary search for interval
    let low = 0;
    let high = list.length - 1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = list[mid];

      if (ms >= item.startMs && ms < item.endMs) {
        return item;
      } else if (ms < item.startMs) {
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return null;
  }

  function applyHighlight(interval) {
    // 1. Remove previous word highlight
    const prevWord = els.ayahsContainer.querySelector('.q-word.active');
    if (prevWord) prevWord.classList.remove('active');

    // 2. Handle Scope: Breath Segment vs Full Ayah
    if (state.highlightScope === 'breath') {
      // Remove any full ayah highlight
      const activeAyahs = els.ayahsContainer.querySelectorAll('.q-ayah.ayah-active');
      activeAyahs.forEach(a => a.classList.remove('ayah-active'));

      // If breath group changed, update breath group highlighting
      if (state.activeBreathGroup !== interval.breathGroupId) {
        state.activeBreathGroup = interval.breathGroupId;
        const prevBreathWords = els.ayahsContainer.querySelectorAll('.q-word.in-breath-active');
        prevBreathWords.forEach(w => w.classList.remove('in-breath-active'));

        // Highlight all words belonging to this breath group
        const groupWords = state.timingIntervals.filter(i => i.breathGroupId === interval.breathGroupId);
        groupWords.forEach(w => {
          if (w.word !== null) {
            const el = els.ayahsContainer.querySelector(`.q-word[data-ayah="${w.ayah}"][data-word="${w.word}"]`);
            if (el) el.classList.add('in-breath-active');
          }
        });
      }
    } else {
      // Full Ayah Scope (default)
      const prevBreathWords = els.ayahsContainer.querySelectorAll('.q-word.in-breath-active');
      prevBreathWords.forEach(w => w.classList.remove('in-breath-active'));
      state.activeBreathGroup = null;

      const prevAyah = els.ayahsContainer.querySelector('.q-ayah.ayah-active');
      if (prevAyah && prevAyah.dataset.ayah !== String(interval.ayah)) {
        prevAyah.classList.remove('ayah-active');
      }

      const curAyah = els.ayahsContainer.querySelector(`.q-ayah[data-ayah="${interval.ayah}"]`);
      if (curAyah && !curAyah.classList.contains('ayah-active')) {
        curAyah.classList.add('ayah-active');
      }
    }

    // 3. Highlight current Word (if in word mode)
    if (interval.word !== null) {
      const wordEl = els.ayahsContainer.querySelector(
        `.q-word[data-ayah="${interval.ayah}"][data-word="${interval.word}"]`
      );
      if (wordEl) {
        wordEl.classList.add('active');

        // Smooth Auto-scroll to active word
        if (state.autoScroll) {
          scrollElementIntoView(wordEl);
        }
      }
    } else if (state.autoScroll) {
      const curAyah = els.ayahsContainer.querySelector(`.q-ayah[data-ayah="${interval.ayah}"]`);
      if (curAyah) scrollElementIntoView(curAyah);
    }

    // Update Drawer Inspector Stats
    els.statWordText.textContent = interval.text || '—';
    els.statAyahWord.textContent =
      interval.word !== null ? `آية ${interval.ayah} · كلمة ${interval.word}` : `آية ${interval.ayah}`;
    els.statTimingsRange.textContent = `${interval.startMs} - ${interval.endMs} ms (${interval.endMs - interval.startMs}ms)`;
  }

  function clearActiveWord() {
    const activeWords = els.ayahsContainer.querySelectorAll('.q-word.active');
    activeWords.forEach(w => w.classList.remove('active'));

    const activeAyahs = els.ayahsContainer.querySelectorAll('.q-ayah.ayah-active');
    activeAyahs.forEach(a => a.classList.remove('ayah-active'));

    const breathWords = els.ayahsContainer.querySelectorAll('.q-word.in-breath-active');
    breathWords.forEach(w => w.classList.remove('in-breath-active'));

    state.activeBreathGroup = null;
    if (els.breathIndicator) els.breathIndicator.style.display = 'none';
  }

  let lastScrollTime = 0;
  function scrollElementIntoView(el) {
    const now = Date.now();
    if (now - lastScrollTime < 300) return; // throttle scrolling
    lastScrollTime = now;

    const viewportRect = els.viewport.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Check if element is out of comfortable viewing zone
    const isAbove = elRect.top < viewportRect.top + 80;
    const isBelow = elRect.bottom > viewportRect.bottom - 120;

    if (isAbove || isBelow) {
      el.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }

  // ==========================================================================
  // Interactive Seeking (Word / Ayah)
  // ==========================================================================
  function seekToWord(ayahNumber, wordNumber) {
    if (!state.timingIntervals.length) return;

    const found = state.timingIntervals.find(i => i.ayah === ayahNumber && i.word === wordNumber);

    if (found) {
      const seekSec = Math.max(0, (found.startMs - state.syncOffset) / 1000);
      els.audio.currentTime = seekSec;
      if (els.audio.paused) {
        els.audio.play();
      }
      showToast(`الانتقال إلى الكلمة: ${found.text}`);
    } else {
      seekToAyah(ayahNumber);
    }
  }

  function seekToAyah(ayahNumber) {
    if (!state.timingIntervals.length) return;

    // Find first interval of that ayah
    const found = state.timingIntervals.find(i => i.ayah === ayahNumber);

    if (found) {
      const seekSec = Math.max(0, (found.startMs - state.syncOffset) / 1000);
      els.audio.currentTime = seekSec;
      if (els.audio.paused) {
        els.audio.play();
      }
      showToast(`الانتقال إلى الآية ${ayahNumber}`);
    }
  }

  function stepWord(direction) {
    if (!state.timingIntervals.length) return;

    const curMs = Math.round(els.audio.currentTime * 1000) + state.syncOffset;
    let idx = state.timingIntervals.findIndex(i => curMs >= i.startMs && curMs < i.endMs);

    if (idx === -1) {
      idx = state.timingIntervals.findIndex(i => i.startMs > curMs);
      if (idx === -1) idx = state.timingIntervals.length - 1;
    }

    const nextIdx = Math.max(0, Math.min(state.timingIntervals.length - 1, idx + direction));
    const target = state.timingIntervals[nextIdx];
    if (target) {
      els.audio.currentTime = Math.max(0, target.startMs / 1000);
    }
  }

  // ==========================================================================
  // Audio Controls & Timeline Scrubber
  // ==========================================================================
  function togglePlay() {
    if (els.audio.paused) {
      els.audio
        .play()
        .then(() => {
          updatePlayIcon(true);
          startSyncLoop();
        })
        .catch(err => {
          console.error('Play error:', err);
          showToast('تعذر تشغيل الصوت، تحقق من الاتصال بالإنترنت');
        });
    } else {
      els.audio.pause();
      updatePlayIcon(false);
      stopSyncLoop();
    }
  }

  function updatePlayIcon(isPlaying) {
    els.playIcon.style.display = isPlaying ? 'none' : 'block';
    els.pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }

  function updateScrubber() {
    const dur = els.audio.duration || 0;
    const cur = els.audio.currentTime || 0;

    els.timeNow.textContent = formatTime(cur);
    els.timeTotal.textContent = formatTime(dur);

    if (dur > 0) {
      const pct = (cur / dur) * 100;
      els.scrubberFill.style.width = `${pct}%`;
      els.scrubberKnob.style.left = `${pct}%`;

      // Buffered progress
      if (els.audio.buffered.length > 0) {
        const bufEnd = els.audio.buffered.end(els.audio.buffered.length - 1);
        els.scrubberBuffered.style.width = `${(bufEnd / dur) * 100}%`;
      }
    }
  }

  function onScrubberClick(e) {
    const rect = els.scrubberBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, clickX / rect.width));

    if (els.audio.duration) {
      els.audio.currentTime = pct * els.audio.duration;
    }
  }

  // ==========================================================================
  // Quality & Speed Switches
  // ==========================================================================
  function cycleQuality() {
    const qualities = ['original', 'mp3_64', 'opus_48'];
    let nextIdx = (qualities.indexOf(state.currentQuality) + 1) % qualities.length;
    state.currentQuality = qualities[nextIdx];
    localStorage.setItem('tarteel_quality', state.currentQuality);

    els.btnQuality.textContent = getQualityLabel(state.currentQuality);
    showToast(`تم تبديل الجودة إلى: ${getQualityLabel(state.currentQuality)}`);

    // Retain playback position seamlessly
    const curTime = els.audio.currentTime;
    const wasPlaying = !els.audio.paused;

    loadSurahAudioAndTimings().then(() => {
      els.audio.currentTime = curTime;
      if (wasPlaying) els.audio.play();
    });
  }

  function cycleSpeed() {
    const speeds = [0.75, 1.0, 1.25, 1.5];
    let nextIdx = (speeds.indexOf(state.playbackRate) + 1) % speeds.length;
    state.playbackRate = speeds[nextIdx];
    localStorage.setItem('tarteel_speed', state.playbackRate);

    els.audio.playbackRate = state.playbackRate;
    els.btnSpeed.textContent = `${state.playbackRate}x`;
    showToast(`سرعة القراءة: ${state.playbackRate}x`);
  }

  // ==========================================================================
  // Timing Calibration & Feedback Generator
  // ==========================================================================
  function setSyncOffset(val) {
    state.syncOffset = parseInt(val, 10);
    localStorage.setItem('tarteel_sync_offset', state.syncOffset);
    els.timingOffsetSlider.value = state.syncOffset;
    els.liveOffsetLabel.textContent = `${state.syncOffset > 0 ? '+' : ''}${state.syncOffset} ms`;

    // Highlight preset if matching
    $$('.btn-preset').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.val, 10) === state.syncOffset);
    });

    updateSyncHighlight();
  }

  function copyTimingFeedback() {
    if (!state.currentReciter || !state.currentRecitation) return;

    const s = state.surahs.find(x => x.number === state.currentSurah);
    const curMs = Math.round(els.audio.currentTime * 1000);
    const curInterval = state.activeInterval;

    const report = [
      `### 📝 ملاحظة حول دقة التوقيت (mp3quran API v4 Staging)`,
      `- **القارئ**: ${state.currentReciter.name} (\`${state.currentRecitation.code}\`)`,
      `- **السورة**: سورة ${s ? s.name_ar : state.currentSurah} (رقم ${state.currentSurah})`,
      curInterval
        ? `- **الموضع**: الآية ${curInterval.ayah} ${curInterval.word ? `· الكلمة: "${curInterval.text}" (رقم ${curInterval.word})` : ''}`
        : `- **الموضع التقريبي**: ثانية ${formatTime(els.audio.currentTime)}`,
      curInterval ? `- **توقيت الاستجابة المسجل**: \`[${curInterval.startMs}ms - ${curInterval.endMs}ms]\`` : '',
      `- **موضع الصوت الفعلي**: \`${curMs}ms\``,
      `- **إزاحة المعايرة المضبوطة**: \`${state.syncOffset > 0 ? '+' : ''}${state.syncOffset}ms\``,
      `- **الصيغة والصوت**: ${state.currentQuality}`,
      `- **إصدار التوقيت (Release)**: \`${state.timingRelease}\``,
      `- **رابط التوقيت**: \`${API_BASE}/recitations/${state.currentRecitation.code}/surahs/${state.currentSurah}/word-timings\``
    ]
      .filter(Boolean)
      .join('\n');

    navigator.clipboard
      .writeText(report)
      .then(() => {
        showToast('تم نسخ تقرير الملاحظة بنجاح! يمكنك لصقه في منتدى إتقان');
      })
      .catch(() => {
        showToast('يرجى السماح بالنسخ إلى الحافظة');
      });
  }

  // ==========================================================================
  // Sidebar & Navigation Controls
  // ==========================================================================
  function openSidebar() {
    state.isSidebarOpen = true;
    els.sidebar.classList.add('open');
    els.sidebarBackdrop.classList.add('open');
  }

  function closeSidebar() {
    state.isSidebarOpen = false;
    els.sidebar.classList.remove('open');
    els.sidebarBackdrop.classList.remove('open');
  }

  function toggleSidebar() {
    if (state.isSidebarOpen) closeSidebar();
    else openSidebar();
  }

  function toggleTimingDrawer() {
    state.isDrawerOpen = !state.isDrawerOpen;
    els.timingDrawer.classList.toggle('open', state.isDrawerOpen);
    els.btnTimingTools.classList.toggle('active', state.isDrawerOpen);
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'sepia' : 'dark';
    localStorage.setItem('tarteel_theme', state.theme);
    initTheme();
    showToast(`تم تفعيل النمط: ${state.theme === 'dark' ? 'الداكن الفاخر' : 'القرآني الورقي'}`);
  }

  // ==========================================================================
  // Event Listeners Binding
  // ==========================================================================
  function initEventListeners() {
    // Audio Events
    els.audio.addEventListener('play', () => {
      updatePlayIcon(true);
      startSyncLoop();
    });
    els.audio.addEventListener('pause', () => {
      updatePlayIcon(false);
      stopSyncLoop();
    });
    els.audio.addEventListener('timeupdate', updateScrubber);
    els.audio.addEventListener('ended', () => {
      // Auto-advance to next surah
      if (state.currentSurah < 114) {
        openSurah(state.currentSurah + 1).then(() => {
          els.audio.play();
        });
      }
    });

    // Playback Controls
    els.btnPlayPause.addEventListener('click', togglePlay);
    els.scrubberBar.addEventListener('click', onScrubberClick);
    els.btnQuality.addEventListener('click', cycleQuality);
    els.btnSpeed.addEventListener('click', cycleSpeed);

    // Prev / Next Ayah
    els.btnPrevAyah.addEventListener('click', () => {
      if (state.activeInterval && state.activeInterval.ayah > 1) {
        seekToAyah(state.activeInterval.ayah - 1);
      } else {
        seekToAyah(1);
      }
    });

    els.btnNextAyah.addEventListener('click', () => {
      if (state.activeInterval && state.surahData && state.activeInterval.ayah < state.surahData.ayah_count) {
        seekToAyah(state.activeInterval.ayah + 1);
      }
    });

    // Volume & Mute
    els.volumeSlider.addEventListener('input', e => {
      els.audio.volume = parseFloat(e.target.value);
    });

    els.btnMute.addEventListener('click', () => {
      els.audio.muted = !els.audio.muted;
      els.btnMute.style.opacity = els.audio.muted ? '0.4' : '1';
    });

    // Sidebar Toggling
    els.btnToggleSidebar.addEventListener('click', toggleSidebar);
    els.sidebarBackdrop.addEventListener('click', closeSidebar);

    // Sidebar Tabs
    els.tabReciters.addEventListener('click', () => {
      state.activeSidebarTab = 'reciters';
      els.tabReciters.classList.add('active');
      els.tabSurahs.classList.remove('active');
      els.recitersList.style.display = 'flex';
      els.surahsList.style.display = 'none';
      $('.filter-chips').style.display = 'flex';
      els.searchInput.placeholder = 'ابحث عن اسم القارئ...';
    });

    els.tabSurahs.addEventListener('click', () => {
      state.activeSidebarTab = 'surahs';
      els.tabSurahs.classList.add('active');
      els.tabReciters.classList.remove('active');
      els.surahsList.style.display = 'flex';
      els.recitersList.style.display = 'none';
      $('.filter-chips').style.display = 'none';
      els.searchInput.placeholder = 'ابحث باسم السورة أو رقمها...';
    });

    // Search Input
    els.searchInput.addEventListener('input', e => {
      state.searchQuery = e.target.value;
      els.searchClear.classList.toggle('visible', Boolean(state.searchQuery));
      if (state.activeSidebarTab === 'reciters') renderRecitersList();
      else renderSurahsList();
    });

    els.searchClear.addEventListener('click', () => {
      state.searchQuery = '';
      els.searchInput.value = '';
      els.searchClear.classList.remove('visible');
      if (state.activeSidebarTab === 'reciters') renderRecitersList();
      else renderSurahsList();
    });

    // Filter Chips
    els.filterChips.forEach(chip => {
      chip.addEventListener('click', () => {
        els.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        state.reciterFilter = chip.dataset.filter;
        renderRecitersList();
      });
    });

    // Timing Tools & Drawer
    els.btnTimingTools.addEventListener('click', toggleTimingDrawer);
    els.btnCloseDrawer.addEventListener('click', toggleTimingDrawer);

    els.timingOffsetSlider.addEventListener('input', e => {
      setSyncOffset(e.target.value);
    });

    $$('.btn-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        setSyncOffset(btn.dataset.val);
      });
    });

    els.btnCopyFeedback.addEventListener('click', copyTimingFeedback);

    // AutoScroll Button
    els.btnAutoScroll.addEventListener('click', () => {
      state.autoScroll = !state.autoScroll;
      localStorage.setItem('tarteel_autoscroll', state.autoScroll);
      els.btnAutoScroll.classList.toggle('active', state.autoScroll);
      showToast(state.autoScroll ? 'تم تفعيل التمرير التلقائي' : 'تم تعطيل التمرير التلقائي');
    });

    // Highlight Scope Button (Ayah vs Breath Segment)
    els.btnHighlightScope.addEventListener('click', toggleHighlightScope);

    // Theme Toggle
    els.btnThemeToggle.addEventListener('click', toggleTheme);

    // Keyboard Shortcuts
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        // RTL forward
        stepWord(1);
      } else if (e.key === 'ArrowLeft') {
        // RTL backward
        stepWord(-1);
      } else if (e.key === '[') {
        setSyncOffset(state.syncOffset - 10);
      } else if (e.key === ']') {
        setSyncOffset(state.syncOffset + 10);
      } else if (e.key === 'm' || e.key === 'M') {
        els.btnMute.click();
      } else if (e.key === 'Escape') {
        if (state.isDrawerOpen) toggleTimingDrawer();
        if (state.isSidebarOpen) closeSidebar();
      }
    });
  }

  // Run on DOM ready
  document.addEventListener('DOMContentLoaded', initApp);
})();

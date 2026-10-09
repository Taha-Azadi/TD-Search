/**
 * app.js — Main application controller / UI wiring
 * TD Search — Offline Search Engine
 * build: 20261009h-newchat — strict tabs videos/maps/ai
 */

(function () {
  'use strict';

  let storage, indexer, searchEngine, crawler, onlineSearch;
  let currentQuery = '';
  let currentPage = 1;
  let currentResults = null;
  let currentSearchType = 'web'; // web | images | news | videos | maps | ai | local
  let aiChatHistory = []; // [{role:'user'|'assistant', content:string}]
  let aiSessionQuery = ''; // first message of current AI chat

  // Global tab switcher (also used by inline onclick on tab buttons)
  window.__tdSetType = async function(type) {
    type = String(type || 'web');
    console.log('[TD Search] __tdSetType', type);
    currentSearchType = type;
    window.__tdSearchType = type;
    try { updateSearchTabs(); } catch (e) {}
    // Auto-enable AI when opening AI tab
    if (type === 'ai' && onlineSearch) {
      try { await onlineSearch.setAiEnabled(true); } catch (e) {}
      const aiEn = document.getElementById('setting-ai-enabled');
      if (aiEn) aiEn.checked = true;
      // Show composer even without a query
      const composer = document.getElementById('ai-composer');
      if (composer) composer.hidden = false;
      showResults();
      const aiEl = document.getElementById('ai-answer');
      if (aiEl && !aiChatHistory.length) {
        aiEl.hidden = false;
        aiEl.innerHTML = '<div class="ai-badge">AI chat</div><div class="ai-thread"><div class="ai-msg ai-msg-assistant"><div class="ai-msg-body">پیامت را بنویس و Send بزن (یا در نوار جستجو Enter بزن).</div></div></div>';
      }
    }
    var q = (typeof currentQuery === 'string' && currentQuery) || '';
    if (!q) {
      var hi = document.getElementById('header-search-input');
      var si = document.getElementById('search-input');
      q = (hi && hi.value) || (si && si.value) || '';
    }
    q = (q || '').trim();
    if (q) {
      doSearch(q, 1, type);
    }
  };
  let autocompleteIndex = -1;
  let debounceTimer = null;
  let selectedImportFiles = null;

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const els = {};

  function cacheElements() {
    els.homeView = $('#home-view');
    els.resultsView = $('#results-view');
    els.headerSearch = $('#header-search');
    els.searchInput = $('#search-input');
    els.headerSearchInput = $('#header-search-input');
    els.searchForm = $('#search-form');
    els.mainClear = $('#main-clear');
    els.headerClear = $('#header-clear');
    els.autocomplete = $('#autocomplete');
    els.statDocs = $('#stat-docs');
    els.statSize = $('#stat-size');
    els.statUpdated = $('#stat-updated');
    els.recentSearches = $('#recent-searches');
    els.recentList = $('#recent-list');
    els.emptyState = $('#empty-state');
    els.resultsList = $('#results-list');
    els.resultsCount = $('#results-count');
    els.resultsTime = $('#results-time');
    els.noResults = $('#no-results');
    els.pagination = $('#pagination');
    els.importModal = $('#import-modal');
    els.settingsModal = $('#settings-modal');
    els.operatorsModal = $('#operators-modal');
    els.dropZone = $('#drop-zone');
    els.fileInput = $('#file-input');
    els.importProgress = $('#import-progress');
    els.progressFill = $('#progress-fill');
    els.progressText = $('#progress-text');
    els.importLog = $('#import-log');
    els.importSummary = $('#import-summary');
    els.startImportBtn = $('#start-import-btn');
    els.toastContainer = $('#toast-container');
    els.debugPanel = $('#debug-panel');
    els.debugContent = $('#debug-content');
    els.themeToggle = $('#theme-toggle');
  }

  async function init() {
    cacheElements();
    storage = new Storage();
    await storage.init();
    indexer = new Indexer(storage);
    await indexer.load();
    const seeded = await indexer.seedDemoIfEmpty();
    if (seeded) toast('Demo documents loaded. Search or import your own HTML files for online search and ai enable on settings.', 'info');
    searchEngine = new SearchEngine(indexer);
    crawler = new Crawler(indexer);
    onlineSearch = new OnlineSearch(storage);
    await loadSettings();
    applyTheme(await storage.getSetting('theme', 'system'));
    bindEvents();
    await refreshStats();
    await renderRecentSearches();
    updateEmptyState();
    document.addEventListener('keydown', handleGlobalKeys);
  }

  async function loadSettings() {
    const opts = {
      resultsPerPage: parseInt(await storage.getSetting('resultsPerPage', 20), 10),
      highlight: await storage.getSetting('highlight', true),
      exactPhrase: await storage.getSetting('exactPhrase', true),
      fuzzy: await storage.getSetting('fuzzy', false),
      searchTitle: await storage.getSetting('searchTitle', true),
      searchContent: await storage.getSetting('searchContent', true)
    };
    searchEngine.updateOptions(opts);
    const theme = await storage.getSetting('theme', 'system');
    const themeSelect = $('#setting-theme');
    if (themeSelect) themeSelect.value = theme;
    const perPage = $('#setting-per-page');
    if (perPage) perPage.value = String(opts.resultsPerPage);
    const checks = {
      'setting-highlight': opts.highlight,
      'setting-phrase': opts.exactPhrase,
      'setting-fuzzy': opts.fuzzy,
      'setting-search-title': opts.searchTitle,
      'setting-search-content': opts.searchContent,
      'setting-debug': await storage.getSetting('debug', false),
      'setting-online-enabled': await storage.getSetting('onlineSearchEnabled', false)
    };
    Object.entries(checks).forEach(([id, val]) => {
      const el = $('#' + id);
      if (el) el.checked = !!val;
    });
    if (checks['setting-debug']) {
      els.debugPanel.hidden = false;
      updateDebugPanel();
    }

    // SerpAPI settings
    const apiKey = await storage.getSetting('serpapiKey', '');
    const keyInput = $('#setting-serpapi-key');
    if (keyInput) keyInput.value = apiKey || '';
    const modeSelect = $('#setting-search-mode');
    if (modeSelect) modeSelect.value = await storage.getSetting('searchMode', 'both');
    updateSerpApiStatus();
    const aiEn = $('#setting-ai-enabled');
    if (aiEn) aiEn.checked = !!(await storage.getSetting('aiSearchEnabled', false));
    const modelSelLoad = $('#setting-or-model');
    if (modelSelLoad) modelSelLoad.value = await storage.getSetting('openrouterModel', 'openai/gpt-4o-mini');
  }

  async function updateSerpApiStatus() {
    const statusEl = $('#serpapi-status');
    if (!statusEl) return;
    const key = await onlineSearch.getApiKey();
    const enabled = await storage.getSetting('onlineSearchEnabled', false);
    if (!key) {
      statusEl.textContent = 'No API key saved.';
      statusEl.style.color = 'var(--text-muted)';
    } else if (enabled) {
      statusEl.textContent = 'Online search enabled · key saved locally.';
      statusEl.style.color = 'var(--success)';
    } else {
      statusEl.textContent = 'Key saved · online search is currently disabled.';
      statusEl.style.color = 'var(--warning)';
    }
  }

  async function saveSetting(key, value) {
    await storage.setSetting(key, value);
  }

  function applyTheme(mode) {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
  }

  function bindEvents() {
    els.searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      doSearch(els.searchInput.value, 1, currentSearchType);
      return false;
    });
    const searchBtn = document.getElementById('search-btn');
    if (searchBtn) {
      searchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        doSearch(els.searchInput.value, 1, currentSearchType);
      });
    }
    if (els.headerSearchInput) {
      els.headerSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          doSearch(els.headerSearchInput.value, 1, currentSearchType);
        }
      });
    }
    els.mainClear.addEventListener('click', () => {
      els.searchInput.value = '';
      els.mainClear.hidden = true;
      hideAutocomplete();
      els.searchInput.focus();
    });
    if (els.headerClear) {
      els.headerClear.addEventListener('click', () => {
        els.headerSearchInput.value = '';
        els.headerClear.hidden = true;
      });
    }
    els.searchInput.addEventListener('input', onSearchInput);
    if (els.headerSearchInput) {
      els.headerSearchInput.addEventListener('input', () => {
        els.headerClear.hidden = !els.headerSearchInput.value;
      });
    }
    els.searchInput.addEventListener('keydown', onSearchKeydown);
    $('#logo-btn').addEventListener('click', (e) => { e.preventDefault(); showHome(); });
    $('#import-btn').addEventListener('click', openImportModal);
    $('#import-home-btn').addEventListener('click', openImportModal);
    $('#empty-import-btn').addEventListener('click', openImportModal);
    $('#settings-btn').addEventListener('click', openSettingsModal);
    $('#operators-help-btn').addEventListener('click', () => openModal(els.operatorsModal));
    els.themeToggle.addEventListener('click', async () => {
      const current = await storage.getSetting('theme', 'system');
      let next;
      if (current === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        next = prefersDark ? 'light' : 'dark';
      } else if (current === 'dark') next = 'light';
      else next = 'dark';
      await saveSetting('theme', next);
      applyTheme(next);
      const sel = $('#setting-theme');
      if (sel) sel.value = next;
    });
    $$('.modal-close').forEach(btn => btn.addEventListener('click', closeAllModals));
    $$('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAllModals(); });
    });
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
    els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
    els.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      els.dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFileSelection(e.dataTransfer.files);
    });
    els.fileInput.addEventListener('change', () => {
      if (els.fileInput.files.length) handleFileSelection(els.fileInput.files);
    });
    els.startImportBtn.addEventListener('click', startImport);
    $('#clear-history-btn').addEventListener('click', async () => {
      await storage.clearHistory();
      await renderRecentSearches();
      toast('Search history cleared', 'info');
    });
    $$('input[name="filter-type"], input[name="sort-by"]').forEach(el => {
      el.addEventListener('change', () => { if (currentQuery) doSearch(currentQuery, 1); });
    });
    // AI chat composer
    const aiSend = document.getElementById('ai-send-btn');
    const aiClear = document.getElementById('ai-clear-btn');
    const aiInput = document.getElementById('ai-chat-input');
    if (aiSend && aiInput) {
      const sendAi = () => {
        const msg = (aiInput.value || '').trim();
        if (!msg) return;
        currentSearchType = 'ai';
        updateSearchTabs();
        aiInput.value = '';
        // Follow-up in same chat
        doSearch(msg, 1, 'ai', { continueChat: true });
      };
      aiSend.addEventListener('click', sendAi);
      aiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendAi();
        }
      });
    }
    if (aiClear) {
      aiClear.addEventListener('click', () => {
        aiChatHistory = [];
        aiSessionQuery = '';
        const aiEl = document.getElementById('ai-answer');
        if (aiEl) {
          aiEl.hidden = false;
          aiEl.innerHTML = '<div class="ai-badge">New chat</div><div class="ai-thread"><div class="ai-msg ai-msg-assistant"><div class="ai-msg-body">چت جدید آماده است. پیام بفرست.</div></div></div>';
        }
      });
    }

    // Search type tabs — always force type + re-query
    document.addEventListener('click', (e) => {
      const tab = e.target.closest('.search-tab');
      if (!tab) return;
      e.preventDefault();
      e.stopPropagation();
      const type = tab.getAttribute('data-type');
      if (!type) return;
      console.log('[TD Search] tab click →', type);
      currentSearchType = type;
      window.__tdSearchType = type;
      updateSearchTabs();
      const q = currentQuery || (els.headerSearchInput && els.headerSearchInput.value) || els.searchInput.value;
      if (q && q.trim()) {
        doSearch(q.trim(), 1, type);
      }
    });
    $('#setting-theme').addEventListener('change', async (e) => {
      await saveSetting('theme', e.target.value);
      applyTheme(e.target.value);
    });
    $('#setting-per-page').addEventListener('change', async (e) => {
      const val = parseInt(e.target.value, 10);
      await saveSetting('resultsPerPage', val);
      searchEngine.updateOptions({ resultsPerPage: val });
      if (currentQuery) doSearch(currentQuery, 1);
    });
    const settingMap = {
      'setting-highlight': 'highlight',
      'setting-phrase': 'exactPhrase',
      'setting-fuzzy': 'fuzzy',
      'setting-search-title': 'searchTitle',
      'setting-search-content': 'searchContent'
    };
    Object.entries(settingMap).forEach(([id, key]) => {
      const el = $('#' + id);
      if (el) {
        el.addEventListener('change', async () => {
          await saveSetting(key, el.checked);
          searchEngine.updateOptions({ [key]: el.checked });
          if (currentQuery) doSearch(currentQuery, currentPage);
        });
      }
    });
    $('#setting-debug').addEventListener('change', async (e) => {
      await saveSetting('debug', e.target.checked);
      els.debugPanel.hidden = !e.target.checked;
      if (e.target.checked) updateDebugPanel();
    });

    // SerpAPI settings
    const onlineEnabledEl = $('#setting-online-enabled');
    if (onlineEnabledEl) {
      onlineEnabledEl.addEventListener('change', async () => {
        await onlineSearch.setEnabled(onlineEnabledEl.checked);
        await updateSerpApiStatus();
      });
    }
    const keyInput = $('#setting-serpapi-key');
    if (keyInput) {
      keyInput.addEventListener('change', async () => {
        await onlineSearch.setApiKey(keyInput.value);
        await updateSerpApiStatus();
        toast('API key saved locally', 'info');
      });
      keyInput.addEventListener('blur', async () => {
        await onlineSearch.setApiKey(keyInput.value);
        await updateSerpApiStatus();
      });
    }
    const modeSelect = $('#setting-search-mode');
    if (modeSelect) {
      modeSelect.addEventListener('change', async () => {
        await saveSetting('searchMode', modeSelect.value);
      });
    }
    const toggleKeyBtn = $('#toggle-key-visibility');
    if (toggleKeyBtn && keyInput) {
      toggleKeyBtn.addEventListener('click', () => {
        if (keyInput.type === 'password') {
          keyInput.type = 'text';
          toggleKeyBtn.textContent = 'Hide';
        } else {
          keyInput.type = 'password';
          toggleKeyBtn.textContent = 'Show';
        }
      });
    }
    const aiEnabledEl = $('#setting-ai-enabled');
    if (aiEnabledEl) {
      aiEnabledEl.addEventListener('change', async () => {
        await onlineSearch.setAiEnabled(aiEnabledEl.checked);
      });
    }
    const modelSel = $('#setting-or-model');
    if (modelSel) {
      modelSel.addEventListener('change', async () => {
        await saveSetting('openrouterModel', modelSel.value);
      });
    }

    const testBtn = $('#test-serpapi-btn');
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = 'Testing…';
        // 1) Check local proxy is running
        const health = await onlineSearch.testProxy();
        if (!health.ok) {
          testBtn.disabled = false;
          testBtn.textContent = 'Test API Key';
          toast(health.error || 'Proxy not running', 'error');
          const statusEl = $('#serpapi-status');
          if (statusEl) {
            statusEl.textContent = health.error || 'Proxy not running';
            statusEl.style.color = 'var(--danger)';
          }
          return;
        }
        // 2) Run a real search through the proxy
        const result = await onlineSearch.search('test', { num: 1 });
        testBtn.disabled = false;
        testBtn.textContent = 'Test API Key';
        if (result.error) {
          toast('API error: ' + result.error, 'error');
          const statusEl = $('#serpapi-status');
          if (statusEl) {
            statusEl.textContent = 'Error: ' + result.error;
            statusEl.style.color = 'var(--danger)';
          }
        } else {
          toast('Proxy + SerpAPI working', 'success');
          await onlineSearch.setEnabled(true);
          const en = $('#setting-online-enabled');
          if (en) en.checked = true;
          await updateSerpApiStatus();
        }
      });
    }
    const clearKeyBtn = $('#clear-serpapi-btn');
    if (clearKeyBtn) {
      clearKeyBtn.addEventListener('click', async () => {
        if (!confirm('Remove the saved SerpAPI key from this browser?')) return;
        await onlineSearch.setApiKey('');
        if (keyInput) keyInput.value = '';
        await onlineSearch.setEnabled(false);
        if (onlineEnabledEl) onlineEnabledEl.checked = false;
        await updateSerpApiStatus();
        toast('API key cleared', 'info');
      });
    }

    $('#export-index-btn').addEventListener('click', exportIndex);
    $('#import-index-btn').addEventListener('click', () => $('#index-file-input').click());
    $('#index-file-input').addEventListener('change', importIndexFile);
    $('#rebuild-index-btn').addEventListener('click', rebuildIndex);
    $('#clear-index-btn').addEventListener('click', clearIndex);
    window.addEventListener('scroll', () => {
      const header = $('#header');
      if (window.scrollY > 4) header.classList.add('scrolled');
      else header.classList.remove('scrolled');
    }, { passive: true });
  }


  async function doSearch(query, page = 1, typeOverride, options = {}) {
    query = (query || '').trim();
    if (!query) return;
    currentQuery = query;
    currentPage = page;
    if (typeOverride) currentSearchType = typeOverride;
    const type = (typeOverride || currentSearchType || 'web');
    currentSearchType = type;
    window.__tdSearchType = type;
    console.log('[TD Search] doSearch type=', type, 'query=', query);

    els.searchInput.value = query;
    if (els.headerSearchInput) els.headerSearchInput.value = query;
    els.mainClear.hidden = !query;
    if (els.headerClear) els.headerClear.hidden = !query;
    hideAutocomplete();
    await storage.addHistory(query);
    updateSearchTabs();

    // Clear previous UI immediately so tab switches never show stale "All" results
    const listEl0 = els.resultsList || $('#results-list');
    if (listEl0) { listEl0.innerHTML = ''; listEl0.hidden = true; }
    ['image-grid','video-grid','maps-list','answer-box','ai-answer','related-searches'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = ''; el.hidden = true; }
    });
    if (els.resultsCount) els.resultsCount.textContent = 'Searching…';
    if (els.resultsTime) els.resultsTime.textContent = '';
    if (els.noResults) els.noResults.hidden = true;

    const perPageSetting = parseInt(await storage.getSetting('resultsPerPage', 20), 10);
    const onlineEnabled = await onlineSearch.isEnabled();

    let result = {
      results: [],
      images: [],
      videos: [],
      maps: [],
      answer: '',
      model: '',
      total: 0,
      page,
      perPage: perPageSetting,
      query: { raw: query },
      took: 0,
      type,
      extras: null,
      onlineError: null
    };

    // ---- Helper: local index search ----
    function runLocalSearch() {
      searchEngine.updateOptions({ resultsPerPage: 10000 });
      const local = searchEngine.search(query, 1);
      searchEngine.updateOptions({ resultsPerPage: perPageSetting });
      return {
        results: (local.results || []).map(r => ({ ...r, source: r.source || 'local' })),
        took: local.took || 0
      };
    }

    // LOCAL tab — offline index only
    if (type === 'local') {
      const local = runLocalSearch();
      const startIdx = (page - 1) * perPageSetting;
      result.results = local.results.slice(startIdx, startIdx + perPageSetting);
      result.total = local.results.length;
      result.took = local.took;
      result.localCount = local.results.length;
    }
    // AI tab
    else if (type === 'ai') {
      // Always allow AI when tab is used (auto-enable)
      await onlineSearch.setAiEnabled(true);

      // New chat when:
      // - explicit options.newChat
      // - OR main search (not continueChat) with a different query than session
      const continueChat = !!(options && options.continueChat);
      const forceNew = !!(options && options.newChat);
      if (forceNew || (!continueChat && query !== aiSessionQuery && aiChatHistory.length > 0)) {
        aiChatHistory = [];
        aiSessionQuery = query;
      }
      if (!aiSessionQuery) aiSessionQuery = query;

      const web = await onlineSearch.search(query, {
        type: 'ai',
        history: aiChatHistory.slice(-12)
      });
      result.took = web.took || 0;
      if (web.error) result.onlineError = web.error;
      result.answer = web.answer || '';
      result.model = web.model || '';
      result.total = result.answer ? 1 : 0;
      if (result.answer && !web.error) {
        aiChatHistory.push({ role: 'user', content: query });
        aiChatHistory.push({ role: 'assistant', content: result.answer });
        if (aiChatHistory.length > 24) aiChatHistory = aiChatHistory.slice(-24);
      }
    }
    // Images / Videos / News / Maps — online only
    else if (type === 'images' || type === 'videos' || type === 'news' || type === 'maps') {
      if (!onlineEnabled) {
        result.onlineError = 'Online search disabled. Enable it in Settings and run the proxy with --key.';
      } else {
        const web = await onlineSearch.search(query, {
          type: type,
          num: type === 'images' ? 30 : 12
        });
        result.took = web.took || 0;
        if (web.error) result.onlineError = web.error;
        if (type === 'images') {
          result.images = web.images || [];
          result.total = result.images.length;
        } else if (type === 'videos') {
          result.videos = web.videos || web.results || [];
          result.results = result.videos;
          result.total = result.videos.length;
        } else if (type === 'maps') {
          result.maps = web.maps || web.results || [];
          result.results = result.maps;
          result.total = result.maps.length;
        } else {
          result.results = web.results || [];
          result.total = result.results.length;
        }
        result.onlineCount = result.total;
      }
    }
    // ALL / web — online + local hybrid (always show local if online off/fails)
    else {
      let onlineResults = [];
      let onlineTook = 0;
      let extras = null;
      if (onlineEnabled) {
        const web = await onlineSearch.search(query, { type: 'web', num: 12 });
        onlineTook = web.took || 0;
        if (web.error) result.onlineError = web.error;
        else {
          onlineResults = web.results || [];
          extras = web.extras || null;
        }
      }
      const local = runLocalSearch();
      // Prefer web first, then local (avoid dupes by url)
      const seen = new Set();
      const merged = [];
      for (const r of onlineResults) {
        const key = (r.url || r.title || '').toLowerCase();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        merged.push(r);
      }
      for (const r of local.results) {
        const key = (r.url || r.title || '').toLowerCase();
        if (key && seen.has(key)) continue;
        if (key) seen.add(key);
        merged.push(r);
      }
      const startIdx = (page - 1) * perPageSetting;
      result.results = merged.slice(startIdx, startIdx + perPageSetting);
      result.total = merged.length;
      result.took = onlineTook + local.took;
      result.localCount = local.results.length;
      result.onlineCount = onlineResults.length;
      result.extras = extras;
      if (!onlineEnabled && merged.length === 0) {
        result.onlineError = null; // pure local empty is fine
      } else if (!onlineEnabled) {
        // silent — local results are enough
      }
    }

    currentResults = result;
    renderResults(result);
    showResults();
    await renderRecentSearches();
    updateDebugPanel(result);

    if (result.onlineError) {
      toast('Online: ' + result.onlineError, 'error');
    }
  }

  function updateSearchTabs() {
    const tabs = $$('.search-tab');
    tabs.forEach(tab => {
      const t = tab.getAttribute('data-type');
      const active = t === currentSearchType;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const badge = document.getElementById('mode-badge');
    if (badge) {
      const labels = {
        web: 'All · google',
        images: 'Images · google_images',
        videos: 'Videos · google_videos',
        news: 'News · google_news',
        maps: 'Maps · google_maps',
        ai: 'AI · openrouter',
        local: 'Local · offline'
      };
      badge.textContent = labels[currentSearchType] || currentSearchType;
      badge.setAttribute('data-mode', currentSearchType || 'web');
    }
  }


  function renderMarkdown(src) {
    let s = escapeHtml(src || '');
    s = s.replace(/```([\s\S]*?)```/g, (_, code) => `<pre class="md-code"><code>${code}</code></pre>`);
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline">$1</code>');
    s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    s = s.replace(/\n{2,}/g, '</p><p>');
    s = s.replace(/\n/g, '<br>');
    return `<p>${s}</p>`;
  }

  function renderResults(result) {
    const { results, images, videos, maps, total, page, perPage, took, type, extras, onlineError, answer, model } = result;

    const labelMap = { images: 'images', videos: 'videos', maps: 'places', ai: 'answer' };
    const countLabel = labelMap[type] || 'results';
    els.resultsCount.textContent = total === 0
      ? 'No results'
      : (type === 'ai' ? 'AI answer' : `About ${total.toLocaleString()} ${countLabel}`);
    els.resultsTime.textContent = took != null ? `(${took.toFixed(1)} ms)` : '';

    const listEl = els.resultsList || $('#results-list');
    const gridEl = $('#image-grid');
    const videoEl = $('#video-grid');
    const mapsEl = $('#maps-list');
    const answerEl = $('#answer-box');
    const aiEl = $('#ai-answer');
    const relatedEl = $('#related-searches');
    const noRes = els.noResults;

    listEl.innerHTML = '';
    if (gridEl) gridEl.innerHTML = '';
    if (videoEl) videoEl.innerHTML = '';
    if (mapsEl) mapsEl.innerHTML = '';
    if (answerEl) { answerEl.innerHTML = ''; answerEl.hidden = true; }
    if (aiEl) { aiEl.innerHTML = ''; aiEl.hidden = true; }
    if (relatedEl) { relatedEl.innerHTML = ''; relatedEl.hidden = true; }

    const isImages = type === 'images';
    const isVideos = type === 'videos';
    const isMaps = type === 'maps';
    const isAi = type === 'ai';

    if (listEl) listEl.hidden = isImages || isVideos || isMaps || isAi || total === 0;
    if (gridEl) gridEl.hidden = !isImages || total === 0;
    if (videoEl) videoEl.hidden = !isVideos || total === 0;
    if (mapsEl) mapsEl.hidden = !isMaps || total === 0;
    if (noRes) noRes.hidden = isAi || total > 0;
    const composer = document.getElementById('ai-composer');
    if (composer) composer.hidden = !isAi;

    // AI answer panel
    if (isAi && aiEl) {
      const historyHtml = aiChatHistory.map(m => {
        const who = m.role === 'user' ? 'You' : 'AI';
        return `<div class="ai-msg ai-msg-${m.role}"><div class="ai-msg-role">${who}</div><div class="ai-msg-body">${renderMarkdown(m.content)}</div></div>`;
      }).join('');
      aiEl.innerHTML = `
        <div class="ai-badge">AI · ${escapeHtml(model || 'OpenRouter')}</div>
        <div class="ai-thread">${historyHtml || (answer ? `<div class="ai-msg ai-msg-assistant"><div class="ai-msg-body">${renderMarkdown(answer)}</div></div>` : '')}</div>
        <div class="ai-actions">
          <button type="button" class="btn btn-secondary btn-sm" id="ai-clear-chat">New chat</button>
        </div>`;
      aiEl.hidden = false;
      const clearBtn = document.getElementById('ai-clear-chat');
      if (clearBtn) {
        clearBtn.onclick = () => {
          aiChatHistory = [];
          aiSessionQuery = '';
          aiEl.innerHTML = '<div class="ai-badge">New chat</div><div class="ai-thread"><div class="ai-msg ai-msg-assistant"><div class="ai-msg-body">چت جدید آماده است. پیام بفرست.</div></div></div>';
        };
      }
    }

    // Answer box / knowledge / knowledge graph (web only)
    if (type === 'web' && extras && answerEl) {
      let html = '';
      if (extras.answerBox) {
        const a = extras.answerBox;
        html += `<div class="answer-box-title">Answer</div>`;
        html += `<div class="answer-box-answer">${escapeHtml(a.answer || a.title)}</div>`;
        if (a.title && a.answer && a.title !== a.answer) {
          html += `<div class="answer-box-desc">${escapeHtml(a.title)}</div>`;
        }
        if (a.url) html += `<a class="answer-box-link" href="${escapeAttr(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.url)}</a>`;
      } else if (extras.knowledgeGraph) {
        const kg = extras.knowledgeGraph;
        html += `<div class="kg-layout">`;
        if (kg.image) html += `<img class="kg-image" src="${escapeAttr(kg.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`;
        html += `<div>`;
        html += `<div class="answer-box-answer">${escapeHtml(kg.title)}</div>`;
        if (kg.type) html += `<div class="answer-box-title">${escapeHtml(kg.type)}</div>`;
        if (kg.description) html += `<div class="answer-box-desc">${escapeHtml(kg.description)}</div>`;
        if (kg.facts && kg.facts.length) {
          html += `<dl class="kg-facts">`;
          kg.facts.slice(0, 6).forEach(f => {
            html += `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`;
          });
          html += `</dl>`;
        }
        html += `</div></div>`;
      }
      if (html) {
        answerEl.innerHTML = html;
        answerEl.hidden = false;
      }
    }

    // Image grid
    if (isImages && gridEl && images) {
      images.forEach(img => {
        const card = document.createElement('a');
        card.className = 'image-card';
        card.href = img.url || img.imageUrl;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.innerHTML = `
          <img src="${escapeAttr(img.thumbnail || img.imageUrl)}" alt="${escapeAttr(img.title)}" loading="lazy" referrerpolicy="no-referrer" />
          <div class="image-card-meta"><div class="domain">${escapeHtml(img.domain || '')}</div></div>`;
        gridEl.appendChild(card);
      });
    }

    // Video grid
    if (isVideos && videoEl) {
      const vids = videos || results || [];
      vids.forEach(v => {
        const card = document.createElement('a');
        card.className = 'video-card';
        card.href = v.url;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.innerHTML = `
          <div class="video-thumb-wrap">
            ${v.thumbnail ? `<img src="${escapeAttr(v.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : '<div class="video-placeholder">▶</div>'}
            ${v.duration ? `<span class="video-duration">${escapeHtml(String(v.duration))}</span>` : ''}
          </div>
          <div class="video-info">
            <div class="video-title">${escapeHtml(v.title)}</div>
            <div class="video-meta">${escapeHtml(v.displayedLink || '')}${v.date ? ' · ' + escapeHtml(v.date) : ''}</div>
          </div>`;
        videoEl.appendChild(card);
      });
    }

    // Maps list
    if (isMaps && mapsEl) {
      const places = maps || results || [];
      places.forEach(p => {
        const card = document.createElement('article');
        card.className = 'map-card';
        const mapsUrl = (p.lat && p.lng)
          ? `https://www.google.com/maps?q=${p.lat},${p.lng}`
          : (p.url && p.url !== '#' ? p.url : `https://www.google.com/maps/search/${encodeURIComponent(p.title || '')}`);
        card.innerHTML = `
          ${p.thumbnail ? `<img class="map-thumb" src="${escapeAttr(p.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
          <div class="map-body">
            <h3 class="result-title"><a href="${escapeAttr(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a></h3>
            <div class="result-url">${escapeHtml(p.displayedLink || '')}</div>
            <div class="result-snippet">${escapeHtml(p.description || '')}</div>
            <div class="result-meta">
              <span class="result-badge web">MAPS</span>
              ${p.rating != null ? `<span>★ ${escapeHtml(String(p.rating))}</span>` : ''}
              ${p.reviews != null ? `<span>${escapeHtml(String(p.reviews))} reviews</span>` : ''}
              ${p.phone ? `<span>${escapeHtml(p.phone)}</span>` : ''}
            </div>
          </div>`;
        mapsEl.appendChild(card);
      });
    }

    // Web / news / local list
    if (!isImages && !isVideos && !isMaps && !isAi && results) {
      results.forEach(r => {
        const card = document.createElement('article');
        const hasThumb = !!(r.thumbnail);
        card.className = 'result-card' + (hasThumb ? ' has-thumb' : '');
        card.setAttribute('role', 'listitem');
        const debug = $('#setting-debug') && $('#setting-debug').checked;
        const src = r.source || 'local';
        const badgeMap = {
          web: '<span class="result-badge web">WEB</span>',
          news: '<span class="result-badge web">NEWS</span>',
          videos: '<span class="result-badge web">VIDEO</span>',
          maps: '<span class="result-badge web">MAPS</span>',
          local: '<span class="result-badge">LOCAL</span>'
        };
        const badge = r.isDemo ? '<span class="result-badge demo">DEMO</span>' : (badgeMap[src] || badgeMap.local);
        const titleHtml = (src === 'local' && !r.isDemo === false && r.title && r.title.includes('<')) ? r.title : escapeHtml(r.title || '');
        // local results may already include <mark>
        const safeTitle = (src === 'local') ? (r.title || '') : escapeHtml(r.title || '');
        const safeSnippet = (src === 'local') ? (r.description || '') : escapeHtml(r.description || '');

        let thumbHtml = hasThumb
          ? `<img class="result-thumb" src="${escapeAttr(r.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
          : '';

        card.innerHTML = `
          ${thumbHtml}
          <div class="result-body">
            <h3 class="result-title"><a href="${escapeAttr(r.url)}" target="_blank" rel="noopener noreferrer">${safeTitle}</a></h3>
            <div class="result-url">${escapeHtml(r.displayedLink || r.url || '')}</div>
            <div class="result-snippet">${safeSnippet}</div>
            <div class="result-meta">
              ${badge}
              ${r.date ? `<span>${escapeHtml(r.date)}</span>` : ''}
              ${r.wordCount ? `<span>${r.wordCount} words</span>` : ''}
              ${debug ? `<span class="result-score">score: ${r.score}</span>` : ''}
            </div>
          </div>`;
        listEl.appendChild(card);
      });
    }

    // Related searches
    if (extras && extras.relatedSearches && extras.relatedSearches.length && relatedEl) {
      relatedEl.innerHTML = `
        <h3>Related searches</h3>
        <div class="related-chips">
          ${extras.relatedSearches.map(q =>
            `<button type="button" class="related-chip" data-q="${escapeAttr(q)}">${escapeHtml(q)}</button>`
          ).join('')}
        </div>`;
      relatedEl.hidden = false;
      relatedEl.querySelectorAll('.related-chip').forEach(chip => {
        chip.addEventListener('click', () => doSearch(chip.dataset.q, 1));
      });
    }

    const skipPager = isImages || isVideos || isMaps || isAi;
    renderPagination(skipPager ? 0 : total, page, perPage);
  }

  function renderPagination(total, page, perPage) {
    const totalPages = Math.ceil(total / perPage);
    if (totalPages <= 1) {
      els.pagination.hidden = true;
      els.pagination.innerHTML = '';
      return;
    }
    els.pagination.hidden = false;
    let html = '';
    html += `<button type="button" class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">‹</button>`;
    const range = getPageRange(page, totalPages, 5);
    for (const p of range) {
      if (p === '...') html += `<span class="page-btn" style="pointer-events:none">…</span>`;
      else html += `<button type="button" class="page-btn ${p === page ? 'active' : ''}" data-page="${p}" aria-label="Page ${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`;
    }
    html += `<button type="button" class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''} aria-label="Next page">›</button>`;
    els.pagination.innerHTML = html;
    els.pagination.querySelectorAll('.page-btn[data-page]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = parseInt(btn.dataset.page, 10);
        if (p >= 1 && p <= totalPages) doSearch(currentQuery, p);
      });
    });
  }

  function getPageRange(current, total, maxVisible) {
    if (total <= maxVisible) return Array.from({ length: total }, (_, i) => i + 1);
    const pages = [];
    const half = Math.floor(maxVisible / 2);
    let start = Math.max(1, current - half);
    let end = Math.min(total, start + maxVisible - 1);
    if (end - start < maxVisible - 1) start = Math.max(1, end - maxVisible + 1);
    if (start > 1) { pages.push(1); if (start > 2) pages.push('...'); }
    for (let i = start; i <= end; i++) pages.push(i);
    if (end < total) { if (end < total - 1) pages.push('...'); pages.push(total); }
    return pages;
  }

  function onSearchInput() {
    const val = els.searchInput.value;
    els.mainClear.hidden = !val;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (val.length >= 1) showAutocomplete(val);
      else hideAutocomplete();
    }, 120);
  }

  function showAutocomplete(prefix) {
    const parts = prefix.split(/\s+/);
    const last = parts[parts.length - 1].replace(/^["'-]+/, '');
    if (!last) { hideAutocomplete(); return; }
    const suggestions = searchEngine.suggest(last, 8);
    if (suggestions.length === 0) { hideAutocomplete(); return; }
    autocompleteIndex = -1;
    els.autocomplete.innerHTML = suggestions.map((s, i) => {
      const highlighted = escapeHtml(s).replace(
        new RegExp('^(' + escapeRegex(last) + ')', 'i'),
        '<mark>$1</mark>'
      );
      return `<div class="autocomplete-item" role="option" data-index="${i}" data-term="${escapeAttr(s)}">
        <svg viewBox="0 0 24 24" width="16" height="16"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><line x1="16.5" y1="16.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <span>${highlighted}</span>
      </div>`;
    }).join('');
    els.autocomplete.hidden = false;
    els.autocomplete.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const term = item.dataset.term;
        parts[parts.length - 1] = term;
        els.searchInput.value = parts.join(' ') + ' ';
        hideAutocomplete();
        els.searchInput.focus();
      });
    });
  }

  function hideAutocomplete() {
    els.autocomplete.hidden = true;
    autocompleteIndex = -1;
  }

  function onSearchKeydown(e) {
    const items = els.autocomplete.querySelectorAll('.autocomplete-item');
    if (els.autocomplete.hidden || items.length === 0) {
      if (e.key === 'Escape') hideAutocomplete();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      autocompleteIndex = Math.min(autocompleteIndex + 1, items.length - 1);
      updateAutocompleteActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      autocompleteIndex = Math.max(autocompleteIndex - 1, -1);
      updateAutocompleteActive(items);
    } else if (e.key === 'Enter' && autocompleteIndex >= 0) {
      e.preventDefault();
      items[autocompleteIndex].click();
    } else if (e.key === 'Escape') {
      hideAutocomplete();
    }
  }

  function updateAutocompleteActive(items) {
    items.forEach((item, i) => item.classList.toggle('active', i === autocompleteIndex));
  }

  function showHome() {
    els.homeView.hidden = false;
    els.resultsView.hidden = true;
    els.headerSearch.hidden = true;
    currentQuery = '';
    updateEmptyState();
    refreshStats();
  }

  function showResults() {
    els.homeView.hidden = true;
    els.resultsView.hidden = false;
    els.headerSearch.hidden = false;
  }

  function updateEmptyState() {
    const count = indexer.documents.size;
    els.emptyState.hidden = count > 0;
  }

  async function refreshStats() {
    const count = indexer.documents.size;
    els.statDocs.textContent = count.toLocaleString();
    const bytes = await storage.estimateSize();
    els.statSize.textContent = formatBytes(bytes);
    const last = await storage.getMeta('lastUpdated');
    els.statUpdated.textContent = last ? formatDate(last) : 'Never';
    const setDoc = $('#set-doc-count');
    const setSize = $('#set-index-size');
    if (setDoc) setDoc.textContent = count.toLocaleString();
    if (setSize) setSize.textContent = formatBytes(bytes);
  }

  async function renderRecentSearches() {
    const history = await storage.getHistory(8);
    if (history.length === 0) { els.recentSearches.hidden = true; return; }
    els.recentSearches.hidden = false;
    els.recentList.innerHTML = history.map(h =>
      `<button type="button" class="recent-chip" data-query="${escapeAttr(h.query)}">${escapeHtml(h.query)}</button>`
    ).join('');
    els.recentList.querySelectorAll('.recent-chip').forEach(chip => {
      chip.addEventListener('click', () => doSearch(chip.dataset.query));
    });
  }

  function openImportModal() {
    els.importProgress.hidden = true;
    els.importLog.hidden = true;
    els.importSummary.hidden = true;
    els.importLog.innerHTML = '';
    els.progressFill.style.width = '0%';
    els.startImportBtn.disabled = true;
    selectedImportFiles = null;
    els.fileInput.value = '';
    openModal(els.importModal);
  }

  function handleFileSelection(files) {
    const count = crawler.setFiles(files);
    selectedImportFiles = files;
    els.startImportBtn.disabled = count === 0;
    if (count > 0) toast(`${count} HTML file${count > 1 ? 's' : ''} selected`, 'info');
    else toast('No HTML files found in selection', 'error');
  }

  async function startImport() {
    if (!selectedImportFiles || selectedImportFiles.length === 0) return;
    els.startImportBtn.disabled = true;
    els.importProgress.hidden = false;
    els.importLog.hidden = false;
    els.importLog.innerHTML = '';
    els.importSummary.hidden = true;
    const summary = await crawler.importFiles((current, total, status) => {
      const pct = Math.round((current / total) * 100);
      els.progressFill.style.width = pct + '%';
      els.progressText.textContent = `Indexing ${current} / ${total}…`;
      if (status.current) {
        const c = status.current;
        const cls = c.status === 'error' ? 'error' : c.status === 'duplicate' ? 'warn' : 'success';
        const entry = document.createElement('div');
        entry.className = 'log-entry ' + cls;
        entry.textContent = `${c.filename}: ${c.message || c.status}`;
        els.importLog.appendChild(entry);
        els.importLog.scrollTop = els.importLog.scrollHeight;
      }
    });
    els.progressFill.style.width = '100%';
    els.progressText.textContent = 'Done';
    els.importSummary.hidden = false;
    $('#sum-files').textContent = summary.files;
    $('#sum-indexed').textContent = summary.indexed;
    $('#sum-dupes').textContent = summary.duplicates;
    $('#sum-errors').textContent = summary.errors.length;
    await refreshStats();
    updateEmptyState();
    if (summary.indexed > 0) toast(`Indexed ${summary.indexed} document${summary.indexed > 1 ? 's' : ''}`, 'success');
    els.startImportBtn.disabled = false;
  }

  async function exportIndex() {
    try {
      const data = await storage.exportIndex();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `td-search-index-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Index exported', 'success');
    } catch (err) {
      toast('Export failed: ' + err.message, 'error');
    }
  }

  async function importIndexFile() {
    const file = $('#index-file-input').files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await storage.importIndex(data);
      await indexer.load();
      await refreshStats();
      updateEmptyState();
      toast(`Imported ${data.documents?.length || 0} documents`, 'success');
      closeAllModals();
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    }
    $('#index-file-input').value = '';
  }

  async function rebuildIndex() {
    if (!confirm('Rebuild the entire inverted index from stored documents?')) return;
    try {
      const count = await indexer.rebuild();
      await refreshStats();
      toast(`Rebuilt index for ${count} documents`, 'success');
      updateDebugPanel();
    } catch (err) {
      toast('Rebuild failed: ' + err.message, 'error');
    }
  }

  async function clearIndex() {
    if (!confirm('Delete ALL indexed documents and the search index? This cannot be undone.')) return;
    try {
      await indexer.clear();
      await refreshStats();
      updateEmptyState();
      showHome();
      toast('Index cleared', 'info');
    } catch (err) {
      toast('Clear failed: ' + err.message, 'error');
    }
  }

  function openSettingsModal() {
    refreshStats();
    updateDebugPanel();
    openModal(els.settingsModal);
  }

  function updateDebugPanel(searchResult) {
    if (!els.debugContent) return;
    const stats = indexer.getStats();
    const lines = [
      `Documents: ${stats.documentCount}`,
      `Demo docs: ${stats.demoCount}`,
      `Unique terms: ${stats.uniqueTerms}`,
      `Doc ID counter: ${indexer.docIdCounter}`,
      `Storage: ${storage.useIndexedDB ? 'IndexedDB' : 'localStorage/memory'}`,
      `Loaded: ${indexer.loaded}`
    ];
    if (searchResult) {
      lines.push('--- Last search ---', `Query: ${searchResult.query?.raw || ''}`,
        `Matched: ${searchResult.total}`, `Took: ${searchResult.took?.toFixed(2)} ms`,
        `Page: ${searchResult.page}`);
    }
    els.debugContent.textContent = lines.join('\n');
  }

  function openModal(modal) {
    closeAllModals();
    modal.hidden = false;
    const focusable = modal.querySelector('button, input, select, [tabindex]');
    if (focusable) focusable.focus();
  }

  function closeAllModals() {
    $$('.modal-overlay').forEach(m => { m.hidden = true; });
  }

  function handleGlobalKeys(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); focusSearch(); return; }
    if (e.key === '/' && !typing) { e.preventDefault(); focusSearch(); return; }
    if (e.key === 'Escape') { closeAllModals(); hideAutocomplete(); }
  }

  function focusSearch() {
    if (!els.resultsView.hidden && els.headerSearchInput) {
      els.headerSearchInput.focus();
      els.headerSearchInput.select();
    } else {
      els.searchInput.focus();
      els.searchInput.select();
    }
  }

  function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    els.toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
      el.style.transition = 'opacity 0.3s, transform 0.3s';
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function escapeAttr(str) { return escapeHtml(str).replace(/'/g, '&#39;'); }
  function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' hours ago';
    if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' days ago';
    return d.toLocaleDateString();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

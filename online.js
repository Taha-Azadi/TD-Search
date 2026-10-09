/**
 * online.js — SerpAPI (web/images/news/videos/maps) + OpenRouter AI via local proxy
 */

class OnlineSearch {
  constructor(storage) {
    this.storage = storage;
    this.proxyBase = 'http://127.0.0.1:8080';
  }

  async isEnabled() {
    return !!(await this.storage.getSetting('onlineSearchEnabled', false));
  }

  async setEnabled(value) {
    await this.storage.setSetting('onlineSearchEnabled', !!value);
  }

  async isAiEnabled() {
    return !!(await this.storage.getSetting('aiSearchEnabled', true));
  }

  async setAiEnabled(value) {
    await this.storage.setSetting('aiSearchEnabled', !!value);
  }

  async getProxyBase() {
    const custom = await this.storage.getSetting('proxyBase', '');
    return (custom || this.proxyBase).replace(/\/$/, '');
  }

  async getAiModel() {
    return (await this.storage.getSetting('openrouterModel', 'nvidia/nemotron-3.5-lightning:free')) || 'nvidia/nemotron-3.5-lightning:free';
  }

  async search(query, options = {}) {
    const start = performance.now();
    const type = options.type || 'web';

    if (!query || !query.trim()) {
      return { results: [], images: [], videos: [], maps: [], answer: '', took: 0, type };
    }

    if (type === 'ai') {
      return this.aiSearch(query, options, start);
    }

    const base = await this.getProxyBase();
    let engine = 'google';
    if (type === 'images') engine = 'google_images';
    else if (type === 'news') engine = 'google_news';
    else if (type === 'videos') engine = 'google_videos';
    else if (type === 'maps') engine = 'google_maps';
    else if (type === 'web') engine = 'google';
    else if (type === 'ai') {
      return this.aiSearch(query, options, start);
    } else {
      return emptyResult(type, start, 'Unknown search type: ' + type);
    }
    const numDefault = type === 'images' ? 20 : type === 'videos' ? 12 : type === 'maps' ? 10 : 10;

    const params = new URLSearchParams({
      q: query.trim(),
      engine,
      num: String(options.num || numDefault),
      hl: options.lang || 'fa',
      gl: options.country || 'ir'
    });

    const url = `${base}/api/search?${params.toString()}`;
    console.log('[TD Search] engine=', engine, url);

    try {
      const response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          if (errBody.error) message = errBody.error;
        } catch (_) {}
        return emptyResult(type, start, message);
      }

      const data = await response.json();
      if (data.error) return emptyResult(type, start, data.error);

      const took = performance.now() - start;

      if (type === 'images') {
        const images = this._parseImages(data);
        return { results: [], images, videos: [], maps: [], answer: '', took, type, rawCount: images.length };
      }
      if (type === 'videos') {
        const videos = this._parseVideos(data);
        return { results: videos, images: [], videos, maps: [], answer: '', took, type, rawCount: videos.length };
      }
      if (type === 'maps') {
        const maps = this._parseMaps(data);
        return { results: maps, images: [], videos: [], maps, answer: '', took, type, rawCount: maps.length };
      }
      if (type === 'news') {
        const news = this._parseNews(data);
        return { results: news, images: [], videos: [], maps: [], answer: '', took, type, rawCount: news.length };
      }

      const results = this._parseWeb(data);
      const extras = this._parseExtras(data);
      return {
        results, images: [], videos: [], maps: [], answer: '', extras, took, type,
        rawCount: results.length, searchMetadata: data.search_metadata || null
      };
    } catch (err) {
      return emptyResult(type, start, networkHint(err));
    }
  }

  async aiSearch(query, options = {}, start = performance.now()) {
    const base = await this.getProxyBase();
    const model = options.model || await this.getAiModel();
    const history = Array.isArray(options.history) ? options.history : [];
    try {
      const response = await fetch(`${base}/api/ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          q: query.trim(),
          model,
          messages: history
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.error) {
        return emptyResult('ai', start, data.error || `HTTP ${response.status}`);
      }
      return {
        results: [],
        images: [],
        videos: [],
        maps: [],
        answer: data.answer || '',
        model: data.model || model,
        usage: data.usage || null,
        took: performance.now() - start,
        type: 'ai',
        rawCount: data.answer ? 1 : 0
      };
    } catch (err) {
      return emptyResult('ai', start, networkHint(err));
    }
  }

  _parseWeb(data) {
    const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
    return organic.map((item, index) => ({
      id: 'web-' + (item.position || index + 1),
      title: item.title || 'Untitled',
      url: item.link || '#',
      description: item.snippet || '',
      score: 1000 - (item.position || index),
      source: 'web',
      position: item.position || index + 1,
      displayedLink: item.displayed_link || '',
      date: item.date || null,
      thumbnail: item.thumbnail || null,
      isDemo: false,
      metadata: { source: 'serpapi', engine: 'google' }
    }));
  }

  _parseImages(data) {
    const list = Array.isArray(data.images_results) ? data.images_results : [];
    return list.map((item, index) => ({
      id: 'img-' + (index + 1),
      title: item.title || '',
      url: item.link || item.source || '#',
      imageUrl: item.original || item.thumbnail || '',
      thumbnail: item.thumbnail || item.original || '',
      source: 'images',
      domain: item.source || '',
      isDemo: false
    }));
  }

  _parseNews(data) {
    const list = Array.isArray(data.news_results) ? data.news_results : [];
    return list.map((item, index) => ({
      id: 'news-' + (index + 1),
      title: item.title || 'Untitled',
      url: item.link || '#',
      description: item.snippet || '',
      score: 1000 - index,
      source: 'news',
      displayedLink: item.source || '',
      date: item.date || null,
      thumbnail: item.thumbnail || null,
      isDemo: false
    }));
  }

  _parseVideos(data) {
    // Do NOT fall back to organic_results — that made Videos look like All
    const list = Array.isArray(data.video_results) ? data.video_results
      : Array.isArray(data.videos_results) ? data.videos_results
      : [];
    return list.map((item, index) => ({
      id: 'vid-' + (index + 1),
      title: item.title || 'Untitled',
      url: item.link || item.url || '#',
      description: item.snippet || item.description || '',
      score: 1000 - index,
      source: 'videos',
      displayedLink: item.channel || item.source || item.platform || '',
      date: item.date || item.published_date || null,
      thumbnail: item.thumbnail || item.thumbnail_static || null,
      duration: item.duration || item.length || null,
      isDemo: false
    }));
  }

  _parseMaps(data) {
    // Prefer local_results / place_results only (never organic web results)
    let list = [];
    if (Array.isArray(data.local_results)) list = data.local_results;
    else if (data.place_results && typeof data.place_results === 'object') {
      list = Array.isArray(data.place_results) ? data.place_results : [data.place_results];
    } else if (Array.isArray(data.places)) list = data.places;
    const normalized = list.map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const gps = item.gps_coordinates || item.gps || {};
      return {
        id: 'map-' + (index + 1),
        title: item.title || item.name || 'Place',
        url: item.website || item.link || item.place_id_search || '#',
        description: item.address || item.description || item.snippet || '',
        score: 1000 - index,
        source: 'maps',
        displayedLink: item.type || item.category || '',
        rating: item.rating || null,
        reviews: item.reviews || item.reviews_original || null,
        phone: item.phone || null,
        hours: item.hours || item.operating_hours || null,
        thumbnail: item.thumbnail || null,
        lat: gps.latitude || item.latitude || null,
        lng: gps.longitude || item.longitude || null,
        isDemo: false
      };
    }).filter(Boolean);
    return normalized;
  }

  _parseExtras(data) {
    const extras = {};
    if (data.answer_box) {
      extras.answerBox = {
        title: data.answer_box.title || data.answer_box.answer || '',
        answer: data.answer_box.answer || data.answer_box.snippet || '',
        url: data.answer_box.link || '',
        type: data.answer_box.type || 'answer'
      };
    }
    if (data.knowledge_graph) {
      const kg = data.knowledge_graph;
      extras.knowledgeGraph = {
        title: kg.title || '',
        type: kg.type || '',
        description: kg.description || '',
        image: kg.thumbnail || '',
        url: kg.source?.link || kg.website || '',
        facts: []
      };
      Object.keys(kg).forEach(k => {
        if (['title', 'type', 'description', 'thumbnail', 'source', 'website', 'header_images'].includes(k)) return;
        const v = kg[k];
        if (typeof v === 'string' && v.length < 200) {
          extras.knowledgeGraph.facts.push({ label: k.replace(/_/g, ' '), value: v });
        }
      });
    }
    if (Array.isArray(data.related_searches) && data.related_searches.length) {
      extras.relatedSearches = data.related_searches.slice(0, 8).map(r => r.query || r).filter(Boolean);
    }
    return extras;
  }

  async testProxy() {
    const base = await this.getProxyBase();
    try {
      const resp = await fetch(`${base}/api/health`);
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const data = await resp.json();
      return { ok: true, ...data };
    } catch (_) {
      return { ok: false, error: 'Proxy not running. Start: python3 proxy_server.py --key SERP --openrouter OR_KEY' };
    }
  }
}

function emptyResult(type, start, error) {
  return {
    results: [], images: [], videos: [], maps: [], answer: '',
    took: performance.now() - start, type, error
  };
}

function networkHint(err) {
  const msg = err && err.message ? err.message : 'Network error';
  if (msg === 'Failed to fetch' || msg.includes('NetworkError')) {
    return 'Cannot reach local proxy. Run: python3 proxy_server.py --key SERPAPI_KEY --openrouter OPENROUTER_KEY';
  }
  return msg;
}

if (typeof window !== 'undefined') {
  window.OnlineSearch = OnlineSearch;
}

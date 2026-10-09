/**
 * storage.js — Storage abstraction layer
 * Prefers IndexedDB; falls back to localStorage for small datasets.
 * All data stays in the browser — zero network.
 */

const DB_NAME = 'td-search-db';
const DB_VERSION = 1;
const STORE_DOCS = 'documents';
const STORE_INDEX = 'inverted_index';
const STORE_META = 'metadata';
const STORE_HISTORY = 'search_history';
const STORE_SETTINGS = 'settings';

class Storage {
  constructor() {
    this.db = null;
    this.ready = false;
    this.useIndexedDB = typeof indexedDB !== 'undefined';
    this._memoryFallback = {
      documents: new Map(),
      invertedIndex: {},
      metadata: {},
      history: [],
      settings: {}
    };
  }

  /**
   * Open / initialize the database.
   */
  async init() {
    if (!this.useIndexedDB) {
      console.warn('[Storage] IndexedDB unavailable — using in-memory + localStorage fallback');
      this._loadLocalStorageFallback();
      this.ready = true;
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.warn('[Storage] IndexedDB open failed, falling back', request.error);
        this.useIndexedDB = false;
        this._loadLocalStorageFallback();
        this.ready = true;
        resolve();
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.ready = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        if (!db.objectStoreNames.contains(STORE_DOCS)) {
          const docStore = db.createObjectStore(STORE_DOCS, { keyPath: 'id' });
          docStore.createIndex('url', 'url', { unique: false });
          docStore.createIndex('title', 'title', { unique: false });
          docStore.createIndex('indexedAt', 'indexedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_INDEX)) {
          db.createObjectStore(STORE_INDEX, { keyPath: 'term' });
        }

        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }

        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          db.createObjectStore(STORE_HISTORY, { keyPath: 'id', autoIncrement: true });
        }

        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };
    });
  }

  // ── Documents ──────────────────────────────────────────────

  async putDocument(doc) {
    if (this.useIndexedDB && this.db) {
      return this._idbPut(STORE_DOCS, doc);
    }
    this._memoryFallback.documents.set(doc.id, doc);
    this._persistLocalStorage();
  }

  async putDocuments(docs) {
    if (this.useIndexedDB && this.db) {
      return this._idbPutAll(STORE_DOCS, docs);
    }
    docs.forEach(d => this._memoryFallback.documents.set(d.id, d));
    this._persistLocalStorage();
  }

  async getDocument(id) {
    if (this.useIndexedDB && this.db) {
      return this._idbGet(STORE_DOCS, id);
    }
    return this._memoryFallback.documents.get(id) || null;
  }

  async getAllDocuments() {
    if (this.useIndexedDB && this.db) {
      return this._idbGetAll(STORE_DOCS);
    }
    return Array.from(this._memoryFallback.documents.values());
  }

  async deleteDocument(id) {
    if (this.useIndexedDB && this.db) {
      return this._idbDelete(STORE_DOCS, id);
    }
    this._memoryFallback.documents.delete(id);
    this._persistLocalStorage();
  }

  async clearDocuments() {
    if (this.useIndexedDB && this.db) {
      return this._idbClear(STORE_DOCS);
    }
    this._memoryFallback.documents.clear();
    this._persistLocalStorage();
  }

  async countDocuments() {
    if (this.useIndexedDB && this.db) {
      return this._idbCount(STORE_DOCS);
    }
    return this._memoryFallback.documents.size;
  }

  // ── Inverted Index ─────────────────────────────────────────

  async putIndexTerm(term, docIds) {
    const record = { term, docIds };
    if (this.useIndexedDB && this.db) {
      return this._idbPut(STORE_INDEX, record);
    }
    this._memoryFallback.invertedIndex[term] = docIds;
    this._persistLocalStorage();
  }

  async putIndexTerms(entries) {
    // entries: Array<{term, docIds}>
    if (this.useIndexedDB && this.db) {
      return this._idbPutAll(STORE_INDEX, entries);
    }
    entries.forEach(e => {
      this._memoryFallback.invertedIndex[e.term] = e.docIds;
    });
    this._persistLocalStorage();
  }

  async getIndexTerm(term) {
    if (this.useIndexedDB && this.db) {
      const rec = await this._idbGet(STORE_INDEX, term);
      return rec ? rec.docIds : null;
    }
    return this._memoryFallback.invertedIndex[term] || null;
  }

  async getAllIndexTerms() {
    if (this.useIndexedDB && this.db) {
      const all = await this._idbGetAll(STORE_INDEX);
      const map = {};
      all.forEach(r => { map[r.term] = r.docIds; });
      return map;
    }
    return { ...this._memoryFallback.invertedIndex };
  }

  async clearIndex() {
    if (this.useIndexedDB && this.db) {
      return this._idbClear(STORE_INDEX);
    }
    this._memoryFallback.invertedIndex = {};
    this._persistLocalStorage();
  }

  // ── Metadata ───────────────────────────────────────────────

  async setMeta(key, value) {
    const record = { key, value };
    if (this.useIndexedDB && this.db) {
      return this._idbPut(STORE_META, record);
    }
    this._memoryFallback.metadata[key] = value;
    this._persistLocalStorage();
  }

  async getMeta(key) {
    if (this.useIndexedDB && this.db) {
      const rec = await this._idbGet(STORE_META, key);
      return rec ? rec.value : null;
    }
    return this._memoryFallback.metadata[key] ?? null;
  }

  // ── Search History ─────────────────────────────────────────

  async addHistory(query) {
    const entry = { query, timestamp: Date.now() };
    if (this.useIndexedDB && this.db) {
      // Keep only last 30
      const all = await this._idbGetAll(STORE_HISTORY);
      if (all.length >= 30) {
        const sorted = all.sort((a, b) => a.timestamp - b.timestamp);
        for (let i = 0; i < sorted.length - 29; i++) {
          await this._idbDelete(STORE_HISTORY, sorted[i].id);
        }
      }
      return this._idbPut(STORE_HISTORY, entry);
    }
    this._memoryFallback.history.unshift(entry);
    this._memoryFallback.history = this._memoryFallback.history.slice(0, 30);
    this._persistLocalStorage();
  }

  async getHistory(limit = 10) {
    if (this.useIndexedDB && this.db) {
      const all = await this._idbGetAll(STORE_HISTORY);
      return all.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
    }
    return this._memoryFallback.history.slice(0, limit);
  }

  async clearHistory() {
    if (this.useIndexedDB && this.db) {
      return this._idbClear(STORE_HISTORY);
    }
    this._memoryFallback.history = [];
    this._persistLocalStorage();
  }

  // ── Settings ───────────────────────────────────────────────

  async getSetting(key, defaultValue = null) {
    if (this.useIndexedDB && this.db) {
      const rec = await this._idbGet(STORE_SETTINGS, key);
      return rec ? rec.value : defaultValue;
    }
    // Also check localStorage for settings (works even without IDB)
    try {
      const raw = localStorage.getItem('td-search-settings');
      if (raw) {
        const obj = JSON.parse(raw);
        return obj[key] !== undefined ? obj[key] : defaultValue;
      }
    } catch (_) {}
    return this._memoryFallback.settings[key] ?? defaultValue;
  }

  async setSetting(key, value) {
    if (this.useIndexedDB && this.db) {
      return this._idbPut(STORE_SETTINGS, { key, value });
    }
    this._memoryFallback.settings[key] = value;
    try {
      const raw = localStorage.getItem('td-search-settings');
      const obj = raw ? JSON.parse(raw) : {};
      obj[key] = value;
      localStorage.setItem('td-search-settings', JSON.stringify(obj));
    } catch (_) {}
  }

  async getAllSettings() {
    if (this.useIndexedDB && this.db) {
      const all = await this._idbGetAll(STORE_SETTINGS);
      const map = {};
      all.forEach(r => { map[r.key] = r.value; });
      return map;
    }
    try {
      const raw = localStorage.getItem('td-search-settings');
      return raw ? JSON.parse(raw) : { ...this._memoryFallback.settings };
    } catch (_) {
      return { ...this._memoryFallback.settings };
    }
  }

  // ── Export / Import whole index ────────────────────────────

  async exportIndex() {
    const documents = await this.getAllDocuments();
    const invertedIndex = await this.getAllIndexTerms();
    const meta = {
      exportedAt: Date.now(),
      version: 1,
      documentCount: documents.length
    };
    return { meta, documents, invertedIndex };
  }

  async importIndex(data) {
    if (!data || !data.documents) throw new Error('Invalid index file');
    await this.clearDocuments();
    await this.clearIndex();
    if (data.documents.length) {
      await this.putDocuments(data.documents);
    }
    if (data.invertedIndex) {
      const entries = Object.entries(data.invertedIndex).map(([term, docIds]) => ({ term, docIds }));
      // Batch in chunks to avoid locking
      const CHUNK = 200;
      for (let i = 0; i < entries.length; i += CHUNK) {
        await this.putIndexTerms(entries.slice(i, i + CHUNK));
      }
    }
    await this.setMeta('lastUpdated', Date.now());
    await this.setMeta('documentCount', data.documents.length);
  }

  // ── Size estimation ────────────────────────────────────────

  async estimateSize() {
    const docs = await this.getAllDocuments();
    const index = await this.getAllIndexTerms();
    const json = JSON.stringify({ docs, index });
    return json.length; // bytes approximation
  }

  // ── IndexedDB helpers ──────────────────────────────────────

  _idbPut(storeName, value) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  _idbPutAll(storeName, values) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      let remaining = values.length;
      if (remaining === 0) return resolve();
      values.forEach(v => {
        const req = store.put(v);
        req.onsuccess = () => {
          remaining--;
          if (remaining === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  _idbGet(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  _idbGetAll(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  _idbDelete(storeName, key) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  _idbClear(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  _idbCount(storeName) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  // ── localStorage fallback (small datasets only) ────────────

  _persistLocalStorage() {
    try {
      const payload = {
        documents: Array.from(this._memoryFallback.documents.entries()),
        invertedIndex: this._memoryFallback.invertedIndex,
        metadata: this._memoryFallback.metadata,
        history: this._memoryFallback.history
      };
      localStorage.setItem('td-search-fallback', JSON.stringify(payload));
    } catch (e) {
      console.warn('[Storage] localStorage persist failed (quota?)', e);
    }
  }

  _loadLocalStorageFallback() {
    try {
      const raw = localStorage.getItem('td-search-fallback');
      if (raw) {
        const data = JSON.parse(raw);
        this._memoryFallback.documents = new Map(data.documents || []);
        this._memoryFallback.invertedIndex = data.invertedIndex || {};
        this._memoryFallback.metadata = data.metadata || {};
        this._memoryFallback.history = data.history || [];
      }
    } catch (_) {}
  }
}

if (typeof window !== 'undefined') {
  window.Storage = Storage;
}

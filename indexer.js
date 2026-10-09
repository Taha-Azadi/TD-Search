/**
 * indexer.js — Build and maintain the inverted index
 */

class Indexer {
  constructor(storage) {
    this.storage = storage;
    // In-memory inverted index for fast search (synced with storage)
    this.invertedIndex = {}; // term -> Set of docIds
    this.documents = new Map(); // id -> doc
    this.docIdCounter = 1;
    this.loaded = false;
  }

  /**
   * Load existing index from storage into memory.
   */
  async load() {
    const docs = await this.storage.getAllDocuments();
    this.documents.clear();
    let maxId = 0;
    docs.forEach(doc => {
      this.documents.set(doc.id, doc);
      // Extract numeric part if present
      const num = parseInt(String(doc.id).replace(/\D/g, ''), 10);
      if (!isNaN(num) && num > maxId) maxId = num;
    });
    this.docIdCounter = maxId + 1;

    const indexData = await this.storage.getAllIndexTerms();
    this.invertedIndex = {};
    Object.entries(indexData).forEach(([term, docIds]) => {
      this.invertedIndex[term] = new Set(docIds);
    });

    this.loaded = true;
    return docs.length;
  }

  /**
   * Generate a unique document id.
   */
  nextId() {
    return 'doc-' + (this.docIdCounter++);
  }

  /**
   * Index a single parsed document.
   * @param {object} parsed - output from HTMLParser.parse
   * @param {object} [opts]
   * @returns {object} the stored document
   */
  async addDocument(parsed, opts = {}) {
    // Duplicate detection by URL
    const existing = Array.from(this.documents.values())
      .find(d => d.url === parsed.url || (parsed.filename && d.filename === parsed.filename));
    if (existing && !opts.force) {
      return { document: existing, duplicate: true };
    }

    const id = opts.id || this.nextId();
    const doc = {
      id,
      title: parsed.title,
      url: parsed.url,
      description: parsed.description || '',
      headings: parsed.headings || [],
      text: parsed.text || '',
      wordCount: parsed.wordCount || 0,
      indexedAt: Date.now(),
      metadata: parsed.metadata || {},
      filename: parsed.filename || '',
      isDemo: !!opts.isDemo || !!parsed.isDemo
    };

    // Tokenize fields with field weighting markers
    const titleTokens = HTMLParser.tokenize(doc.title);
    const headingTokens = HTMLParser.tokenize((doc.headings || []).join(' '));
    const contentTokens = HTMLParser.tokenize(doc.text);
    const urlTokens = HTMLParser.tokenize(
      doc.url.replace(/[\/\.\-_?#&=]/g, ' ')
    );

    // Build postings for this document
    const termSet = new Set([
      ...titleTokens,
      ...headingTokens,
      ...contentTokens,
      ...urlTokens
    ]);

    termSet.forEach(term => {
      const normalized = HTMLParser.normalizeToken(term);
      if (!normalized || normalized.length < 2) return;
      if (!this.invertedIndex[normalized]) {
        this.invertedIndex[normalized] = new Set();
      }
      this.invertedIndex[normalized].add(id);
    });

    // Store field-level token lists for ranking
    doc._titleTokens = titleTokens.map(t => HTMLParser.normalizeToken(t));
    doc._headingTokens = headingTokens.map(t => HTMLParser.normalizeToken(t));
    doc._contentTokens = contentTokens.map(t => HTMLParser.normalizeToken(t));
    doc._urlTokens = urlTokens.map(t => HTMLParser.normalizeToken(t));

    this.documents.set(id, doc);
    await this.storage.putDocument(doc);

    // Persist new/updated index terms (batch later if many)
    const entries = [];
    termSet.forEach(term => {
      const n = HTMLParser.normalizeToken(term);
      if (n && this.invertedIndex[n]) {
        entries.push({ term: n, docIds: Array.from(this.invertedIndex[n]) });
      }
    });
    if (entries.length) {
      await this.storage.putIndexTerms(entries);
    }

    await this.storage.setMeta('lastUpdated', Date.now());
    await this.storage.setMeta('documentCount', this.documents.size);

    return { document: doc, duplicate: false };
  }

  /**
   * Add multiple documents (used by crawler).
   * @param {Array} parsedDocs
   * @param {function} [onProgress]
   */
  async addDocuments(parsedDocs, onProgress) {
    const results = { indexed: 0, duplicates: 0, errors: [] };
    for (let i = 0; i < parsedDocs.length; i++) {
      try {
        const r = await this.addDocument(parsedDocs[i]);
        if (r.duplicate) results.duplicates++;
        else results.indexed++;
      } catch (err) {
        results.errors.push({ index: i, error: err.message });
      }
      if (onProgress) onProgress(i + 1, parsedDocs.length, results);
    }
    return results;
  }

  /**
   * Remove a document and clean inverted index.
   */
  async removeDocument(id) {
    const doc = this.documents.get(id);
    if (!doc) return false;

    // Remove from inverted index
    const allTokens = new Set([
      ...(doc._titleTokens || []),
      ...(doc._headingTokens || []),
      ...(doc._contentTokens || []),
      ...(doc._urlTokens || [])
    ]);

    const updates = [];
    allTokens.forEach(term => {
      if (this.invertedIndex[term]) {
        this.invertedIndex[term].delete(id);
        if (this.invertedIndex[term].size === 0) {
          delete this.invertedIndex[term];
        } else {
          updates.push({ term, docIds: Array.from(this.invertedIndex[term]) });
        }
      }
    });

    this.documents.delete(id);
    await this.storage.deleteDocument(id);
    if (updates.length) await this.storage.putIndexTerms(updates);

    await this.storage.setMeta('lastUpdated', Date.now());
    await this.storage.setMeta('documentCount', this.documents.size);
    return true;
  }

  /**
   * Rebuild entire inverted index from stored documents.
   */
  async rebuild() {
    this.invertedIndex = {};
    await this.storage.clearIndex();

    const entriesMap = {}; // term -> Set

    for (const doc of this.documents.values()) {
      const titleTokens = HTMLParser.tokenize(doc.title);
      const headingTokens = HTMLParser.tokenize((doc.headings || []).join(' '));
      const contentTokens = HTMLParser.tokenize(doc.text);
      const urlTokens = HTMLParser.tokenize(doc.url.replace(/[\/\.\-_?#&=]/g, ' '));

      doc._titleTokens = titleTokens.map(t => HTMLParser.normalizeToken(t));
      doc._headingTokens = headingTokens.map(t => HTMLParser.normalizeToken(t));
      doc._contentTokens = contentTokens.map(t => HTMLParser.normalizeToken(t));
      doc._urlTokens = urlTokens.map(t => HTMLParser.normalizeToken(t));

      const termSet = new Set([
        ...doc._titleTokens,
        ...doc._headingTokens,
        ...doc._contentTokens,
        ...doc._urlTokens
      ]);

      termSet.forEach(term => {
        if (!term || term.length < 2) return;
        if (!entriesMap[term]) entriesMap[term] = new Set();
        entriesMap[term].add(doc.id);
      });

      await this.storage.putDocument(doc);
    }

    this.invertedIndex = entriesMap;
    const entries = Object.entries(entriesMap).map(([term, set]) => ({
      term,
      docIds: Array.from(set)
    }));

    const CHUNK = 300;
    for (let i = 0; i < entries.length; i += CHUNK) {
      await this.storage.putIndexTerms(entries.slice(i, i + CHUNK));
    }

    await this.storage.setMeta('lastUpdated', Date.now());
    return this.documents.size;
  }

  /**
   * Clear everything.
   */
  async clear() {
    this.invertedIndex = {};
    this.documents.clear();
    this.docIdCounter = 1;
    await this.storage.clearDocuments();
    await this.storage.clearIndex();
    await this.storage.setMeta('lastUpdated', null);
    await this.storage.setMeta('documentCount', 0);
  }

  /**
   * Seed demo data if index is empty.
   */
  async seedDemoIfEmpty() {
    if (this.documents.size > 0) return false;
    if (typeof DEMO_DOCUMENTS === 'undefined') return false;

    for (const demo of DEMO_DOCUMENTS) {
      const parsed = {
        title: demo.title,
        url: demo.url,
        description: demo.description,
        headings: demo.headings,
        text: demo.text,
        wordCount: demo.wordCount,
        metadata: demo.metadata,
        filename: demo.url,
        isDemo: true
      };
      await this.addDocument(parsed, { id: demo.id, isDemo: true, force: true });
    }
    return true;
  }

  /**
   * Get stats for UI / debug.
   */
  getStats() {
    return {
      documentCount: this.documents.size,
      uniqueTerms: Object.keys(this.invertedIndex).length,
      demoCount: Array.from(this.documents.values()).filter(d => d.isDemo).length
    };
  }

  getDocument(id) {
    return this.documents.get(id) || null;
  }

  getAllDocuments() {
    return Array.from(this.documents.values());
  }
}

if (typeof window !== 'undefined') {
  window.Indexer = Indexer;
}

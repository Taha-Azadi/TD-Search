/**
 * search.js — Query parsing, ranking, and result generation
 *
 * Ranking weights:
 *   Title match        +20
 *   URL match          +10
 *   Heading match      +15
 *   Exact phrase       +25
 *   Content match      +5
 *   Multiple matches   additional
 */

class SearchEngine {
  constructor(indexer, options = {}) {
    this.indexer = indexer;
    this.options = {
      resultsPerPage: 20,
      highlight: true,
      exactPhrase: true,
      fuzzy: false,
      searchTitle: true,
      searchContent: true,
      ...options
    };
  }

  updateOptions(opts) {
    Object.assign(this.options, opts);
  }

  /**
   * Parse a raw query string into structured tokens and operators.
   */
  parseQuery(raw) {
    const query = {
      terms: [],          // required terms (AND)
      orGroups: [],       // OR groups
      phrases: [],        // exact phrases
      exclude: [],        // -terms
      titleTerms: [],     // title:x
      urlTerms: [],       // url:x
      siteTerms: [],      // site:x
      excludeFiletypes: [],
      raw: raw.trim()
    };

    if (!raw || !raw.trim()) return query;

    let str = raw.trim();

    // Extract exact phrases "..."
    const phraseRegex = /"([^"]+)"/g;
    let m;
    while ((m = phraseRegex.exec(str)) !== null) {
      query.phrases.push(m[1].toLowerCase());
    }
    str = str.replace(phraseRegex, ' ');

    // Tokenize remaining, respecting operators
    const tokens = str.split(/\s+/).filter(Boolean);

    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      const lower = tok.toLowerCase();

      // OR operator
      if (lower === 'or' && i > 0 && i < tokens.length - 1) {
        const prev = query.terms.pop();
        const next = tokens[++i];
        if (prev && next) {
          query.orGroups.push([
            HTMLParser.normalizeToken(prev),
            HTMLParser.normalizeToken(next.replace(/^-/, ''))
          ]);
        }
        i++;
        continue;
      }

      // AND is default — skip the keyword
      if (lower === 'and') {
        i++;
        continue;
      }

      // title:term
      if (lower.startsWith('title:')) {
        const val = tok.slice(6);
        if (val) query.titleTerms.push(HTMLParser.normalizeToken(val));
        i++;
        continue;
      }

      // url:term
      if (lower.startsWith('url:')) {
        const val = tok.slice(4);
        if (val) query.urlTerms.push(HTMLParser.normalizeToken(val));
        i++;
        continue;
      }

      // site:term
      if (lower.startsWith('site:')) {
        const val = tok.slice(5).toLowerCase();
        if (val) query.siteTerms.push(val);
        i++;
        continue;
      }

      // -filetype:ext
      if (lower.startsWith('-filetype:')) {
        const val = tok.slice(10).toLowerCase().replace(/^\./, '');
        if (val) query.excludeFiletypes.push(val);
        i++;
        continue;
      }

      // Exclusion -term
      if (tok.startsWith('-') && tok.length > 1) {
        query.exclude.push(HTMLParser.normalizeToken(tok.slice(1)));
        i++;
        continue;
      }

      // Regular term
      const normalized = HTMLParser.normalizeToken(tok);
      if (normalized && normalized.length > 0) {
        query.terms.push(normalized);
      }
      i++;
    }

    return query;
  }

  /**
   * Execute a search and return ranked results.
   */
  search(rawQuery, page = 1) {
    const start = performance.now();
    const query = this.parseQuery(rawQuery);

    if (!query.raw) {
      return {
        results: [],
        total: 0,
        page,
        perPage: this.options.resultsPerPage,
        query,
        took: 0
      };
    }

    // Collect candidate document IDs via inverted index
    let candidateIds = null;

    const intersect = (setA, setB) => {
      if (setA === null) return new Set(setB);
      const result = new Set();
      for (const id of setA) {
        if (setB.has(id)) result.add(id);
      }
      return result;
    };

    const union = (setA, setB) => {
      const result = new Set(setA);
      for (const id of setB) result.add(id);
      return result;
    };

    // Required terms (AND)
    for (const term of query.terms) {
      const ids = this._lookup(term);
      candidateIds = intersect(candidateIds, ids);
      if (candidateIds && candidateIds.size === 0) break;
    }

    // Phrases — treated as required (documents must contain the phrase)
    // We'll filter more precisely during scoring
    for (const phrase of query.phrases) {
      const phraseTokens = HTMLParser.tokenize(phrase);
      for (const t of phraseTokens) {
        const ids = this._lookup(t);
        candidateIds = intersect(candidateIds, ids);
      }
    }

    // Title-only terms
    for (const term of query.titleTerms) {
      const ids = this._lookup(term);
      // Further filter: must appear in title
      const filtered = new Set();
      for (const id of ids) {
        const doc = this.indexer.getDocument(id);
        if (doc && (doc._titleTokens || []).includes(term)) {
          filtered.add(id);
        }
      }
      candidateIds = intersect(candidateIds, filtered);
    }

    // URL terms
    for (const term of query.urlTerms) {
      const ids = this._lookup(term);
      const filtered = new Set();
      for (const id of ids) {
        const doc = this.indexer.getDocument(id);
        if (doc && (doc._urlTokens || []).includes(term)) {
          filtered.add(id);
        }
      }
      candidateIds = intersect(candidateIds, filtered);
    }

    // OR groups
    for (const group of query.orGroups) {
      let orSet = new Set();
      for (const term of group) {
        orSet = union(orSet, this._lookup(term));
      }
      candidateIds = intersect(candidateIds, orSet);
    }

    // If no positive terms at all but we have operators, start from all docs
    const hasPositive =
      query.terms.length > 0 ||
      query.phrases.length > 0 ||
      query.titleTerms.length > 0 ||
      query.urlTerms.length > 0 ||
      query.orGroups.length > 0;

    if (!hasPositive && candidateIds === null) {
      candidateIds = new Set(this.indexer.documents.keys());
    }

    if (!candidateIds || candidateIds.size === 0) {
      return {
        results: [],
        total: 0,
        page,
        perPage: this.options.resultsPerPage,
        query,
        took: performance.now() - start
      };
    }

    // Score each candidate
    const scored = [];
    for (const id of candidateIds) {
      const doc = this.indexer.getDocument(id);
      if (!doc) continue;

      // Exclusions
      if (this._isExcluded(doc, query)) continue;

      // Site filter
      if (query.siteTerms.length > 0) {
        const urlLower = (doc.url || '').toLowerCase();
        if (!query.siteTerms.some(s => urlLower.includes(s))) continue;
      }

      const score = this._scoreDocument(doc, query);
      if (score > 0) {
        scored.push({ doc, score });
      }
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const total = scored.length;
    const perPage = this.options.resultsPerPage;
    const startIdx = (page - 1) * perPage;
    const pageItems = scored.slice(startIdx, startIdx + perPage);

    // Build result objects with snippets + highlighting
    const results = pageItems.map(({ doc, score }) => {
      const snippet = this._buildSnippet(doc, query);
      return {
        id: doc.id,
        title: this.options.highlight ? this._highlight(doc.title, query) : doc.title,
        url: doc.url,
        description: snippet,
        score,
        wordCount: doc.wordCount,
        indexedAt: doc.indexedAt,
        isDemo: !!doc.isDemo,
        metadata: doc.metadata
      };
    });

    return {
      results,
      total,
      page,
      perPage,
      query,
      took: performance.now() - start
    };
  }

  /**
   * Lookup term in inverted index (with optional prefix / fuzzy).
   */
  _lookup(term) {
    const index = this.indexer.invertedIndex;
    if (index[term]) {
      return new Set(index[term]);
    }

    // Prefix matching
    const matches = new Set();
    for (const [t, ids] of Object.entries(index)) {
      if (t.startsWith(term)) {
        for (const id of ids) matches.add(id);
      }
    }

    // Simple fuzzy: edit distance 1 for short terms when enabled
    if (this.options.fuzzy && term.length >= 4 && matches.size === 0) {
      for (const [t, ids] of Object.entries(index)) {
        if (Math.abs(t.length - term.length) <= 1 && this._editDistance(t, term) <= 1) {
          for (const id of ids) matches.add(id);
        }
      }
    }

    return matches;
  }

  _editDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  _isExcluded(doc, query) {
    // Exclude terms
    for (const term of query.exclude) {
      const inTitle = (doc._titleTokens || []).includes(term);
      const inContent = (doc._contentTokens || []).includes(term);
      const inHead = (doc._headingTokens || []).includes(term);
      if (inTitle || inContent || inHead) return true;
    }
    // Exclude filetypes
    if (query.excludeFiletypes.length > 0) {
      const ft = (doc.metadata && doc.metadata.filetype) || '';
      const url = (doc.url || '').toLowerCase();
      for (const ext of query.excludeFiletypes) {
        if (ft === ext || url.endsWith('.' + ext)) return true;
      }
    }
    return false;
  }

  /**
   * Compute relevance score for a document against the query.
   */
  _scoreDocument(doc, query) {
    let score = 0;
    const titleTokens = doc._titleTokens || [];
    const headingTokens = doc._headingTokens || [];
    const contentTokens = doc._contentTokens || [];
    const urlTokens = doc._urlTokens || [];
    const titleSet = new Set(titleTokens);
    const headingSet = new Set(headingTokens);
    const contentSet = new Set(contentTokens);
    const urlSet = new Set(urlTokens);

    const allTerms = [
      ...query.terms,
      ...query.titleTerms,
      ...query.urlTerms,
      ...query.orGroups.flat()
    ];

    for (const term of allTerms) {
      if (this.options.searchTitle && titleSet.has(term)) {
        score += 20;
        // Bonus for multiple occurrences
        const count = titleTokens.filter(t => t === term).length;
        if (count > 1) score += (count - 1) * 5;
      }
      if (headingSet.has(term)) {
        score += 15;
      }
      if (urlSet.has(term)) {
        score += 10;
      }
      if (this.options.searchContent && contentSet.has(term)) {
        score += 5;
        const count = contentTokens.filter(t => t === term).length;
        if (count > 1) score += Math.min(count - 1, 10) * 2;
      }
    }

    // Exact phrase bonus
    if (this.options.exactPhrase && query.phrases.length > 0) {
      const titleLower = (doc.title || '').toLowerCase();
      const textLower = (doc.text || '').toLowerCase();
      const headLower = (doc.headings || []).join(' ').toLowerCase();
      for (const phrase of query.phrases) {
        if (titleLower.includes(phrase)) score += 25;
        else if (headLower.includes(phrase)) score += 20;
        else if (textLower.includes(phrase)) score += 15;
      }
    }

    // Title-specific operator already filtered; small extra boost
    for (const term of query.titleTerms) {
      if (titleSet.has(term)) score += 10;
    }

    // Slight boost for shorter documents (more focused) when scores are close
    if (doc.wordCount > 0 && doc.wordCount < 300) {
      score += 2;
    }

    return score;
  }

  /**
   * Build a snippet with optional highlighting around match terms.
   */
  _buildSnippet(doc, query, maxLen = 200) {
    const text = doc.text || doc.description || '';
    if (!text) return doc.description || '';

    const terms = [
      ...query.terms,
      ...query.phrases,
      ...query.titleTerms
    ].filter(Boolean);

    if (terms.length === 0) {
      const s = text.slice(0, maxLen);
      return s.length < text.length ? s + '…' : s;
    }

    // Find earliest occurrence of any term
    const lower = text.toLowerCase();
    let bestPos = -1;
    for (const term of terms) {
      const pos = lower.indexOf(term.toLowerCase());
      if (pos !== -1 && (bestPos === -1 || pos < bestPos)) {
        bestPos = pos;
      }
    }

    let snippet;
    if (bestPos === -1) {
      snippet = text.slice(0, maxLen);
    } else {
      const start = Math.max(0, bestPos - 40);
      const end = Math.min(text.length, start + maxLen);
      snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
    }

    if (this.options.highlight) {
      return this._highlight(snippet, query);
    }
    return snippet;
  }

  /**
   * Highlight matching terms in text (returns HTML-safe string with <mark>).
   */
  _highlight(text, query) {
    if (!text) return '';
    const terms = [
      ...query.terms,
      ...query.phrases,
      ...query.titleTerms,
      ...query.urlTerms,
      ...query.orGroups.flat()
    ].filter(Boolean);

    if (terms.length === 0) return this._escapeHtml(text);

    // Sort longest first to avoid partial overlaps
    const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length);
    const pattern = sorted.map(t => this._escapeRegex(t)).join('|');
    if (!pattern) return this._escapeHtml(text);

    const regex = new RegExp(`(${pattern})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return '<mark>' + this._escapeHtml(part) + '</mark>';
      }
      return this._escapeHtml(part);
    }).join('');
  }

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Autocomplete suggestions from local index terms.
   */
  suggest(prefix, limit = 8) {
    if (!prefix || prefix.length < 1) return [];
    const lower = prefix.toLowerCase().trim();
    const index = this.indexer.invertedIndex;
    const matches = [];

    for (const term of Object.keys(index)) {
      if (term.startsWith(lower)) {
        matches.push({
          term,
          count: index[term].size
        });
      }
    }

    matches.sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
    return matches.slice(0, limit).map(m => m.term);
  }
}

if (typeof window !== 'undefined') {
  window.SearchEngine = SearchEngine;
}

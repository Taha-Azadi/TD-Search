/**
 * parser.js — HTML parsing and text extraction
 * Uses DOMParser. Never executes scripts from imported HTML.
 */

class HTMLParser {
  /**
   * Parse an HTML string into a structured document object.
   * @param {string} htmlString
   * @param {string} filename - original filename or path
   * @param {object} [options]
   * @returns {object} extracted document
   */
  static parse(htmlString, filename = 'unknown.html', options = {}) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      throw new Error('Malformed HTML: ' + parseError.textContent.slice(0, 120));
    }

    // Remove scripts, styles, noscript, templates — treat as data only
    const removeSelectors = ['script', 'style', 'noscript', 'template', 'svg script'];
    removeSelectors.forEach(sel => {
      doc.querySelectorAll(sel).forEach(el => el.remove());
    });

    // Title
    let title = '';
    const titleEl = doc.querySelector('title');
    if (titleEl && titleEl.textContent.trim()) {
      title = titleEl.textContent.trim();
    } else {
      const h1 = doc.querySelector('h1');
      title = h1 ? h1.textContent.trim() : filename;
    }
    title = this.cleanText(title) || filename;

    // Meta description
    let description = '';
    const metaDesc = doc.querySelector('meta[name="description"]');
    if (metaDesc && metaDesc.getAttribute('content')) {
      description = this.cleanText(metaDesc.getAttribute('content'));
    }

    // Meta keywords / other metadata
    const metadata = {
      source: 'import',
      filetype: 'html',
      charset: doc.characterSet || 'UTF-8',
      language: doc.documentElement.lang || '',
      tags: []
    };
    const metaKeywords = doc.querySelector('meta[name="keywords"]');
    if (metaKeywords && metaKeywords.getAttribute('content')) {
      metadata.tags = metaKeywords.getAttribute('content')
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);
    }
    const metaAuthor = doc.querySelector('meta[name="author"]');
    if (metaAuthor) metadata.author = metaAuthor.getAttribute('content') || '';

    // Headings
    const headings = [];
    doc.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
      const t = this.cleanText(h.textContent);
      if (t) headings.push(t);
    });

    // Links (for potential future use / site: operator)
    const links = [];
    doc.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
        links.push({ href, text: this.cleanText(a.textContent) });
      }
    });

    // Main readable text
    // Prefer main/article, fall back to body
    let contentRoot = doc.querySelector('main') ||
                      doc.querySelector('article') ||
                      doc.querySelector('[role="main"]') ||
                      doc.body;

    // Remove common noise elements
    const noiseSelectors = [
      'nav', 'header', 'footer', 'aside',
      '.nav', '.navbar', '.navigation', '.menu',
      '.sidebar', '.footer', '.header',
      '.advertisement', '.ad', '.ads',
      '[aria-hidden="true"]'
    ];
    // Clone to avoid mutating original for other extractions
    const contentClone = contentRoot.cloneNode(true);
    noiseSelectors.forEach(sel => {
      try {
        contentClone.querySelectorAll(sel).forEach(el => el.remove());
      } catch (_) { /* ignore invalid selectors in edge cases */ }
    });

    // Extract text from paragraphs, list items, table cells, divs with text
    const textParts = [];
    const textElements = contentClone.querySelectorAll('p, li, td, th, blockquote, pre, figcaption, dt, dd');
    if (textElements.length > 0) {
      textElements.forEach(el => {
        const t = this.cleanText(el.textContent);
        if (t && t.length > 15) textParts.push(t);
      });
    }

    // Fallback: whole content text
    let fullText = textParts.join(' ');
    if (fullText.length < 50) {
      fullText = this.cleanText(contentClone.textContent || '');
    }

    // Build description from first substantial paragraph if missing
    if (!description && textParts.length > 0) {
      description = textParts[0].slice(0, 200);
      if (textParts[0].length > 200) description += '…';
    }
    if (!description) {
      description = fullText.slice(0, 180) + (fullText.length > 180 ? '…' : '');
    }

    // Word count
    const words = fullText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    // URL / path representation
    const url = options.url || ('file:///' + filename.replace(/\\/g, '/'));

    return {
      title,
      url,
      description,
      headings,
      text: fullText,
      wordCount,
      links,
      metadata,
      filename
    };
  }

  /**
   * Normalize and clean extracted text.
   */
  static cleanText(str) {
    if (!str) return '';
    return str
      .replace(/\s+/g, ' ')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .trim();
  }

  /**
   * Tokenize text for indexing.
   * Lowercase, strip most punctuation, split on whitespace.
   */
  static tokenize(text) {
    if (!text) return [];
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1 || /^\d+$/.test(t));
  }

  /**
   * Normalize a single token.
   */
  static normalizeToken(token) {
    return token.toLowerCase().replace(/^['-]+|['-]+$/g, '');
  }
}

// Export for module-style usage (also attached to window for non-module scripts)
if (typeof window !== 'undefined') {
  window.HTMLParser = HTMLParser;
}

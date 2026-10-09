/**
 * crawler.js — Offline HTML file importer / crawler
 *
 * Works entirely with File / FileReader / DOMParser.
 * No network requests. Scripts from imported HTML are never executed.
 *
 * Optional robots.txt parser is included for local robots.txt files
 * (useful if user imports a full site mirror that includes robots.txt).
 */

class RobotsParser {
  /**
   * Parse a robots.txt string.
   * @param {string} text
   * @returns {object} rules
   */
  static parse(text) {
    const rules = {
      userAgents: {},
      sitemaps: [],
      crawlDelay: null
    };

    let currentAgents = ['*'];
    const lines = text.split(/\r?\n/);

    for (let line of lines) {
      // Strip comments
      const commentIdx = line.indexOf('#');
      if (commentIdx !== -1) line = line.slice(0, commentIdx);
      line = line.trim();
      if (!line) continue;

      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      switch (key) {
        case 'user-agent':
          currentAgents = [value.toLowerCase()];
          if (!rules.userAgents[value.toLowerCase()]) {
            rules.userAgents[value.toLowerCase()] = { allow: [], disallow: [] };
          }
          break;
        case 'allow':
          currentAgents.forEach(ua => {
            if (!rules.userAgents[ua]) rules.userAgents[ua] = { allow: [], disallow: [] };
            rules.userAgents[ua].allow.push(value);
          });
          break;
        case 'disallow':
          currentAgents.forEach(ua => {
            if (!rules.userAgents[ua]) rules.userAgents[ua] = { allow: [], disallow: [] };
            rules.userAgents[ua].disallow.push(value);
          });
          break;
        case 'sitemap':
          rules.sitemaps.push(value);
          break;
        case 'crawl-delay':
          rules.crawlDelay = parseFloat(value) || null;
          break;
      }
    }

    return rules;
  }

  /**
   * Check if a path is allowed for a given user-agent.
   */
  static isAllowed(rules, path, userAgent = '*') {
    const ua = userAgent.toLowerCase();
    const agentRules = rules.userAgents[ua] || rules.userAgents['*'];
    if (!agentRules) return true;

    // Longest match wins (simplified)
    let matchedAllow = '';
    let matchedDisallow = '';

    for (const p of agentRules.allow) {
      if (path.startsWith(p) && p.length > matchedAllow.length) {
        matchedAllow = p;
      }
    }
    for (const p of agentRules.disallow) {
      if (p === '' ) continue; // empty disallow = allow all
      if (path.startsWith(p) && p.length > matchedDisallow.length) {
        matchedDisallow = p;
      }
    }

    if (matchedDisallow && matchedDisallow.length >= matchedAllow.length) {
      return false;
    }
    return true;
  }
}


class Crawler {
  constructor(indexer) {
    this.indexer = indexer;
    this.robotsRules = null;
    this.selectedFiles = [];
  }

  /**
   * Set selected FileList / File array from input or drop.
   */
  setFiles(files) {
    this.selectedFiles = Array.from(files).filter(f => {
      const name = (f.name || '').toLowerCase();
      const type = (f.type || '').toLowerCase();
      return name.endsWith('.html') || name.endsWith('.htm') ||
             type === 'text/html' || type === 'application/xhtml+xml';
    });
    return this.selectedFiles.length;
  }

  /**
   * Optionally load a local robots.txt File.
   */
  async loadRobotsTxt(file) {
    const text = await this._readFile(file);
    this.robotsRules = RobotsParser.parse(text);
    return this.robotsRules;
  }

  /**
   * Import all selected files, parse, and index.
   * @param {function} onProgress - (current, total, statusObj)
   * @returns {object} summary
   */
  async importFiles(onProgress) {
    const files = this.selectedFiles;
    const summary = {
      files: files.length,
      indexed: 0,
      duplicates: 0,
      errors: [],
      skipped: 0
    };

    if (files.length === 0) {
      return summary;
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const status = { filename: file.name, status: 'processing' };

      try {
        // robots.txt check (path-based, using filename as path proxy)
        if (this.robotsRules) {
          const path = '/' + file.name;
          if (!RobotsParser.isAllowed(this.robotsRules, path)) {
            status.status = 'skipped';
            status.message = 'Blocked by robots.txt';
            summary.skipped++;
            if (onProgress) onProgress(i + 1, files.length, { ...summary, current: status });
            continue;
          }
        }

        const html = await this._readFile(file);
        const parsed = HTMLParser.parse(html, file.name, {
          url: 'file:///' + file.name
        });

        const result = await this.indexer.addDocument(parsed);

        if (result.duplicate) {
          status.status = 'duplicate';
          status.message = 'Already indexed';
          summary.duplicates++;
        } else {
          status.status = 'indexed';
          status.message = 'OK';
          summary.indexed++;
        }
      } catch (err) {
        status.status = 'error';
        status.message = err.message || String(err);
        summary.errors.push({ filename: file.name, error: status.message });
      }

      if (onProgress) {
        onProgress(i + 1, files.length, { ...summary, current: status });
      }
    }

    return summary;
  }

  /**
   * Read a File as text via FileReader.
   */
  _readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file: ' + file.name));
      reader.readAsText(file);
    });
  }
}

if (typeof window !== 'undefined') {
  window.Crawler = Crawler;
  window.RobotsParser = RobotsParser;
}

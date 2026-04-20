/**
 * Thin wrapper around the GitHub REST API for the admin panel.
 *
 * Usage:
 *   const api = new GithubApi({ owner, repo, branch, token });
 *   await api.getFile('data/products.json');
 *   await api.putFile('data/products.json', jsonString, 'update catalog', sha);
 *   await api.uploadBinary('uploads/xyz.pptx', fileObject, 'upload PPTX');
 *
 * The token required is a fine-grained Personal Access Token scoped to this repo
 * with "Contents: Read and write" permission.
 */
class GithubApi {
  constructor({ owner, repo, branch = 'main', token }) {
    if (!owner || !repo || !token) throw new Error('owner, repo and token are required');
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.base = `https://api.github.com/repos/${owner}/${repo}`;
  }

  _headers(extra = {}) {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra
    };
  }

  /** Verify token + repo access. Throws on failure. */
  async whoami() {
    const r = await fetch(this.base, { headers: this._headers() });
    if (r.status === 401) throw new Error('Token invalid or expired');
    if (r.status === 404) throw new Error('Repository not found or token lacks access');
    if (!r.ok) throw new Error(`GitHub returned HTTP ${r.status}`);
    return r.json();
  }

  /**
   * GET /contents/{path}. Returns { sha, content (utf-8 string), raw (base64), size }.
   * Returns null if the file does not exist.
   */
  async getFile(path) {
    const url = `${this.base}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`;
    const r = await fetch(url, { headers: this._headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`getFile(${path}): HTTP ${r.status}`);
    const j = await r.json();
    // j.content is base64 w/ newlines
    const raw = (j.content || '').replace(/\n/g, '');
    let content = '';
    try { content = raw ? decodeURIComponent(escape(atob(raw))) : ''; }
    catch { content = atob(raw); }
    return { sha: j.sha, content, raw, size: j.size, url: j.html_url };
  }

  /** PUT a UTF-8 text file (create or update). `sha` is required for updates. */
  async putFile(path, content, message, sha = null) {
    const b64 = btoa(unescape(encodeURIComponent(content)));
    return this._putBase64(path, b64, message, sha);
  }

  /** PUT a binary File/Blob. `sha` is required for updates. */
  async uploadBinary(path, fileOrBlob, message, sha = null, onProgress = null) {
    const b64 = await fileToBase64(fileOrBlob, onProgress);
    return this._putBase64(path, b64, message, sha);
  }

  async _putBase64(path, b64, message, sha) {
    const body = {
      message,
      content: b64,
      branch: this.branch
    };
    if (sha) body.sha = sha;

    const url = `${this.base}/contents/${encodeURI(path)}`;
    const r = await fetch(url, {
      method: 'PUT',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`putFile(${path}): HTTP ${r.status} ${text}`);
    }
    return r.json();
  }

  /** DELETE /contents/{path}. Requires `sha`. */
  async deleteFile(path, message, sha) {
    const url = `${this.base}/contents/${encodeURI(path)}`;
    const r = await fetch(url, {
      method: 'DELETE',
      headers: this._headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ message, sha, branch: this.branch })
    });
    if (!r.ok) throw new Error(`deleteFile(${path}): HTTP ${r.status}`);
    return r.json();
  }

  /** List files/folders inside a directory. Returns [] if the directory doesn't exist. */
  async listDir(path) {
    const url = `${this.base}/contents/${encodeURI(path)}?ref=${encodeURIComponent(this.branch)}`;
    const r = await fetch(url, { headers: this._headers() });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`listDir(${path}): HTTP ${r.status}`);
    return r.json();
  }

  /** Delete a directory recursively (only small dirs - each file = 1 request). */
  async deleteDir(path, message) {
    const entries = await this.listDir(path);
    for (const entry of entries) {
      if (entry.type === 'dir') {
        await this.deleteDir(entry.path, message);
      } else {
        await this.deleteFile(entry.path, message, entry.sha);
      }
    }
  }

  /** Query GitHub Actions runs, useful to show conversion status. */
  async latestActionRun(workflow = 'convert-pptx.yml') {
    const url = `${this.base}/actions/workflows/${workflow}/runs?per_page=1&branch=${encodeURIComponent(this.branch)}`;
    const r = await fetch(url, { headers: this._headers() });
    if (!r.ok) return null;
    const j = await r.json();
    return j.workflow_runs?.[0] || null;
  }
}

/** Convert a File/Blob to base64 (without the data URL prefix), optionally reporting progress. */
function fileToBase64(fileOrBlob, onProgress = null) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.onprogress = (e) => {
      if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total);
    };
    reader.onload = () => {
      const result = reader.result; // "data:...;base64,AAAA"
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(fileOrBlob);
  });
}

/**
 * Try to guess owner/repo from the current URL.
 * Works for *.github.io/repo and repo-with-custom-domain is null.
 */
function detectRepoFromUrl() {
  const host = location.hostname;
  const parts = location.pathname.split('/').filter(Boolean);
  if (host.endsWith('.github.io')) {
    const owner = host.split('.')[0];
    const repo = parts[0] || `${owner}.github.io`;
    return { owner, repo };
  }
  return null;
}

/** PBKDF2-SHA256 password hashing / verification (no external library). */
const PasswordCrypto = {
  ITERATIONS: 150000,

  async hash(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await this._deriveKey(password, salt, this.ITERATIONS);
    return `pbkdf2-sha256$${this.ITERATIONS}$${b64encode(salt)}$${b64encode(new Uint8Array(key))}`;
  },

  async verify(password, record) {
    const parts = record.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
    const iters = parseInt(parts[1], 10);
    const salt  = b64decode(parts[2]);
    const stored = b64decode(parts[3]);
    const derived = new Uint8Array(await this._deriveKey(password, salt, iters));
    if (derived.length !== stored.length) return false;
    // Constant-time compare
    let diff = 0;
    for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ stored[i];
    return diff === 0;
  },

  async _deriveKey(password, salt, iterations) {
    const enc = new TextEncoder();
    const material = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    return crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      material,
      256
    );
  }
};

function b64encode(bytes) { return btoa(String.fromCharCode(...bytes)); }
function b64decode(str)   {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

window.GithubApi = GithubApi;
window.PasswordCrypto = PasswordCrypto;
window.detectRepoFromUrl = detectRepoFromUrl;

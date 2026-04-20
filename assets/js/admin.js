/**
 * Comda Academy - Admin panel.
 *
 * Responsibilities:
 *  - Gate access behind username + password (PBKDF2 hash in data/auth.json).
 *  - Hold a fine-grained GitHub PAT in localStorage (never sent anywhere but to api.github.com).
 *  - CRUD for products & categories against data/products.json.
 *  - Upload PPTX files to uploads/ (the GitHub Actions workflow converts them to WebP).
 *  - Poll the latest workflow run so the admin can see conversion progress.
 */
(() => {
  'use strict';

  const DATA_URL     = 'data/products.json';
  const AUTH_URL     = 'data/auth.json';
  const PRODUCTS_DIR = 'data/presentations';
  const UPLOADS_DIR  = 'uploads';
  const CFG_KEY      = 'academy.adminCfg';

  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let auth = null;          // { admin: { username, passwordHash } }
  let data = null;          // products.json (in memory)
  let productsSha = null;   // sha of products.json at last fetch
  let api = null;           // GithubApi instance once logged in
  let pollInterval = null;

  // ---------- Boot ----------
  document.addEventListener('DOMContentLoaded', boot);

  async function boot() {
    wireUi();
    try {
      auth = await fetchJson(`${AUTH_URL}?t=${Date.now()}`);
    } catch (e) {
      showStatus('error', `לא ניתן לטעון את הגדרות האימות: ${e.message}`);
    }

    const cfg = loadCfg();
    if (cfg) {
      // Pre-fill fields (not the password, of course)
      $('#cfg-owner').value  = cfg.owner  || '';
      $('#cfg-repo').value   = cfg.repo   || '';
      $('#cfg-branch').value = cfg.branch || 'main';
      if (cfg.token) $('#cfg-token').placeholder = '••••••• (saved)';
    } else {
      const auto = detectRepoFromUrl();
      if (auto) {
        $('#cfg-owner').value = auto.owner;
        $('#cfg-repo').value  = auto.repo;
      }
    }
  }

  function wireUi() {
    $('#btn-login').addEventListener('click', onLogin);
    $('#login-form').addEventListener('submit', (e) => { e.preventDefault(); onLogin(); });
    $('#btn-logout').addEventListener('click', onLogout);

    // Tabs
    $$('.tab').forEach(tab => tab.addEventListener('click', () => activateTab(tab.dataset.tab)));

    // Add buttons
    $('#btn-add-product').addEventListener('click',  () => openProductModal(null));
    $('#btn-add-category').addEventListener('click', () => openCategoryModal(null));

    // Modals: close on backdrop click + escape
    $$('.modal-backdrop').forEach(bd => {
      bd.addEventListener('click', (e) => { if (e.target === bd) bd.classList.remove('open'); });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $$('.modal-backdrop').forEach(bd => bd.classList.remove('open'));
    });

    // Product modal
    $('#product-cancel').addEventListener('click', () => $('#product-modal').classList.remove('open'));
    $('#product-save').addEventListener('click', onProductSave);

    // Category modal
    $('#category-cancel').addEventListener('click', () => $('#category-modal').classList.remove('open'));
    $('#category-save').addEventListener('click', onCategorySave);

    // Upload modal
    $('#upload-cancel').addEventListener('click', () => $('#upload-modal').classList.remove('open'));
    $('#upload-start').addEventListener('click', onUploadStart);

    // Change password
    $('#btn-change-password').addEventListener('click', onChangePassword);

    // Save GitHub config (without logging in; useful for first-time setup)
    $('#btn-save-cfg').addEventListener('click', onSaveCfgOnly);
  }

  // ---------- Login ----------
  async function onLogin() {
    const username = $('#login-username').value.trim();
    const password = $('#login-password').value;
    const cfg = {
      owner:  $('#cfg-owner').value.trim(),
      repo:   $('#cfg-repo').value.trim(),
      branch: $('#cfg-branch').value.trim() || 'main',
      token:  $('#cfg-token').value.trim() || loadCfg()?.token || ''
    };

    $('#login-status').textContent = '';

    if (!auth?.admin) return setLoginError('הגדרות האימות לא נטענו');
    if (username !== auth.admin.username) return setLoginError('שם משתמש שגוי');

    const ok = await PasswordCrypto.verify(password, auth.admin.passwordHash);
    if (!ok) return setLoginError('סיסמה שגויה');

    if (!cfg.owner || !cfg.repo || !cfg.token) {
      return setLoginError('חסרים פרטי GitHub (owner/repo/token)');
    }

    setLoginBusy(true);
    try {
      const tentative = new GithubApi(cfg);
      await tentative.whoami();
      api = tentative;
      saveCfg(cfg);
      $('#cfg-token').value = '';
    } catch (e) {
      setLoginBusy(false);
      return setLoginError(`חיבור ל-GitHub נכשל: ${e.message}`);
    }
    setLoginBusy(false);

    await enterAdmin();
  }

  function setLoginBusy(busy) {
    $('#btn-login').disabled = busy;
    $('#btn-login').textContent = busy ? 'מתחבר...' : 'התחבר';
  }
  function setLoginError(msg) {
    const el = $('#login-status');
    el.className = 'status error';
    el.textContent = msg;
  }

  async function enterAdmin() {
    $('#login-screen').classList.add('hidden');
    $('#admin-screen').classList.remove('hidden');
    await refreshAll();
    activateTab('tab-products');
  }

  function onLogout() {
    if (pollInterval) clearInterval(pollInterval);
    // Keep the cfg (owner/repo/branch) but clear the token.
    const cfg = loadCfg();
    if (cfg) { cfg.token = ''; saveCfg(cfg); }
    api = null;
    $('#admin-screen').classList.add('hidden');
    $('#login-screen').classList.remove('hidden');
    $('#login-password').value = '';
  }

  function onSaveCfgOnly() {
    const cfg = {
      owner:  $('#cfg-owner').value.trim(),
      repo:   $('#cfg-repo').value.trim(),
      branch: $('#cfg-branch').value.trim() || 'main',
      token:  $('#cfg-token').value.trim()
    };
    if (!cfg.owner || !cfg.repo) return setLoginError('חסרים owner/repo');
    saveCfg(cfg);
    $('#cfg-token').value = '';
    $('#cfg-token').placeholder = '••••••• (saved)';
    const el = $('#login-status');
    el.className = 'status success';
    el.textContent = 'הגדרות GitHub נשמרו מקומית.';
  }

  // ---------- Tabs ----------
  function activateTab(id) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === id));
    $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== id));
    if (id === 'tab-products')   renderProducts();
    if (id === 'tab-categories') renderCategories();
  }

  // ---------- Data refresh ----------
  async function refreshAll() {
    showStatus('info', 'טוען נתונים...');
    try {
      const f = await api.getFile(DATA_URL);
      if (!f) throw new Error(`${DATA_URL} לא נמצא בריפו`);
      data = JSON.parse(f.content);
      productsSha = f.sha;
      clearStatus();
    } catch (e) {
      showStatus('error', `שגיאה: ${e.message}`);
    }
  }

  async function saveProductsJson(message) {
    data.updatedAt = new Date().toISOString();
    const json = JSON.stringify(data, null, 2) + '\n';
    const res = await api.putFile(DATA_URL, json, message, productsSha);
    productsSha = res.content?.sha || productsSha;
  }

  // ---------- Products tab ----------
  function renderProducts() {
    const host = $('#products-list');
    host.innerHTML = '';
    if (!data) return;

    const cats = [...data.categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    for (const cat of cats) {
      const items = data.products.filter(p => p.cat === cat.key);
      if (!items.length) continue;

      const group = document.createElement('div');
      group.style.marginBottom = '28px';
      group.innerHTML = `<h3 style="color: var(--neon-blue); font-weight:400; letter-spacing:1px; margin:0 0 10px;">${escapeHtml(cat.he)} <span class="muted" style="font-weight:300; font-size:.8em;">/ ${escapeHtml(cat.en)}</span></h3>`;

      const list = document.createElement('div');
      list.className = 'items-list';
      for (const p of items) list.appendChild(buildProductRow(p));
      group.appendChild(list);
      host.appendChild(group);
    }

    // Uncategorised products (category no longer exists)
    const orphan = data.products.filter(p => !data.categories.some(c => c.key === p.cat));
    if (orphan.length) {
      const group = document.createElement('div');
      group.style.marginBottom = '28px';
      group.innerHTML = `<h3 style="color:#f87171; font-weight:400;">מוצרים ללא קטגוריה</h3>`;
      const list = document.createElement('div');
      list.className = 'items-list';
      for (const p of orphan) list.appendChild(buildProductRow(p));
      group.appendChild(list);
      host.appendChild(group);
    }
  }

  function buildProductRow(p) {
    const pagesHe = p.pages?.he ?? 0;
    const pagesEn = p.pages?.en ?? 0;
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div class="meta">
        <div class="primary">${escapeHtml(p.nameHe)} <span class="muted" style="font-size:.85em">/ ${escapeHtml(p.nameEn)}</span></div>
        <div class="secondary">
          <code style="background:rgba(0,0,0,.3); padding:1px 6px; border-radius:4px;">${escapeHtml(p.folder)}</code>
          &nbsp;•&nbsp; HE: ${pagesHe} שקפים
          &nbsp;•&nbsp; EN: ${pagesEn} slides
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost" data-act="upload">העלה PPTX</button>
        <button class="btn btn-ghost" data-act="edit">ערוך</button>
        <button class="btn btn-danger" data-act="delete">מחק</button>
      </div>`;
    row.querySelector('[data-act=edit]').onclick    = () => openProductModal(p);
    row.querySelector('[data-act=delete]').onclick  = () => onDeleteProduct(p);
    row.querySelector('[data-act=upload]').onclick  = () => openUploadModal(p);
    return row;
  }

  function openProductModal(existing) {
    const m = $('#product-modal');
    m.dataset.mode = existing ? 'edit' : 'new';
    m.dataset.originalId = existing ? String(existing.id) : '';
    $('#pm-title').textContent = existing ? 'עריכת מוצר' : 'מוצר חדש';

    $('#pm-nameHe').value = existing?.nameHe || '';
    $('#pm-nameEn').value = existing?.nameEn || '';
    $('#pm-folder').value = existing?.folder || '';
    $('#pm-folder').disabled = !!existing; // cannot rename folder after creation

    // populate categories
    const sel = $('#pm-category');
    sel.innerHTML = '';
    for (const c of data.categories) {
      const opt = document.createElement('option');
      opt.value = c.key;
      opt.textContent = `${c.he} / ${c.en}`;
      if (existing && existing.cat === c.key) opt.selected = true;
      sel.appendChild(opt);
    }

    $('#pm-status').textContent = '';
    m.classList.add('open');
  }

  async function onProductSave() {
    const m = $('#product-modal');
    const mode = m.dataset.mode;
    const statusEl = $('#pm-status');

    const nameHe = $('#pm-nameHe').value.trim();
    const nameEn = $('#pm-nameEn').value.trim();
    const folder = $('#pm-folder').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const cat    = $('#pm-category').value;

    if (!nameHe || !nameEn || !folder || !cat) {
      statusEl.className = 'status error';
      statusEl.textContent = 'כל השדות חובה';
      return;
    }

    $('#product-save').disabled = true;
    try {
      if (mode === 'new') {
        if (data.products.some(p => p.folder === folder)) {
          throw new Error('קיים כבר מוצר עם המזהה הזה (folder)');
        }
        const newId = Math.max(0, ...data.products.map(p => p.id)) + 1;
        data.products.push({ id: newId, cat, folder, nameHe, nameEn, pages: { he: 0, en: 0 } });
      } else {
        const id = parseInt(m.dataset.originalId, 10);
        const p = data.products.find(x => x.id === id);
        if (!p) throw new Error('מוצר לא נמצא');
        p.nameHe = nameHe; p.nameEn = nameEn; p.cat = cat;
      }
      await saveProductsJson(`admin: ${mode === 'new' ? 'add' : 'update'} product ${folder}`);
      m.classList.remove('open');
      renderProducts();
      showStatus('success', 'נשמר בהצלחה');
    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = e.message;
    } finally {
      $('#product-save').disabled = false;
    }
  }

  async function onDeleteProduct(p) {
    if (!confirm(`למחוק את המוצר "${p.nameHe}"? כל השקפים שלו יימחקו מהריפו.`)) return;
    showStatus('info', `מוחק את המוצר ${p.folder}...`);
    try {
      // Remove from catalog first
      data.products = data.products.filter(x => x.id !== p.id);
      await saveProductsJson(`admin: remove product ${p.folder}`);

      // Then delete the presentation folder (best-effort; 404 ignored).
      try { await api.deleteDir(`${PRODUCTS_DIR}/${p.folder}`, `admin: cleanup files for ${p.folder}`); }
      catch (e) { console.warn('presentation cleanup warning:', e); }

      renderProducts();
      showStatus('success', `המוצר ${p.folder} נמחק`);
    } catch (e) {
      showStatus('error', `מחיקה נכשלה: ${e.message}`);
    }
  }

  // ---------- Upload PPTX ----------
  function openUploadModal(p) {
    const m = $('#upload-modal');
    m.dataset.productId = String(p.id);
    $('#um-title').textContent = `העלאת מצגת: ${p.nameHe}`;
    $('#um-file').value = '';
    $('#um-status').textContent = '';
    $('#um-progress').style.width = '0%';
    $('#um-progress-wrap').style.display = 'none';
    $('#um-lang').value = 'he';
    m.classList.add('open');
  }

  async function onUploadStart() {
    const m = $('#upload-modal');
    const id = parseInt(m.dataset.productId, 10);
    const p = data.products.find(x => x.id === id);
    const lang = $('#um-lang').value;
    const file = $('#um-file').files[0];
    const statusEl = $('#um-status');

    if (!file) { statusEl.className='status error'; statusEl.textContent = 'בחר קובץ PPTX'; return; }
    if (!/\.pptx?$/i.test(file.name) && !/\.pdf$/i.test(file.name)) {
      statusEl.className='status error'; statusEl.textContent = 'רק קבצי PPTX, PPT, PDF';
      return;
    }
    if (file.size > 95 * 1024 * 1024) {
      statusEl.className='status error'; statusEl.textContent = 'הקובץ גדול מדי (עד 95MB)';
      return;
    }

    $('#upload-start').disabled = true;
    $('#um-progress-wrap').style.display = 'block';

    try {
      const ext = file.name.match(/\.(pptx|ppt|pdf)$/i)[1].toLowerCase();
      const uploadPath = `${UPLOADS_DIR}/${p.folder}__${lang}.${ext}`;

      statusEl.className = 'status info';
      statusEl.textContent = 'מעלה קובץ ל-GitHub...';

      // If a previous upload for this product+lang is still there, include its sha so we overwrite.
      const existing = await api.getFile(uploadPath);
      const sha = existing?.sha || null;

      await api.uploadBinary(
        uploadPath, file,
        `admin: upload ${p.folder}/${lang} (${file.name})`,
        sha,
        (frac) => { $('#um-progress').style.width = `${Math.round(frac * 100)}%`; }
      );

      statusEl.className = 'status success';
      statusEl.innerHTML = 'הקובץ הועלה. ההמרה רצה ברקע ב-GitHub Actions...<br>' +
                          'תוכל לעקוב אחר ההתקדמות ב-<a href="https://github.com/' +
                          `${api.owner}/${api.repo}/actions" target="_blank" style="color:var(--neon-blue)">GitHub Actions</a>.`;

      // Start polling action status
      pollActionStatus();

    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = `העלאה נכשלה: ${e.message}`;
    } finally {
      $('#upload-start').disabled = false;
    }
  }

  function pollActionStatus() {
    if (pollInterval) clearInterval(pollInterval);
    const banner = $('#action-banner');
    banner.classList.remove('hidden');
    pollInterval = setInterval(async () => {
      try {
        const run = await api.latestActionRun('convert-pptx.yml');
        if (!run) {
          banner.textContent = 'ממתין להתחלת GitHub Action...';
          return;
        }
        if (run.status === 'completed') {
          if (run.conclusion === 'success') {
            banner.textContent = '✓ ההמרה הסתיימה בהצלחה. מרענן נתונים...';
            banner.className = 'status success';
            clearInterval(pollInterval);
            pollInterval = null;
            await refreshAll();
            renderProducts();
            setTimeout(() => banner.classList.add('hidden'), 4000);
          } else {
            banner.textContent = `✗ ההמרה נכשלה (${run.conclusion}). בדוק ב-GitHub Actions.`;
            banner.className = 'status error';
            clearInterval(pollInterval);
            pollInterval = null;
          }
        } else {
          banner.textContent = `ממיר מצגת... (${run.status})`;
          banner.className = 'status info';
        }
      } catch (e) {
        // silent - just keep trying
      }
    }, 5000);
  }

  // ---------- Categories ----------
  function renderCategories() {
    const host = $('#categories-list');
    host.innerHTML = '';
    if (!data) return;
    const cats = [...data.categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    const list = document.createElement('div');
    list.className = 'items-list';
    for (const c of cats) list.appendChild(buildCategoryRow(c));
    host.appendChild(list);
  }

  function buildCategoryRow(c) {
    const count = data.products.filter(p => p.cat === c.key).length;
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <div class="meta">
        <div class="primary">${escapeHtml(c.he)} <span class="muted" style="font-size:.85em">/ ${escapeHtml(c.en)}</span></div>
        <div class="secondary">key: <code style="background:rgba(0,0,0,.3); padding:1px 6px; border-radius:4px;">${escapeHtml(c.key)}</code> • סדר: ${c.order ?? '-'} • ${count} מוצרים</div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost"  data-act="edit">ערוך</button>
        <button class="btn btn-danger" data-act="delete">מחק</button>
      </div>`;
    row.querySelector('[data-act=edit]').onclick   = () => openCategoryModal(c);
    row.querySelector('[data-act=delete]').onclick = () => onDeleteCategory(c);
    return row;
  }

  function openCategoryModal(existing) {
    const m = $('#category-modal');
    m.dataset.mode = existing ? 'edit' : 'new';
    m.dataset.originalKey = existing ? existing.key : '';
    $('#cm-title').textContent = existing ? 'עריכת קטגוריה' : 'קטגוריה חדשה';
    $('#cm-key').value = existing?.key || '';
    $('#cm-key').disabled = !!existing;
    $('#cm-he').value  = existing?.he  || '';
    $('#cm-en').value  = existing?.en  || '';
    $('#cm-order').value = existing?.order ?? (data.categories.length + 1);
    $('#cm-status').textContent = '';
    m.classList.add('open');
  }

  async function onCategorySave() {
    const m = $('#category-modal');
    const mode = m.dataset.mode;
    const statusEl = $('#cm-status');
    const key = $('#cm-key').value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    const he  = $('#cm-he').value.trim();
    const en  = $('#cm-en').value.trim();
    const order = parseInt($('#cm-order').value, 10) || 99;

    if (!key || !he || !en) {
      statusEl.className = 'status error';
      statusEl.textContent = 'כל השדות חובה';
      return;
    }

    $('#category-save').disabled = true;
    try {
      if (mode === 'new') {
        if (data.categories.some(c => c.key === key)) throw new Error('key קיים כבר');
        data.categories.push({ key, he, en, order });
      } else {
        const c = data.categories.find(x => x.key === m.dataset.originalKey);
        if (!c) throw new Error('קטגוריה לא נמצאה');
        c.he = he; c.en = en; c.order = order;
      }
      await saveProductsJson(`admin: ${mode === 'new' ? 'add' : 'update'} category ${key}`);
      m.classList.remove('open');
      renderCategories();
      showStatus('success', 'נשמר בהצלחה');
    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = e.message;
    } finally {
      $('#category-save').disabled = false;
    }
  }

  async function onDeleteCategory(c) {
    const count = data.products.filter(p => p.cat === c.key).length;
    if (count > 0) {
      alert(`לא ניתן למחוק קטגוריה עם ${count} מוצרים. קודם העבר או מחק אותם.`);
      return;
    }
    if (!confirm(`למחוק את הקטגוריה "${c.he}"?`)) return;
    try {
      data.categories = data.categories.filter(x => x.key !== c.key);
      await saveProductsJson(`admin: remove category ${c.key}`);
      renderCategories();
      showStatus('success', 'הקטגוריה נמחקה');
    } catch (e) {
      showStatus('error', `מחיקה נכשלה: ${e.message}`);
    }
  }

  // ---------- Change password ----------
  async function onChangePassword() {
    const cur  = $('#pw-current').value;
    const next = $('#pw-new').value;
    const rep  = $('#pw-new2').value;
    const statusEl = $('#pw-status');

    if (!cur || !next || !rep) {
      statusEl.className = 'status error';
      statusEl.textContent = 'כל השדות חובה';
      return;
    }
    if (next.length < 8) {
      statusEl.className = 'status error';
      statusEl.textContent = 'סיסמה חדשה חייבת להיות לפחות 8 תווים';
      return;
    }
    if (next !== rep) {
      statusEl.className = 'status error';
      statusEl.textContent = 'הסיסמאות החדשות לא תואמות';
      return;
    }
    const ok = await PasswordCrypto.verify(cur, auth.admin.passwordHash);
    if (!ok) {
      statusEl.className = 'status error';
      statusEl.textContent = 'סיסמה נוכחית שגויה';
      return;
    }

    $('#btn-change-password').disabled = true;
    try {
      const newHash = await PasswordCrypto.hash(next);
      const newAuth = { ...auth, admin: { ...auth.admin, passwordHash: newHash } };
      const existing = await api.getFile(AUTH_URL);
      await api.putFile(
        AUTH_URL,
        JSON.stringify(newAuth, null, 2) + '\n',
        'admin: change password',
        existing?.sha || null
      );
      auth = newAuth;
      $('#pw-current').value = $('#pw-new').value = $('#pw-new2').value = '';
      statusEl.className = 'status success';
      statusEl.textContent = 'הסיסמה שונתה בהצלחה';
    } catch (e) {
      statusEl.className = 'status error';
      statusEl.textContent = `שינוי נכשל: ${e.message}`;
    } finally {
      $('#btn-change-password').disabled = false;
    }
  }

  // ---------- Helpers ----------
  async function fetchJson(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)); } catch { return null; } }
  function saveCfg(cfg) { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }
  function showStatus(kind, html) {
    const el = $('#admin-status');
    el.className = `status ${kind}`;
    el.innerHTML = html;
  }
  function clearStatus() { const el = $('#admin-status'); el.className = 'hidden'; el.textContent = ''; }
  function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[m])); }
})();

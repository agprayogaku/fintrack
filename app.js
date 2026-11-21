'use strict';

/* FinTrack — vanilla frontend. No frameworks, no build step. */

const CONFIG = {
  // Paste the Apps Script /exec URL here. Never put the spreadsheet ID in client code.
  API_URL: 'PASTE_APPS_SCRIPT_EXEC_URL_HERE',
  LOCALE: 'id-ID',
  CURRENCY: 'IDR',
  SESSION_KEY: 'fintrack.session',
  REQUEST_TIMEOUT_MS: 30000,
  SESSION_EXPIRED_MESSAGE: 'Sesi berakhir. Silakan masuk kembali.',
  OFFLINE_MESSAGE: 'Anda sedang offline. Data memerlukan koneksi internet.',
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

const rupiahFormatter = new Intl.NumberFormat(CONFIG.LOCALE, {
  style: 'currency',
  currency: CONFIG.CURRENCY,
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat(CONFIG.LOCALE, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const state = {
  session: null,
  transactions: [],
  loading: false,
  filters: { from: '', to: '', category: '' },
  editingId: null,
  deletingId: null,
};

class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AppError';
    this.code = code || 'api';
  }
}

/* ---------- Formatting helpers ---------- */

function formatRupiah(value) {
  return rupiahFormatter.format(Number(value) || 0);
}

function formatSignedRupiah(value, type) {
  return (type === 'income' ? '+' : '−') + formatRupiah(value);
}

function formatDate(isoDate) {
  if (!isValidISODate(isoDate)) return String(isoDate || '');
  const [year, month, day] = isoDate.split('-').map(Number);
  return dateFormatter.format(new Date(year, month - 1, day));
}

function isValidISODate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ---------- Pure data helpers (also used by self-tests) ---------- */

function filterTransactions(transactions, filters) {
  const { from, to, category } = filters || {};
  if (from && to && from > to) return [];
  return transactions
    .filter((txn) => !from || txn.date >= from)
    .filter((txn) => !to || txn.date <= to)
    .filter((txn) => !category || txn.category === category)
    .sort((a, b) => {
      const byDate = String(b.date).localeCompare(String(a.date));
      if (byDate !== 0) return byDate;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

function summarizeTransactions(transactions) {
  let totalIncome = 0;
  let totalExpenses = 0;
  const categories = new Map();

  transactions.forEach((txn) => {
    const amount = Math.trunc(Number(txn.amount) || 0);
    const category = txn.category || 'Tanpa kategori';
    if (!categories.has(category)) {
      categories.set(category, { name: category, income: 0, expense: 0, total: 0 });
    }
    const bucket = categories.get(category);

    if (txn.type === 'income') {
      totalIncome += amount;
      bucket.income += amount;
    } else {
      totalExpenses += amount;
      bucket.expense += amount;
    }
    bucket.total += amount;
  });

  return {
    totalIncome,
    totalExpenses,
    net: totalIncome - totalExpenses,
    categories: Array.from(categories.values()).sort((a, b) => b.total - a.total),
  };
}

function hasActiveFilters() {
  return Boolean(state.filters.from || state.filters.to || state.filters.category);
}

function visibleTransactions() {
  return filterTransactions(state.transactions, state.filters);
}

/* ---------- API client ---------- */

async function api(action, payload = {}) {
  if (!CONFIG.API_URL || CONFIG.API_URL.indexOf('PASTE_') === 0) {
    throw new AppError('URL backend belum dikonfigurasi. Lihat langkah setup.', 'config');
  }
  if (!navigator.onLine) {
    throw new AppError(CONFIG.OFFLINE_MESSAGE, 'offline');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(CONFIG.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action }, payload)),
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new AppError('Permintaan habis waktu. Silakan coba lagi.', 'timeout');
    }
    throw new AppError('Tidak dapat terhubung ke server. Periksa koneksi Anda.', 'network');
  } finally {
    clearTimeout(timer);
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new AppError('Respons server tidak valid.', 'invalid');
  }

  if (!body || body.success !== true) {
    const message = body && typeof body.error === 'string'
      ? body.error
      : 'Terjadi kesalahan server. Silakan coba lagi.';
    throw new AppError(message, 'api');
  }

  return body.data;
}

function isSessionExpiredError(error) {
  return Boolean(error) && error.message === CONFIG.SESSION_EXPIRED_MESSAGE;
}

/* ---------- Session ---------- */

function readStoredSession() {
  let raw;
  try {
    raw = localStorage.getItem(CONFIG.SESSION_KEY);
  } catch (error) {
    return null;
  }
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    const valid = session
      && typeof session.token === 'string'
      && session.token.length > 0
      && typeof session.expiresAt === 'number'
      && session.user
      && typeof session.user.username === 'string';

    if (!valid) {
      localStorage.removeItem(CONFIG.SESSION_KEY);
      return null;
    }
    if (Date.now() >= session.expiresAt) {
      localStorage.removeItem(CONFIG.SESSION_KEY);
      return 'expired';
    }
    return session;
  } catch (error) {
    try { localStorage.removeItem(CONFIG.SESSION_KEY); } catch (ignored) { /* storage unavailable */ }
    return null;
  }
}

function storeSession(session) {
  try {
    localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    // The session still works in memory; persistence just will not survive a reload.
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(CONFIG.SESSION_KEY);
  } catch (error) {
    // Ignore unavailable storage.
  }
}

/* ---------- Views ---------- */

function showLogin(message) {
  $('login-view').hidden = false;
  $('app-view').hidden = true;
  $('login-password').value = '';
  if (message) {
    showLoginError(message);
  } else {
    hideLoginError();
  }
}

function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('current-user').textContent = state.session && state.session.user
    ? state.session.user.username
    : 'Keuangan Pribadi';
}

function showLoginError(message) {
  $('login-error-text').textContent = message;
  $('login-error').hidden = false;
}

function hideLoginError() {
  $('login-error').hidden = true;
  $('login-error-text').textContent = '';
}

function showAppError(message) {
  $('app-error-text').textContent = message;
  $('app-error').hidden = false;
}

function hideAppError() {
  $('app-error').hidden = true;
  $('app-error-text').textContent = '';
}

function expireSession() {
  clearStoredSession();
  state.session = null;
  state.transactions = [];
  resetFilterControls();
  state.editingId = null;
  state.deletingId = null;
  closeDialog($('txn-dialog'));
  closeDialog($('delete-dialog'));
  showLogin(CONFIG.SESSION_EXPIRED_MESSAGE);
}

/* ---------- Loading and summarizing ---------- */

async function loadTransactions() {
  if (!state.session) return;

  hideAppError();
  setTransactionsLoading(true);

  try {
    const data = await api('getTransactions', { token: state.session.token });
    const rows = Array.isArray(data) ? data : [];
    state.transactions = rows.map(normalizeTransaction).filter(Boolean);
  } catch (error) {
    if (isSessionExpiredError(error)) {
      expireSession();
      return;
    }
    showAppError(error.message);
  }

  setTransactionsLoading(false);
  renderCategoryOptions();
  renderAll();
}

function setTransactionsLoading(loading) {
  state.loading = loading;
  $('txn-loading').hidden = !loading;
  $('txn-section').setAttribute('aria-busy', String(loading));
  if (loading) {
    $('txn-list').hidden = true;
    $('txn-empty').hidden = true;
    $('txn-count').textContent = '';
  }
}

function normalizeTransaction(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !isValidISODate(raw.date)) {
    return null;
  }
  const amount = Number(raw.amount);
  if (!Number.isFinite(amount)) return null;

  return {
    id: raw.id,
    date: raw.date,
    description: String(raw.description == null ? '' : raw.description),
    category: String(raw.category == null ? '' : raw.category),
    amount,
    type: raw.type === 'income' ? 'income' : 'expense',
    createdAt: raw.createdAt ? String(raw.createdAt) : '',
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : '',
  };
}

function renderAll() {
  renderSummary();
  renderCategories();
  renderTransactions();
  renderScope();
}

function renderSummary() {
  const summary = summarizeTransactions(visibleTransactions());

  $('summary-income').textContent = formatRupiah(summary.totalIncome);
  $('summary-expense').textContent = formatRupiah(summary.totalExpenses);

  const net = $('summary-net');
  net.textContent = formatRupiah(summary.net);
  net.classList.toggle('income-text', summary.net > 0);
  net.classList.toggle('expense-text', summary.net < 0);
}

function renderScope() {
  $('summary-scope').textContent = hasActiveFilters() ? 'Sesuai filter' : 'Semua transaksi';
}

function renderCategories() {
  const container = $('category-list');
  container.replaceChildren();

  const summary = summarizeTransactions(visibleTransactions());
  if (!summary.categories.length) {
    container.append(createElement('p', 'category-empty', 'Belum ada data kategori.'));
    return;
  }

  const maxTotal = Math.max(...summary.categories.map((category) => category.total), 1);

  summary.categories.forEach((category) => {
    const row = createElement('div', 'category-row');

    const head = createElement('div', 'category-row-head');
    head.append(
      createElement('span', 'category-name', category.name),
      createElement('span', 'category-total', formatRupiah(category.total))
    );

    const progress = createElement('div', 'progress');
    progress.setAttribute('role', 'progressbar');
    progress.setAttribute('aria-label', 'Porsi ' + category.name);
    progress.setAttribute('aria-valuemin', '0');
    progress.setAttribute('aria-valuemax', '100');

    const percentage = Math.max(2, Math.round((category.total / maxTotal) * 100));
    progress.setAttribute('aria-valuenow', String(percentage));

    const bar = createElement('div', 'progress-bar');
    bar.style.width = percentage + '%';
    progress.append(bar);

    const meta = createElement('div', 'category-meta');
    if (category.income > 0) {
      meta.append(createElement('span', 'income-text', 'Masuk +' + formatRupiah(category.income)));
    }
    if (category.expense > 0) {
      meta.append(createElement('span', 'expense-text', 'Keluar −' + formatRupiah(category.expense)));
    }
    if (!category.income && !category.expense) {
      meta.append(createElement('span', null, 'Tidak ada transaksi.'));
    }

    row.append(head, progress, meta);
    container.append(row);
  });
}

function renderCategoryOptions() {
  const categories = Array.from(new Set(
    state.transactions
      .map((txn) => txn.category)
      .filter((category) => category && category.length)
  )).sort((a, b) => a.localeCompare(b, CONFIG.LOCALE));

  const select = $('filter-category');
  select.replaceChildren(createElement('option', null, 'Semua kategori'));
  select.firstChild.value = '';

  categories.forEach((category) => {
    const option = createElement('option', null, category);
    option.value = category;
    select.append(option);
  });

  const nextCategory = categories.includes(state.filters.category) ? state.filters.category : '';
  select.value = nextCategory;
  state.filters.category = nextCategory;

  const suggestions = $('category-suggestions');
  suggestions.replaceChildren();
  categories.forEach((category) => {
    const option = document.createElement('option');
    option.value = category;
    suggestions.append(option);
  });
}

function renderTransactions() {
  const list = visibleTransactions();
  const listElement = $('txn-list');
  listElement.replaceChildren();

  const isLoading = state.loading;
  listElement.hidden = isLoading;
  $('txn-empty').hidden = isLoading || list.length > 0;
  $('txn-count').textContent = list.length ? list.length + ' transaksi' : '';

  if (!isLoading && list.length === 0) {
    $('txn-empty-text').textContent = hasActiveFilters()
      ? 'Tidak ada transaksi yang cocok dengan filter.'
      : 'Belum ada transaksi.';
  }

  if (isLoading) return;

  list.forEach((txn) => {
    const item = createElement('li', 'txn-item');

    const main = createElement('div', 'txn-main');
    main.append(createElement('p', 'txn-description', txn.description || '(Tanpa deskripsi)'));

    const meta = createElement('div', 'txn-meta');
    meta.append(createElement(
      'span',
      'badge ' + (txn.type === 'income' ? 'badge-income' : 'badge-expense'),
      txn.type === 'income' ? 'Pemasukan' : 'Pengeluaran'
    ));
    meta.append(createElement('span', null, txn.category || 'Tanpa kategori'));
    meta.append(createElement('span', null, '·'));
    meta.append(createElement('span', null, formatDate(txn.date)));
    main.append(meta);

    const side = createElement('div', 'txn-side');
    side.append(createElement(
      'span',
      'txn-amount ' + (txn.type === 'income' ? 'income-text' : 'expense-text'),
      formatSignedRupiah(txn.amount, txn.type)
    ));

    const actions = createElement('div', 'txn-actions');
    actions.append(
      createIconButton('pencil', 'Ubah transaksi: ' + txn.description, 'edit', txn.id),
      createIconButton('trash', 'Hapus transaksi: ' + txn.description, 'delete', txn.id)
    );
    side.append(actions);

    item.append(main, side);
    listElement.append(item);
  });
}

/* ---------- DOM helpers ---------- */

function createElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createSvgIcon(symbolId, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className || 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', '#i-' + symbolId);
  svg.append(use);
  return svg;
}

function createIconButton(symbolId, label, action, id) {
  const button = createElement('button', 'btn btn-ghost btn-icon btn-sm');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.dataset.action = action;
  button.dataset.id = id;
  button.append(createSvgIcon(symbolId));
  return button;
}

/* ---------- Dialogs ---------- */

function openDialog(dialog) {
  if (dialog.open) return;
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeDialog(dialog) {
  if (!dialog || !dialog.open) return;
  if (typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

function resetTxnForm() {
  $('txn-form').reset();
  $('txn-type').value = 'expense';
  $('txn-date').value = todayISO();
  hideTxnFormError();
  Array.from($('txn-form').elements).forEach((field) => field.removeAttribute('aria-invalid'));
}

function openTransactionDialog(transaction) {
  state.editingId = transaction ? transaction.id : null;
  resetTxnForm();

  if (transaction) {
    $('txn-type').value = transaction.type;
    $('txn-date').value = transaction.date;
    $('txn-description').value = transaction.description;
    $('txn-category').value = transaction.category;
    $('txn-amount').value = String(transaction.amount);
    $('txn-dialog-title').textContent = 'Ubah transaksi';
    $('txn-dialog-description').textContent = 'Perbarui detail transaksi.';
    $('txn-submit').textContent = 'Simpan perubahan';
  } else {
    $('txn-dialog-title').textContent = 'Tambah transaksi';
    $('txn-dialog-description').textContent = 'Catat pemasukan atau pengeluaran baru.';
    $('txn-submit').textContent = 'Simpan';
  }

  openDialog($('txn-dialog'));
  $('txn-description').focus();
}

function openDeleteDialog(transaction) {
  state.deletingId = transaction.id;
  $('delete-target').textContent = (transaction.description || '(Tanpa deskripsi)')
    + ' — ' + formatSignedRupiah(transaction.amount, transaction.type);
  $('delete-error').hidden = true;
  $('delete-error-text').textContent = '';
  openDialog($('delete-dialog'));
  $('delete-cancel').focus();
}

function showTxnFormError(message, field) {
  $('txn-form-error-text').textContent = message;
  $('txn-form-error').hidden = false;
  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function hideTxnFormError() {
  $('txn-form-error').hidden = true;
  $('txn-form-error-text').textContent = '';
}

function readTxnForm() {
  return {
    date: $('txn-date').value,
    description: $('txn-description').value.trim(),
    category: $('txn-category').value.trim(),
    amount: Number($('txn-amount').value),
    type: $('txn-type').value,
  };
}

function validateTxnForm(values) {
  if (!isValidISODate(values.date)) {
    return { message: 'Tanggal tidak valid.', field: $('txn-date') };
  }
  if (values.description.length < 1 || values.description.length > 120) {
    return { message: 'Deskripsi harus 1–120 karakter.', field: $('txn-description') };
  }
  if (values.category.length < 1 || values.category.length > 40) {
    return { message: 'Kategori harus 1–40 karakter.', field: $('txn-category') };
  }
  if (!Number.isSafeInteger(values.amount) || values.amount <= 0) {
    return { message: 'Jumlah harus berupa angka bulat lebih dari 0.', field: $('txn-amount') };
  }
  if (values.type !== 'income' && values.type !== 'expense') {
    return { message: 'Jenis transaksi tidak valid.', field: $('txn-type') };
  }
  return null;
}

/* ---------- Actions ---------- */

async function handleLogin(event) {
  event.preventDefault();
  hideLoginError();

  const username = $('login-username').value.trim();
  const password = $('login-password').value;

  if (!username || !password) {
    showLoginError('Nama pengguna dan kata sandi wajib diisi.');
    return;
  }

  setButtonBusy($('login-submit'), true, 'Memeriksa…');
  try {
    const session = await api('login', { username, password });
    const valid = session
      && typeof session.token === 'string'
      && typeof session.expiresAt === 'number'
      && session.user;

    if (!valid) throw new AppError('Respons server tidak valid.', 'invalid');

    state.session = session;
    storeSession(session);
    $('login-form').reset();
    showApp();
    await loadTransactions();
  } catch (error) {
    showLoginError(error.message || 'Tidak dapat masuk. Silakan coba lagi.');
  } finally {
    setButtonBusy($('login-submit'), false);
  }
}

function handleLogout() {
  clearStoredSession();
  state.session = null;
  state.transactions = [];
  resetFilterControls();
  state.editingId = null;
  state.deletingId = null;
  closeDialog($('txn-dialog'));
  closeDialog($('delete-dialog'));
  $('txn-list').replaceChildren();
  $('txn-empty').hidden = true;
  $('txn-count').textContent = '';
  showLogin();
}

async function handleTxnSubmit(event) {
  event.preventDefault();
  hideTxnFormError();

  const values = readTxnForm();
  const problem = validateTxnForm(values);
  if (problem) {
    showTxnFormError(problem.message, problem.field);
    return;
  }

  const editingId = state.editingId;
  setButtonBusy($('txn-submit'), true, 'Menyimpan…');

  try {
    const payload = Object.assign({ token: state.session.token }, values);
    let saved;
    if (editingId) {
      payload.id = editingId;
      saved = await api('updateTransaction', payload);
    } else {
      saved = await api('addTransaction', payload);
    }

    const transaction = normalizeTransaction(saved)
      || Object.assign({ id: editingId || 'local-' + Date.now(), createdAt: '', updatedAt: '' }, values);

    if (editingId) {
      const index = state.transactions.findIndex((txn) => txn.id === editingId);
      if (index >= 0) {
        state.transactions[index] = transaction;
      } else {
        state.transactions.push(transaction);
      }
    } else {
      state.transactions.push(transaction);
    }

    closeDialog($('txn-dialog'));
    renderCategoryOptions();
    renderAll();
    showToast(editingId ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.', 'success');
  } catch (error) {
    if (isSessionExpiredError(error)) {
      expireSession();
      return;
    }
    showTxnFormError(error.message);
  } finally {
    setButtonBusy($('txn-submit'), false);
  }
}

async function handleDeleteConfirm() {
  const id = state.deletingId;
  if (!id) return;

  setButtonBusy($('delete-confirm'), true, 'Menghapus…');
  $('delete-error').hidden = true;

  try {
    await api('deleteTransaction', { token: state.session.token, id });
    state.transactions = state.transactions.filter((txn) => txn.id !== id);
    if (state.editingId === id) closeDialog($('txn-dialog'));
    closeDialog($('delete-dialog'));
    state.deletingId = null;
    renderCategoryOptions();
    renderAll();
    showToast('Transaksi dihapus.', 'success');
  } catch (error) {
    if (isSessionExpiredError(error)) {
      expireSession();
      return;
    }
    $('delete-error-text').textContent = error.message;
    $('delete-error').hidden = false;
  } finally {
    setButtonBusy($('delete-confirm'), false);
  }
}

function handleFilterChange() {
  state.filters = {
    from: $('filter-from').value,
    to: $('filter-to').value,
    category: $('filter-category').value,
  };

  const invalidRange = Boolean(state.filters.from && state.filters.to && state.filters.from > state.filters.to);
  $('filter-error').hidden = !invalidRange;
  $('filter-error').textContent = invalidRange
    ? 'Tanggal "dari" tidak boleh setelah tanggal "sampai".'
    : '';

  renderSummary();
  renderCategories();
  renderTransactions();
  renderScope();
}

function resetFilterControls() {
  $('filter-from').value = '';
  $('filter-to').value = '';
  $('filter-category').value = '';
  $('filter-error').hidden = true;
  $('filter-error').textContent = '';
  state.filters = { from: '', to: '', category: '' };
}

function clearFilters() {
  resetFilterControls();
  renderSummary();
  renderCategories();
  renderTransactions();
  renderScope();
}

/* ---------- Toast ---------- */

function showToast(message, variant) {
  const toast = createElement('div', 'toast ' + (variant === 'error' ? 'toast-error' : 'toast-success'));
  toast.append(
    createSvgIcon(variant === 'error' ? 'alert' : 'check'),
    createElement('span', null, message)
  );
  $('toast-region').append(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.textContent = label || 'Memuat…';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  } else {
    if (button.dataset.idleLabel) {
      button.textContent = button.dataset.idleLabel;
      delete button.dataset.idleLabel;
    }
    button.disabled = false;
    button.removeAttribute('aria-busy');
  }
}

/* ---------- Online state and service worker ---------- */

function updateOnlineStatus() {
  $('offline-banner').hidden = navigator.onLine;
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;

  navigator.serviceWorker.register('service-worker.js').catch((error) => {
    console.warn('Registrasi service worker gagal.', error);
  });
}

/* ---------- Wiring ---------- */

function bindEvents() {
  $('login-form').addEventListener('submit', handleLogin);
  $('logout-button').addEventListener('click', handleLogout);
  $('retry-button').addEventListener('click', loadTransactions);

  $('add-button').addEventListener('click', () => openTransactionDialog(null));
  $('empty-add-button').addEventListener('click', () => openTransactionDialog(null));

  $('txn-form').addEventListener('submit', handleTxnSubmit);
  $('txn-form').addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
  });

  $('delete-confirm').addEventListener('click', handleDeleteConfirm);
  $('delete-cancel').addEventListener('click', () => closeDialog($('delete-dialog')));

  $('filter-form').addEventListener('change', handleFilterChange);
  $('clear-filters').addEventListener('click', clearFilters);

  $('txn-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const transaction = state.transactions.find((txn) => txn.id === button.dataset.id);
    if (!transaction) return;
    if (button.dataset.action === 'edit') openTransactionDialog(transaction);
    if (button.dataset.action === 'delete') openDeleteDialog(transaction);
  });

  Array.from(document.querySelectorAll('[data-close-dialog]')).forEach((button) => {
    button.addEventListener('click', () => closeDialog($('txn-dialog')));
  });

  Array.from(document.querySelectorAll('dialog.dialog')).forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeDialog(dialog);
    });
  });

  $('txn-dialog').addEventListener('close', () => {
    state.editingId = null;
    $('txn-submit').textContent = 'Simpan';
    hideTxnFormError();
  });

  $('delete-dialog').addEventListener('close', () => {
    state.deletingId = null;
    $('delete-error').hidden = true;
  });

  window.addEventListener('online', () => {
    updateOnlineStatus();
    if (state.session) loadTransactions();
  });
  window.addEventListener('offline', updateOnlineStatus);
}

function restoreSession() {
  const session = readStoredSession();

  if (session === 'expired') {
    showLogin(CONFIG.SESSION_EXPIRED_MESSAGE);
    return;
  }
  if (!session) {
    showLogin();
    return;
  }

  state.session = session;
  showApp();
  loadTransactions();
}

function init() {
  bindEvents();
  updateOnlineStatus();

  if (new URLSearchParams(location.search).has('selftest')) {
    runSelfTests();
  }

  restoreSession();
  registerServiceWorker();
}

/* ---------- Self-tests (?selftest=1) ---------- */

function runSelfTests() {
  const results = [];
  const check = (name, passed) => results.push({ name, pass: Boolean(passed) });

  check('formatRupiah memakai Rupiah', formatRupiah(10000).includes('10.000') && !formatRupiah(10000).includes('$'));
  check('formatSignedRupiah memberi tanda + dan −',
    formatSignedRupiah(5000, 'income').startsWith('+') && formatSignedRupiah(5000, 'expense').startsWith('−'));
  check('formatDate menampilkan tahun', formatDate('2026-11-22').includes('2026'));
  check('isValidISODate menolak tanggal palsu',
    isValidISODate('2026-11-22') && !isValidISODate('2026-02-30') && !isValidISODate('22-11-2026'));

  const sample = [
    { id: '1', date: '2026-11-01', description: 'Makan', category: 'Makanan', amount: 10000, type: 'expense' },
    { id: '2', date: '2026-11-15', description: 'Gaji', category: 'Gaji', amount: 5000000, type: 'income' },
    { id: '3', date: '2026-12-01', description: 'Makan', category: 'Makanan', amount: 25000, type: 'expense' },
  ];

  check('filter rentang tanggal', filterTransactions(sample, { from: '2026-11-01', to: '2026-11-30', category: '' }).length === 2);
  check('filter kategori', filterTransactions(sample, { from: '', to: '', category: 'Makanan' }).length === 2);
  check('rentang terbalik kosong', filterTransactions(sample, { from: '2026-12-01', to: '2026-11-01', category: '' }).length === 0);

  const summary = summarizeTransactions(sample);
  check('total pemasukan', summary.totalIncome === 5000000);
  check('total pengeluaran', summary.totalExpenses === 35000);
  check('saldo bersih', summary.net === 4965000);
  check('kategori terkelompok', summary.categories.length === 2);

  console.table(results);
  const failed = results.filter((result) => !result.pass);
  if (failed.length) {
    console.error('FinTrack self-test gagal: ' + failed.length + '/' + results.length);
  } else {
    console.info('FinTrack self-test lulus: ' + results.length + '/' + results.length);
  }
  return results;
}

window.fintrackSelfTest = runSelfTests;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

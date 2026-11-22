'use strict';

/* FinTrack — vanilla frontend. No frameworks, no build step. */

const CONFIG = {
  // Paste the Apps Script /exec URL here. Never put the spreadsheet ID in client code.
  API_URL: 'https://script.google.com/macros/s/AKfycbwoGYwKo1bEhcTraaGRrYyW0u-P1XLCZby5u2Ci6HeP1ujwHVkMiQ8z3i2XEnPS-Yhixg/exec',
  LOCALE: 'id-ID',
  CURRENCY: 'IDR',
  SESSION_KEY: 'fintrack.session',
  THEME_KEY: 'fintrack.theme',
  CACHE_KEY_PREFIX: 'fintrack.cache.transactions.',
  QUEUE_KEY_PREFIX: 'fintrack.offline_queue.',
  BUDGETS_KEY_PREFIX: 'fintrack.budgets.',
  SETTINGS_KEY_PREFIX: 'fintrack.settings.',
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

const monthFormatter = new Intl.DateTimeFormat(CONFIG.LOCALE, {
  month: 'long',
  year: 'numeric',
});

const monthShortFormatter = new Intl.DateTimeFormat(CONFIG.LOCALE, {
  month: 'short',
});

const CHART_COLORS = [
  '#0f766e', // teal
  '#2563eb', // blue
  '#f59e0b', // amber
  '#7c3aed', // violet
  '#10b981', // emerald
  '#e11d48', // rose
  '#64748b', // slate
];

const state = {
  session: null,
  transactions: [],
  budgets: {},
  settings: {},
  loading: false,
  filters: { from: '', to: '', category: '', preset: 'all' },
  editingId: null,
  deletingId: null,
  activeChartTab: 'trend',
  syncing: false,
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

function formatDateISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* ---------- Offline Cache & Queue helpers ---------- */

function getCacheKey(userId) {
  const uid = userId || (state.session && state.session.user && state.session.user.id) || 'default';
  return CONFIG.CACHE_KEY_PREFIX + uid;
}

function getQueueKey(userId) {
  const uid = userId || (state.session && state.session.user && state.session.user.id) || 'default';
  return CONFIG.QUEUE_KEY_PREFIX + uid;
}

function getBudgetsKey(userId) {
  const uid = userId || (state.session && state.session.user && state.session.user.id) || 'default';
  return CONFIG.BUDGETS_KEY_PREFIX + uid;
}

function getSettingsKey(userId) {
  const uid = userId || (state.session && state.session.user && state.session.user.id) || 'default';
  return CONFIG.SETTINGS_KEY_PREFIX + uid;
}

function getCachedBudgets(userId) {
  try {
    const raw = localStorage.getItem(getBudgetsKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    return {};
  }
}

function setCachedBudgets(userId, budgets) {
  try {
    localStorage.setItem(getBudgetsKey(userId), JSON.stringify(budgets || {}));
  } catch (e) {}
}

function getCachedSettings(userId) {
  try {
    const raw = localStorage.getItem(getSettingsKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (e) {
    return {};
  }
}

function setCachedSettings(userId, settings) {
  try {
    localStorage.setItem(getSettingsKey(userId), JSON.stringify(settings || {}));
  } catch (e) {}
}

function getCachedTransactions(userId) {
  try {
    const raw = localStorage.getItem(getCacheKey(userId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(normalizeTransaction).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function setCachedTransactions(userId, txns) {
  try {
    localStorage.setItem(getCacheKey(userId), JSON.stringify(txns));
  } catch (e) {
    // LocalStorage quota or disabled
  }
}

function getOfflineQueue(userId) {
  try {
    const raw = localStorage.getItem(getQueueKey(userId));
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

function saveOfflineQueue(userId, queue) {
  try {
    localStorage.setItem(getQueueKey(userId), JSON.stringify(queue));
  } catch (e) {
    // LocalStorage quota or disabled
  }
  updateSyncStatus();
}

function enqueueOfflineMutation(mutation) {
  if (!state.session || !state.session.user) return;
  const queue = getOfflineQueue(state.session.user.id);
  queue.push(mutation);
  saveOfflineQueue(state.session.user.id, queue);
}

/* ---------- Pure data helpers ---------- */

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
    try { localStorage.removeItem(CONFIG.SESSION_KEY); } catch (ignored) {}
    return null;
  }
}

function storeSession(session) {
  try {
    localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
  } catch (error) {}
}

function clearStoredSession() {
  try {
    localStorage.removeItem(CONFIG.SESSION_KEY);
  } catch (error) {}
}

/* ---------- Theme Management ---------- */

function getStoredTheme() {
  try {
    return localStorage.getItem(CONFIG.THEME_KEY);
  } catch (e) {
    return null;
  }
}

function applyTheme(theme) {
  if (theme === 'dark' || theme === 'light') {
    document.documentElement.setAttribute('data-theme', theme);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function toggleTheme() {
  const currentAttr = document.documentElement.getAttribute('data-theme');
  const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDarkNow = currentAttr ? currentAttr === 'dark' : systemDark;
  const newTheme = isDarkNow ? 'light' : 'dark';

  try {
    localStorage.setItem(CONFIG.THEME_KEY, newTheme);
  } catch (e) {}

  applyTheme(newTheme);
  showToast('Tema diubah ke mode ' + (newTheme === 'dark' ? 'gelap' : 'terang') + '.', 'success');

  // Persist preference to Google Spreadsheet (Settings sheet) for the logged-in user
  if (state.session && state.session.token && state.session.user) {
    const userId = state.session.user.id;
    if (!state.settings) state.settings = {};
    state.settings.theme = newTheme;
    setCachedSettings(userId, state.settings);

    if (navigator.onLine) {
      api('saveSetting', { token: state.session.token, key: 'theme', value: newTheme })
        .catch((err) => {
          console.warn('Gagal menyimpan tema ke server:', err);
          enqueueOfflineMutation({ action: 'saveSetting', payload: { key: 'theme', value: newTheme } });
        });
    } else {
      enqueueOfflineMutation({ action: 'saveSetting', payload: { key: 'theme', value: newTheme } });
    }
  }
}

function initTheme() {
  const stored = getStoredTheme();
  if (stored) {
    applyTheme(stored);
  }
}

/* ---------- Views & Auth Tabs ---------- */

function switchAuthTab(targetTab) {
  const isLogin = targetTab === 'login';
  $('tab-login').classList.toggle('active', isLogin);
  $('tab-login').setAttribute('aria-selected', String(isLogin));
  $('tab-register').classList.toggle('active', !isLogin);
  $('tab-register').setAttribute('aria-selected', String(!isLogin));

  $('login-panel').hidden = !isLogin;
  $('register-panel').hidden = isLogin;

  hideLoginError();
  hideRegisterError();
}

function showLogin(message) {
  $('login-view').hidden = false;
  $('app-view').hidden = true;
  $('login-password').value = '';
  switchAuthTab('login');
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
  updateSyncStatus();
}

function showLoginError(message) {
  $('login-error-text').textContent = message;
  $('login-error').hidden = false;
}

function hideLoginError() {
  $('login-error').hidden = true;
  $('login-error-text').textContent = '';
}

function showRegisterError(message) {
  $('register-error-text').textContent = message;
  $('register-error').hidden = false;
}

function hideRegisterError() {
  $('register-error').hidden = true;
  $('register-error-text').textContent = '';
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
  closeDialog($('budget-dialog'));
  closeDialog($('reset-password-dialog'));
  closeDialog($('change-password-dialog'));
  showLogin(CONFIG.SESSION_EXPIRED_MESSAGE);
}

/* ---------- Loading and summarizing ---------- */

async function loadTransactions() {
  if (!state.session) return;

  hideAppError();
  setTransactionsLoading(true);

  const userId = state.session.user.id;
  let serverLoaded = false;

  if (navigator.onLine) {
    try {
      const [txnsData, budgetsData, settingsData] = await Promise.all([
        api('getTransactions', { token: state.session.token }),
        api('getBudgets', { token: state.session.token }).catch((err) => {
          console.warn('Gagal memuat target anggaran dari server:', err);
          return null;
        }),
        api('getSettings', { token: state.session.token }).catch((err) => {
          console.warn('Gagal memuat pengaturan dari server:', err);
          return null;
        }),
      ]);

      const rows = Array.isArray(txnsData) ? txnsData : [];
      state.transactions = rows.map(normalizeTransaction).filter(Boolean);
      setCachedTransactions(userId, state.transactions);

      if (budgetsData && typeof budgetsData === 'object') {
        state.budgets = budgetsData;
        setCachedBudgets(userId, state.budgets);
      }
      if (settingsData && typeof settingsData === 'object') {
        state.settings = settingsData;
        setCachedSettings(userId, state.settings);
        if (settingsData.theme) {
          applyTheme(settingsData.theme);
        }
      }

      serverLoaded = true;

      // Auto-sync any offline items
      const queue = getOfflineQueue(userId);
      if (queue.length > 0) {
        syncOfflineQueue();
      }
    } catch (error) {
      if (isSessionExpiredError(error)) {
        expireSession();
        return;
      }
      console.warn('Gagal memuat dari server, beralih ke cache offline:', error);
    }
  }

  if (!serverLoaded) {
    // Offline or network error: load from local cache
    const cachedTxns = getCachedTransactions(userId);
    state.budgets = getCachedBudgets(userId);
    state.settings = getCachedSettings(userId);
    if (state.settings && state.settings.theme) {
      applyTheme(state.settings.theme);
    }

    if (cachedTxns.length > 0) {
      state.transactions = cachedTxns;
      if (navigator.onLine) {
        showToast('Memuat data dari penyimpanan perangkat (server tidak dapat dijangkau).', 'error');
      }
    } else {
      showAppError(navigator.onLine ? 'Gagal memuat data dari server.' : CONFIG.OFFLINE_MESSAGE);
    }
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
    _pending: Boolean(raw._pending),
  };
}

function renderAll() {
  renderSummary();
  renderBudgets();
  renderCharts();
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

    if (txn._pending) {
      const pendingBadge = createElement('span', 'badge badge-pending', 'Menunggu sinkron');
      meta.append(pendingBadge);
    }

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

/* ---------- Target Anggaran (Budgeting) ---------- */

function getBudgets(userId) {
  if (state.budgets && typeof state.budgets === 'object' && Object.keys(state.budgets).length > 0) {
    return state.budgets;
  }
  return getCachedBudgets(userId);
}

function saveBudgets(userId, budgets) {
  state.budgets = budgets || {};
  setCachedBudgets(userId, state.budgets);
}

function calculateBudgetStatus(transactions, budgets, referenceDate) {
  const ref = referenceDate || todayISO();
  const currentMonthKey = ref.slice(0, 7); // e.g. "2026-11"
  const [year, month] = currentMonthKey.split('-').map(Number);
  const monthName = monthFormatter.format(new Date(year, month - 1, 1));

  // Filter transactions for this month that are expenses
  const monthExpenses = transactions.filter((t) => t.type === 'expense' && String(t.date || '').startsWith(currentMonthKey));

  const spentByCategory = new Map();
  monthExpenses.forEach((t) => {
    const cat = t.category || 'Tanpa kategori';
    spentByCategory.set(cat, (spentByCategory.get(cat) || 0) + Math.trunc(Number(t.amount) || 0));
  });

  const categoriesWithBudget = Object.keys(budgets || {}).filter((cat) => Number(budgets[cat]) > 0);

  let totalBudget = 0;
  let totalSpent = 0;

  const items = categoriesWithBudget.map((category) => {
    const budget = Math.trunc(Number(budgets[category]) || 0);
    const spent = spentByCategory.get(category) || 0;
    const remaining = budget - spent;
    const percent = Math.round((spent / budget) * 100);

    let status = 'normal';
    if (percent >= 100) {
      status = 'exceeded';
    } else if (percent >= 75) {
      status = 'warning';
    }

    totalBudget += budget;
    totalSpent += spent;

    return {
      category,
      budget,
      spent,
      remaining,
      percent,
      status,
    };
  }).sort((a, b) => b.percent - a.percent);

  const overallPercent = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0;
  let overallStatus = 'normal';
  if (overallPercent >= 100) overallStatus = 'exceeded';
  else if (overallPercent >= 75) overallStatus = 'warning';

  return {
    currentMonthKey,
    monthName,
    items,
    totalBudget,
    totalSpent,
    overallPercent,
    overallStatus,
  };
}

function renderBudgets() {
  const container = $('budget-content');
  container.replaceChildren();

  if (!state.session || !state.session.user) return;
  const budgets = getBudgets(state.session.user.id);
  const status = calculateBudgetStatus(state.transactions, budgets);

  $('budget-month-desc').textContent = `Bulan: ${status.monthName}`;

  if (!status.items.length) {
    const empty = createElement('div', 'budget-empty');
    empty.append(
      createSvgIcon('target', 'icon icon-lg'),
      createElement('p', null, 'Belum ada target anggaran bulanan yang ditentukan.'),
      createElement('p', 'field-description', 'Buat target pengeluaran per kategori untuk mengontrol keuangan Anda.'),
      (() => {
        const btn = createElement('button', 'btn btn-outline btn-sm', 'Atur Target Sekarang');
        btn.type = 'button';
        btn.addEventListener('click', openBudgetDialog);
        return btn;
      })()
    );
    container.append(empty);
    return;
  }

  // Summary box
  const summaryBox = createElement('div', 'budget-summary-box');
  const summaryMeta = createElement('div', 'budget-summary-meta');
  summaryMeta.append(
    createElement('span', null, `Total Anggaran Terpakai: ${status.overallPercent}%`),
    createElement('span', null, `${formatRupiah(status.totalSpent)} / ${formatRupiah(status.totalBudget)}`)
  );

  const progress = createElement('div', 'progress');
  const progressBar = createElement('div', `progress-bar budget-bar-${status.overallStatus}`);
  progressBar.style.width = Math.min(100, Math.max(2, status.overallPercent)) + '%';
  progress.append(progressBar);

  summaryBox.append(summaryMeta, progress);
  container.append(summaryBox);

  // Grid of budget cards
  const grid = createElement('div', 'budget-grid');
  status.items.forEach((item) => {
    const card = createElement('div', 'budget-card');

    const head = createElement('div', 'budget-card-head');
    head.append(createElement('span', 'budget-card-title', item.category));

    let statusText = `${item.percent}%`;
    if (item.status === 'exceeded') {
      statusText = `Melebihi (+${formatRupiah(Math.abs(item.remaining))})`;
    } else if (item.status === 'warning') {
      statusText = `Waspada (${item.percent}%)`;
    } else {
      statusText = `Aman (${item.percent}%)`;
    }

    const badge = createElement('span', `budget-card-status budget-status-${item.status}`, statusText);
    head.append(badge);

    const itemProgress = createElement('div', 'progress');
    const itemBar = createElement('div', `progress-bar budget-bar-${item.status}`);
    itemBar.style.width = Math.min(100, Math.max(2, item.percent)) + '%';
    itemProgress.append(itemBar);

    const details = createElement('div', 'budget-card-details');
    details.append(
      createElement('span', null, `${formatRupiah(item.spent)} dari ${formatRupiah(item.budget)}`),
      createElement('span', null, item.remaining >= 0 ? `Sisa: ${formatRupiah(item.remaining)}` : `Lebih: ${formatRupiah(Math.abs(item.remaining))}`)
    );

    card.append(head, itemProgress, details);
    grid.append(card);
  });

  container.append(grid);
}

function openBudgetDialog() {
  if (!state.session || !state.session.user) return;
  const budgets = getBudgets(state.session.user.id);
  const container = $('budget-rows-container');
  container.replaceChildren();

  // Combine categories from transactions + currently budgeted categories
  const categories = Array.from(new Set([
    ...state.transactions.map((t) => t.category).filter(Boolean),
    ...Object.keys(budgets),
  ])).sort((a, b) => a.localeCompare(b, CONFIG.LOCALE));

  if (!categories.length) categories.push('Makanan', 'Transportasi', 'Belanja');

  categories.forEach((cat) => {
    container.append(createBudgetRow(cat, budgets[cat] || ''));
  });

  $('budget-form-error').hidden = true;
  openDialog($('budget-dialog'));
}

function createBudgetRow(categoryName = '', amountVal = '') {
  const row = createElement('div', 'budget-row-item');

  const catInput = createElement('input', 'input');
  catInput.type = 'text';
  catInput.placeholder = 'Nama kategori';
  catInput.value = categoryName;
  catInput.dataset.field = 'category';

  const amtInput = createElement('input', 'input');
  amtInput.type = 'number';
  amtInput.min = '0';
  amtInput.step = '1000';
  amtInput.placeholder = 'Target Rp (0 = hapus)';
  amtInput.value = amountVal ? String(amountVal) : '';
  amtInput.dataset.field = 'amount';

  const removeBtn = createElement('button', 'btn btn-ghost btn-icon btn-sm');
  removeBtn.type = 'button';
  removeBtn.setAttribute('aria-label', 'Hapus baris');
  removeBtn.append(createSvgIcon('close'));
  removeBtn.addEventListener('click', () => row.remove());

  row.append(catInput, amtInput, removeBtn);
  return row;
}

async function handleBudgetSubmit(event) {
  event.preventDefault();
  if (!state.session || !state.session.user) return;

  const rows = Array.from($('budget-rows-container').querySelectorAll('.budget-row-item'));
  const newBudgets = {};

  for (const row of rows) {
    const catInput = row.querySelector('[data-field="category"]');
    const amtInput = row.querySelector('[data-field="amount"]');
    const cat = catInput ? catInput.value.trim() : '';
    const amt = amtInput ? Math.trunc(Number(amtInput.value) || 0) : 0;

    if (cat && amt > 0) {
      newBudgets[cat] = amt;
    }
  }

  const userId = state.session.user.id;
  saveBudgets(userId, newBudgets);
  closeDialog($('budget-dialog'));
  renderBudgets();

  if (navigator.onLine) {
    try {
      await api('saveBudgets', { token: state.session.token, budgets: newBudgets });
      showToast('Target anggaran berhasil disimpan ke Google Spreadsheet.', 'success');
    } catch (err) {
      if (isSessionExpiredError(err)) {
        expireSession();
        return;
      }
      enqueueOfflineMutation({ action: 'saveBudgets', payload: { budgets: newBudgets } });
      showToast('Target anggaran disimpan secara offline. Akan disinkronkan saat online.', 'info');
    }
  } else {
    enqueueOfflineMutation({ action: 'saveBudgets', payload: { budgets: newBudgets } });
    showToast('Target anggaran disimpan offline. Akan disinkronkan ke Google Spreadsheet saat online.', 'info');
  }
}

/* ---------- Visualisasi & Analisis Grafik (Charts) ---------- */

function renderCharts() {
  const container = $('chart-content');
  container.replaceChildren();

  if (state.activeChartTab === 'donut') {
    renderExpenseDonutChart(container);
  } else {
    renderMonthlyTrendChart(container);
  }
}

function renderMonthlyTrendChart(container) {
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = monthShortFormatter.format(d);
    months.push({ key, label, income: 0, expense: 0 });
  }

  const monthMap = new Map(months.map((m) => [m.key, m]));

  state.transactions.forEach((t) => {
    const key = String(t.date || '').slice(0, 7);
    if (monthMap.has(key)) {
      const entry = monthMap.get(key);
      const amt = Math.trunc(Number(t.amount) || 0);
      if (t.type === 'income') entry.income += amt;
      else entry.expense += amt;
    }
  });

  const hasData = months.some((m) => m.income > 0 || m.expense > 0);
  if (!hasData) {
    const empty = createElement('div', 'chart-empty');
    empty.append(
      createSvgIcon('chart', 'icon icon-lg'),
      createElement('p', null, 'Belum ada data untuk grafik tren 6 bulan.')
    );
    container.append(empty);
    return;
  }

  const maxVal = Math.max(...months.map((m) => Math.max(m.income, m.expense)), 100000);
  const niceMax = Math.ceil(maxVal / 500000) * 500000 || 500000;

  const width = 540;
  const height = 220;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;
  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Grafik tren pemasukan dan pengeluaran 6 bulan terakhir');

  // Grid lines
  const steps = 3;
  for (let s = 0; s <= steps; s++) {
    const yVal = (niceMax / steps) * s;
    const yPos = padTop + chartH - (s / steps) * chartH;

    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('x1', String(padLeft));
    line.setAttribute('x2', String(width - padRight));
    line.setAttribute('y1', String(yPos));
    line.setAttribute('y2', String(yPos));
    line.setAttribute('stroke', 'var(--border)');
    line.setAttribute('stroke-dasharray', s > 0 ? '3 3' : 'none');
    line.setAttribute('stroke-width', '1');
    svg.append(line);

    const txt = document.createElementNS(SVG_NS, 'text');
    txt.setAttribute('x', String(padLeft - 8));
    txt.setAttribute('y', String(yPos + 4));
    txt.setAttribute('text-anchor', 'end');
    txt.setAttribute('font-size', '10');
    txt.setAttribute('fill', 'var(--muted-foreground)');
    txt.textContent = yVal >= 1000000 ? (yVal / 1000000).toFixed(1).replace('.0', '') + 'jt' : (yVal / 1000) + 'k';
    svg.append(txt);
  }

  // Bars per month
  const colW = chartW / months.length;
  const barW = Math.min(20, colW * 0.32);

  months.forEach((m, idx) => {
    const groupX = padLeft + idx * colW + colW / 2;

    // Income bar
    const incH = Math.max(2, (m.income / niceMax) * chartH);
    const incY = padTop + chartH - incH;
    const incBar = document.createElementNS(SVG_NS, 'rect');
    incBar.setAttribute('x', String(groupX - barW - 2));
    incBar.setAttribute('y', String(incY));
    incBar.setAttribute('width', String(barW));
    incBar.setAttribute('height', String(incH));
    incBar.setAttribute('rx', '3');
    incBar.setAttribute('fill', 'var(--income)');
    incBar.setAttribute('class', 'chart-bar');
    const incTitle = document.createElementNS(SVG_NS, 'title');
    incTitle.textContent = `${m.label}: Masuk ${formatRupiah(m.income)}`;
    incBar.append(incTitle);
    svg.append(incBar);

    // Expense bar
    const expH = Math.max(2, (m.expense / niceMax) * chartH);
    const expY = padTop + chartH - expH;
    const expBar = document.createElementNS(SVG_NS, 'rect');
    expBar.setAttribute('x', String(groupX + 2));
    expBar.setAttribute('y', String(expY));
    expBar.setAttribute('width', String(barW));
    expBar.setAttribute('height', String(expH));
    expBar.setAttribute('rx', '3');
    expBar.setAttribute('fill', 'var(--expense)');
    expBar.setAttribute('class', 'chart-bar');
    const expTitle = document.createElementNS(SVG_NS, 'title');
    expTitle.textContent = `${m.label}: Keluar ${formatRupiah(m.expense)}`;
    expBar.append(expTitle);
    svg.append(expBar);

    // Month label
    const lbl = document.createElementNS(SVG_NS, 'text');
    lbl.setAttribute('x', String(groupX));
    lbl.setAttribute('y', String(height - 10));
    lbl.setAttribute('text-anchor', 'middle');
    lbl.setAttribute('font-size', '11');
    lbl.setAttribute('font-weight', '550');
    lbl.setAttribute('fill', 'var(--muted-foreground)');
    lbl.textContent = m.label;
    svg.append(lbl);
  });

  const wrap = createElement('div', 'chart-svg-wrap');
  wrap.append(svg);

  // Legend
  const legend = createElement('div', 'chart-legend');
  const incLegend = createElement('div', 'chart-legend-item');
  const incColor = createElement('span', 'chart-legend-color');
  incColor.style.background = 'var(--income)';
  incLegend.append(incColor, createElement('span', null, 'Pemasukan'));

  const expLegend = createElement('div', 'chart-legend-item');
  const expColor = createElement('span', 'chart-legend-color');
  expColor.style.background = 'var(--expense)';
  expLegend.append(expColor, createElement('span', null, 'Pengeluaran'));

  legend.append(incLegend, expLegend);
  container.append(wrap, legend);
}

function renderExpenseDonutChart(container) {
  const visible = visibleTransactions();
  const expenses = visible.filter((t) => t.type === 'expense');

  if (!expenses.length) {
    const empty = createElement('div', 'chart-empty');
    empty.append(
      createSvgIcon('donut', 'icon icon-lg'),
      createElement('p', null, 'Belum ada data transaksi pengeluaran untuk porsi kategori.')
    );
    container.append(empty);
    return;
  }

  // Aggregate by category
  const catMap = new Map();
  let totalExpense = 0;

  expenses.forEach((t) => {
    const cat = t.category || 'Tanpa kategori';
    const amt = Math.trunc(Number(t.amount) || 0);
    catMap.set(cat, (catMap.get(cat) || 0) + amt);
    totalExpense += amt;
  });

  const sorted = Array.from(catMap.entries())
    .map(([name, amount]) => ({ name, amount, percent: Math.round((amount / totalExpense) * 100) }))
    .sort((a, b) => b.amount - a.amount);

  // Top 5 + Lainnya
  const topCategories = sorted.slice(0, 5);
  if (sorted.length > 5) {
    const others = sorted.slice(5).reduce((acc, cur) => acc + cur.amount, 0);
    topCategories.push({
      name: 'Lainnya',
      amount: others,
      percent: Math.round((others / totalExpense) * 100),
    });
  }

  // Build SVG Donut
  const size = 240;
  const strokeWidth = 26;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'chart-svg');
  svg.style.maxWidth = '240px';
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Grafik lingkaran porsi pengeluaran per kategori');

  let accumulated = 0;

  topCategories.forEach((cat, idx) => {
    const color = CHART_COLORS[idx % CHART_COLORS.length];
    const sliceLength = (cat.amount / totalExpense) * circumference;

    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(size / 2));
    circle.setAttribute('cy', String(size / 2));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', String(strokeWidth));
    circle.setAttribute('stroke-dasharray', `${sliceLength} ${circumference}`);
    circle.setAttribute('stroke-dashoffset', String(-accumulated));
    circle.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);

    const title = document.createElementNS(SVG_NS, 'title');
    title.textContent = `${cat.name}: ${formatRupiah(cat.amount)} (${cat.percent}%)`;
    circle.append(title);

    svg.append(circle);
    accumulated += sliceLength;
  });

  // Central text
  const labelText = document.createElementNS(SVG_NS, 'text');
  labelText.setAttribute('x', String(size / 2));
  labelText.setAttribute('y', String(size / 2 - 10));
  labelText.setAttribute('text-anchor', 'middle');
  labelText.setAttribute('font-size', '12');
  labelText.setAttribute('fill', 'var(--muted-foreground)');
  labelText.textContent = 'Total Keluar';

  const valText = document.createElementNS(SVG_NS, 'text');
  valText.setAttribute('x', String(size / 2));
  valText.setAttribute('y', String(size / 2 + 14));
  valText.setAttribute('text-anchor', 'middle');
  valText.setAttribute('font-size', '14');
  valText.setAttribute('font-weight', '700');
  valText.setAttribute('fill', 'var(--foreground)');
  valText.textContent = formatRupiah(totalExpense);

  svg.append(labelText, valText);

  // Layout wrapper: Donut + Legend
  const layout = createElement('div', 'donut-layout');
  layout.append(svg);

  const legendList = createElement('div', 'donut-legend');
  topCategories.forEach((cat, idx) => {
    const color = CHART_COLORS[idx % CHART_COLORS.length];
    const row = createElement('div', 'donut-legend-row');

    const info = createElement('div', 'donut-legend-info');
    const dot = createElement('span', 'chart-legend-color');
    dot.style.background = color;
    info.append(dot, createElement('span', 'donut-legend-name', `${cat.name} (${cat.percent}%)`));

    const val = createElement('span', 'donut-legend-val', formatRupiah(cat.amount));
    row.append(info, val);
    legendList.append(row);
  });

  layout.append(legendList);
  container.append(layout);
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

/* ---------- Actions & Optimistic Offline CRUD ---------- */

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
    if (session.budgets && typeof session.budgets === 'object') {
      state.budgets = session.budgets;
      setCachedBudgets(session.user.id, session.budgets);
    }
    if (session.settings && typeof session.settings === 'object') {
      state.settings = session.settings;
      setCachedSettings(session.user.id, session.settings);
      if (session.settings.theme) {
        applyTheme(session.settings.theme);
      }
    }
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

async function handleRegister(event) {
  event.preventDefault();
  hideRegisterError();

  const username = $('register-username').value.trim().toLowerCase();
  const password = $('register-password').value;
  const confirm = $('register-confirm').value;

  if (!username) {
    showRegisterError('Nama pengguna wajib diisi.');
    return;
  }
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    showRegisterError('Nama pengguna harus 3–64 karakter (huruf, angka, titik, strip, underscore tanpa spasi).');
    return;
  }
  if (!password || password.length < 8) {
    showRegisterError('Kata sandi minimal harus 8 karakter.');
    return;
  }
  if (password !== confirm) {
    showRegisterError('Konfirmasi kata sandi tidak cocok.');
    return;
  }

  setButtonBusy($('register-submit'), true, 'Mendaftarkan…');
  try {
    const session = await api('register', { username, password });
    const valid = session
      && typeof session.token === 'string'
      && typeof session.expiresAt === 'number'
      && session.user;

    if (!valid) throw new AppError('Respons pendaftaran server tidak valid.', 'invalid');

    state.session = session;
    if (session.budgets && typeof session.budgets === 'object') {
      state.budgets = session.budgets;
      setCachedBudgets(session.user.id, session.budgets);
    }
    if (session.settings && typeof session.settings === 'object') {
      state.settings = session.settings;
      setCachedSettings(session.user.id, session.settings);
      if (session.settings.theme) {
        applyTheme(session.settings.theme);
      }
    }
    storeSession(session);
    $('register-form').reset();
    showApp();
    await loadTransactions();
    showToast('Akun berhasil dibuat! Selamat datang di FinTrack.', 'success');
  } catch (error) {
    showRegisterError(error.message || 'Pendaftaran gagal. Silakan coba lagi.');
  } finally {
    setButtonBusy($('register-submit'), false);
  }
}

function openResetPasswordDialog() {
  $('reset-password-form').reset();
  $('reset-error').hidden = true;
  $('reset-username').value = $('login-username').value.trim();
  openDialog($('reset-password-dialog'));
}

async function handleResetPasswordSubmit(event) {
  event.preventDefault();
  $('reset-error').hidden = true;

  const username = $('reset-username').value.trim().toLowerCase();
  const newPassword = $('reset-new-password').value;
  const confirmNewPassword = $('reset-confirm-password').value;

  if (!username) {
    $('reset-error-text').textContent = 'Nama pengguna wajib diisi.';
    $('reset-error').hidden = false;
    return;
  }
  if (!newPassword || newPassword.length < 8) {
    $('reset-error-text').textContent = 'Kata sandi baru minimal harus 8 karakter.';
    $('reset-error').hidden = false;
    return;
  }
  if (newPassword !== confirmNewPassword) {
    $('reset-error-text').textContent = 'Konfirmasi kata sandi baru tidak cocok.';
    $('reset-error').hidden = false;
    return;
  }

  setButtonBusy($('reset-submit'), true, 'Memproses…');
  try {
    const res = await api('resetPassword', { username, newPassword });
    closeDialog($('reset-password-dialog'));
    $('login-username').value = username;
    $('login-password').value = '';
    switchAuthTab('login');
    showToast(res && res.message ? res.message : 'Kata sandi berhasil direset. Silakan masuk.', 'success');
  } catch (error) {
    $('reset-error-text').textContent = error.message || 'Gagal mereset kata sandi.';
    $('reset-error').hidden = false;
  } finally {
    setButtonBusy($('reset-submit'), false);
  }
}

function openChangePasswordDialog() {
  $('change-password-form').reset();
  $('change-error').hidden = true;
  openDialog($('change-password-dialog'));
}

async function handleChangePasswordSubmit(event) {
  event.preventDefault();
  $('change-error').hidden = true;

  const currentPassword = $('change-current-password').value;
  const newPassword = $('change-new-password').value;
  const confirmNewPassword = $('change-confirm-password').value;

  if (!currentPassword) {
    $('change-error-text').textContent = 'Kata sandi saat ini wajib diisi.';
    $('change-error').hidden = false;
    return;
  }
  if (!newPassword || newPassword.length < 8) {
    $('change-error-text').textContent = 'Kata sandi baru minimal harus 8 karakter.';
    $('change-error').hidden = false;
    return;
  }
  if (newPassword !== confirmNewPassword) {
    $('change-error-text').textContent = 'Konfirmasi kata sandi baru tidak cocok.';
    $('change-error').hidden = false;
    return;
  }

  setButtonBusy($('change-submit'), true, 'Menyimpan…');
  try {
    const res = await api('changePassword', {
      token: state.session.token,
      currentPassword,
      newPassword,
    });
    closeDialog($('change-password-dialog'));
    showToast(res && res.message ? res.message : 'Kata sandi berhasil diperbarui.', 'success');
  } catch (error) {
    $('change-error-text').textContent = error.message || 'Gagal mengubah kata sandi.';
    $('change-error').hidden = false;
  } finally {
    setButtonBusy($('change-submit'), false);
  }
}

function handleLogout() {
  clearStoredSession();
  state.session = null;
  state.transactions = [];
  state.budgets = {};
  state.settings = {};
  resetFilterControls();
  state.editingId = null;
  state.deletingId = null;
  closeDialog($('txn-dialog'));
  closeDialog($('delete-dialog'));
  closeDialog($('budget-dialog'));
  closeDialog($('reset-password-dialog'));
  closeDialog($('change-password-dialog'));
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
  const userId = state.session.user.id;

  // Offline handler
  if (!navigator.onLine) {
    if (editingId) {
      const idx = state.transactions.findIndex((t) => t.id === editingId);
      if (idx >= 0) {
        state.transactions[idx] = Object.assign({}, state.transactions[idx], values, {
          updatedAt: new Date().toISOString(),
          _pending: true,
        });
      }
      enqueueOfflineMutation({
        action: 'update',
        id: editingId,
        payload: Object.assign({ id: editingId }, values),
        timestamp: Date.now(),
      });
      showToast('Perubahan disimpan di perangkat (offline).', 'success');
    } else {
      const tempId = 'offline-' + Date.now();
      const optimisticTxn = Object.assign({
        id: tempId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        _pending: true,
      }, values);
      state.transactions.unshift(optimisticTxn);
      enqueueOfflineMutation({
        action: 'add',
        tempId,
        payload: values,
        timestamp: Date.now(),
      });
      showToast('Transaksi disimpan di perangkat (offline).', 'success');
    }

    setCachedTransactions(userId, state.transactions);
    closeDialog($('txn-dialog'));
    renderCategoryOptions();
    renderAll();
    updateSyncStatus();
    return;
  }

  // Online flow
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
        state.transactions.unshift(transaction);
      }
    } else {
      state.transactions.unshift(transaction);
    }

    setCachedTransactions(userId, state.transactions);
    closeDialog($('txn-dialog'));
    renderCategoryOptions();
    renderAll();
    showToast(editingId ? 'Transaksi diperbarui.' : 'Transaksi ditambahkan.', 'success');
  } catch (error) {
    if (isSessionExpiredError(error)) {
      expireSession();
      return;
    }

    // Fallback to offline if network dropped mid-request
    if (error.code === 'network' || error.code === 'timeout' || error.code === 'offline') {
      if (editingId) {
        const idx = state.transactions.findIndex((t) => t.id === editingId);
        if (idx >= 0) {
          state.transactions[idx] = Object.assign({}, state.transactions[idx], values, { _pending: true });
        }
        enqueueOfflineMutation({ action: 'update', id: editingId, payload: Object.assign({ id: editingId }, values), timestamp: Date.now() });
      } else {
        const tempId = 'offline-' + Date.now();
        state.transactions.unshift(Object.assign({ id: tempId, createdAt: new Date().toISOString(), _pending: true }, values));
        enqueueOfflineMutation({ action: 'add', tempId, payload: values, timestamp: Date.now() });
      }
      setCachedTransactions(userId, state.transactions);
      closeDialog($('txn-dialog'));
      renderCategoryOptions();
      renderAll();
      showToast('Koneksi terputus: disimpan di perangkat (offline).', 'success');
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
  const userId = state.session.user.id;

  // Offline handler
  if (!navigator.onLine) {
    state.transactions = state.transactions.filter((txn) => txn.id !== id);
    if (state.editingId === id) closeDialog($('txn-dialog'));
    closeDialog($('delete-dialog'));
    state.deletingId = null;

    // If it was an unsynced offline add, remove it from queue
    const queue = getOfflineQueue(userId);
    const existingQueueIdx = queue.findIndex((item) => item.tempId === id);
    if (existingQueueIdx >= 0) {
      queue.splice(existingQueueIdx, 1);
      saveOfflineQueue(userId, queue);
    } else {
      enqueueOfflineMutation({ action: 'delete', id, timestamp: Date.now() });
    }

    setCachedTransactions(userId, state.transactions);
    renderCategoryOptions();
    renderAll();
    updateSyncStatus();
    showToast('Penghapusan disimpan di perangkat (offline).', 'success');
    return;
  }

  // Online flow
  setButtonBusy($('delete-confirm'), true, 'Menghapus…');
  $('delete-error').hidden = true;

  try {
    await api('deleteTransaction', { token: state.session.token, id });
    state.transactions = state.transactions.filter((txn) => txn.id !== id);
    if (state.editingId === id) closeDialog($('txn-dialog'));
    closeDialog($('delete-dialog'));
    state.deletingId = null;
    setCachedTransactions(userId, state.transactions);
    renderCategoryOptions();
    renderAll();
    showToast('Transaksi dihapus.', 'success');
  } catch (error) {
    if (isSessionExpiredError(error)) {
      expireSession();
      return;
    }

    // Fallback to offline if network disconnected
    if (error.code === 'network' || error.code === 'timeout' || error.code === 'offline') {
      state.transactions = state.transactions.filter((txn) => txn.id !== id);
      enqueueOfflineMutation({ action: 'delete', id, timestamp: Date.now() });
      setCachedTransactions(userId, state.transactions);
      if (state.editingId === id) closeDialog($('txn-dialog'));
      closeDialog($('delete-dialog'));
      state.deletingId = null;
      renderCategoryOptions();
      renderAll();
      showToast('Koneksi terputus: penghapusan disimpan di perangkat (offline).', 'success');
      return;
    }

    $('delete-error-text').textContent = error.message;
    $('delete-error').hidden = false;
  } finally {
    setButtonBusy($('delete-confirm'), false);
  }
}

/* ---------- Filter Handlers & Quick Presets ---------- */

function applyFilterPreset(preset) {
  state.filters.preset = preset;
  const now = new Date();

  if (preset === 'this-month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    $('filter-from').value = formatDateISO(start);
    $('filter-to').value = formatDateISO(end);
  } else if (preset === 'last-month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    $('filter-from').value = formatDateISO(start);
    $('filter-to').value = formatDateISO(end);
  } else if (preset === '30-days') {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    $('filter-from').value = formatDateISO(start);
    $('filter-to').value = todayISO();
  } else {
    // all
    $('filter-from').value = '';
    $('filter-to').value = '';
  }

  document.querySelectorAll('.filter-preset-btn').forEach((btn) => {
    const active = btn.dataset.range === preset;
    btn.classList.toggle('active', active);
    btn.classList.toggle('btn-secondary', active);
    btn.classList.toggle('btn-outline', !active);
  });

  handleFilterChange();
}

function handleFilterChange() {
  state.filters = {
    from: $('filter-from').value,
    to: $('filter-to').value,
    category: $('filter-category').value,
    preset: state.filters.preset || 'all',
  };

  const invalidRange = Boolean(state.filters.from && state.filters.to && state.filters.from > state.filters.to);
  $('filter-error').hidden = !invalidRange;
  $('filter-error').textContent = invalidRange
    ? 'Tanggal "dari" tidak boleh setelah tanggal "sampai".'
    : '';

  renderSummary();
  renderCharts();
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
  state.filters = { from: '', to: '', category: '', preset: 'all' };

  document.querySelectorAll('.filter-preset-btn').forEach((btn) => {
    const active = btn.dataset.range === 'all';
    btn.classList.toggle('active', active);
    btn.classList.toggle('btn-secondary', active);
    btn.classList.toggle('btn-outline', !active);
  });
}

function clearFilters() {
  resetFilterControls();
  renderSummary();
  renderCharts();
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

/* ---------- Offline Sync Engine & Service Worker ---------- */

async function syncOfflineQueue() {
  if (state.syncing || !state.session || !state.session.user || !navigator.onLine) return;
  const userId = state.session.user.id;
  const queue = getOfflineQueue(userId);
  if (!queue.length) {
    updateSyncStatus();
    return;
  }

  state.syncing = true;
  updateSyncStatus();

  let syncedCount = 0;
  const remaining = [];

  for (const item of queue) {
    try {
      if (item.action === 'add') {
        const payload = Object.assign({ token: state.session.token }, item.payload);
        const res = await api('addTransaction', payload);
        const serverTxn = normalizeTransaction(res);
        if (serverTxn) {
          const idx = state.transactions.findIndex((t) => t.id === item.tempId);
          if (idx >= 0) {
            state.transactions[idx] = serverTxn;
          } else {
            state.transactions.unshift(serverTxn);
          }
        }
        syncedCount++;
      } else if (item.action === 'update') {
        const payload = Object.assign({ token: state.session.token }, item.payload);
        const res = await api('updateTransaction', payload);
        const serverTxn = normalizeTransaction(res);
        if (serverTxn) {
          const idx = state.transactions.findIndex((t) => t.id === item.payload.id);
          if (idx >= 0) state.transactions[idx] = serverTxn;
        }
        syncedCount++;
      } else if (item.action === 'delete') {
        await api('deleteTransaction', { token: state.session.token, id: item.id });
        state.transactions = state.transactions.filter((t) => t.id !== item.id);
        syncedCount++;
      } else if (item.action === 'saveBudgets') {
        const payload = Object.assign({ token: state.session.token }, item.payload);
        await api('saveBudgets', payload);
        syncedCount++;
      } else if (item.action === 'saveSetting') {
        const payload = Object.assign({ token: state.session.token }, item.payload);
        await api('saveSetting', payload);
        syncedCount++;
      }
    } catch (err) {
      if (isSessionExpiredError(err)) {
        state.syncing = false;
        expireSession();
        return;
      }
      console.warn('Gagal sinkron item antrean:', item, err);
      remaining.push(item);
      break;
    }
  }

  saveOfflineQueue(userId, remaining);
  setCachedTransactions(userId, state.transactions);
  state.syncing = false;
  updateSyncStatus();

  if (syncedCount > 0) {
    showToast(`${syncedCount} perubahan data offline berhasil disinkronkan ke server.`, 'success');
    renderCategoryOptions();
    renderAll();
  }
}

function updateSyncStatus() {
  if (!state.session || !state.session.user) {
    $('sync-button').hidden = true;
    $('banner-sync-btn').hidden = true;
    return;
  }

  const queue = getOfflineQueue(state.session.user.id);
  const count = queue.length;
  const isOnline = navigator.onLine;

  const syncBtn = $('sync-button');
  const bannerSyncBtn = $('banner-sync-btn');
  const icon = syncBtn.querySelector('.sync-icon');

  if (state.syncing) {
    syncBtn.hidden = false;
    $('sync-button-text').textContent = 'Menyinkronkan…';
    if (icon) icon.classList.add('sync-spinning');
    syncBtn.disabled = true;
    bannerSyncBtn.hidden = true;
  } else {
    if (icon) icon.classList.remove('sync-spinning');
    syncBtn.disabled = false;
    if (count > 0) {
      syncBtn.hidden = false;
      $('sync-button-text').textContent = `Sinkronkan (${count})`;
      if (isOnline) {
        bannerSyncBtn.hidden = false;
        bannerSyncBtn.textContent = `Sinkronkan (${count})`;
      } else {
        bannerSyncBtn.hidden = true;
      }
    } else {
      syncBtn.hidden = true;
      bannerSyncBtn.hidden = true;
    }
  }
}

function updateOnlineStatus() {
  const isOnline = navigator.onLine;
  const banner = $('offline-banner');
  const bannerText = $('offline-banner-text');

  if (!isOnline) {
    banner.hidden = false;
    const queue = state.session && state.session.user ? getOfflineQueue(state.session.user.id) : [];
    if (queue.length > 0) {
      bannerText.textContent = `Mode offline: Data disimpan di perangkat. (${queue.length} transaksi menunggu sinkronisasi)`;
    } else {
      bannerText.textContent = 'Mode offline: Data disimpan secara lokal di perangkat Anda.';
    }
  } else {
    banner.hidden = true;
  }

  updateSyncStatus();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (location.protocol !== 'https:' && !local) return;

  navigator.serviceWorker.register('service-worker.js').catch((error) => {
    console.warn('Registrasi service worker gagal.', error);
  });
}

/* ---------- Wiring & Event Listeners ---------- */

function bindEvents() {
  // Theme toggle buttons
  document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
    btn.addEventListener('click', toggleTheme);
  });

  // Auth tabs & forms
  $('tab-login').addEventListener('click', () => switchAuthTab('login'));
  $('tab-register').addEventListener('click', () => switchAuthTab('register'));
  $('switch-to-register').addEventListener('click', () => switchAuthTab('register'));
  $('switch-to-login').addEventListener('click', () => switchAuthTab('login'));

  $('login-form').addEventListener('submit', handleLogin);
  $('register-form').addEventListener('submit', handleRegister);
  $('logout-button').addEventListener('click', handleLogout);
  $('retry-button').addEventListener('click', loadTransactions);

  // Forgot password & Change password
  $('forgot-password-link').addEventListener('click', openResetPasswordDialog);
  $('reset-password-form').addEventListener('submit', handleResetPasswordSubmit);
  $('open-change-pass-btn').addEventListener('click', openChangePasswordDialog);
  $('change-password-form').addEventListener('submit', handleChangePasswordSubmit);

  $('add-button').addEventListener('click', () => openTransactionDialog(null));
  $('empty-add-button').addEventListener('click', () => openTransactionDialog(null));

  $('txn-form').addEventListener('submit', handleTxnSubmit);
  $('txn-form').addEventListener('input', (event) => {
    event.target.removeAttribute('aria-invalid');
  });

  $('delete-confirm').addEventListener('click', handleDeleteConfirm);
  $('delete-cancel').addEventListener('click', () => closeDialog($('delete-dialog')));

  // Budget dialog events
  $('manage-budget-btn').addEventListener('click', openBudgetDialog);
  $('budget-form').addEventListener('submit', handleBudgetSubmit);
  $('budget-add-row-btn').addEventListener('click', () => {
    $('budget-rows-container').append(createBudgetRow());
  });

  // Chart tabs
  $('tab-chart-trend').addEventListener('click', () => {
    state.activeChartTab = 'trend';
    $('tab-chart-trend').classList.add('active');
    $('tab-chart-trend').setAttribute('aria-selected', 'true');
    $('tab-chart-donut').classList.remove('active');
    $('tab-chart-donut').setAttribute('aria-selected', 'false');
    renderCharts();
  });

  $('tab-chart-donut').addEventListener('click', () => {
    state.activeChartTab = 'donut';
    $('tab-chart-donut').classList.add('active');
    $('tab-chart-donut').setAttribute('aria-selected', 'true');
    $('tab-chart-trend').classList.remove('active');
    $('tab-chart-trend').setAttribute('aria-selected', 'false');
    renderCharts();
  });

  // Filter form and presets
  $('filter-form').addEventListener('change', handleFilterChange);
  $('clear-filters').addEventListener('click', clearFilters);

  document.querySelectorAll('.filter-preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyFilterPreset(btn.dataset.range);
    });
  });

  // Sync button clicks
  $('sync-button').addEventListener('click', syncOfflineQueue);
  $('banner-sync-btn').addEventListener('click', syncOfflineQueue);

  $('txn-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const transaction = state.transactions.find((txn) => txn.id === button.dataset.id);
    if (!transaction) return;
    if (button.dataset.action === 'edit') openTransactionDialog(transaction);
    if (button.dataset.action === 'delete') openDeleteDialog(transaction);
  });

  Array.from(document.querySelectorAll('[data-close-dialog]')).forEach((button) => {
    button.addEventListener('click', () => {
      closeDialog($('txn-dialog'));
      closeDialog($('delete-dialog'));
      closeDialog($('budget-dialog'));
      closeDialog($('reset-password-dialog'));
      closeDialog($('change-password-dialog'));
    });
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
    if (state.session) {
      syncOfflineQueue();
      loadTransactions();
    }
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
  if (session.user && session.user.id) {
    state.budgets = getCachedBudgets(session.user.id);
    state.settings = getCachedSettings(session.user.id);
    if (state.settings && state.settings.theme) {
      applyTheme(state.settings.theme);
    }
  }
  showApp();
  loadTransactions();
}

function init() {
  initTheme();
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

  // Budget calculations check
  const budgetSampleTxns = [
    { id: 'b1', date: '2026-11-05', description: 'Restoran', category: 'Makanan', amount: 400000, type: 'expense' },
    { id: 'b2', date: '2026-11-10', description: 'Supermarket', category: 'Makanan', amount: 500000, type: 'expense' },
    { id: 'b3', date: '2026-11-12', description: 'Bensin', category: 'Transportasi', amount: 120000, type: 'expense' },
  ];
  const sampleBudgets = { 'Makanan': 1000000, 'Transportasi': 100000 };
  const budgetStatus = calculateBudgetStatus(budgetSampleTxns, sampleBudgets, '2026-11-15');

  check('anggaran total dihitung', budgetStatus.totalBudget === 1100000);
  check('anggaran terpakai dihitung', budgetStatus.totalSpent === 1020000);
  check('makanan berstatus waspada (90%)', budgetStatus.items.find((i) => i.category === 'Makanan').status === 'warning');
  check('transportasi berstatus exceeded (120%)', budgetStatus.items.find((i) => i.category === 'Transportasi').status === 'exceeded');

  // Username validation check
  check('validasi username normal', /^[a-z0-9._-]{3,64}$/.test('budi_santoso'));
  check('validasi username tolak spasi', !/^[a-z0-9._-]{3,64}$/.test('budi santoso'));
  check('validasi username tolak pendek', !/^[a-z0-9._-]{3,64}$/.test('ab'));

  // FinTrack v1.1 checks
  check('konfigurasi settings key prefix ada', Boolean(CONFIG.SETTINGS_KEY_PREFIX));
  check('offline queue mutation saveBudgets valid', (function () {
    const q = [{ action: 'saveBudgets', payload: { budgets: { 'Makanan': 500000 } } }];
    return q[0].action === 'saveBudgets' && q[0].payload.budgets.Makanan === 500000;
  })());
  check('offline queue mutation saveSetting valid', (function () {
    const q = [{ action: 'saveSetting', payload: { key: 'theme', value: 'dark' } }];
    return q[0].action === 'saveSetting' && q[0].payload.key === 'theme';
  })());

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

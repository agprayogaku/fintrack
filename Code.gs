/**
 * FinTrack — Google Apps Script backend.
 *
 * Spreadsheet-bound script. Run setup() once, then createUser() from the editor.
 * Deploy as a web app: Execute as "Me", access "Anyone".
 */

const SHEET_USERS = 'Users';
const SHEET_TRANSACTIONS = 'Transactions';
const USERS_HEADERS = ['id', 'username', 'salt', 'passwordHash', 'active', 'createdAt'];
const TRANSACTIONS_HEADERS = ['id', 'userId', 'date', 'description', 'category', 'amount', 'type', 'createdAt', 'updatedAt'];

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_EXPIRED_MESSAGE = 'Sesi berakhir. Silakan masuk kembali.';
const GENERIC_LOGIN_ERROR = 'Nama pengguna atau kata sandi salah.';
const GENERIC_SERVER_ERROR = 'Terjadi kesalahan server. Silakan coba lagi.';

/* ---------- Setup ---------- */

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Jalankan setup() dari Apps Script yang terikat pada spreadsheet.');
  }

  ensureSheet_(SHEET_USERS, USERS_HEADERS);
  ensureSheet_(SHEET_TRANSACTIONS, TRANSACTIONS_HEADERS);

  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('AUTH_SECRET')) {
    properties.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  return 'Setup selesai. Buat pengguna dengan createUser(nama, kataSandi).';
}

function ensureSheet_(name, headers) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);

  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  const currentHeaders = headerRange.getValues()[0].join('|');
  if (currentHeaders !== headers.join('|')) {
    if (sheet.getLastRow() > 1) {
      throw new Error('Header sheet ' + name + ' tidak cocok. Periksa sheet sebelum melanjutkan.');
    }
    headerRange.setValues([headers]);
  }

  headerRange.setFontWeight('bold').setBackground('#f3f4f6');
  sheet.setFrozenRows(1);
  return sheet;
}

function getSheet_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sheet) throw userError_('Spreadsheet belum disiapkan. Jalankan setup().');
  return sheet;
}

/**
 * Run this once from the Apps Script editor to create an account.
 * Delete any temporary wrapper function afterwards.
 */
function createUser(username, password) {
  const cleanUsername = String(username == null ? '' : username).trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,64}$/.test(cleanUsername)) {
    throw userError_('Nama pengguna harus 3–64 karakter: huruf, angka, titik, garis bawah, atau tanda hubung.');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw userError_('Kata sandi harus 8–128 karakter.');
  }

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues() : [];
  const exists = rows.some(function (row) {
    return String(row[1] || '').trim().toLowerCase() === cleanUsername;
  });
  if (exists) throw userError_('Nama pengguna sudah digunakan.');

  const salt = Utilities.getUuid();
  sheet.appendRow([
    Utilities.getUuid(),
    cleanUsername,
    salt,
    hashPassword_(password, salt),
    true,
    new Date().toISOString(),
  ]);

  return 'Pengguna "' + cleanUsername + '" berhasil dibuat.';
}

/* ---------- HTTP entry points ---------- */

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'ping';

    if (action === 'ping') {
      return ok_({ service: 'FinTrack', time: new Date().toISOString() });
    }
    if (action === 'getTransactions' || action === 'getSummary') {
      const userId = verifyToken_(params.token);
      return ok_(action === 'getTransactions'
        ? getTransactions_(userId, params)
        : getSummary_(userId, params));
    }
    return fail_('Aksi tidak diizinkan melalui GET.');
  } catch (error) {
    return fail_(messageForError_(error));
  }
}

function doPost(e) {
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    let body;
    try {
      body = JSON.parse(raw);
    } catch (error) {
      return fail_('Permintaan tidak valid.');
    }
    if (!body || typeof body.action !== 'string') {
      return fail_('Aksi tidak valid.');
    }
    return ok_(handleAction_(body.action, body));
  } catch (error) {
    return fail_(messageForError_(error));
  }
}

function handleAction_(action, payload) {
  switch (action) {
    case 'login':
      return login_(payload);
    case 'getTransactions':
      return getTransactions_(requireUser_(payload), payload);
    case 'addTransaction':
      return addTransaction_(requireUser_(payload), payload);
    case 'updateTransaction':
      return updateTransaction_(requireUser_(payload), payload);
    case 'deleteTransaction':
      return deleteTransaction_(requireUser_(payload), payload);
    case 'getSummary':
      return getSummary_(requireUser_(payload), payload);
    default:
      throw userError_('Aksi tidak dikenal.');
  }
}

function requireUser_(payload) {
  return verifyToken_(payload && payload.token);
}

function ok_(data) {
  return json_({ success: true, data: data });
}

function fail_(message) {
  return json_({ success: false, error: message });
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Authentication ---------- */

function login_(payload) {
  const username = String((payload && payload.username) || '').trim().toLowerCase();
  const password = String((payload && payload.password) || '');

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues() : [];

  let userRow = null;
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][1] || '').trim().toLowerCase() === username) {
      userRow = rows[i];
      break;
    }
  }

  if (!userRow) {
    // Hash anyway to reduce timing differences for unknown usernames.
    hashPassword_(password, 'dummy-salt');
    throw userError_(GENERIC_LOGIN_ERROR);
  }

  const active = userRow[4] === true || userRow[4] === 1 || String(userRow[4]).toLowerCase() === 'true';
  const suppliedHash = hashPassword_(password, String(userRow[2] || ''));
  const storedHash = String(userRow[3] || '');

  if (!active || !safeEquals_(suppliedHash, storedHash)) {
    throw userError_(GENERIC_LOGIN_ERROR);
  }

  const userId = String(userRow[0]);
  return {
    token: createToken_(userId),
    expiresAt: Date.now() + TOKEN_TTL_MS,
    user: { id: userId, username: String(userRow[1]) },
  };
}

function hashPassword_(password, salt) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    salt + ':' + password,
    Utilities.Charset.UTF_8
  );
  return bytesToHex_(bytes);
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) {
    const value = (byte < 0 ? byte + 256 : byte).toString(16);
    return value.length === 1 ? '0' + value : value;
  }).join('');
}

function safeEquals_(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) {
    difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return difference === 0;
}

function createToken_(userId) {
  const payload = { sub: userId, exp: Date.now() + TOKEN_TTL_MS, v: 1 };
  const encodedPayload = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return encodedPayload + '.' + signPayload_(encodedPayload);
}

function signPayload_(encodedPayload) {
  const secret = PropertiesService.getScriptProperties().getProperty('AUTH_SECRET');
  if (!secret) throw userError_('Server belum disiapkan. Jalankan setup().');

  const signature = Utilities.computeHmacSha256Signature(encodedPayload, secret);
  return Utilities.base64EncodeWebSafe(signature);
}

function verifyToken_(token) {
  if (typeof token !== 'string' || !token) {
    throw userError_(SESSION_EXPIRED_MESSAGE);
  }

  const parts = token.split('.');
  if (parts.length !== 2) throw userError_(SESSION_EXPIRED_MESSAGE);

  const expectedSignature = signPayload_(parts[0]);
  if (!safeEquals_(expectedSignature, parts[1])) {
    throw userError_(SESSION_EXPIRED_MESSAGE);
  }

  let payload;
  try {
    payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8')
    );
  } catch (error) {
    throw userError_(SESSION_EXPIRED_MESSAGE);
  }

  const valid = payload
    && payload.v === 1
    && typeof payload.sub === 'string'
    && payload.sub.length > 0
    && typeof payload.exp === 'number';

  if (!valid || payload.exp <= Date.now()) {
    throw userError_(SESSION_EXPIRED_MESSAGE);
  }

  return payload.sub;
}

/* ---------- Transactions ---------- */

function getTransactions_(userId, payload) {
  return applyFilters_(readTransactions_(userId), payload).map(publicTransaction_);
}

function getSummary_(userId, payload) {
  return buildSummary_(applyFilters_(readTransactions_(userId), payload));
}

function readTransactions_(userId) {
  const sheet = getSheet_(SHEET_TRANSACTIONS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, TRANSACTIONS_HEADERS.length).getValues();
  const timeZone = Session.getScriptTimeZone();
  const transactions = [];

  rows.forEach(function (row) {
    if (!row[0] || String(row[1]) !== userId) return;

    const date = toISODate_(row[2], timeZone);
    const amount = Number(row[5]);
    if (!date || !Number.isFinite(amount)) return;

    transactions.push({
      id: String(row[0]),
      userId: String(row[1]),
      date: date,
      description: unsanitizeText_(row[3]),
      category: unsanitizeText_(row[4]),
      amount: amount,
      type: row[6] === 'income' ? 'income' : 'expense',
      createdAt: toISOString_(row[7]),
      updatedAt: toISOString_(row[8]),
    });
  });

  return transactions;
}

function addTransaction_(userId, payload) {
  const input = validateTransactionInput_(payload);
  const sheet = getSheet_(SHEET_TRANSACTIONS);
  const now = new Date().toISOString();
  const transaction = {
    id: Utilities.getUuid(),
    userId: userId,
    date: input.date,
    description: input.description,
    category: input.category,
    amount: input.amount,
    type: input.type,
    createdAt: now,
    updatedAt: now,
  };

  sheet.appendRow(transactionToRow_(transaction));
  return publicTransaction_(transaction);
}

function updateTransaction_(userId, payload) {
  const id = String((payload && payload.id) || '');
  if (!id) throw userError_('ID transaksi wajib diisi.');

  const input = validateTransactionInput_(payload);
  const sheet = getSheet_(SHEET_TRANSACTIONS);
  const match = findTransactionRow_(sheet, userId, id);
  if (!match) throw userError_('Transaksi tidak ditemukan.');

  const now = new Date().toISOString();
  const transaction = {
    id: id,
    userId: userId,
    date: input.date,
    description: input.description,
    category: input.category,
    amount: input.amount,
    type: input.type,
    createdAt: toISOString_(match.values[7]) || now,
    updatedAt: now,
  };

  sheet.getRange(match.rowNumber, 1, 1, TRANSACTIONS_HEADERS.length).setValues([transactionToRow_(transaction)]);
  return publicTransaction_(transaction);
}

function deleteTransaction_(userId, payload) {
  const id = String((payload && payload.id) || '');
  if (!id) throw userError_('ID transaksi wajib diisi.');

  const sheet = getSheet_(SHEET_TRANSACTIONS);
  const match = findTransactionRow_(sheet, userId, id);
  if (!match) throw userError_('Transaksi tidak ditemukan.');

  sheet.deleteRow(match.rowNumber);
  return { id: id };
}

function findTransactionRow_(sheet, userId, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, 1, lastRow - 1, TRANSACTIONS_HEADERS.length).getValues();
  for (let i = 0; i < values.length; i += 1) {
    if (String(values[i][0]) === id && String(values[i][1]) === userId) {
      return { rowNumber: i + 2, values: values[i] };
    }
  }
  return null;
}

function transactionToRow_(transaction) {
  return [
    transaction.id,
    transaction.userId,
    transaction.date,
    protectText_(transaction.description),
    protectText_(transaction.category),
    transaction.amount,
    transaction.type,
    transaction.createdAt,
    transaction.updatedAt,
  ];
}

function validateTransactionInput_(payload) {
  const value = payload || {};

  const date = String(value.date || '');
  if (!isValidISODate_(date)) throw userError_('Tanggal tidak valid.');

  const description = String(value.description || '').trim();
  if (description.length < 1 || description.length > 120) {
    throw userError_('Deskripsi harus 1–120 karakter.');
  }

  const category = String(value.category || '').trim();
  if (category.length < 1 || category.length > 40) {
    throw userError_('Kategori harus 1–40 karakter.');
  }

  const amount = Number(value.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw userError_('Jumlah harus berupa angka bulat lebih dari 0.');
  }

  const type = String(value.type || '');
  if (type !== 'income' && type !== 'expense') {
    throw userError_('Jenis transaksi tidak valid.');
  }

  return {
    date: date,
    description: description,
    category: category,
    amount: amount,
    type: type,
  };
}

function applyFilters_(transactions, payload) {
  const value = payload || {};
  const from = value.from ? requireISODate_(value.from) : '';
  const to = value.to ? requireISODate_(value.to) : '';
  const category = value.category ? String(value.category).trim() : '';

  if (from && to && from > to) return [];

  return transactions
    .filter(function (transaction) {
      if (from && transaction.date < from) return false;
      if (to && transaction.date > to) return false;
      if (category && transaction.category !== category) return false;
      return true;
    })
    .sort(function (a, b) {
      const byDate = b.date.localeCompare(a.date);
      if (byDate !== 0) return byDate;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
}

function buildSummary_(transactions) {
  let totalIncome = 0;
  let totalExpenses = 0;
  const categories = new Map();

  transactions.forEach(function (transaction) {
    const amount = Math.trunc(Number(transaction.amount) || 0);
    const category = transaction.category || 'Tanpa kategori';
    if (!categories.has(category)) {
      categories.set(category, { name: category, income: 0, expense: 0, total: 0 });
    }
    const bucket = categories.get(category);

    if (transaction.type === 'income') {
      totalIncome += amount;
      bucket.income += amount;
    } else {
      totalExpenses += amount;
      bucket.expense += amount;
    }
    bucket.total += amount;
  });

  return {
    totalIncome: totalIncome,
    totalExpenses: totalExpenses,
    net: totalIncome - totalExpenses,
    categories: Array.from(categories.values()).sort(function (a, b) {
      return b.total - a.total;
    }),
  };
}

function publicTransaction_(transaction) {
  return {
    id: transaction.id,
    date: transaction.date,
    description: transaction.description,
    category: transaction.category,
    amount: transaction.amount,
    type: transaction.type,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
  };
}

/* ---------- Value helpers ---------- */

function protectText_(value) {
  const text = String(value == null ? '' : value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function unsanitizeText_(value) {
  const text = String(value == null ? '' : value);
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function toISODate_(value, timeZone) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function toISOString_(value) {
  if (value instanceof Date) return value.toISOString();
  return value == null ? '' : String(value);
}

function requireISODate_(value) {
  const date = String(value);
  if (!isValidISODate_(date)) throw userError_('Tanggal tidak valid.');
  return date;
}

function isValidISODate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parts = value.split('-').map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function userError_(message) {
  const error = new Error(message);
  error.userFacing = true;
  return error;
}

function messageForError_(error) {
  if (error && error.userFacing) return error.message;
  console.error(error);
  return GENERIC_SERVER_ERROR;
}

/* ---------- Self-tests ---------- */

function runSelfTests() {
  const results = [];
  const check = function (name, passed) {
    results.push({ name: name, pass: Boolean(passed) });
  };

  check('hash deterministik', hashPassword_('rahasia', 'salt') === hashPassword_('rahasia', 'salt'));
  check('hash bergantung salt', hashPassword_('rahasia', 'a') !== hashPassword_('rahasia', 'b'));
  check('tanggal ISODate valid', isValidISODate_('2026-11-22') && !isValidISODate_('2026-02-30'));
  check('proteksi formula', protectText_('=1+1') === "'=1+1" && unsanitizeText_("'=1+1") === '=1+1');

  const token = createToken_('user-test');
  check('token bolak-balik', verifyToken_(token) === 'user-test');
  check('token rusak ditolak', (function () {
    try {
      verifyToken_(token + 'x');
      return false;
    } catch (error) {
      return true;
    }
  })());

  const summary = buildSummary_([
    { category: 'Gaji', amount: 5000000, type: 'income' },
    { category: 'Makanan', amount: 35000, type: 'expense' },
  ]);
  check('ringkasan pemasukan', summary.totalIncome === 5000000);
  check('ringkasan pengeluaran', summary.totalExpenses === 35000);
  check('ringkasan bersih', summary.net === 4965000);
  check('kategori terkelompok', summary.categories.length === 2);

  Logger.log(JSON.stringify(results, null, 2));
  const failed = results.filter(function (result) { return !result.pass; });
  if (failed.length) {
    throw new Error('Self-test gagal: ' + failed.map(function (item) { return item.name; }).join(', '));
  }
  return 'Semua self-test lulus (' + results.length + ').';
}

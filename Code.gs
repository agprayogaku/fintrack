/**
 * FinTrack v1.0 — Google Apps Script backend.
 *
 * Spreadsheet-bound script.
 * Seluruh data (Transaksi, Pengguna, Target Anggaran, dan Pengaturan)
 * tersimpan permanen di Google Spreadsheet secara aman.
 *
 * Deploy as a web app: Execute as "Me", access "Anyone".
 */

const SHEET_USERS = 'Users';
const SHEET_TRANSACTIONS = 'Transactions';
const SHEET_BUDGETS = 'Budgets';
const SHEET_SETTINGS = 'Settings';

const USERS_HEADERS = ['id', 'username', 'salt', 'passwordHash', 'active', 'createdAt'];
const TRANSACTIONS_HEADERS = ['id', 'userId', 'date', 'description', 'category', 'amount', 'type', 'createdAt', 'updatedAt'];
const BUDGETS_HEADERS = ['userId', 'category', 'amount', 'updatedAt'];
const SETTINGS_HEADERS = ['userId', 'key', 'value', 'updatedAt'];

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_EXPIRED_MESSAGE = 'Sesi berakhir. Silakan masuk kembali.';
const GENERIC_LOGIN_ERROR = 'Nama pengguna atau kata sandi salah.';
const GENERIC_SERVER_ERROR = 'Terjadi kesalahan server. Silakan coba lagi.';

/* ---------- Menu Interaktif Spreadsheet ---------- */

/**
 * Otomatis menambahkan menu "FinTrack v1.0" saat spreadsheet dibuka.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FinTrack v1.0')
    .addItem('👤 Tambah Pengguna Baru', 'menuTambahPengguna')
    .addItem('🔑 Reset Kata Sandi Pengguna', 'menuResetPassword')
    .addItem('🔄 Aktif / Nonaktifkan Pengguna', 'menuToggleStatusPengguna')
    .addItem('📋 Lihat Daftar Pengguna', 'menuLihatPengguna')
    .addSeparator()
    .addItem('📊 Lihat Target Anggaran (v1.0)', 'menuLihatAnggaran')
    .addItem('⚙️ Setup / Periksa Lembar Sheet', 'menuSetup')
    .addItem('ℹ️ Status & Petunjuk Deployment', 'menuPetunjukDeployment')
    .addItem('🧪 Jalankan Self-Tests', 'menuJalankanSelfTests')
    .addToUi();
}

/**
 * Menampilkan ringkasan target anggaran dari sheet Budgets.
 */
function menuLihatAnggaran() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheet_(SHEET_BUDGETS);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    ui.alert(
      'Target Anggaran FinTrack',
      'Belum ada target anggaran yang tersimpan.\nPengguna dapat mengatur target anggaran langsung dari aplikasi FinTrack.',
      ui.ButtonSet.OK
    );
    return;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, BUDGETS_HEADERS.length).getValues();
  const usersSheet = getSheet_(SHEET_USERS);
  const userRows = usersSheet.getLastRow() > 1 ? usersSheet.getRange(2, 1, usersSheet.getLastRow() - 1, 2).getValues() : [];
  const userMap = {};
  userRows.forEach(function (r) { userMap[String(r[0])] = String(r[1]); });

  const list = rows.map(function (row, idx) {
    const uName = userMap[String(row[0])] || String(row[0]).slice(0, 8);
    const cat = unsanitizeText_(row[1]);
    const amt = Number(row[2]) || 0;
    return (idx + 1) + '. [' + uName + '] ' + cat + ': Rp ' + amt.toLocaleString('id-ID');
  }).join('\n');

  ui.alert('Daftar Target Anggaran (' + rows.length + ')', list, ui.ButtonSet.OK);
}

/**
 * Dialog interaktif untuk menambahkan pengguna baru langsung dari spreadsheet.
 */
function menuTambahPengguna() {
  const ui = SpreadsheetApp.getUi();

  const respUser = ui.prompt(
    'Tambah Pengguna FinTrack',
    'Masukkan nama pengguna (3–64 karakter, tanpa spasi):',
    ui.ButtonSet.OK_CANCEL
  );

  if (respUser.getSelectedButton() !== ui.Button.OK) return;
  const username = respUser.getResponseText().trim();

  if (!username) {
    ui.alert('Peringatan', 'Nama pengguna tidak boleh kosong.', ui.ButtonSet.OK);
    return;
  }

  if (/\s/.test(username)) {
    ui.alert(
      'Format Tidak Valid',
      'Nama pengguna tidak boleh mengandung spasi.\nGunakan huruf kecil, angka, titik (.), strip (-), atau underscore (_).',
      ui.ButtonSet.OK
    );
    return;
  }

  const respPass = ui.prompt(
    'Tambah Pengguna FinTrack',
    'Masukkan kata sandi untuk "' + username + '" (minimal 8 karakter):',
    ui.ButtonSet.OK_CANCEL
  );

  if (respPass.getSelectedButton() !== ui.Button.OK) return;
  const password = respPass.getResponseText();

  if (!password || password.length < 8) {
    ui.alert('Peringatan', 'Kata sandi minimal harus 8 karakter.', ui.ButtonSet.OK);
    return;
  }

  try {
    const hasil = createUser(username, password);
    ui.alert(
      'Berhasil 🎉',
      hasil + '\n\nPengguna sekarang dapat langsung login di aplikasi FinTrack tanpa perlu membuat deployment baru!',
      ui.ButtonSet.OK
    );
  } catch (error) {
    ui.alert('Gagal', error.message || 'Terjadi kesalahan saat membuat pengguna.', ui.ButtonSet.OK);
  }
}

/**
 * Dialog interaktif untuk mereset kata sandi pengguna langsung dari spreadsheet.
 */
function menuResetPassword() {
  const ui = SpreadsheetApp.getUi();

  const respUser = ui.prompt(
    'Reset Kata Sandi Pengguna',
    'Masukkan nama pengguna yang ingin direset:',
    ui.ButtonSet.OK_CANCEL
  );

  if (respUser.getSelectedButton() !== ui.Button.OK) return;
  const username = respUser.getResponseText().trim().toLowerCase();

  if (!username) return;

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues() : [];

  let rowIndex = -1;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === username) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    ui.alert('Tidak Ditemukan', 'Pengguna "' + username + '" tidak ditemukan di lembar Users.', ui.ButtonSet.OK);
    return;
  }

  const respPass = ui.prompt(
    'Reset Kata Sandi Pengguna',
    'Masukkan kata sandi baru untuk "' + username + '" (minimal 8 karakter):',
    ui.ButtonSet.OK_CANCEL
  );

  if (respPass.getSelectedButton() !== ui.Button.OK) return;
  const newPassword = respPass.getResponseText();

  if (!newPassword || newPassword.length < 8 || newPassword.length > 128) {
    ui.alert('Peringatan', 'Kata sandi baru harus 8–128 karakter.', ui.ButtonSet.OK);
    return;
  }

  const newSalt = Utilities.getUuid();
  const newHash = hashPassword_(newPassword, newSalt);

  sheet.getRange(rowIndex, 3).setValue(newSalt);
  sheet.getRange(rowIndex, 4).setValue(newHash);

  ui.alert('Berhasil', 'Kata sandi untuk pengguna "' + username + '" berhasil diperbarui.', ui.ButtonSet.OK);
}

/**
 * Dialog interaktif untuk mengaktifkan atau menonaktifkan akun pengguna.
 */
function menuToggleStatusPengguna() {
  const ui = SpreadsheetApp.getUi();

  const respUser = ui.prompt(
    'Ubah Status Pengguna',
    'Masukkan nama pengguna yang ingin diaktifkan/dinonaktifkan:',
    ui.ButtonSet.OK_CANCEL
  );

  if (respUser.getSelectedButton() !== ui.Button.OK) return;
  const username = respUser.getResponseText().trim().toLowerCase();

  if (!username) return;

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues() : [];

  let rowIndex = -1;
  let currentActive = true;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i][1] || '').trim().toLowerCase() === username) {
      rowIndex = i + 2;
      currentActive = rows[i][4] === true || rows[i][4] === 1 || String(rows[i][4]).toLowerCase() === 'true';
      break;
    }
  }

  if (rowIndex === -1) {
    ui.alert('Tidak Ditemukan', 'Pengguna "' + username + '" tidak ditemukan.', ui.ButtonSet.OK);
    return;
  }

  const newActive = !currentActive;
  sheet.getRange(rowIndex, 5).setValue(newActive);

  ui.alert(
    'Status Berhasil Diubah',
    'Pengguna "' + username + '" sekarang berstatus: ' + (newActive ? 'AKTIF (bisa login)' : 'NONAKTIF (login diblokir)'),
    ui.ButtonSet.OK
  );
}

/**
 * Menampilkan daftar pengguna yang terdaftar di spreadsheet.
 */
function menuLihatPengguna() {
  const ui = SpreadsheetApp.getUi();
  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    ui.alert('Daftar Pengguna', 'Belum ada pengguna terdaftar.\nGunakan menu "FinTrack > Tambah Pengguna Baru".', ui.ButtonSet.OK);
    return;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues();
  const list = rows.map(function (row, idx) {
    const username = row[1];
    const active = row[4] === true || row[4] === 1 || String(row[4]).toLowerCase() === 'true';
    const createdAt = String(row[5] || '').slice(0, 10);
    return (idx + 1) + '. ' + username + ' [' + (active ? 'Aktif' : 'Nonaktif') + '] — dibuat: ' + createdAt;
  }).join('\n');

  ui.alert('Daftar Pengguna FinTrack (' + rows.length + ')', list, ui.ButtonSet.OK);
}

/**
 * Menjalankan setup sheet dari menu spreadsheet.
 */
function menuSetup() {
  const ui = SpreadsheetApp.getUi();
  try {
    const hasil = setup();
    ui.alert('Setup Berhasil', hasil, ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('Gagal Setup', error.message, ui.ButtonSet.OK);
  }
}

/**
 * Menampilkan status dan petunjuk deployment Web App.
 */
function menuPetunjukDeployment() {
  const ui = SpreadsheetApp.getUi();
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const userCount = Math.max(0, getSheet_(SHEET_USERS).getLastRow() - 1);
  const txnCount = Math.max(0, getSheet_(SHEET_TRANSACTIONS).getLastRow() - 1);
  const budgetCount = Math.max(0, getSheet_(SHEET_BUDGETS).getLastRow() - 1);
  const settingCount = Math.max(0, getSheet_(SHEET_SETTINGS).getLastRow() - 1);

  const pesan = '📊 Status Spreadsheet FinTrack v1.0:\n'
    + '• Total Pengguna: ' + userCount + '\n'
    + '• Total Transaksi: ' + txnCount + '\n'
    + '• Target Anggaran: ' + budgetCount + '\n'
    + '• Pengaturan Tersimpan: ' + settingCount + '\n\n'
    + '🌐 Petunjuk Deployment Web App (v1.0):\n'
    + '1. Buka menu Ekstensi > Apps Script.\n'
    + '2. Klik "Kelola Penerapan" (Manage deployments).\n'
    + '3. Klik ikon pensil (Edit) pada penerapan aktif.\n'
    + '4. Pada Versi, pilih: "Versi baru" (New version).\n'
    + '5. Klik "Terapkan" (Deploy).\n\n'
    + '💡 Tips Penting:\n'
    + 'Menambah/mengubah pengguna dan target anggaran langsung tersimpan permanen di Google Spreadsheet!';

  ui.alert('Status & Petunjuk Deployment v1.0', pesan, ui.ButtonSet.OK);
}

/**
 * Menjalankan self-test dari menu spreadsheet.
 */
function menuJalankanSelfTests() {
  const ui = SpreadsheetApp.getUi();
  try {
    const hasil = runSelfTests();
    ui.alert('Hasil Self-Tests', hasil + '\n\nSemua pengujian backend lulus.', ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('Self-Test Gagal', error.message, ui.ButtonSet.OK);
  }
}

/* ---------- Setup ---------- */

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Jalankan setup() dari Apps Script yang terikat pada spreadsheet.');
  }

  ensureSheet_(SHEET_USERS, USERS_HEADERS);
  ensureSheet_(SHEET_TRANSACTIONS, TRANSACTIONS_HEADERS);
  ensureSheet_(SHEET_BUDGETS, BUDGETS_HEADERS);
  ensureSheet_(SHEET_SETTINGS, SETTINGS_HEADERS);

  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('AUTH_SECRET')) {
    properties.setProperty('AUTH_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  return 'Setup v1.0 selesai. Lembar Users, Transactions, Budgets, dan Settings siap digunakan.';
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
 * Jalankan fungsi ini dari dropdown editor Apps Script untuk membuat akun pertama Anda.
 * Ubah 'admin' dan 'kataSandiKuat123' di bawah ini sesuai keinginan Anda sebelum mengklik "Jalankan".
 */
function buatAkunAwal() {
  const username = 'admin';              // 3–64 karakter: huruf, angka, titik (.), strip (-), atau underscore (_)
  const password = 'kataSandiKuat123';   // Minimal 8 karakter
  const hasil = createUser(username, password);
  Logger.log(hasil);
  return hasil;
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
      return ok_({ service: 'FinTrack', version: '1.0', time: new Date().toISOString() });
    }
    if (action === 'getTransactions' || action === 'getSummary' || action === 'getBudgets' || action === 'getSettings') {
      const userId = verifyToken_(params.token);
      if (action === 'getTransactions') return ok_(getTransactions_(userId, params));
      if (action === 'getSummary') return ok_(getSummary_(userId, params));
      if (action === 'getBudgets') return ok_(getBudgets_(userId));
      if (action === 'getSettings') return ok_(getSettings_(userId));
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
    case 'register':
      return register_(payload);
    case 'resetPassword':
      return resetPassword_(payload);
    case 'changePassword':
      return changePassword_(requireUser_(payload), payload);
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
    case 'getBudgets':
      return getBudgets_(requireUser_(payload));
    case 'saveBudgets':
      return saveBudgets_(requireUser_(payload), payload);
    case 'getSettings':
      return getSettings_(requireUser_(payload));
    case 'saveSetting':
      return saveSetting_(requireUser_(payload), payload);
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
    budgets: getBudgets_(userId),
    settings: getSettings_(userId),
  };
}

function register_(payload) {
  const username = String((payload && payload.username) || '').trim().toLowerCase();
  const password = String((payload && payload.password) || '');

  // Validasi dan simpan pengguna baru ke sheet Users
  createUser(username, password);

  // Otomatis login dan kembalikan token sesi
  return login_({ username: username, password: password });
}

function resetPassword_(payload) {
  const username = String((payload && payload.username) || '').trim().toLowerCase();
  const newPassword = String((payload && payload.newPassword) || '');

  if (!username) throw userError_('Nama pengguna wajib diisi.');
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    throw userError_('Kata sandi baru harus 8–128 karakter.');
  }

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues() : [];

  let rowIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][1] || '').trim().toLowerCase() === username) {
      rowIndex = i + 2;
      break;
    }
  }

  if (rowIndex === -1) {
    throw userError_('Nama pengguna tidak ditemukan.');
  }

  const newSalt = Utilities.getUuid();
  const newHash = hashPassword_(newPassword, newSalt);

  sheet.getRange(rowIndex, 3).setValue(newSalt);
  sheet.getRange(rowIndex, 4).setValue(newHash);

  return { message: 'Kata sandi berhasil diperbarui. Silakan masuk dengan kata sandi baru Anda.' };
}

function changePassword_(userId, payload) {
  const currentPassword = String((payload && payload.currentPassword) || '');
  const newPassword = String((payload && payload.newPassword) || '');

  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
    throw userError_('Kata sandi baru harus 8–128 karakter.');
  }

  const sheet = getSheet_(SHEET_USERS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, USERS_HEADERS.length).getValues() : [];

  let userRow = null;
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0]) === userId) {
      userRow = rows[i];
      rowIndex = i + 2;
      break;
    }
  }

  if (!userRow) throw userError_('Pengguna tidak ditemukan.');

  const suppliedHash = hashPassword_(currentPassword, String(userRow[2] || ''));
  const storedHash = String(userRow[3] || '');

  if (!safeEquals_(suppliedHash, storedHash)) {
    throw userError_('Kata sandi saat ini salah.');
  }

  const newSalt = Utilities.getUuid();
  const newHash = hashPassword_(newPassword, newSalt);

  sheet.getRange(rowIndex, 3).setValue(newSalt);
  sheet.getRange(rowIndex, 4).setValue(newHash);

  return { message: 'Kata sandi berhasil diperbarui.' };
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

    const txn = rowToTransaction_(row, timeZone);
    if (!txn.date || !Number.isFinite(txn.amount)) return;

    transactions.push(txn);
  });

  return transactions;
}

function listTransactions_(userId) {
  return readTransactions_(userId);
}

function rowToTransaction_(row, timeZone) {
  const tz = timeZone || Session.getScriptTimeZone();
  return {
    id: String(row[0] || ''),
    userId: String(row[1] || ''),
    date: toISODate_(row[2], tz),
    description: unsanitizeText_(row[3]),
    category: unsanitizeText_(row[4]),
    amount: Number(row[5]),
    type: row[6] === 'income' ? 'income' : 'expense',
    createdAt: toISOString_(row[7]),
    updatedAt: toISOString_(row[8]),
  };
}

function formatRupiah_(amount) {
  return 'Rp ' + Math.trunc(amount || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function getUserCashBalance_(userId, excludeTxnId) {
  const transactions = readTransactions_(userId);
  let balance = 0;
  transactions.forEach(function (t) {
    if (excludeTxnId && String(t.id) === String(excludeTxnId)) return;
    const amt = Math.trunc(Number(t.amount) || 0);
    if (t.type === 'income') balance += amt;
    else balance -= amt;
  });
  return balance;
}

function addTransaction_(userId, payload) {
  const input = validateTransactionInput_(payload);

  if (input.type === 'expense') {
    const currentBalance = getUserCashBalance_(userId);
    if (input.amount > currentBalance) {
      throw userError_('Pengeluaran melebihi sisa saldo kas yang tersedia (' + formatRupiah_(Math.max(0, currentBalance)) + ').');
    }
  }

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

  const balanceWithoutThis = getUserCashBalance_(userId, id);
  if (input.type === 'expense') {
    if (input.amount > balanceWithoutThis) {
      throw userError_('Pengeluaran melebihi sisa saldo kas yang tersedia (' + formatRupiah_(Math.max(0, balanceWithoutThis)) + ').');
    }
  } else if (input.type === 'income') {
    if (balanceWithoutThis + input.amount < 0) {
      throw userError_('Pengurangan pemasukan ini akan membuat saldo kas menjadi negatif.');
    }
  }

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

  const existingTxn = rowToTransaction_(match.values);
  if (existingTxn.type === 'income') {
    const balanceWithoutThis = getUserCashBalance_(userId, id);
    if (balanceWithoutThis < 0) {
      throw userError_('Menghapus pemasukan ini akan membuat saldo kas menjadi negatif.');
    }
  }

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

  const type = String(value.type || '');
  if (type !== 'income' && type !== 'expense') {
    throw userError_('Jenis transaksi tidak valid.');
  }

  let category = String(value.category || '').trim();
  if (type === 'income') {
    // Model Celengan: Pemasukan langsung masuk saldo kas tanpa beban pembagian kategori
    if (!category) category = '-';
  } else {
    // Pengeluaran: Wajib kategori (bisa 'Lainnya' atau kategori anggaran yang dipilih)
    if (!category) category = 'Lainnya';
    if (category.length > 40) {
      throw userError_('Kategori pengeluaran maksimal 40 karakter.');
    }
  }

  const amount = Number(value.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw userError_('Jumlah harus berupa angka bulat lebih dari 0.');
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

    if (transaction.type === 'income') {
      totalIncome += amount;
    } else {
      totalExpenses += amount;
      const category = transaction.category || 'Lainnya';
      if (!categories.has(category)) {
        categories.set(category, { name: category, income: 0, expense: 0, total: 0 });
      }
      const bucket = categories.get(category);
      bucket.expense += amount;
      bucket.total += amount;
    }
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

/* ---------- Budgets (v1.0) ---------- */

/**
 * Mengambil semua target anggaran untuk pengguna tertentu dari sheet Budgets.
 * Mengembalikan objek: { [category]: amount }
 */
function getBudgets_(userId) {
  const sheet = getSheet_(SHEET_BUDGETS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const rows = sheet.getRange(2, 1, lastRow - 1, BUDGETS_HEADERS.length).getValues();
  const budgets = {};

  rows.forEach(function (row) {
    if (String(row[0]) === userId) {
      const category = unsanitizeText_(row[1]);
      const amount = Number(row[2]);
      // Target anggaran khusus pengeluaran (abaikan '-' atau 'Pendapatan', terima >= 0 untuk kategori fleksibel)
      if (category && category !== '-' && category !== 'Pendapatan' && Number.isFinite(amount) && amount >= 0) {
        budgets[category] = Math.trunc(amount);
      }
    }
  });

  return budgets;
}

/**
 * Menyimpan seluruh target anggaran untuk pengguna ke sheet Budgets.
 * payload.budgets: objek kategori -> jumlah, contoh: { "Makanan": 1500000, "Transportasi": 500000 }
 */
function saveBudgets_(userId, payload) {
  const inputBudgets = (payload && payload.budgets) || {};
  if (typeof inputBudgets !== 'object' || inputBudgets === null || Array.isArray(inputBudgets)) {
    throw userError_('Data anggaran tidak valid.');
  }

  const sheet = getSheet_(SHEET_BUDGETS);
  const lastRow = sheet.getLastRow();
  const existingRows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, BUDGETS_HEADERS.length).getValues() : [];

  const otherUsersRows = existingRows.filter(function (row) {
    return String(row[0]) !== userId && String(row[0]) !== '';
  });

  const now = new Date().toISOString();
  const newRows = [];
  const sanitizedBudgets = {};

  Object.keys(inputBudgets).forEach(function (rawCategory) {
    const category = String(rawCategory || '').trim();
    const amount = Number(inputBudgets[rawCategory]);
    // Target anggaran hanya untuk kategori pengeluaran (abaikan '-' dan 'Pendapatan', terima >= 0 untuk kategori fleksibel)
    if (category.length >= 1 && category.length <= 40 && category !== '-' && category !== 'Pendapatan' && Number.isFinite(amount) && amount >= 0) {
      const intAmount = Math.trunc(amount);
      sanitizedBudgets[category] = intAmount;
      newRows.push([
        userId,
        protectText_(category),
        intAmount,
        now,
      ]);
    }
  });

  const allRows = otherUsersRows.concat(newRows);
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, BUDGETS_HEADERS.length).clearContent();
  }
  if (allRows.length > 0) {
    sheet.getRange(2, 1, allRows.length, BUDGETS_HEADERS.length).setValues(allRows);
  }

  return sanitizedBudgets;
}

/* ---------- Settings (v1.0) ---------- */

/**
 * Mengambil preferensi pengguna (seperti tema) dari sheet Settings.
 * Mengembalikan objek: { [key]: value }
 */
function getSettings_(userId) {
  const sheet = getSheet_(SHEET_SETTINGS);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const rows = sheet.getRange(2, 1, lastRow - 1, SETTINGS_HEADERS.length).getValues();
  const settings = {};

  rows.forEach(function (row) {
    if (String(row[0]) === userId) {
      const key = String(row[1] || '').trim();
      const value = unsanitizeText_(row[2]);
      if (key) {
        settings[key] = value;
      }
    }
  });

  return settings;
}

/**
 * Menyimpan satu nilai pengaturan pengguna ke sheet Settings.
 * payload.key: string (e.g. 'theme')
 * payload.value: string (e.g. 'dark' atau 'light')
 */
function saveSetting_(userId, payload) {
  const key = String((payload && payload.key) || '').trim();
  const value = String((payload && payload.value) || '').trim();

  if (!key || key.length > 64) {
    throw userError_('Kunci pengaturan tidak valid.');
  }
  if (value.length > 500) {
    throw userError_('Nilai pengaturan terlalu panjang.');
  }

  const sheet = getSheet_(SHEET_SETTINGS);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, SETTINGS_HEADERS.length).getValues() : [];

  let rowIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0]) === userId && String(rows[i][1]).trim() === key) {
      rowIndex = i + 2;
      break;
    }
  }

  const now = new Date().toISOString();
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 3, 1, 2).setValues([[protectText_(value), now]]);
  } else {
    sheet.appendRow([userId, key, protectText_(value), now]);
  }

  return { key: key, value: value };
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
    if (isNaN(value.getTime())) return '';
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }
  const text = String(value == null ? '' : value).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : '';
}

function toISOString_(value) {
  if (value instanceof Date) {
    return !isNaN(value.getTime()) ? value.toISOString() : '';
  }
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
    { category: '-', amount: 5000000, type: 'income' },
    { category: 'Makanan', amount: 35000, type: 'expense' },
  ]);
  check('ringkasan pemasukan', summary.totalIncome === 5000000);
  check('ringkasan pengeluaran', summary.totalExpenses === 35000);
  check('ringkasan bersih', summary.net === 4965000);
  check('kategori pengeluaran terkelompok', summary.categories.length === 1 && summary.categories[0].name === 'Makanan');

  // Pengujian FinTrack v1.0
  check('proteksi formula budget', protectText_('=SUM(A1:A10)') === "'=SUM(A1:A10)");
  check('konstanta sheet v1.0 ada', SHEET_BUDGETS === 'Budgets' && SHEET_SETTINGS === 'Settings');
  check('header sheet v1.0 valid', BUDGETS_HEADERS.length === 4 && SETTINGS_HEADERS.length === 4);
  const sampleRow = ['tx-1', 'user-1', '2026-11-22', 'Makan', 'Makanan', 25000, 'expense', '2026-11-22T00:00:00.000Z', '2026-11-22T00:00:00.000Z'];
  const parsedTxn = rowToTransaction_(sampleRow, 'Asia/Jakarta');
  check('rowToTransaction_ valid', parsedTxn.id === 'tx-1' && parsedTxn.amount === 25000 && parsedTxn.type === 'expense');
  check('formatRupiah_ valid', formatRupiah_(1500000) === 'Rp 1.500.000');
  check('listTransactions_ terdefinisi', typeof listTransactions_ === 'function' && typeof readTransactions_ === 'function');

  Logger.log(JSON.stringify(results, null, 2));
  const failed = results.filter(function (result) { return !result.pass; });
  if (failed.length) {
    throw new Error('Self-test gagal: ' + failed.map(function (item) { return item.name; }).join(', '));
  }
  return 'Semua self-test lulus (' + results.length + ').';
}

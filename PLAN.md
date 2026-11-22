# FinTrack PWA — Implementation Plan (IDR + Bahasa Indonesia)

**Status:** Implemented — static PWA + Apps Script backend  
**Project:** `C:\Users\user\Personal\Project\fintrack`  
**Last updated:** 2026-11-22

## 1. Product decisions

- Static PWA hosted on GitHub Pages.
- Backend: Google Apps Script web app bound to a Google Spreadsheet.
- Frontend: vanilla HTML, CSS, and JavaScript only. No frameworks or libraries.
- No NPM, Node build step, `package.json`, React, Tailwind, or Radix.
- UI design reference: `components.md` and the linked shadcn/ui documentation. The result is **shadcn-inspired**, not an actual shadcn installation.
- Login-first flow, then a personal finance dashboard.
- **UI language:** Bahasa Indonesia.
- **Currency:** Indonesian Rupiah (IDR / Rp).
- **Amounts:** whole rupiah (integer). Input uses `min="1"`, `step="1"`, and `inputmode="numeric"`. Server validates positive integers and summaries use integer arithmetic.
- **Dates:** stored as `YYYY-MM-DD`; displayed in Indonesian format, e.g. `22 Nov 2026`.
- **Locale:** `id-ID`.
- Code identifiers, API action names, and spreadsheet headers remain English for maintainability. All user-facing text, ARIA labels, errors, toasts, and confirmations are Bahasa Indonesia.
- App name: **FinTrack**; descriptive subtitle: **Keuangan Pribadi**.

## 2. Files

| File | Purpose |
|---|---|
| `index.html` | Login view, app shell, native dialogs, toast region, SVG icon sprite, Indonesian copy |
| `styles.css` | shadcn-inspired design tokens and components, mobile-first responsive layout, focus states, safe-area support |
| `app.js` | Config, API client, auth/session, CRUD, filtering, summary, formatting, dialog/toast helpers, XSS-safe rendering, service-worker registration |
| `manifest.json` | Standalone PWA manifest with Indonesian name/description and install icons |
| `service-worker.js` | Precache app shell; network-first navigation; cache-first static assets; never cache API calls |
| `Code.gs` | Apps Script backend: setup, user creation, auth, token validation, CRUD, summary, JSON routing |
| `components.md` | shadcn documentation link list used only as a design reference; not loaded at runtime |
| `icons/icon.svg` | Source icon |
| `icons/icon-180.png`, `icon-192.png`, `icon-512.png` | Generated Apple/Android/desktop install icons |

### 2.1 UI design reference

`components.md` is the source list for the shadcn documentation links. The implementation uses the linked **Button, Card, Input, Dialog, Alert Dialog, Table, Badge, Alert, Progress, Skeleton, Toast, and Theming** docs as a reference for anatomy, states, and accessibility.

The app copies the visual language and interaction patterns, not the React/Tailwind implementation. There is no runtime dependency on shadcn, Tailwind, or Radix.

#### Design tokens

`styles.css` uses semantic tokens modeled on shadcn theming:

```css
:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.43 0.08 180);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --income: oklch(0.596 0.145 163.225);
  --expense: var(--destructive);
}
```

The theme is light-only for the first version. A dark theme can be added later by overriding the same tokens.

#### Component mapping

| shadcn reference | Vanilla implementation |
|---|---|
| Button | `.btn` with `default`, `outline`, `secondary`, `ghost`, `destructive`, `link`, `icon`, and loading variants |
| Card | `.card`, `.card-header`, `.card-title`, `.card-description`, `.card-content`, `.card-footer` |
| Input / Label / Field | `.field`, `.label`, `.input`, `.field-description`, `.field-error`, `aria-invalid` |
| Dialog | Native `<dialog>` with `showModal()`, backdrop, header, footer, close button, and focus return |
| Alert Dialog | Native `<dialog role="alertdialog">` for delete confirmation |
| Select | Styled native `<select>` for accessibility and simplicity |
| Table | Reference only; transactions use responsive transaction rows instead of a data table |
| Badge | `.badge` variants for income, expense, and status |
| Alert | `.alert` default/destructive for errors and offline notices |
| Progress | `role="progressbar"` with CSS width for category totals |
| Skeleton | `.skeleton` placeholders; disabled under `prefers-reduced-motion` |
| Toast | Fixed `aria-live` region with success/error variants and auto-dismiss |
| Empty | Centered empty-state block with message and action |
| Spinner | CSS-only loading spinner inside buttons |

Native `<dialog>` provides the modal behavior, focus trap, Escape handling, and backdrop. Icons are project-owned inline SVGs in an HTML sprite; no Lucide dependency.

## 3. Localization rules

### 3.1 Configuration

```js
const CONFIG = {
  API_URL: 'PASTE_APPS_SCRIPT_WEB_APP_URL_HERE',
  LOCALE: 'id-ID',
  CURRENCY: 'IDR',
  SESSION_HOURS: 24,
};
```

### 3.2 Currency formatting

```js
const money = new Intl.NumberFormat(CONFIG.LOCALE, {
  style: 'currency',
  currency: CONFIG.CURRENCY,
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
```

Expected display: `Rp 10.000`, `Rp 1.250.000`, etc.  
For signed amounts, format the absolute value and prefix `+` or `−` manually to avoid double negatives.

### 3.3 Dates

- Store transaction dates and filter values as `YYYY-MM-DD`.
- Display with `Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })`.
- Compare date strings directly for filters (inclusive).
- Native `<input type="date">` pickers may follow the device/browser locale even though all labels are Indonesian. This is acceptable and documented as a limitation.

### 3.4 HTML and manifest language

- `<html lang="id">`
- Manifest: `"lang": "id"`, `"dir": "ltr"`.
- `<title>FinTrack — Keuangan Pribadi</title>`
- Meta description in Indonesian.

## 4. Indonesian UI copy

| Context | Copy |
|---|---|
| App title | FinTrack — Keuangan Pribadi |
| Login heading | Masuk |
| Login description | Masuk ke akun Anda untuk mengelola keuangan pribadi. |
| Username label | Nama pengguna |
| Password label | Kata sandi |
| Login button | Masuk |
| Login hint | Gunakan akun yang dibuat oleh administrator. |
| Logout | Keluar |
| Dashboard heading | Ringkasan |
| Total income | Total pemasukan |
| Total expenses | Total pengeluaran |
| Net balance | Saldo bersih |
| All-time scope | Semua transaksi |
| Filtered scope | Sesuai filter |
| Add dialog title | Tambah transaksi |
| Add dialog description | Catat pemasukan atau pengeluaran baru. |
| Edit dialog title | Ubah transaksi |
| Edit dialog description | Perbarui detail transaksi. |
| Close dialog | Tutup |
| Date | Tanggal |
| Description | Deskripsi |
| Category | Kategori Anggaran (khusus pengeluaran) |
| Amount | Jumlah |
| Type | Jenis |
| Income option | Pemasukan |
| Expense option | Pengeluaran |
| Add button | Tambah transaksi |
| Save edit | Simpan perubahan |
| Cancel edit | Batal |
| Filters heading | Filter |
| From date | Dari tanggal |
| To date | Sampai tanggal |
| All categories | Semua kategori |
| Clear filters | Bersihkan filter |
| List heading | Transaksi |
| Count | `{n} transaksi` |
| Edit action | Ubah |
| Delete action | Hapus |
| Empty list | Belum ada transaksi. Tambahkan transaksi pertama Anda. |
| Empty filtered list | Tidak ada transaksi yang cocok dengan filter. |
| Loading | Memuat transaksi... |
| Retry | Coba lagi |
| Offline banner | Anda sedang offline. Data memerlukan koneksi internet. |
| Delete dialog title | Hapus transaksi? |
| Delete dialog description | Tindakan ini tidak dapat dibatalkan. |
| Delete confirm | Hapus |
| Added toast | Transaksi ditambahkan. |
| Saved toast | Perubahan disimpan. |
| Deleted toast | Transaksi dihapus. |
| Invalid login | Nama pengguna atau kata sandi salah. |
| Session expired | Sesi berakhir. Silakan masuk kembali. |
| Network failure | Tidak dapat terhubung ke server. Periksa koneksi internet Anda lalu coba lagi. |
| Timeout | Server terlalu lama merespons. Silakan coba lagi. |
| Unexpected response | Respons server tidak dikenali. Periksa konfigurasi URL Apps Script. |
| Missing config | URL Apps Script belum diatur di app.js. |
| Offline action | Anda sedang offline. Sambungkan ke internet untuk memuat atau mengubah data. |
| Invalid date | Tanggal tidak valid. |
| Missing description | Deskripsi wajib diisi. |
| Missing category | Kategori pengeluaran wajib dipilih. |
| Invalid amount | Jumlah harus berupa angka bulat lebih dari 0. |
| Generic server error | Terjadi kesalahan server. Silakan coba lagi. |

All additional labels, `aria-label` values, empty/loading states, and validation messages must also be in Bahasa Indonesia.

## 5. Data model

### 5.1 Users sheet

Headers: `id`, `username`, `salt`, `passwordHash`, `active`, `createdAt`

- `id`: UUID generated by the server.
- `username`: trimmed, lowercase, 3–64 characters.
- `salt`: random UUID per user.
- `passwordHash`: hex SHA-256 of `salt + ':' + password`.
- `active`: boolean; inactive users cannot log in.
- `createdAt`: ISO timestamp.

Users are created with a helper function, not a registration UI:

```js
createUser('nama', 'kata-sandi-yang-kuat');
```

### 5.2 Transactions sheet

Headers: `id`, `userId`, `date`, `description`, `category`, `amount`, `type`, `createdAt`, `updatedAt`

- `id`: UUID.
- `userId`: owner ID from the authenticated session token.
- `date`: `YYYY-MM-DD` string.
- `description`: trimmed, 1–120 characters.
- `category`: trimmed, 1–40 characters.
- `amount`: positive whole integer (IDR).
- `type`: `income` or `expense`.
- `createdAt` / `updatedAt`: ISO timestamps.
- Every read filters by `userId`.
- Update and delete require a matching transaction `id` **and** `userId`.
- Text fields beginning with `=`, `+`, `-`, or `@` are prefixed with an apostrophe before writing to the sheet to prevent spreadsheet formula injection. The prefix is removed when reading.

### 5.3 Budgets sheet (v1.0)

Headers: `userId`, `category`, `amount`, `updatedAt`

- `userId`: owner ID from the authenticated session token.
- `category`: trimmed, 1–40 characters.
- `amount`: positive whole integer monthly budget (IDR).
- `updatedAt`: ISO timestamp.
- Stores user monthly budget targets per category permanently in Google Spreadsheet.

### 5.4 Settings sheet (v1.0)

Headers: `userId`, `key`, `value`, `updatedAt`

- `userId`: owner ID from the authenticated session token.
- `key`: setting key (e.g., `theme`).
- `value`: setting value (e.g., `dark` or `light`).
- `updatedAt`: ISO timestamp.
- Stores user preferences permanently in Google Spreadsheet.

### 5.5 Session secret

`AUTH_SECRET` is stored in Apps Script `ScriptProperties`, never in the client. It is used to sign stateless session tokens.

## 6. API contract

Every response uses the shape:

```json
{ "success": true, "data": {} }
```

or

```json
{ "success": false, "error": "Pesan kesalahan dalam Bahasa Indonesia." }
```

| Action | Method | Payload | Success data |
|---|---|---|---|
| `ping` | GET | none | `{ service, version, time }` |
| `login` | POST | `{ username, password }` | `{ token, expiresAt, user, budgets, settings }` |
| `register` | POST | `{ username, password }` | `{ token, expiresAt, user, budgets, settings }` |
| `resetPassword` | POST | `{ username, newPassword }` | `{ message }` |
| `changePassword` | POST | `{ token, currentPassword, newPassword }` | `{ message }` |
| `getTransactions` | POST (also GET) | `{ token, from?, to?, category? }` | Transaction array |
| `addTransaction` | POST | `{ token, date, description, category, amount, type }` | Created transaction |
| `updateTransaction` | POST | `{ token, id, date, description, category, amount, type }` | Updated transaction |
| `deleteTransaction` | POST | `{ token, id }` | `{ id }` |
| `getSummary` | POST (also GET) | `{ token, from?, to?, category? }` | `{ totalIncome, totalExpenses, net, categories }` |
| `getBudgets` | POST (also GET) | `{ token }` | `{ [category]: amount }` |
| `saveBudgets` | POST | `{ token, budgets: { [cat]: amt } }` | `{ [category]: amount }` |
| `getSettings` | POST (also GET) | `{ token }` | `{ [key]: value }` |
| `saveSetting` | POST | `{ token, key, value }` | `{ key, value }` |

Routing notes:

- `doPost` handles login and all mutations.
- `doGet` handles `ping` and read-only `getTransactions` / `getSummary`.
- Login is rejected over GET to avoid passwords in URLs.
- The PWA uses POST for every request.
- POST requests use `Content-Type: text/plain;charset=utf-8` with a JSON string body to avoid CORS preflight.
- The token travels in the JSON body, never in a custom header or URL.
- Apps Script always returns HTTP 200; the client checks the `success` flag.
- Backend error strings are in Bahasa Indonesia.
- The client recognizes the exact session-expiry message:
  `Sesi berakhir. Silakan masuk kembali.`

## 7. Authentication and sessions

1. `setup()` creates the `Users` and `Transactions` sheets if missing, writes headers, and creates `AUTH_SECRET` if absent.
2. `createUser(username, password)` validates input, generates a salt, hashes the password, and appends a row.
3. Login finds the username, hashes the supplied password with the stored salt, compares hashes in constant time, and checks `active`.
4. A failed login always returns `Nama pengguna atau kata sandi salah.` and performs a dummy hash when the user is not found to reduce timing leaks.
5. Successful login returns a signed token, expiry timestamp, and public user object.
6. Token format:
   - Payload: `{ sub: userId, exp: epochMillis, v: 1 }`
   - Base64url-encoded payload + `.` + base64url HMAC-SHA256 signature.
7. The server validates signature and expiry on every data action.
8. Tokens expire after 24 hours. There is no server-side session store.
9. The client stores `{ token, expiresAt, user }` in `localStorage` under `fintrack.session`.
10. The client checks expiry before loading the app; the server remains authoritative.
11. Logout clears the stored session and all in-memory data, then shows the login view.
12. Rotating `AUTH_SECRET` invalidates every existing token.

## 8. Frontend behavior

### 8.1 Views and initialization

- Login view is shown first for unauthenticated users.
- If a non-expired session exists, show the app shell and load transactions.
- If the session is expired or rejected by the server, clear it and show the login view with the session-expired message.
- The app shell remains visible when a data request fails; an error banner with `Coba lagi` is shown.

### 8.2 API client

- `api(action, payload)` sends a JSON string with `text/plain`.
- Adds the current token when available.
- Uses `AbortController` with a 30-second timeout for Apps Script cold starts.
- Distinguishes:
  - API errors (`success: false`)
  - Network failures
  - Timeouts
  - Non-JSON/unexpected responses
  - Session expiry
- Never uses `mode: 'no-cors'`.

### 8.3 Transactions and dialogs

- Add and edit use the same native `<dialog>` form.
- Opening add resets the form, sets the title to `Tambah transaksi`, and focuses the description field.
- Edit mode fills the form, sets the transaction ID, changes the title to `Ubah transaksi`, and changes the submit label to `Simpan perubahan`.
- The dialog has a visible `Tutup` button, closes on Escape, and returns focus to the trigger.
- Long dialog content scrolls while the footer actions remain reachable on mobile.
- Delete uses a separate `<dialog role="alertdialog">` with `Hapus transaksi?`, the irreversible warning, `Batal`, and `Hapus`.
- After a successful mutation, update local state and re-render without a full reload.
- If the deleted transaction is being edited, close and reset the edit dialog.
- Disable submit while a request is in flight.
- Keep the dialog open and preserve values when a save fails.

### 8.4 Filters

- Date range is inclusive.
- Category filter is an exact match.
- Filters apply client-side for instant feedback.
- Clear filters resets all filter controls.
- If `from > to`, show a validation message and no results.
- Category options are derived from expense transactions and defined budget categories (plus fallback "Lainnya") and sorted alphabetically.
- If the selected category no longer exists, reset to `Semua kategori`.

### 8.5 Summary, Celengan Model, & Target Pemenuhan

- **Model Celengan untuk Pemasukan:** Pemasukan dicatat langsung ke saldo kas/rekening tanpa membebani pengguna untuk memilih alokasi kategori anggaran (kategori otomatis dicatat sebagai `-`).
- **Kategori Anggaran Khusus Pengeluaran:** Pengeluaran wajib memilih kategori anggaran (yang disinkronkan dengan target pemenuhan atau opsi bawaan "Lainnya") agar pengeluaran terlacak dengan presisi.
- **Target Pemenuhan / Pelunasan Kewajiban:** Kategori anggaran diperlakukan sebagai target pemenuhan bulanan (misal: Cicilan, Tagihan, Tabungan). Status kategori:
  - *Perlu Dilunasi (0%)*: belum ada pengeluaran dicatat.
  - *Sebagian (X%)*: sudah dicatat sebagian dari target.
  - *Lunas / Terpenuhi*: target telah tercapai atau terlampaui.
  - *Fleksibel*: kategori yang disimpan tanpa nominal target tetap dapat digunakan untuk mencatat pengeluaran.
- **Anti-Defisit Kas:** Pengeluaran tidak boleh melebihi sisa saldo kas yang tersedia. Transaksi pengeluaran yang melebihi saldo kas ditolak secara otomatis di sisi antarmuka maupun backend spreadsheet.
- Totals are calculated from the filtered transactions so the dashboard matches the visible list.
- Show:
  - Total pemasukan
  - Total pengeluaran
  - Saldo bersih
  - Per-category expense totals and budget fulfillment progress (visualized via Budget list and Donut chart; the redundant standalone "Berdasarkan Kategori" card was removed).
- Use integer arithmetic; all amounts are whole rupiah.
- The backend `getSummary` action returns the same shape and is available for API clients, but the PWA calculates summaries locally for instant filtering.

### 8.6 Formatting helpers

- `formatRupiah(value)` → `Rp 10.000`
- `formatSignedRupiah(value, type)` → `+Rp 10.000` / `−Rp 10.000`
- `formatDate(isoDate)` → `22 Nov 2026`
- `todayISO()` → local date without UTC shifting

### 8.7 XSS and accessibility

- Build dynamic DOM with `createElement` and `textContent`.
- Do not use dynamic `innerHTML` with user data.
- All form controls have labels.
- Errors use `role="alert"`.
- Toasts use `aria-live="polite"`.
- Visible focus states; touch targets at least 44px.
- Amount direction is conveyed by sign and text, not only color.
- Layout is mobile-first and responsive.
- Respect `prefers-reduced-motion`.

### 8.8 Offline behavior

- Show `Anda sedang offline. Data memerlukan koneksi internet.` when offline.
- Allow the app shell and login page to load offline.
- Disable no local financial caching; data requests fail with the Indonesian offline message.
- On reconnect, hide the banner and reload data if a session exists.
- Do not cache API responses in the service worker.

## 9. PWA and offline shell

### 9.1 Manifest

```json
{
  "name": "FinTrack — Pelacak Keuangan Pribadi",
  "short_name": "FinTrack",
  "description": "Pelacak keuangan pribadi yang aman dan dapat digunakan secara offline.",
  "lang": "id",
  "dir": "ltr",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#f6f8fb",
  "theme_color": "#0f766e",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Additional HTML metadata:

- `<meta name="theme-color" content="#0f766e">`
- `<link rel="manifest" href="manifest.json">`
- `<link rel="apple-touch-icon" href="icons/icon-180.png">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`
- `<meta name="apple-mobile-web-app-title" content="FinTrack">`

### 9.2 Service worker

- Cache name: `fintrack-shell-v1`.
- Precache: `./`, `./index.html`, `./styles.css`, `./app.js`, `./manifest.json`.
- Install: `cache.addAll`, `skipWaiting`.
- Activate: delete old caches, `clients.claim`.
- Navigation: network-first; fall back to cached `index.html`.
- Same-origin static GET: cache-first, then network and cache the response.
- Non-GET and cross-origin requests: pass through untouched.
- Bump the cache name when shell assets change.
- Register only over HTTP(S), not `file://`.

### 9.3 Icons

- Create a simple teal/white wallet-chart icon with content inside the maskable safe zone.
- Export to 180×180, 192×192, and 512×512 PNG.
- Include the SVG source.
- Binary PNGs are generated from the source rather than pasted as text.

## 10. Security

- Spreadsheet ID never appears in client code. Use a spreadsheet-bound Apps Script project.
- The Apps Script web app URL is the only backend detail in `app.js`; it is public by nature.
- Passwords are hashed server-side with a per-user salt. Passwords are never stored or hashed in the client.
- Tokens are signed server-side; user IDs cannot be forged.
- All transaction queries are scoped to the authenticated user ID.
- Client and server both validate dates, categories, descriptions, types, and amounts.
- Text is rendered with `textContent`; no user data goes through dynamic `innerHTML`.
- Spreadsheet formula injection is mitigated for text cells.
- CORS uses simple `text/plain` POST requests; no preflight.
- Avoid logging passwords, hashes, tokens, or sensitive spreadsheet data.
- Use HTTPS (GitHub Pages provides it).

## 11. Setup steps

### 11.1 Google Sheet and Apps Script

1. Create a Google Sheet named `FinTrack`.
2. Optionally set **File → Settings → Locale** to Indonesia and the time zone to `Asia/Jakarta`.
3. Open **Extensions → Apps Script**.
4. Replace the stub with `Code.gs`.
5. Run `setup()` and authorize the script.
6. Temporarily add and run:
   ```js
   function makeMe() {
     createUser('nama', 'kata-sandi-yang-kuat');
   }
   ```
7. Delete the temporary function after the user is created.
8. Deploy → **New deployment** → **Web app**.
9. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
10. Copy the `/exec` URL.

### 11.2 Frontend configuration

1. Paste the `/exec` URL into `CONFIG.API_URL` in `app.js`.
2. Confirm `LOCALE: 'id-ID'` and `CURRENCY: 'IDR'`.
3. Keep the manifest and app copy in Bahasa Indonesia.

### 11.3 GitHub Pages

1. Push these files to the repository root:
   - `index.html`
   - `styles.css`
   - `app.js`
   - `manifest.json`
   - `service-worker.js`
   - `icons/` directory
2. In GitHub: **Settings → Pages**.
3. Source: **Deploy from a branch**.
4. Branch: `main`, folder: `/ (root)`.
5. Save and wait for the deployment.
6. Open the HTTPS Pages URL.

### 11.4 Deployment updates

- After editing `Code.gs`: **Deploy → Manage deployments → Edit → New version → Deploy**. The URL stays the same.
- After changing shell assets: bump `CACHE_NAME` in `service-worker.js`.
- Hard-refresh once after deploying a new version if an old service worker is still active.

### 11.5 Install

- Chrome/Edge desktop: install icon in the address bar.
- Android Chrome: menu → **Install app** / **Tambahkan ke layar utama**.
- iOS Safari: Share → **Add to Home Screen**.

## 12. Test checklist

### Automated/self-checks

- `runSelfTests()` in `Code.gs` checks:
  - Password hashing is deterministic for the same salt.
  - Token creation and verification round-trip.
  - Summary arithmetic with mixed income/expense.
- Client self-check behind `?selftest=1` checks:
  - Date/category filtering.
  - Integer rupiah summary totals.
  - Signed formatting.

### Manual checks

- Login succeeds with a valid user.
- Login fails with a generic message for a wrong password or unknown user.
- Session persists across reloads and expires after 24 hours.
- Logout clears the session and data.
- Add, edit, and delete transactions.
- Date range and category filters work, including `from > to`.
- Summary matches the filtered list.
- Currency displays as `Rp 10.000`, not `$10.00`.
- Dates display in Indonesian format.
- Two users cannot see or modify each other’s transactions.
- XSS payload such as `<img src=x onerror=alert(1)>` appears as text.
- Network failure and offline mode show Indonesian messages.
- App shell loads offline.
- Service worker registration succeeds over HTTPS/localhost.
- PWA installs on desktop and Android; iOS Add to Home Screen works.
- Layout is usable on a narrow mobile viewport.

## 13. Known limitations

- Apps Script cold starts add latency and quotas apply.
- Salted single-pass SHA-256 is fast and not a proper password KDF. There is no rate limiting, password reset, or 2FA.
- Stateless tokens cannot be revoked individually; logout only clears the client. A stolen token remains valid until expiry. Rotating `AUTH_SECRET` revokes all sessions.
- Apps Script CORS depends on its redirect/simple-request behavior. There are no custom headers or HTTP status codes.
- Offline mode caches only the app shell. Transactions are not cached and offline edits are not supported.
- Amounts are whole rupiah. Fractional amounts would require changing the input step, validation, and formatting.
- Native date pickers may follow the device locale rather than the Indonesian UI.
- Client-side filtering loads all user transactions; suitable for personal-scale data.
- `localStorage` tokens remain exposed to XSS; DOM safety reduces but does not eliminate the risk.
- iOS icon and home-screen behavior differs from Android/desktop.
- Apps Script returns HTTP 200 for errors; clients must inspect `success`.
- No pagination, reporting export, recurring transactions, or budgets.
- The UI is shadcn-inspired, not an actual shadcn installation; component behavior and exact visuals will not match the React/Radix versions.
- Native `<dialog>` and `<select>` behavior differs from Radix. Dark mode, tooltip, popover, and combobox components are not included.
- `components.md` is documentation only; changes to the linked shadcn docs do not update the app automatically.

## 14. Implementation order

1. Build `index.html` and `styles.css` with Indonesian copy, shadcn-inspired tokens, and vanilla components.
2. Add `app.js` configuration, API client, session handling, and login.
3. Add transaction CRUD, native dialogs, filters, toast feedback, and summary rendering.
4. Add `manifest.json`, `service-worker.js`, and generated icons.
5. Add `Code.gs` with setup, auth, CRUD, summary, and Indonesian errors.
6. Add self-checks and run the manual checklist.
7. Deliver each text file in a fenced code block with setup steps and limitations.

## 15. Deliverable format

- Each source file presented under its own heading in a fenced code block.
- Binary icons noted separately with the SVG source and generation approach.
- Short **Setup steps** section.
- Short **Known limitations** section.
- UI copy and backend errors in Bahasa Indonesia; currency in IDR.
- No NPM install or build step; only static HTML, CSS, JS, manifest, service worker, and Apps Script files.

# FinTrack — Pelacak Keuangan Pribadi (PWA)

Aplikasi pencatatan keuangan pribadi modern, ringan (*zero-dependency*), dan aman yang dirancang khusus dalam **Rupiah (IDR)** dan **Bahasa Indonesia**. Menggunakan **Google Apps Script** dan **Google Sheets** sebagai *serverless backend* gratis tanpa memerlukan server atau database berbayar.

Dapat diinstal langsung di Android, iOS, dan Desktop sebagai **Progressive Web App (PWA)** dengan kemampuan **Offline-First**.

---

## Fitur Utama

- **Pencatatan Keuangan (CRUD):** Catat pemasukan dan pengeluaran secara cepat dengan validasi bilangan bulat Rupiah (integer Rupiah).
- **Target Anggaran per Kategori (Budgeting):**
  - Tentukan batas pengeluaran bulanan untuk setiap kategori (misal: *Makanan: Rp 1.500.000*, *Transportasi: Rp 500.000*).
  - Indikator progres visual dengan status otomatis: **Aman (< 75%)**, **Waspada (75%–99%)**, dan **Melebihi Anggaran (≥ 100%)**.
  - Ringkasan total anggaran vs realisasi pengeluaran bulanan.
- **Visualisasi & Analisis Grafik (Zero-Dependency):**
  - **Grafik Tren 6 Bulan:** Perbandingan pemasukan (hijau) vs pengeluaran (merah) dalam diagram batang berbasis SVG murni yang responsif dan tajam.
  - **Grafik Donut Porsi Pengeluaran:** Diagram lingkaran proporsi pengeluaran per kategori beserta persentase dan legenda warna.
- **Pengalaman Offline Lanjutan (Offline-First):**
  - **Local Cache:** Riwayat transaksi otomatis dicadangkan di penyimpanan lokal perangkat sehingga tetap dapat dibuka meski tanpa koneksi internet.
  - **Antrean Mutasi Offline (Offline Queue):** Tetap dapat menambah, mengedit, atau menghapus transaksi saat offline.
  - **Sinkronisasi Otomatis:** Saat internet kembali aktif, antrean perubahan disinkronkan secara otomatis (*auto-sync*) ke Google Sheets dengan indikator status.
- **Filter Cepat (Quick Presets):** Pilihan 1-klik untuk *Semua*, *Bulan Ini*, *Bulan Lalu*, dan *30 Hari Terakhir*, serta filter rentang tanggal dan kategori.
- **Desain Modern (shadcn-inspired) & Dark Mode:**
  - Desain antarmuka bersih berbasis palet `oklch`.
  - Otomatis mendukung **Mode Gelap (Dark Mode)** mengikuti pengaturan sistem perangkat.
- **Keamanan & Privasi:**
  - Kata sandi di-hash server-side (*salted SHA-256*).
  - Token sesi stateless berbasis *HMAC-SHA256* berlaku 24 jam.
  - Isolasi data transaksi per akun pengguna.
  - Perlindungan terhadap Formula Injection pada spreadsheet dan XSS pada DOM.

---

## Struktur Berkas

```
fintrack/
├── icons/                  # Ikon aplikasi PWA (SVG, 180px, 192px, 512px)
├── .gitignore              # Konfigurasi file yang diabaikan Git
├── app.js                  # Frontend logic, state, offline queue, budgeting, charts, & tests
├── Code.gs                 # Backend Google Apps Script (Auth & Sheets database API)
├── index.html              # Antarmuka semantik, native dialogs, & SVG sprites
├── manifest.json           # Manifest PWA standalone
├── service-worker.js       # Service worker untuk caching app shell & navigasi offline
├── styles.css              # Desain token, dark mode, animasi, & styling responsif
├── PLAN.md                 # Rencana arsitektur dan dokumentasi teknis mendalam
└── README.md               # Panduan penggunaan dan instalasi
```

---

## Panduan Pemasangan (Setup Guide)

### 1. Siapkan Backend (Google Sheets & Apps Script)

1. Buka [Google Sheets](https://sheets.new) di Google Drive Anda, buat spreadsheet baru dengan nama **FinTrack**.
2. Buka menu **Ekstensi** > **Apps Script**.
3. Hapus kode bawaan di editor, lalu salin seluruh isi berkas [`Code.gs`](Code.gs).
4. Pilih fungsi `setup` di dropdown editor, lalu klik tombol **Jalankan (Run)**. Berikan izin akses Google ketika diminta.
5. Buat akun pertama Anda dengan menambahkan fungsi sementara di bagian bawah editor:
   ```javascript
   function buatAkunSaya() {
     createUser("username_anda", "kata_sandi_minimal_8_karakter");
   }
   ```
   Pilih `buatAkunSaya` dan klik **Jalankan**. Setelah selesai, Anda dapat menghapus fungsi sementara tersebut.
6. Klik **Terapkan (Deploy)** > **Penerapan Baru (New deployment)**:
   - Pilih jenis: **Aplikasi Web (Web app)**.
   - Jalankan sebagai (*Execute as*): **Saya (Me)**.
   - Yang memiliki akses (*Who has access*): **Siapa saja (Anyone)**.
   - Klik **Terapkan (Deploy)** dan salin URL Web App (`https://script.google.com/macros/s/.../exec`).

### 2. Hubungkan Frontend ke Backend

1. Buka berkas [`app.js`](app.js).
2. Ganti nilai `CONFIG.API_URL` pada baris ke-7 dengan URL Web App yang Anda salin:
   ```javascript
   const CONFIG = {
     API_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
     ...
   };
   ```

### 3. Pengujian Lokal

Jalankan web server lokal di folder proyek:
```bash
# Menggunakan Python
python -m http.server 8000

# Atau menggunakan Node / npx
npx serve
```
Buka browser di `http://localhost:8000` (atau tambahkan `?selftest=1` untuk menjalankan uji logika otomatis).

---

## Cara Publikasi ke GitHub Pages (Gratis)

1. Buat repositori baru di GitHub (misal: `fintrack`).
2. Hubungkan repositori lokal dan unggah kode:
   ```bash
   git remote add origin https://github.com/USERNAME/fintrack.git
   git branch -M main
   git push -u origin main
   ```
3. Buka repositori di GitHub > **Settings** > **Pages**.
4. Pada bagian **Build and deployment**:
   - Source: **Deploy from a branch**.
   - Branch: `main`, folder: `/ (root)`.
   - Klik **Save**.
5. Tunggu 1–2 menit, FinTrack Anda siap diakses melalui URL HTTPS `https://USERNAME.github.io/fintrack/`.

---

## Lisensi

Didistribusikan untuk penggunaan pribadi dan proyek terbuka.

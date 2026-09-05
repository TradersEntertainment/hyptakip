# ⚡ HYPTAKIP - Hyperliquid Balina & Pozisyon Takip Sistemi

Hyperliquid üzerindeki balina ve trader cüzdanlarını 7/24 gerçek zamanlı izleyen, yeni pozisyon açılışlarında, pozisyon boyutu **%10'dan fazla** değiştiğinde ve pozisyon kapanışlarında Telegram'a anlık zengin bildirimler ileten modern, siberpunk neon tasarımlı web uygulaması ve takip botu.

Varsayılan olarak **`0x3b9e9c9f82eb1C321535FD2Bc48d8DB9E8E8c503`** cüzdanı takipte başlar. Web arayüzü üzerinden dilediğiniz kadar yeni cüzdan ekleyebilir, her cüzdana özel Telegram Chat ID ve % değişim eşiği belirleyebilirsiniz.

---

## 🌟 Öne Çıkan Özellikler

- 🎯 **Kolay Cüzdan Ekleme & Yönetimi**:
  - Balina Lakabı / Adı, Hyperliquid cüzdan adresi (`0x...`), opsiyonel Telegram Chat ID ve % değişim eşiği belirleme.
- ⚡ **Akıllı Pozisyon Takip Motoru**:
  - **Yeni Pozisyon Açılışı**: Parite, Yön (🟢 LONG / 🔴 SHORT), Giriş Fiyatı, Büyüklük, Kaldıraç ve Teminat ile anında bildirim.
  - **%10+ Pozisyon Boyutu Değişimi**: Balina pozisyona ekleme yaptığında veya kısmi kâr aldığında önceki boyut vs yeni boyut karşılaştırmalı bildirim.
  - **Pozisyon Kapanışı**: Tamamen kapatılan pozisyonlar için anlık kapanış ve realized kâr/zarar uyarısı.
  - **Likidasyon Riski Uyarıları**: Fiyat likidasyona yaklaştığında acil durum bildirimi.
- 🖥️ **Zengin Dashboard & Analiz Arayüzü**:
  - **Aktif Pozisyonlar Tablosu**: Coin rozetleri, Giriş vs Mark Fiyatı, $ PnL ve % ROE, Likidasyon mesafesi, Kaldıraç ve Teminat.
  - **Hesap Özeti**: Toplam Kasa (Account Value), Kullanılan Teminat, Çekilebilir Serbest Bakiye ve Toplam Açık Pozisyon Büyüklüğü.
  - **Son İşlemler (Trade Fills)**: Balinanın son alım, satım ve kapatma hareketlerinin canlı dökümü.
  - **Bildirim Geçmişi (Live Alert Feed)**: Tetiklenen tüm bildirimlerin canlı akışı ve logları.
- 🤖 **Entegre Telegram Bot Ayarları**:
  - Web arayüzünden doğrudan Bot Token ve Chat ID girme.
  - Tek tıkla **"Test Bildirimi Gönder"** özelliği.
- 💾 **Railway Kalıcı Hafıza (Persistent Volume)**:
  - SQLite veritabanı `DATA_DIR` üzerinden yönetilir. Railway üzerinde `/data` dizinine volume bağlandığında deploys veya yeniden başlatmalarda verileriniz asla silinmez!

---

## 🚀 Hızlı Başlangıç (Yerel Kurulum)

### Gereksinimler
- Node.js 18+ veya Node.js 24
- npm

### 1. Bağımlılıkları Yükleyin
```bash
npm install
```

### 2. Çevre Değişkenleri (Opsiyonel)
`.env.example` dosyasını `.env` olarak kopyalayabilir veya doğrudan arayüzdeki Ayarlar penceresinden tanımlayabilirsiniz:
```bash
cp .env.example .env
```

### 3. Uygulamayı Başlatın
```bash
npm start
```
Tarayıcınızda açın: **`http://localhost:3000`**

---

## 🤖 Telegram Bot Kurulumu (Adım Adım)

1. Telegram'da **`@BotFather`** botunu açın ve `/newbot` komutu verin.
2. Botunuz için bir isim ve kullanıcı adı belirleyin. Size verilen **API Token**'ı kopyalayın.
3. Bildirimleri almak istediğiniz bir Telegram grubu açın veya botu özel sohbete ekleyin.
4. Botu gruba ekleyip yönetici (admin) yapın.
5. Grubun Chat ID'sini öğrenmek için bota bir mesaj atıp `https://api.telegram.org/bot<TOKEN>/getUpdates` linkini açın veya `@userinfobot` / `@RawDataBot` kullanın (Grup ID'leri genellikle `-100...` ile başlar).
6. Sitede sağ üstteki **"Ayarlar"** butonuna tıklayın, Token ve Chat ID'nizi yapıştırıp **"Test Bildirimi Gönder"** butonuna basın!

---

## 🚂 Railway Dağıtımı & Kalıcı Hafıza (Persistent Volume)

Bu proje Railway üzerinde sıfır yapılandırmayla çalışacak şekilde `Dockerfile` ve `railway.json` ile hazırlanmıştır.

### Adım Adım Railway Kurulumu:
1. [Railway.app](https://railway.app) hesabınıza gidin ve **"New Project"** -> **"Deploy from GitHub repo"** seçeneğini seçin.
2. `TradersEntertainment/hyptakip` reposunu seçin.
3. Servis oluştuktan sonra servisin **"Settings"** sekmesine gidin.
4. **"Volumes"** bölümünden **"Add Volume"** butonuna tıklayın:
   - **Mount Path**: `/data` olarak ayarlayın.
5. **"Variables"** sekmesinden şu ortam değişkenlerini ekleyebilirsiniz (veya site açılınca web arayüzünden kaydedebilirsiniz):
   - `DATA_DIR`: `/data`
   - `TELEGRAM_BOT_TOKEN`: `bot_tokeniniz`
   - `TELEGRAM_DEFAULT_CHAT_ID`: `chat_id_niz`
   - `POLL_INTERVAL_SECONDS`: `5`
6. **"Networking"** sekmesinden **"Generate Domain"** diyerek canlı web adresinizi alın.

> [!IMPORTANT]
> `/data` dizinine bağlanan Volume sayesinde sunucuyu yeniden başlatsanız veya yeni bir commit pushlasanız dahi eklediğiniz tüm cüzdanlar, özelleştirilmiş eşikler ve bildirim logları eksiksiz korunur.

---

## 🔗 Takip Edilen Varsayılan Balina

- **Adres:** `0x3b9e9c9f82eb1C321535FD2Bc48d8DB9E8E8c503`
- **Hyperdash:** [https://hyperdash.com/address/0x3b9e9c9f82eb1C321535FD2Bc48d8DB9E8E8c503](https://hyperdash.com/address/0x3b9e9c9f82eb1C321535FD2Bc48d8DB9E8E8c503)

---

## 🛠️ REST API Endpoints

- `GET /api/wallets` - Takip edilen tüm cüzdanlar ve anlık durumları
- `POST /api/wallets` - Yeni balina cüzdanı ekle
- `PUT /api/wallets/:address` - Cüzdan lakabı, eşik % ve ayarlarını güncelle
- `DELETE /api/wallets/:address` - Cüzdanı takipten çıkar
- `GET /api/wallets/:address/state` - Canlı Hyperliquid clearinghouse state
- `GET /api/wallets/:address/fills` - Son alım/satım/kapatma geçmişi
- `GET /api/alerts` - Tetiklenen bildirim geçmişi
- `POST /api/settings` - Bot token ve sistem ayarlarını kaydet
- `POST /api/settings/test-telegram` - Telegram bağlantısını test et
- `POST /api/tracker/trigger` - Anlık manuel tarama tetikle
- `GET /health` - Sağlık durumu ve çalışma süresi

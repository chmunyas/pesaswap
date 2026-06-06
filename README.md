<p align="center">
  <img src="frontend/public/pwa-512.png" alt="PESASWAP" width="120" height="120">
</p>

<h1 align="center">PESASWAP</h1>

<p align="center">
  <strong>A modern, mobile-first Point of Sale platform for Africa.</strong><br>
  Tap & Go QR payments · Kitchen Display · Co-op BNPL · Loyalty · Real-time orders · AI insights · Offline-first PWA
</p>

<p align="center">
  Built on top of <a href="https://github.com/opensourcepos/opensourcepos">Open Source Point of Sale</a> ·
  React 19 · Vite 8 · Tailwind 4 · TypeScript · PHP 8.2 · CodeIgniter 4 · MariaDB
</p>

<p align="center">
  <a href="#-screenshots">Screenshots</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-quick-start">Quick start</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="#-credits">Credits</a>
</p>

---

## ✨ Why PESASWAP?

PESASWAP takes the proven OSPOS PHP backend (sales, customers, items, employees, gift cards, tax, reporting — battle-tested over a decade) and pairs it with a brand-new mobile-first React frontend purpose-built for African retail and hospitality:

- 📱 **Customer scans, customer pays.** Tap & Go QR flow from scan → PIN/biometric → "ka-ching" in under 8 seconds.
- 🍳 **Real-time Kitchen Display.** Orders flow from customer's phone → KDS bell + visual ticket. Bar-only display via `/bar`.
- 🚨 **Walkout alerts.** Tables open > 2h with no payment auto-flag for staff intervention.
- 💳 **Co-op Bank BNPL.** National ID → eligibility → OTP → installment plan, all in the same `/pay` flow.
- 🎯 **Loyalty tiers.** Bronze/Silver/Gold/Platinum auto-computed from lifetime spend, displayed inline.
- 🤖 **Proactive AI insights.** Revenue forecast, peak hour, anomaly detection, churn risk — without an LLM bill.
- 🌍 **3 languages.** English, Kiswahili, French (navigator.language autodetect).
- 🔌 **Offline-first PWA.** Installable on iOS & Android. `/menu/:tableId` works without network after first visit.
- 📅 **Reservations.** Today / Upcoming / Past sections with seat / no-show / cancel actions.
- 💱 **FX converter.** 7 currencies, 5 providers, best-rate selection (demo rates).

---

## 📸 Screenshots

### Desktop (back-office)

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/02-dashboard.png" alt="Dashboard with AI insight" width="100%"><br><sub><b>Dashboard</b> — sales/revenue snapshot with proactive AI insight</sub></td>
    <td align="center"><img src="docs/screenshots/04-kds.png" alt="Kitchen Display with walkout alert" width="100%"><br><sub><b>Kitchen Display</b> — live order queue + walkout-risk banner</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/05-customers.png" alt="Customers with loyalty tiers" width="100%"><br><sub><b>Customers</b> — Bronze/Silver/Gold/Platinum tier badges</sub></td>
    <td align="center"><img src="docs/screenshots/06-reservations.png" alt="Reservations" width="100%"><br><sub><b>Reservations</b> — today/upcoming/past with status actions</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/08-fx.png" alt="FX Converter" width="100%"><br><sub><b>FX Converter</b> — multi-currency + provider best-rate</sub></td>
    <td align="center"><img src="docs/screenshots/09-payment-summary.png" alt="Payment method summary" width="100%"><br><sub><b>Payment Summary</b> — per-method breakdown, 7-day trend</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/10-ai-insights.png" alt="AI insights cards" width="100%"><br><sub><b>AI Assistant</b> — forecast, peak hour, anomaly, churn cards + chat</sub></td>
    <td align="center"><img src="docs/screenshots/11-qr-hub.png" alt="QR Hub" width="100%"><br><sub><b>QR Hub</b> — generate QR codes for tables, invoices, payments</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/07-invoices.png" alt="Invoice creator" width="100%"><br><sub><b>Invoices</b> — multi-currency invoice creator with FX</sub></td>
    <td align="center"><img src="docs/screenshots/12-mobile-preview.png" alt="Mobile preview" width="100%"><br><sub><b>Mobile Preview</b> — desktop demo of public pages in a phone frame</sub></td>
  </tr>
</table>

### Gift Cards — WeChat-parity modernization

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/15-giftcards-list.png" alt="Gift card list with design strips + linked badges" width="100%"><br><sub><b>Gift Cards list</b> — gradient design strips, "M-Pesa ••• 1111" / "Airtel ••• 3333" linked-phone badges, "Transfer pending" + "Sends DATE" pills, Manage / Link / Gift / Disable actions</sub></td>
    <td align="center"><img src="docs/screenshots/16-giftcards-create.png" alt="Issue gift card modal" width="100%"><br><sub><b>Issue Gift Card</b> — design picker (6 templates) + preset KES denomination chips + optional scheduled delivery</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/17-giftcards-detail.png" alt="Gift card detail with linked-phone panel" width="100%"><br><sub><b>Gift card detail</b> — linked-phone panel + pending-transfer freeze + QR + audit history + 5-button actions row (Redeem / Top-up / Refund / Adjust / Send as gift)</sub></td>
    <td align="center"><img src="docs/screenshots/27-giftcards-bind-modal.png" alt="Bind card to phone modal" width="100%"><br><sub><b>Bind to phone</b> — cashier picks the customer's MNO (M-Pesa / Airtel / MTN MoMo); STK push fires to the customer's handset for PIN authorisation</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/24-public-giftcard-transfer.png" alt="Public accept-a-gift page" width="100%"><br><sub><b>/giftcard/transfer/:token</b> — public accept page (no auth). Accepts the gift → server rotates the code, sender's copy stops working.</sub></td>
    <td align="center"><img src="docs/screenshots/18-giftcards-designs.png" alt="Gift card designs admin" width="100%"><br><sub><b>Designs admin</b> — CRUD gradient templates seeded with Classic/Sunset/Forest/Birthday/Holiday/Wedding</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/19-giftcards-denominations.png" alt="Gift card denominations admin" width="100%"><br><sub><b>Denominations admin</b> — preset amounts per currency, snapshotted onto issued cards so later edits don't rewrite history</sub></td>
    <td align="center"><img src="docs/screenshots/28-giftcards-tender-scan.png" alt="Tender demo — scan card" width="100%"><br><sub><b>Tender Demo — Scan card</b> — cashier scans an NFC card or searches by code, or skips for a bearer payment</sub></td>
  </tr>
</table>

### Gift Cards — multi-tender flow (NFC binding + STK push + wallet + Co-op + BNPL)

<table>
  <tr>
    <td align="center" width="55%"><img src="docs/screenshots/29-giftcards-tender-picker.png" alt="Tender Picker with multiple sources" width="100%"><br><sub><b>Tender Picker</b> — once a card is scanned, the picker lists card balance, the customer's bound MNO (default ★), other MNOs, PESASWAP Wallet, Co-op direct debit and Co-op BNPL — each gated by sufficiency and customer context. On selection: live <code>pending → awaiting_pin → completed</code> status pill with cancel.</sub></td>
    <td align="center" width="22%"><img src="docs/screenshots/31-public-giftcard-self-service.png" alt="Customer self-service portal (linked)" width="100%"><br><sub><b>/giftcard/:code/self-service</b> (linked) — customer manages their card from any mobile browser: balance, recent activity, Unlink (OTP-gated), Disable (Danger Zone, OTP-gated)</sub></td>
    <td align="center" width="22%"><img src="docs/screenshots/32-public-giftcard-self-service-link.png" alt="Customer self-service portal (unlinked)" width="100%"><br><sub><b>/giftcard/:code/self-service</b> (unlinked) — link-my-phone flow: enter number, pick provider, authorise via STK PIN</sub></td>
  </tr>
</table>

### Office — Cashups & Expenses

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/25-cashups.png" alt="Cashups lifecycle" width="100%"><br><sub><b>Cashups</b> — open-till / close-till lifecycle. Live "expected cash" from real sales/refunds/expenses; advisory <code>GET_LOCK</code> prevents two terminals opening a shift at once.</sub></td>
    <td align="center"><img src="docs/screenshots/26-expenses.png" alt="Expenses" width="100%"><br><sub><b>Expenses</b> — date / category / payment-type / employee with monthly total banner.</sub></td>
  </tr>
</table>

### Gift Cards — end-to-end use cases

Each PNG is a single-page walk-through with step-by-step instructions, embedded screenshots, the API routes involved, and the commit history.

**June 2026 redesign** (Ive ⊕ WeChat principles): the cashier flow collapsed from 7 sections to **3 visible fields + a single "More options" disclosure**. NFC binding folded into issue (one button instead of two), the recipient now lands on a **/g/:code/welcome ceremony page** (1.5s gradient reveal + payment chime), the public balance page has **tap-to-show-cashier full-screen QR** plus **Apple Wallet (.pkpass) + Google Wallet (giftCardObject) passes**, gift cards have **human-readable names** (`Bob → Alice · KES 1,000`), and transfer tokens are now **6-word memorable phrases** (`coral-music-river-jet-vivid-mango`) instead of 32-hex strings.

<p align="center">
  <a href="docs/use-cases/00-overview.png"><img src="docs/use-cases/00-overview.png" alt="Gift cards — end-to-end overview (Issue → Deliver → Hold → Spend → Re-gift → Protect)" width="100%"></a><br>
  <sub><b>The full journey on one page</b> — six phases (Issue → Deliver → Hold → Spend → Re-gift → Protect), three principals (cashier · recipient · cashier+recipient), one screen each. Click for full resolution.</sub>
</p>

<table>
  <tr>
    <td align="center" width="25%"><a href="docs/use-cases/01-issuance.png"><img src="docs/use-cases/01-issuance.png" alt="Use case 1 — Send a gift" width="100%"></a><br><sub><b>1. Send a gift</b> — 3-field form, optional "More" disclosure, inline phone link</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/02-binding.png"><img src="docs/use-cases/02-binding.png" alt="Use case 2 — NFC binding" width="100%"></a><br><sub><b>2. NFC binding</b> — usually folded into issue, available standalone for unbound cards</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/03-redemption.png"><img src="docs/use-cases/03-redemption.png" alt="Use case 3 — Multi-tender redemption" width="100%"></a><br><sub><b>3. Multi-tender redemption</b> — card balance / MNO / wallet / Co-op / BNPL picker with live intent status</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/04-transfer.png"><img src="docs/use-cases/04-transfer.png" alt="Use case 4 — Give-to-friend" width="100%"></a><br><sub><b>4. Give-to-friend</b> — 6-word memorable phrase replaces 32-hex token, code rotates on accept</sub></td>
  </tr>
  <tr>
    <td align="center" width="25%"><a href="docs/use-cases/05-self-service.png"><img src="docs/use-cases/05-self-service.png" alt="Use case 5 — Customer self-service" width="100%"></a><br><sub><b>5. Self-service portal</b> — small ⚙ gear icon entry, OTP-gated unbind + disable kill-switch</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/06-scheduled-delivery.png"><img src="docs/use-cases/06-scheduled-delivery.png" alt="Use case 6 — Scheduled delivery" width="100%"></a><br><sub><b>6. Scheduled delivery</b> — issue today, email delivers later via spark cron</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/07-balance-lookup.png"><img src="docs/use-cases/07-balance-lookup.png" alt="Use case 7 — Balance + show-to-cashier" width="100%"></a><br><sub><b>7. Balance + show-to-cashier</b> — tap QR for full-screen overlay, inverted scan flow</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/08-legacy-pos-guard.png"><img src="docs/use-cases/08-legacy-pos-guard.png" alt="Use case 8 — Legacy POS guard" width="100%"></a><br><sub><b>8. Legacy POS guard</b> — bound cards refuse raw-code redemption (defence-in-depth)</sub></td>
  </tr>
  <tr>
    <td align="center" width="25%"><a href="docs/use-cases/09-recipient-ceremony.png"><img src="docs/use-cases/09-recipient-ceremony.png" alt="Use case 9 — Recipient ceremony" width="100%"></a><br><sub><b>9. Recipient ceremony</b> ✨ — <code>/g/:code/welcome</code> envelope reveal + chime + "Keep it" CTA</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/10-wallet-passes.png"><img src="docs/use-cases/10-wallet-passes.png" alt="Use case 10 — Wallet passes" width="100%"></a><br><sub><b>10. Wallet passes</b> ✨ — Apple <code>storeCard</code> + Google <code>giftCardObject</code>, reuses ticket cert pipeline</sub></td>
    <td align="center" width="25%"><a href="docs/use-cases/11-my-gifts.png"><img src="docs/use-cases/11-my-gifts.png" alt="Use case 11 — My Gifts" width="100%"></a><br><sub><b>11. My Gifts</b> ✨ <em>new</em> — <code>/my-gifts</code> OTP-gated roll-up of all cards bound to your phone</sub></td>
    <td></td>
  </tr>
</table>

### Tickets — operations

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/40-tickets-products.png" alt="Ticket products" width="100%"><br><sub><b>Tickets</b> — products + sessions + tiers (meeting / scenic / movie / transport subtypes)</sub></td>
    <td align="center"><img src="docs/screenshots/44-tickets-dashboard.png" alt="Tickets gate dashboard" width="100%"><br><sub><b>Gate Dashboard</b> — live redemptions + no-shows + per-scanner stats</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/42-tickets-redeem.png" alt="Ticket redemption" width="100%"><br><sub><b>Ticket redemption</b> — JWT-signed QR, single-use enforcement, per-device scanner audit</sub></td>
    <td align="center"><img src="docs/screenshots/43-public-ticket.png" alt="Public ticket page" width="100%"><br><sub><b>/t/:code</b> — customer ticket page (Apple/Google Wallet passes + ICS calendar)</sub></td>
  </tr>
</table>

### Mobile (customer-facing, public, PWA-installable)

<table>
  <tr>
    <td align="center" width="25%"><img src="docs/screenshots/20-pay-scanned.png" alt="Tap & Go pay" width="100%"><br><sub><b>/pay</b> — Tap & Go scan flow</sub></td>
    <td align="center" width="25%"><img src="docs/screenshots/21-menu.png" alt="Customer menu" width="100%"><br><sub><b>/menu/:tableId</b> — browse menu, add to cart, send to kitchen</sub></td>
    <td align="center" width="25%"><img src="docs/screenshots/23-table-bill.png" alt="Table bill" width="100%"><br><sub><b>/t/:tableId</b> — split, tip, pay your bill</sub></td>
    <td align="center" width="25%"><img src="docs/screenshots/22-reset-pin.png" alt="Reset PIN" width="100%"><br><sub><b>/reset-pin</b> — SMS code → new PIN</sub></td>
  </tr>
</table>

---

## 🚀 Quick start

```bash
git clone https://github.com/chmunyas/pesaswap.git
cd pesaswap

# 1. Backend (PHP/CodeIgniter via Docker) — composer runs automatically on first boot
export USERID=$(id -u) GROUPID=$(id -g)
docker compose -f docker-compose.dev.yml up -d

# 2. Frontend (Vite dev server with /api proxy → :80)
cd frontend
npm install
npm run dev

# 3. Open http://localhost:5173 and sign in as
#    Username: admin   Password: PointOfSale
```

The Vite dev server proxies `/api/*` to the OSPOS backend at `http://localhost:80`, so login, customers, sales — everything works out of the box.

### Demo flow (under 30 seconds)

1. Sign in as `admin` / `PointOfSale`.
2. Open `/kds` in one tab (Kitchen Display).
3. Open `/menu/5` in another tab — a customer at Table 5.
4. Add a burger and a Tusker, tap **Send to kitchen** — the KDS tab beeps and shows the ticket instantly.

For the BNPL flow: go to `/pay`, click the demo scanner, then **Pay later with Co-op Bank**. Use National ID `12345678`, OTP `1234`.

---

## ✨ Features

### Customer-facing (public, no auth, PWA installable)

| Route | What it does |
|-------|-------------|
| `/pay` | Tap & Go QR scan → phone → PIN/biometric → success. Or "Pay later" → Co-op BNPL. |
| `/menu/:tableId` | Browse the venue menu, add items, send order to kitchen. Works offline. |
| `/t/:tableId` | View your table bill — split, tip, pay, or "Send order to kitchen". |
| `/reset-pin` | 6-digit SMS code → new 4-digit PIN. |
| `/preview/*` | Desktop demo: any public mobile route inside a phone frame. |

### Back-office (authenticated)

| Group | Routes |
|-------|--------|
| **Main** | Dashboard · POS · Sales · Items · Item Kits · Customers · Suppliers · Receivings · Gift Cards · QR Codes · Kitchen Display · Bar Display · Reservations |
| **Office** | Invoices · Payment Summary · FX Converter · Expenses · Cashups · Reports · Messages · Settings |
| **AI** | Mobile Preview · AI Assistant |

### Realtime + i18n + audio

- **BroadcastChannel order bus** — `submitNewOrder()` from any tab fans out to all KDS tabs in the same browser. Cross-device requires WebSocket/SSE (out of scope; future Tier 4).
- **Audio cues** — ka-ching on payment success, beep on new kitchen order, urgent triple-beep on walkout alert.
- **i18n** — `useI18n()` provider, EN/SW/FR strings, footer language toggle.

### PWA

- **`registerType: 'prompt'`** — busy POS/KDS shifts choose when to apply a new SW version (no silent updates mid-transaction).
- **Workbox precache** — all 28 lazy chunks + CSS + manifest + icons (~1.1 MB). Means `/menu/:tableId`, `/`, `/login`, `/pay`, `/reset-pin` all render fully offline after one warm visit.
- **Runtime caching** — `/api/public/menu/*` (1h NetworkFirst, 200s only) and `/api/dashboard/stats` (5min NetworkFirst, 200s only). Authenticated caches are purged on logout (`clearAuthenticatedCaches()`).
- **iOS + Android install** — `beforeinstallprompt` for Chromium; "Tap Share → Add to Home Screen" instructions for iOS Safari.
- **Maskable icon** — 512×512 with ~20% safe-zone padding so Android doesn't crop the mark.

Verified offline by automated smoke test (`scripts/pwa-offline-test.mjs`): all 5 critical routes render after `setOffline(true)`.

---

## 🏗 Architecture

```
chmunyas/pesaswap
├── app/                      # CodeIgniter 4 — preserved from upstream OSPOS
│   ├── Controllers/Api/      # NEW — 18 JSON API controllers
│   │   ├── BaseApiController.php       # shared auth + JSON envelope + CORS
│   │   ├── AuthController.php          # session-cookie login/logout/me
│   │   ├── PublicController.php        # NEW — customer-safe /api/public/menu/:tableId
│   │   ├── DashboardController.php
│   │   ├── ItemsController.php / CustomersController.php / ...
│   │   └── ...
│   ├── Config/Routes.php     # /api/* group mounted
│   ├── Config/Filters.php    # CSRF bypassed for /api/* (session-cookie + CORS)
│   └── Models/               # preserved from OSPOS (Sale, Customer, Item, ...)
│
├── frontend/                 # NEW — React 19 + Vite 8 + Tailwind 4 SPA
│   ├── src/
│   │   ├── App.tsx           # all routes lazy-loaded, PWA prompts mounted
│   │   ├── pages/            # 28 page components (lazy)
│   │   ├── components/
│   │   │   ├── ai/InsightsCards.tsx          # forecast/peak/anomaly/churn
│   │   │   ├── bnpl/BnplCheckout.tsx         # Co-op Bank BNPL
│   │   │   ├── menu/CustomerMenuList.tsx     # customer-facing menu
│   │   │   ├── pwa/InstallPrompt.tsx         # iOS + Android install
│   │   │   ├── pwa/OfflineIndicator.tsx
│   │   │   ├── pwa/UpdatePrompt.tsx
│   │   │   ├── dev/PhoneFrame.tsx            # /preview/:path
│   │   │   └── layout/, ui/, qr/, pos/, dashboard/
│   │   ├── lib/
│   │   │   ├── api.ts        # typed fetch wrapper, credentials: include
│   │   │   ├── realtime.ts   # BroadcastChannel bus + audio cues
│   │   │   ├── i18n.tsx      # EN/SW/FR provider
│   │   │   ├── loyalty.ts    # Bronze/Silver/Gold/Platinum
│   │   │   ├── coop-bnpl.ts  # mock BNPL backend (localStorage)
│   │   │   ├── walkout.ts    # walkout-risk evaluator + persistence
│   │   │   ├── pwa.ts        # SW registration + cache management
│   │   │   └── utils.ts
│   │   ├── hooks/            # useAuth, useTheme, useIsMobile
│   │   └── types/
│   ├── public/               # PWA icons (192/512/maskable + apple-touch)
│   ├── scripts/generate-icons.mjs       # programmatic icon generation
│   └── vite.config.ts        # vite-plugin-pwa + Workbox config
│
├── docker/dev-entrypoint.sh  # NEW — auto-`composer install` on first boot
├── Dockerfile                # MODIFIED — bakes composer install
├── docker-compose.dev.yml    # MariaDB + ospos_dev (port 80)
└── docs/screenshots/         # this README's images
```

### Why this split

- **OSPOS PHP models stay as-is.** Battle-tested, supports MySQL/MariaDB migrations, has a decade of bug fixes around tax/reporting/sales. We don't reinvent any of that.
- **Thin JSON API layer.** 18 controllers under `App\Controllers\Api\`. Session-cookie auth (no JWT to manage). Response envelope `{success, data, message}`.
- **React SPA on top.** Mobile-first by default. Public routes (`/pay`, `/menu/:tableId`, `/t/:tableId`, `/reset-pin`) live outside the auth gate so customers can use them via QR scan.
- **PWA where it counts.** The customer menu MUST work offline (poor connectivity is normal at table 7); the merchant dashboard SHOULD work briefly offline (network hiccups during service).

---

## 🧪 Development

```bash
# Frontend
cd frontend
npm run dev          # Vite dev server on :5173, proxies /api to :80
npm run build        # Production build with PWA service worker
npm run preview      # Preview the production build on :4173
npm run lint         # ESLint
npx tsc -b --noEmit  # TypeScript check

# Re-generate PWA icons (if you change the brand colors / mark)
node scripts/generate-icons.mjs

# Backend
docker compose -f docker-compose.dev.yml up -d
docker compose -f docker-compose.dev.yml logs -f ospos_dev
docker exec ospos_dev composer test    # PHPUnit (when present)
docker exec ospos_dev composer install # if you need to rerun composer
```

### Demo data

The first time the dev container starts, the entrypoint runs `composer install` (this takes ~60s). Once vendor/ exists on the host bind-mount, subsequent container restarts skip the install. The MariaDB volume persists; default OSPOS demo data is loaded on first migration.

To reset to demo data:
```bash
docker compose -f docker-compose.dev.yml down -v
docker compose -f docker-compose.dev.yml up -d
```

---

## 🛡 Known limitations

- **Real-time KDS is per-browser-profile.** The `BroadcastChannel` order bus is in-browser only. Cross-device live orders need a backend WebSocket/SSE layer — planned for Tier 4.
- **BNPL is a client-side mock.** No real Co-op Bank API integration; eligibility/OTP/transactions live in localStorage (`pesaswap.bnpl.*`).
- **AI insights are heuristics, not LLM.** Revenue forecast = trailing 7-day average × drift; peak hour = today's sales bucketed by hour; anomaly = today vs baseline ±25%; churn = customers with `last_visit > 30d ago`. No external AI call.
- **FX rates are static demo data.** Marked "Demo rates · not live quotes" in the UI.
- **Payment Method Summary is NOT bank reconciliation.** It groups OSPOS sales by `payment_type` — true reconciliation needs M-Pesa/Airtel/KCB statement imports.
- **Reservations storage is per-device.** localStorage only; no backend table yet (OSPOS doesn't ship one).
- **PIN reset never persists the PIN.** It's a demo flow; only a benign reset counter is stored.
- **Public `/api/public/menu/:tableId`** returns the same item catalogue regardless of `tableId` in this v1. Multi-tenant scoping would resolve tableId → merchant_id and filter accordingly.

---

## 🙏 Credits

PESASWAP stands on the shoulders of giants:

- **[Open Source Point of Sale (OSPOS)](https://github.com/opensourcepos/opensourcepos)** — the entire PHP/CodeIgniter backend, models, schema, and business logic. PESASWAP is a frontend modernization + thin API layer over OSPOS, not a from-scratch rewrite. Huge thanks to the OSPOS maintainers (Jekkos and contributors) for a decade of work.
- **[chmunyas/merchantApp](https://github.com/chmunyas/merchantApp)** — patterns adapted (with attribution in source files) for: BroadcastChannel order bus, audio cues, i18n provider, BNPL flow + `coop-bnpl.ts`, `CustomerMenuList`, `AIInsightsView` 4-card layout, `WalletReconciliationView` styling, `PhoneFrame`, `QuickExchange`, `ProviderComparison`.
- **[shadcn/ui](https://ui.shadcn.com/)** — design patterns borrowed; PESASWAP uses plain Tailwind primitives instead of shadcn components to keep the dependency footprint small.
- **[Lucide](https://lucide.dev/)** — every icon you see.
- **[Recharts](https://recharts.org/)** — dashboard charting.

The original upstream OSPOS README is preserved at [`README.ospos.md`](README.ospos.md).

---

## 📜 License

This project inherits the **GPL-3.0** license from upstream OSPOS. See [`LICENSE`](LICENSE).

---

<p align="center">
  <sub>Built with 🇰🇪 in mind. Modern Africa deserves modern POS.</sub>
</p>

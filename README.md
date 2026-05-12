# TripCast

Multi-model trip weather forecasts in a single horizontal view. Built as a static site — no backend, no accounts, no tracking.

**Stack:** Plain HTML/CSS/JS · Open-Meteo API (free, no key) · Cloudflare Pages hosting

## Local preview

```bash
# any static server works
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to Cloudflare Pages

### 1. Push to GitHub
```bash
cd tripcast
git init
git add .
git commit -m "Initial TripCast"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/tripcast.git
git push -u origin main
```

### 2. Connect to Cloudflare Pages
1. Go to https://dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git
2. Authorize GitHub, pick the `tripcast` repo
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave empty)*
   - **Build output directory:** `/`
4. Click **Save and Deploy**

You'll get a URL like `tripcast-xyz.pages.dev`.

### 3. Custom domain
1. Buy a domain (Cloudflare Registrar, Namecheap, etc.). Cloudflare Registrar sells at cost — usually cheapest.
2. In Cloudflare Pages → your project → Custom domains → Set up a custom domain.
3. If the domain is on Cloudflare already, it auto-configures. If not, follow the DNS instructions shown.

## How it works

1. User enters trip legs (city + date range each)
2. Geocoding via Open-Meteo's free geocoder
3. For each unique location, fetch 6 models (ECMWF, GFS, ICON, GEM, JMA, UKMO) in one API call
4. Compute ensemble mean for hi/lo/precip, mode for weather code
5. Confidence dot based on spread across models (high < 2.5°C, med < 5°C, low ≥ 5°C)
6. Render horizontal scrolling card per day
7. Trip params encoded in URL for sharing

## Files

- `index.html` — markup + inline SVG icon defs
- `styles.css` — all styling
- `app.js` — everything else (~350 lines)
- `README.md` — this file

## Limits & notes

- Open-Meteo free tier: 10,000 calls/day. You won't hit it.
- Forecast horizon: ~16 days max via Open-Meteo. Past 7 days, skill drops considerably.
- No PWA / offline support in v1 — could add a manifest + service worker later.
- License: Open-Meteo free tier is non-commercial. Don't monetize without their commercial plan.

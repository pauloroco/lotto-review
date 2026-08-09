# Deploying Lotto Review to pausystems.com

## Project structure
```
lotto-review-pwa/
  index.html          ← the app (all game logic, UI, intro video, embedded)
  manifest.json        ← PWA manifest (name, icons, colors)
  sw.js                 ← service worker (enables install + offline)
  icons/
    icon-192.png
    icon-512.png
    icon-512-maskable.png
    apple-touch-icon.png
```

## 1. Push to GitHub
1. Create a new repo, e.g. `lotto-review` under your GitHub account.
2. Push this folder's contents to the repo root (index.html, manifest.json, sw.js, icons/ — no subfolder wrapping).

```bash
cd lotto-review-pwa
git init
git add .
git commit -m "Lotto Review PWA — initial deploy"
git branch -M main
git remote add origin https://github.com/<your-username>/lotto-review.git
git push -u origin main
```

## 2. Connect to Cloudflare Pages
1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.
2. Select the `lotto-review` repo.
3. Build settings: **Framework preset = None**, **Build command = (leave blank)**, **Build output directory = /** (root — since index.html sits at the repo root).
4. Deploy. Cloudflare will give you a working `*.pages.dev` URL immediately — good for testing before the subdomain is wired up.

## 3. Add the subdomain (lottoreview.pausystems.com)
Since pausystems.com's DNS is already on Cloudflare (via Cloudflare Registrar):
1. In the Pages project → **Custom domains** → **Set up a custom domain**.
2. Enter `lottoreview.pausystems.com`.
3. Cloudflare auto-creates the CNAME record since the zone is already on your account — no manual DNS editing needed.
4. SSL is automatic (Cloudflare-managed certificate). Usually live within a few minutes.

## 4. Link it from your portfolio
On pausystems.com's portfolio page, add a project card/link pointing to `https://lottoreview.pausystems.com`.

## 5. Verify installability
Once live on the real domain (HTTPS required — won't work on `file://`):
- **Android/Chrome**: visit the site → you should see an "Install app" prompt or the option in the browser menu (⋮ → Install app / Add to Home screen).
- **iPhone/Safari**: visit the site → Share button → **Add to Home Screen**. (iOS doesn't show an automatic install prompt like Android; this manual step is expected and normal for iOS.)
- Confirm the icon, app name ("Lotto Review"), and splash background (`#0d1526`) all appear correctly after install.

## Notes
- Every future update: edit `index.html`, commit, push to `main` — Cloudflare Pages auto-redeploys.
- The service worker caches the app shell for offline use and re-checks for updates on every visit (network-first for index.html).
- If you ever change core files, consider bumping `CACHE_NAME` in `sw.js` (e.g. `lottoreview-cache-v2`) to force clients to pick up the new version immediately rather than waiting for the old cache to expire.

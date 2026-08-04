# Druckwerk

Honest 3D print pricing — a static site with two funnels:

1. **Cost calculator** (`/`) — for makers who sell prints (existing funnel: Pro-Kit, cheat sheet, blog).
2. **Instant quote portal** (`/angebot/`) — upload STL/3MF/OBJ, get an instant estimated price,
   request a binding offer from 3D-WINDT (3D-Windt GbR).

## Key properties

- **Fully static** — no build step, no framework. Deploy the `site/` directory as-is.
- **Client-side geometry analysis** — STL (binary/ASCII), OBJ and 3MF are parsed in the browser
  (`site/assets/quote.js`). Files never leave the device until the inquiry form is submitted.
- **Three.js viewer** — vendored in `site/assets/vendor/` (r147 UMD build, no CDN dependency).
- **Netlify Forms** — `academy-lead` (cheat sheet) and `quote-request` (quote inquiries, with
  file upload ≤ 8 MB). Both redirect to `/danke/`.

## Business configuration

All pricing knobs live at the top of `site/assets/quote.js`:

- `MATERIALS` — 8 materials with density, charged €/kg and technical data
  (mirrors `Materialtabelle_3DWindt.xlsx`).
- `QUALITIES` — layer heights with effective deposition rates (mm³/s) used for time estimation.
- `PRICING` — setup fee, machine rate, minimum order value, quantity discounts.
- `SPEEDS` — Eco / Standard / Express factors and lead times.
- `BUILD_VOLUME` — 350 × 350 × 300 mm (Voron 350 fleet).

## Deploy

Netlify site: `druckwerk.netlify.app`.

- **Drag & drop:** zip or drag the `site/` folder onto the Netlify deploy page.
- **CLI:** `netlify deploy --prod --dir site` (after `netlify login` + `netlify link`).
- **Git:** connect this repo; `netlify.toml` sets `publish = "site"`.

After the first deploy with the new form, check *Netlify → Forms* that `quote-request`
is registered and enable e-mail notifications to `support@3d-windt.de`.

## Local preview

Any static server works, e.g.:

```
python3 -m http.server 8080 --directory site
```

(Form submissions only work on Netlify.)

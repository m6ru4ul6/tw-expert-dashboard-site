# Dashboard Routing Contract

This dashboard must work from both:

- the local server, for example `http://127.0.0.1:8766/runs/20260702_223151`
- direct file opening, for example `file:///.../dashboard/index.html`
- the static cloud export, for example `https://example.pages.dev/runs/20260702_223151`
- GitHub project Pages, for example `https://m6ru4ul6.github.io/tw-expert-dashboard-site/runs/20260702_223151`

Keep these rules when changing dashboard pages or assets:

1. `index.html` must reference local assets with relative paths, such as `styles.css` and `app.js`.
2. Do not use root-relative paths like `/styles.css` or `/app.js` in `index.html`; those break direct file opening.
3. Server report routes `/runs/<run_id>` and `/run/<run_id>` must return the app shell.
4. Server asset routes under report paths, such as `/runs/app.js` and `/runs/styles.css`, must return the asset files.
5. Static exports must include `/runs/* /index.html 200` and `/run/* /index.html 200` rewrites plus routed asset copies under `public/runs/` and `public/run/`.
6. Static exports must also create real `public/runs/<encoded_run_id>/index.html` files because GitHub Pages does not honor Cloudflare-style `_redirects`.
7. Each real GitHub Pages permalink directory must include its own `app.js` and `styles.css`; otherwise `/runs/<run_id>/` resolves relative assets under that same directory and renders as unstyled HTML.
8. New local assets used by `index.html` must live under `dashboard/` and be covered by the smoke test.

Before shipping dashboard changes, run:

```sh
python3 scripts/dashboard_smoke_test.py
python3 scripts/dashboard_export_static.py --output public
python3 scripts/dashboard_static_smoke_test.py --public-dir public
python3 scripts/dashboard_healthcheck.py --url http://127.0.0.1:8766/api/summary/today
```

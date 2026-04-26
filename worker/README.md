# rrradio-stats Worker

Cloudflare Worker that proxies the GoatCounter API for the rrradio
admin dashboard at `https://<host>/rrradio/dashboard.html`. The
GoatCounter API token never reaches the browser — the Worker holds it
as a Cloudflare secret. The dashboard authenticates against the
Worker with a separate admin token (also a secret).

## Endpoints

All require `Authorization: Bearer <ADMIN_TOKEN>`. All accept
`?days=N` (1–90, default 7) for the time range. All responses are
cached 5 min in the Cloudflare edge.

| Path                | What it returns                                    |
| ------------------- | -------------------------------------------------- |
| `/api/totals`       | `total`, `total_events`, `total_unique`            |
| `/api/top-stations` | most-played (filter `play: …`, top 20)             |
| `/api/errors`       | errored stations (filter `error: …`, with reasons) |
| `/api/tabs`         | tab usage (filter `tab/…`)                         |
| `/api/genres`       | genre dropdown selections (filter `genre/…`)       |
| `/api/favorites`    | most-favorited (filter `favorite: …`)              |

## One-time setup

1. **Create a GoatCounter API token**
   - Go to your GoatCounter dashboard → Settings → API → New token
   - Permissions: tick "Read statistics" only
   - Copy the token (shown only once)

2. **Generate an admin token** for the dashboard
   ```sh
   openssl rand -hex 24
   ```
   Save it somewhere — you'll paste it once into the dashboard.

3. **Install Wrangler + log in**
   ```sh
   cd worker
   npm install
   npx wrangler login
   ```

4. **Set Worker secrets**
   ```sh
   npx wrangler secret put GOATCOUNTER_TOKEN   # paste the GC token
   npx wrangler secret put ADMIN_TOKEN          # paste the admin token from step 2
   ```

5. **Deploy**
   ```sh
   npx wrangler deploy
   ```
   Wrangler prints the deployed URL — something like
   `https://rrradio-stats.<your-subdomain>.workers.dev`.

6. **Wire the dashboard**
   - Open `../public/dashboard.html`
   - Replace `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev` in the
     `WORKER_URL` constant with the URL from step 5
   - Commit and push (GH Pages redeploys automatically)

7. **Open the dashboard**
   - Visit `https://<your-host>/rrradio/dashboard.html`
   - Paste the admin token from step 2 → unlock
   - Token persists in localStorage

## Local development

```sh
cd worker
npm install
echo 'GOATCOUNTER_TOKEN = "..."' > .dev.vars
echo 'ADMIN_TOKEN = "dev-token"' >> .dev.vars
npx wrangler dev
```

`.dev.vars` is gitignored. The Worker runs at `http://localhost:8787`.

## Rotating the admin token

```sh
npx wrangler secret put ADMIN_TOKEN
```

Pick a new token, paste it; the dashboard's localStorage entry will
fail authorization, the gate re-prompts, paste the new token.

## Tail live logs

```sh
npx wrangler tail
```

Useful when the dashboard returns "fetch failed" — the upstream
GoatCounter response is logged here.

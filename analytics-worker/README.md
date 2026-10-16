# Privacy-friendly visitor map

This Cloudflare Worker records page entries for the personal site and returns
coarse, aggregated locations for a world map. It is intentionally separate
from GitHub Pages because a static site cannot persist counters by itself.

## Privacy contract

- The Worker never reads, logs, stores, hashes, or returns the visitor's raw IP.
- It uses Cloudflare's request geolocation only long enough to place the visit
  into a **2-degree grid** (roughly 110–220 km, depending on latitude).
- D1 stores only the grid centre, two-letter country code, aggregate count, and
  update time. A pin never represents a precise person or address.
- `total` is a count of page entries (`POST /visit` calls), not unique people or
  unique IP addresses. Unique-IP counting would require retaining an
  IP-derived identifier, which this design deliberately avoids.
- The source contains no `console.log` calls. Cloudflare still processes the
  network request as the hosting provider; review the account's platform log
  and retention settings separately.

## API

### `POST /visit`

Adds one page entry and returns the updated public statistics:

```json
{
  "recorded": true,
  "total": 128,
  "pins": [
    { "lat": 39, "lng": 117, "count": 24, "country": "CN" }
  ],
  "precisionDegrees": 2,
  "generatedAt": "2026-10-16T12:00:00.000Z"
}
```

If Cloudflare has no usable geolocation, the request still increments `total`
but does not create a map pin.

### `GET /stats`

Returns the same object without `recorded` and does not modify the database.
Results may be cached for 60 seconds. At most `MAX_PINS` grid cells are returned,
ordered by visit count.

Only origins listed in `ALLOWED_ORIGINS` may use the API from a browser. This is
basic cross-origin protection, not an anti-bot guarantee; Origin headers can be
spoofed by non-browser clients. Cloudflare rate limiting or Turnstile can be
added later if artificial traffic becomes a problem.

## Deploy

Requirements: a Cloudflare account and Wrangler authentication.

```bash
cd analytics-worker
cp wrangler.toml.example wrangler.toml
npx wrangler login
npx wrangler d1 create wenjie-site-analytics
```

Copy the returned database ID into `wrangler.toml`, then initialize and deploy:

```bash
npx wrangler d1 execute wenjie-site-analytics --remote --file=./schema.sql
npx wrangler deploy
```

Wrangler prints a URL such as
`https://wenjie-site-analytics.<account>.workers.dev`. Use that as the front-end
API base. Keep the actual `wrangler.toml` private if it later contains account-
specific settings; the example file is safe to commit.

For local development:

```bash
npx wrangler d1 execute wenjie-site-analytics --local --file=./schema.sql
npx wrangler dev
```

To simulate a location locally, temporarily set `ALLOW_TEST_GEO = "true"` and
send `x-test-latitude`, `x-test-longitude`, and `x-test-country` headers. Never
enable this flag in production. A page opened directly via `file://` has the
opaque Origin `null`; prefer a local HTTP server instead of enabling
`ALLOW_NULL_ORIGIN` in production.

## Front-end integration

Record the entry once when the page loads, keep the returned data, and reuse it
when the visitor expands the footer map:

```js
const ANALYTICS_API = "https://wenjie-site-analytics.example.workers.dev";

let visitorStats;

async function recordPageEntry() {
  const response = await fetch(`${ANALYTICS_API}/visit`, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Visitor counter unavailable");
  visitorStats = await response.json();
  return visitorStats;
}

async function getVisitorStats() {
  if (visitorStats) return visitorStats;
  const response = await fetch(`${ANALYTICS_API}/stats`);
  if (!response.ok) throw new Error("Visitor map unavailable");
  visitorStats = await response.json();
  return visitorStats;
}
```

Render each `pins` item at `[lng, lat]`, size or label it with `count`, and show
`total` below the map using Arabic numerals. The front end should degrade
quietly when the service is unavailable: the rest of the homepage must remain
usable and the footer may show `—` instead of a count.

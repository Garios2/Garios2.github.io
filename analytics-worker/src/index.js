const GRID_SIZE_DEGREES = 2;
const DEFAULT_MAX_PINS = 500;
const DEFAULT_ALLOWED_ORIGIN = "https://garios2.github.io";

export default {
  async fetch(request, env) {
    if (!env.DB) {
      return jsonResponse(
        request,
        env,
        { error: "D1 binding `DB` is not configured." },
        500,
      );
    }

    if (!isOriginAllowed(request, env)) {
      return jsonResponse(request, env, { error: "Origin not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: responseHeaders(request, env, "no-store"),
      });
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    try {
      if (path === "/stats" && request.method === "GET") {
        const stats = await readStats(env);
        return jsonResponse(request, env, stats, 200, "public, max-age=60");
      }

      if (path === "/visit" && request.method === "POST") {
        const geo = coarseLocation(request, env);
        const statements = [
          env.DB.prepare(
            `INSERT INTO counters (key, value, updated_at)
             VALUES ('total_visits', 1, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET
               value = value + 1,
               updated_at = CURRENT_TIMESTAMP`,
          ),
        ];

        if (geo) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO visit_cells
                 (cell_key, latitude, longitude, country_code, visit_count, updated_at)
               VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
               ON CONFLICT(cell_key) DO UPDATE SET
                 visit_count = visit_count + 1,
                 updated_at = CURRENT_TIMESTAMP`,
            ).bind(
              geo.cellKey,
              geo.latitude,
              geo.longitude,
              geo.countryCode,
            ),
          );
        }

        // D1 batch is atomic: the total and map cell advance together.
        await env.DB.batch(statements);
        const stats = await readStats(env);

        return jsonResponse(
          request,
          env,
          { recorded: true, ...stats },
          200,
          "no-store",
        );
      }

      if ((path === "/visit" || path === "/stats") && request.method !== "GET") {
        return jsonResponse(
          request,
          env,
          { error: "Method not allowed." },
          405,
        );
      }

      return jsonResponse(request, env, { error: "Not found." }, 404);
    } catch {
      // Deliberately do not log the request: request metadata may contain an IP.
      return jsonResponse(
        request,
        env,
        { error: "Analytics service temporarily unavailable." },
        503,
      );
    }
  },
};

async function readStats(env) {
  const maxPins = clampInteger(env.MAX_PINS, 1, 1000, DEFAULT_MAX_PINS);
  const [counter, cells] = await Promise.all([
    env.DB.prepare(
      "SELECT value FROM counters WHERE key = 'total_visits'",
    ).first(),
    env.DB.prepare(
      `SELECT latitude, longitude, country_code, visit_count
       FROM visit_cells
       ORDER BY visit_count DESC, updated_at DESC
       LIMIT ?`,
    )
      .bind(maxPins)
      .all(),
  ]);

  return {
    total: Number(counter?.value ?? 0),
    pins: (cells.results ?? []).map((cell) => ({
      lat: Number(cell.latitude),
      lng: Number(cell.longitude),
      count: Number(cell.visit_count),
      country: cell.country_code,
    })),
    precisionDegrees: GRID_SIZE_DEGREES,
    generatedAt: new Date().toISOString(),
  };
}

function coarseLocation(request, env) {
  let latitude = request.cf?.latitude;
  let longitude = request.cf?.longitude;
  let countryCode = request.cf?.country;

  // Only for `wrangler dev`; keep ALLOW_TEST_GEO=false in production.
  if (env.ALLOW_TEST_GEO === "true") {
    latitude ??= request.headers.get("x-test-latitude");
    longitude ??= request.headers.get("x-test-longitude");
    countryCode ??= request.headers.get("x-test-country");
  }

  const lat = parseCoordinate(latitude);
  const lng = parseCoordinate(longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return null;
  }

  const safeLat = Math.min(lat, 89.999999);
  const safeLng = Math.min(lng, 179.999999);
  const latBand = Math.floor((safeLat + 90) / GRID_SIZE_DEGREES);
  const lngBand = Math.floor((safeLng + 180) / GRID_SIZE_DEGREES);
  const centerLat = -90 + (latBand + 0.5) * GRID_SIZE_DEGREES;
  const centerLng = -180 + (lngBand + 0.5) * GRID_SIZE_DEGREES;
  const candidateCountry = String(countryCode ?? "").toUpperCase();
  const normalizedCountry = /^[A-Z]{2}$/.test(candidateCountry)
    ? candidateCountry
    : "XX";

  return {
    cellKey: `${normalizedCountry}:${latBand}:${lngBand}`,
    latitude: centerLat,
    longitude: centerLng,
    countryCode: normalizedCountry,
  };
}

function parseCoordinate(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return Number.NaN;
  }
  return Number(value);
}

function isOriginAllowed(request, env) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  if (origin === "null") return env.ALLOW_NULL_ORIGIN === "true";

  const allowed = String(env.ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGIN)
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return allowed.includes(origin.replace(/\/$/, ""));
}

function responseHeaders(request, env, cacheControl) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": cacheControl,
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  });

  const origin = request.headers.get("origin");
  if (origin && isOriginAllowed(request, env)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  return headers;
}

function jsonResponse(
  request,
  env,
  payload,
  status = 200,
  cacheControl = "no-store",
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders(request, env, cacheControl),
  });
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number)
    ? Math.min(Math.max(number, minimum), maximum)
    : fallback;
}

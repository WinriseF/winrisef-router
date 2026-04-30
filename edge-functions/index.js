const ORIGINS = {
  edge: {
    key: "edge",
    name: "edgeone",
    base: "https://edge.winrisef.top"
  },
  v: {
    key: "v",
    name: "vercel",
    base: "https://v.winrisef.top"
  },
  n: {
    key: "n",
    name: "netlify",
    base: "https://n.winrisef.top"
  }
};

const ROUTER_PARAMS = new Set([
  "to",
  "debug",
  "_router_debug",
  "_router_clear"
]);

const DEFAULT_CN_WEIGHTS = {
  edge: 45,
  v: 45,
  n: 10
};

const DEFAULT_GLOBAL_WEIGHTS = {
  v: 50,
  n: 35,
  edge: 15
};

function envFlag(env, key, defaultValue = false) {
  const value = String(env?.[key] ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;

  return defaultValue;
}

function envNumber(env, key, defaultValue) {
  const value = Number(env?.[key]);
  return Number.isFinite(value) ? value : defaultValue;
}

function parseWeightEnv(env, key, fallback) {
  const raw = String(env?.[key] || "").trim();

  if (!raw) {
    return fallback;
  }

  const result = { ...fallback };

  for (const pair of raw.split(",")) {
    const [name, value] = pair.split(":").map((item) => item.trim());
    const numberValue = Number(value);

    if (ORIGINS[name] && Number.isFinite(numberValue) && numberValue >= 0) {
      result[name] = numberValue;
    }
  }

  return result;
}

function parseDisabledOrigins(env) {
  const raw = String(env?.DISABLED_ORIGINS || "");

  return new Set(
    raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getCountry(request) {
  return request.eo?.geo?.countryCodeAlpha2 || "";
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const parts = cookie.split(";").map((part) => part.trim());

  for (const part of parts) {
    const index = part.indexOf("=");

    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index);
    const value = part.slice(index + 1);

    if (key === name) {
      try {
        return decodeURIComponent(value);
      } catch (_) {
        return value;
      }
    }
  }

  return "";
}

function isDisabled(origin, disabled) {
  return disabled.has(origin.key) || disabled.has(origin.name);
}

function weightedPick(weightMap, disabled) {
  const candidates = Object.entries(weightMap)
    .filter(([key, weight]) => ORIGINS[key] && weight > 0)
    .map(([key, weight]) => ({
      ...ORIGINS[key],
      weight
    }))
    .filter((origin) => !isDisabled(origin, disabled));

  if (candidates.length === 0) {
    return null;
  }

  const total = candidates.reduce((sum, item) => sum + item.weight, 0);

  if (total <= 0) {
    return candidates[0];
  }

  let cursor = Math.random() * total;

  for (const item of candidates) {
    cursor -= item.weight;

    if (cursor <= 0) {
      return item;
    }
  }

  return candidates[0];
}

function uniqueOrigins(origins) {
  const seen = new Set();
  const result = [];

  for (const origin of origins) {
    if (!origin || !origin.key || seen.has(origin.key)) {
      continue;
    }

    seen.add(origin.key);
    result.push(origin);
  }

  return result;
}

function buildWeightedOrder(weightMap, disabled) {
  return Object.entries(weightMap)
    .filter(([key, weight]) => ORIGINS[key] && weight > 0)
    .map(([key, weight]) => ({
      ...ORIGINS[key],
      weight
    }))
    .filter((origin) => !isDisabled(origin, disabled))
    .sort((a, b) => b.weight - a.weight);
}

function buildCandidateList(request, env) {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const country = getCountry(request);
  const disabled = parseDisabledOrigins(env);

  const forced = url.searchParams.get("to");

  if (forced && ORIGINS[forced] && !isDisabled(ORIGINS[forced], disabled)) {
    return [ORIGINS[forced]];
  }

  const cnWeights = parseWeightEnv(env, "CN_WEIGHTS", DEFAULT_CN_WEIGHTS);
  const globalWeights = parseWeightEnv(env, "GLOBAL_WEIGHTS", DEFAULT_GLOBAL_WEIGHTS);
  const activeWeights = country === "CN" ? cnWeights : globalWeights;

  const picked = weightedPick(activeWeights, disabled);
  const weightedOrder = buildWeightedOrder(activeWeights, disabled);

  const stickyEnabled = envFlag(env, "STICKY_ENABLED", true);
  const stickyKey = stickyEnabled ? getCookie(request, "wr_origin") : "";
  const stickyOrigin = ORIGINS[stickyKey];

  if (method !== "GET" && method !== "HEAD") {
    return uniqueOrigins([
      ORIGINS.v,
      ORIGINS.edge,
      ORIGINS.n
    ]).filter((origin) => !isDisabled(origin, disabled));
  }

  if (stickyOrigin && !isDisabled(stickyOrigin, disabled)) {
    return uniqueOrigins([
      stickyOrigin,
      picked,
      ...weightedOrder,
      ORIGINS.v,
      ORIGINS.edge,
      ORIGINS.n
    ]).filter((origin) => !isDisabled(origin, disabled));
  }

  return uniqueOrigins([
    picked,
    ...weightedOrder,
    ORIGINS.v,
    ORIGINS.edge,
    ORIGINS.n
  ]).filter((origin) => !isDisabled(origin, disabled));
}

function buildTargetUrl(request, origin) {
  const incoming = new URL(request.url);
  const target = new URL(origin.base);

  target.pathname = incoming.pathname;
  target.search = incoming.search;

  for (const param of ROUTER_PARAMS) {
    target.searchParams.delete(param);
  }

  return target;
}

async function isOriginHealthy(origin, env) {
  const healthCheckEnabled = envFlag(env, "HEALTH_CHECK", true);

  if (!healthCheckEnabled) {
    return true;
  }

  const timeout = envNumber(env, "HEALTH_TIMEOUT_MS", 1000);

  const target = new URL(origin.base);
  target.pathname = "/";
  target.search = "";

  try {
    const response = await fetch(target.toString(), {
      method: "HEAD",
      redirect: "manual",
      eo: {
        timeoutSetting: {
          connectTimeout: timeout,
          readTimeout: timeout,
          writeTimeout: timeout
        }
      }
    });

    return response.status >= 200 && response.status < 500;
  } catch (_) {
    return false;
  }
}

async function chooseOrigin(request, env) {
  const candidates = buildCandidateList(request, env);

  for (const origin of candidates) {
    if (await isOriginHealthy(origin, env)) {
      return {
        origin,
        healthy: true,
        candidates
      };
    }
  }

  return {
    origin: candidates[0] || ORIGINS.v,
    healthy: false,
    candidates
  };
}

function createRedirectResponse(request, result, targetUrl, env) {
  const method = request.method.toUpperCase();
  const status = method === "GET" || method === "HEAD" ? 302 : 307;
  const stickySeconds = envNumber(env, "STICKY_SECONDS", 7 * 24 * 60 * 60);

  const headers = new Headers();

  headers.set("Location", targetUrl.toString());
  headers.set("Cache-Control", "no-store, max-age=0");
  headers.set("Vary", "Cookie");
  headers.set("X-Router-Version", "2026-04-30.1");
  headers.set("X-Routed-Origin", result.origin.name);
  headers.set("X-Routed-Origin-Key", result.origin.key);
  headers.set("X-Router-Healthy", result.healthy ? "1" : "0");

  headers.append(
    "Set-Cookie",
    `wr_origin=${encodeURIComponent(result.origin.key)}; Path=/; Max-Age=${stickySeconds}; Secure; HttpOnly; SameSite=Lax`
  );

  return new Response(null, {
    status,
    headers
  });
}

function createDebugResponse(request, result, targetUrl) {
  return new Response(
    JSON.stringify(
      {
        ok: true,
        routerVersion: "2026-04-30.1",
        method: request.method,
        country: getCountry(request),
        selected: {
          key: result.origin.key,
          name: result.origin.name,
          base: result.origin.base
        },
        healthy: result.healthy,
        target: targetUrl.toString(),
        candidates: result.candidates.map((origin) => ({
          key: origin.key,
          name: origin.name,
          base: origin.base,
          weight: origin.weight ?? null
        }))
      },
      null,
      2
    ),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

function createClearCookieResponse(request) {
  const url = new URL(request.url);
  url.searchParams.delete("_router_clear");

  return new Response(null, {
    status: 302,
    headers: {
      "Location": url.toString(),
      "Cache-Control": "no-store",
      "Set-Cookie": "wr_origin=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax"
    }
  });
}

export default async function onRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const url = new URL(request.url);

  if (url.searchParams.get("_router_clear") === "1") {
    return createClearCookieResponse(request);
  }

  const result = await chooseOrigin(request, env);
  const targetUrl = buildTargetUrl(request, result.origin);

  if (url.searchParams.get("debug") === "1" || url.searchParams.get("_router_debug") === "1") {
    return createDebugResponse(request, result, targetUrl);
  }

  return createRedirectResponse(request, result, targetUrl, env);
}

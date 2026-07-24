import test from "node:test";
import assert from "node:assert/strict";

import onRequest from "../edge-functions/index.js";

test("checks all candidate origins concurrently", async (t) => {
  const calls = [];
  let releaseProbes;
  const probesReleased = new Promise((resolve) => {
    releaseProbes = resolve;
  });

  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    await probesReleased;
    return new Response(null, { status: 204 });
  });

  const request = new Request("https://winrisef.top/");
  const pendingResponse = onRequest({ request, env: {} });

  assert.equal(calls.length, 3);
  assert.deepEqual(new Set(calls), new Set([
    "https://e.winrisef.top/healthz",
    "https://v.winrisef.top/healthz",
    "https://n.winrisef.top/healthz"
  ]));

  releaseProbes();
  const response = await pendingResponse;
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("x-router-healthy"), "1");
});

test("falls back to the origin root when /healthz is missing", async (t) => {
  const calls = [];

  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return new Response(null, {
      status: url.endsWith("/healthz") ? 404 : 200
    });
  });

  const request = new Request("https://winrisef.top/?to=n&debug=1");
  const response = await onRequest({ request, env: {} });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.selected.key, "n");
  assert.equal(body.healthy, true);
  assert.deepEqual(calls, [
    "https://n.winrisef.top/healthz",
    "https://n.winrisef.top/"
  ]);
});

test("redirects to e when every health probe has a transient error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("temporary probe failure");
  });

  const request = new Request("https://winrisef.top/docs?to=v");
  const response = await onRequest({ request, env: {} });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://e.winrisef.top/docs");
  assert.equal(response.headers.get("x-routed-origin-key"), "e");
  assert.equal(response.headers.get("x-router-healthy"), "0");
});

test("redirects to e when no origin is enabled", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("fetch should not be called");
  });

  const request = new Request("https://winrisef.top/");
  const response = await onRequest({
    request,
    env: { DISABLED_ORIGINS: "e,v,n" }
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://e.winrisef.top/");
  assert.equal(response.headers.get("x-routed-origin-key"), "e");
  assert.equal(response.headers.get("x-router-healthy"), "0");
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("supports overriding the default fallback origin", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("temporary probe failure");
  });

  const request = new Request("https://winrisef.top/status");
  const response = await onRequest({
    request,
    env: { FALLBACK_ORIGIN: "v" }
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://v.winrisef.top/status");
  assert.equal(response.headers.get("x-router-healthy"), "0");
});

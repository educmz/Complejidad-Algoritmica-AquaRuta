import assert from "node:assert/strict";

globalThis.window = globalThis;

const { apiRequest, API_BASE_URL } = await import("../src/services/apiClient.js");

assert.equal(API_BASE_URL, "http://127.0.0.1:8000");

globalThis.fetch = async (url, options) => ({
  ok: true,
  status: 200,
  headers: new Map(),
  async json() {
    return { url, method: options.method, body: JSON.parse(options.body) };
  },
});

const ok = await apiRequest("/probe", { body: { alive: true } });
assert.equal(ok.url, "http://127.0.0.1:8000/probe");
assert.equal(ok.method, "POST");
assert.deepEqual(ok.body, { alive: true });

globalThis.fetch = async () => ({
  ok: false,
  status: 422,
  headers: { get: () => null },
  async json() {
    return { detail: "Validacion fallida" };
  },
});

await assert.rejects(
  () => apiRequest("/bad", { body: {}, fallbackError: "Fallback" }),
  (error) => error.message === "Validacion fallida" && error.status === 422
);

import assert from "node:assert/strict";

globalThis.window = globalThis;

const { apiRequest, API_BASE_URL } = await import("../src/services/apiClient.js");
const { fetchDashboard } = await import("../src/services/dashboardApi.js");

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

globalThis.fetch = async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  async json() {
    throw new Error("broken json");
  },
});

await assert.rejects(
  () => apiRequest("/invalid-json", { body: {} }),
  /respuesta invalida/
);

globalThis.fetch = async () => {
  throw new TypeError("Failed to fetch");
};

await assert.rejects(
  () => apiRequest("/offline", { body: {} }),
  /backend este en ejecucion/
);

globalThis.fetch = async (_url, options) =>
  new Promise((_resolve, reject) => {
    options.signal.addEventListener(
      "abort",
      () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true }
    );
  });

await assert.rejects(
  () => apiRequest("/timeout", { body: {}, timeoutMs: 1 }),
  (error) => error.name === "TimeoutError" && /tiempo esperado/.test(error.message)
);

const abortController = new AbortController();
globalThis.fetch = async () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  throw error;
};
abortController.abort();

await assert.rejects(
  () => apiRequest("/cancelled", { body: {}, signal: abortController.signal }),
  (error) => error.name === "AbortError"
);

globalThis.fetch = async (url, options) => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  async json() {
    return {
      url,
      method: options.method,
      metadata: {},
      districts: [],
      groupedZones: [],
      epsOrigins: [],
      operationalRoutes: {},
    };
  },
});

const dashboard = await fetchDashboard({
  eps: "EPS A",
  departamento: "LIMA",
  provincia: "todos",
  distrito: "",
  grupo: "grupo-1",
});
assert.equal(dashboard.method, "GET");
assert.ok(dashboard.url.includes("/dashboard?"));
assert.ok(dashboard.url.includes("eps=EPS+A"));
assert.ok(dashboard.url.includes("departamento=LIMA"));
assert.ok(dashboard.url.includes("grupo=grupo-1"));
assert.equal(dashboard.url.includes("provincia="), false);

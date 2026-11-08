"use strict";

// GOJI AI local: binds only to loopback; never exposes the API key to the browser.
const express = require("express");
const fs = require("fs");
const path = require("path");
const app = express();
const HOST = "127.0.0.1";
const PORT = Number(process.env.GOJI_LOCAL_PORT || 3000);
const CONFIG_PATH = process.env.GOJI_CONFIG_PATH || path.join(__dirname, ".goji-local.json");
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Cache-Control", "no-store");
  next();
});

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")); }
  catch { return {}; }
}
function saveConfig(value) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  try { fs.chmodSync(CONFIG_PATH, 0o600); } catch {}
}
function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
async function providerJson(response) {
  let data;
  try { data = await response.json(); }
  catch { throw Object.assign(new Error("Abacus devolvió una respuesta no válida."), { status: 502, code: "bad_response" }); }
  if (!response.ok) {
    const status = response.status;
    let message = "Abacus rechazó la solicitud (HTTP " + status + ").";
    if (status === 401 || status === 403) message = "La clave fue rechazada o no tiene acceso a RouteLLM. Revisa que sea una clave válida de Abacus RouteLLM.";
    else if (status === 429) message = "Se alcanzó el límite o cuota de tu cuenta Abacus. Revisa el uso y el plan.";
    else if (status >= 500) message = "RouteLLM tiene un problema temporal. Inténtalo más tarde.";
    throw Object.assign(new Error(message), { status: 502, code: "abacus_error" });
  }
  return data;
}
function getKey() { return String(readConfig().abacusApiKey || ""); }

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "GOJI AI local" }));
app.get("/api/providers", (_req, res) => {
  const configured = Boolean(getKey());
  res.json({ providers: {
    openai: { configured: false, env: "OPENAI_API_KEY", model: "gpt-4o-mini" },
    anthropic: { configured: false, env: "ANTHROPIC_API_KEY", model: "claude" },
    gemini: { configured: false, env: "GEMINI_API_KEY", model: "gemini" },
    deepseek: { configured: false, env: "DEEPSEEK_API_KEY", model: "deepseek-chat" },
    abacus: { configured, env: "ABACUS_API_KEY", model: "route-llm" }
  } });
});
app.post("/api/local/key", (req, res) => {
  const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
  if (key.length < 8 || key.length > 1000 || /[\r\n]/.test(key)) return fail(res, 400, "invalid_key", "La clave no tiene un formato válido.");
  const config = readConfig();
  config.abacusApiKey = key;
  saveConfig(config);
  res.json({ ok: true, configured: true, storage: "local-file" });
});
app.get("/api/abacus/models", async (_req, res) => {
  const key = getKey();
  if (!key) return fail(res, 503, "missing_api_key", "Primero guarda tu clave de Abacus en este PC.");
  try {
    const response = await fetch("https://routellm.abacus.ai/v1/models", {
      headers: { Authorization: "Bearer " + key },
      signal: AbortSignal.timeout(20000)
    });
    const data = await providerJson(response);
    const models = (Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [])
      .filter(item => item && typeof item.id === "string")
      .map(item => {
        const pricing = item.pricing || item.pricing_info || item.prices || item.cost || null;
        const prices = [];
        const scanPrices = (value, key = "") => {
          if (value && typeof value === "object") {
            for (const [k, v] of Object.entries(value)) scanPrices(v, k);
          } else if (/(price|cost|input|output|prompt|completion)/i.test(key) && value !== null && value !== undefined) {
            const n = typeof value === "number" ? value : Number(String(value).replace(/[$,]/g, ""));
            if (Number.isFinite(n)) prices.push(n);
          }
        };
        scanPrices(pricing);
        const explicitFree = item.free === true || item.is_free === true || pricing?.free === true || pricing?.is_free === true;
        const normalizedId = item.id.toLowerCase().replace(/[^a-z0-9]/g, "");
        // Abacus marks these models as available on an unlimited basis for eligible subscribers.
        // Keep this separate from zero-price models: "unlimited" is an access entitlement,
        // not a claim that the underlying API or subscription has no cost.
        const unlimitedIds = new Set([
          "routellm",
          "gpt6luna",
          "claudehaiku55",
          "musespark13",
          "deepseekv41flash",
          "gemini35flashlite",
          "glm53flash",
          "mimov26pro"
        ]);
        const unlimited = unlimitedIds.has(normalizedId);
        const free = !unlimited && (explicitFree || (prices.length > 0 && prices.every(price => price === 0)));
        const hasPrice = prices.some(price => price > 0);
        const paid = !unlimited && (hasPrice || (item.id === "route-llm" && !free));
        return { id: item.id, owned_by: item.owned_by || item.provider || "", model_type: item.model_type || "text", api_formats: item.api_formats || [], pricing, pricing_status: unlimited ? "unlimited" : free ? "free" : paid ? "paid" : "unknown", free, unlimited };
      })
      .slice(0, 500);
    res.json({ models });
  } catch (error) { fail(res, error.status || 502, error.code || "models_error", error.message || "No se pudo consultar el catálogo de Abacus."); }
});
function validate(body) {
  if (body?.provider !== "abacus") throw Object.assign(new Error("En esta versión local está habilitado Abacus RouteLLM. Los demás proveedores no están conectados todavía."), { status: 400, code: "provider_not_enabled" });
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) throw Object.assign(new Error("Envía entre 1 y 20 mensajes."), { status: 400, code: "invalid_messages" });
  const messages = body.messages.map(m => {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string" || !m.content.trim() || m.content.length > 12000) throw Object.assign(new Error("Hay un mensaje con formato no válido."), { status: 400, code: "invalid_message" });
    return { role: m.role, content: m.content.trim() };
  });
  const model = typeof body.model === "string" && /^[A-Za-z0-9._:/-]{1,180}$/.test(body.model) ? body.model : "route-llm";
  return { messages, model, system: typeof body.system === "string" ? body.system.slice(0, 20000) : "" };
}
app.post("/api/chat", async (req, res) => {
  const key = getKey();
  if (!key) return fail(res, 503, "missing_api_key", "Primero guarda tu clave de Abacus en este PC.");
  try {
    const input = validate(req.body);
    const messages = input.system ? [{ role: "system", content: input.system }, ...input.messages] : input.messages;
    const response = await fetch("https://routellm.abacus.ai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ model: input.model, messages, temperature: 0.7, max_tokens: 1800 }),
      signal: AbortSignal.timeout(60000)
    });
    const data = await providerJson(response);
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw Object.assign(new Error("El modelo no devolvió texto. Puede que ese modelo requiera otro formato de API."), { status: 502, code: "empty_reply" });
    res.json({ text: answer.trim() });
  } catch (error) { fail(res, error.status || 500, error.code || "local_error", error.message || "Error local de GOJI AI."); }
});
app.use(express.static(__dirname, { index: "index.html" }));
app.listen(PORT, HOST, () => {
  console.log("GOJI AI LOCAL activo en http://" + HOST + ":" + PORT);
  console.log("Solo accesible desde este PC. Mantén esta ventana abierta mientras lo uses.");
});
process.on("uncaughtException", error => console.error("Error:", error.message));
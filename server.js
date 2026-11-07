"use strict";

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ACCESS_CODE = process.env.GOJI_ACCESS_CODE || "";
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "").trim();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");

  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Goji-Code");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const providers = {
  openai: {
    env: "OPENAI_API_KEY",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini"
  },
  anthropic: {
    env: "ANTHROPIC_API_KEY",
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest"
  },
  gemini: {
    env: "GEMINI_API_KEY",
    model: process.env.GEMINI_MODEL || "gemini-2.5-flash"
  },
  deepseek: {
    env: "DEEPSEEK_API_KEY",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat"
  }
};

function authorized(req) {
  return Boolean(ACCESS_CODE) &&
    req.get("X-Goji-Code") &&
    safeEqual(req.get("X-Goji-Code"), ACCESS_CODE);
}

function safeEqual(a, b) {
  const crypto = require("crypto");
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function requireAccess(req, res, next) {
  if (!ACCESS_CODE) {
    return res.status(503).json({
      error: { code: "server_not_configured", message: "El servidor aún no tiene GOJI_ACCESS_CODE configurado." }
    });
  }
  if (!authorized(req)) {
    return res.status(401).json({
      error: { code: "unauthorized", message: "Código de acceso incorrecto." }
    });
  }
  next();
}

// Limitación sencilla por IP para evitar abuso accidental.
const hits = new Map();
app.use("/api/chat", (req, res, next) => {
  const now = Date.now();
  const key = req.ip;
  const recent = (hits.get(key) || []).filter(t => now - t < 60_000);
  if (recent.length >= 20) {
    return res.status(429).json({
      error: { code: "rate_limited", message: "Demasiadas solicitudes. Espera un minuto e inténtalo de nuevo." }
    });
  }
  recent.push(now);
  hits.set(key, recent);
  next();
  if (hits.size > 2000) {
    for (const [ip, times] of hits) {
      if (!times.some(t => now - t < 60_000)) hits.delete(ip);
    }
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "GOJI AI backend" });
});

app.get("/api/providers", requireAccess, (_req, res) => {
  const result = {};
  for (const [id, p] of Object.entries(providers)) {
    result[id] = { configured: Boolean(process.env[p.env]), env: p.env, model: p.model };
  }
  res.json({ providers: result });
});

function validateChat(body) {
  if (!body || !providers[body.provider]) {
    throw Object.assign(new Error("Proveedor no válido."), { status: 400, code: "invalid_provider" });
  }
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 20) {
    throw Object.assign(new Error("Envía entre 1 y 20 mensajes."), { status: 400, code: "invalid_messages" });
  }
  const messages = body.messages.map(m => {
    if (!m || !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" || !m.content.trim() || m.content.length > 12000) {
      throw Object.assign(new Error("Hay un mensaje con formato no válido."), { status: 400, code: "invalid_message" });
    }
    return { role: m.role, content: m.content.trim() };
  });
  const system = typeof body.system === "string" ? body.system.slice(0, 20000) : "";
  return { provider: body.provider, messages, system };
}

async function readProviderResponse(response) {
  let data;
  try { data = await response.json(); }
  catch {
    throw Object.assign(new Error("El proveedor devolvió una respuesta no válida."), { status: 502, code: "provider_bad_response" });
  }
  if (!response.ok) {
    const status = response.status;
    let message = "El proveedor rechazó la solicitud (HTTP " + status + ").";
    if (status === 401 || status === 403) message = "La clave API fue rechazada. Revisa la variable correspondiente en Render.";
    else if (status === 429) message = "El proveedor alcanzó su límite o cuota. Revisa su panel de uso.";
    else if (status >= 500) message = "El servicio del proveedor presenta problemas. Inténtalo más tarde.";
    throw Object.assign(new Error(message), { status: 502, code: "provider_error" });
  }
  return data;
}

async function callOpenAICompatible(baseUrl, apiKey, model, messages, system) {
  const all = system ? [{ role: "system", content: system }, ...messages] : messages;
  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: all, temperature: 0.7, max_tokens: 1800 })
  });
  const data = await readProviderResponse(response);
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw Object.assign(new Error("El proveedor no devolvió texto."), { status: 502, code: "empty_reply" });
  }
  return text.trim();
}

async function callAnthropic(apiKey, model, messages, system) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model, max_tokens: 1800, temperature: 0.7,
      ...(system ? { system } : {}),
      messages
    })
  });
  const data = await readProviderResponse(response);
  const text = (data.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
  if (!text.trim()) throw Object.assign(new Error("Claude no devolvió texto."), { status: 502, code: "empty_reply" });
  return text.trim();
}

async function callGemini(apiKey, model, messages, system) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1800 }
      })
    }
  );
  const data = await readProviderResponse(response);
  const text = (data.candidates?.[0]?.content?.parts || []).map(x => x.text || "").join("");
  if (!text.trim()) throw Object.assign(new Error("Gemini no devolvió texto."), { status: 502, code: "empty_reply" });
  return text.trim();
}

app.post("/api/chat", requireAccess, async (req, res) => {
  try {
    const input = validateChat(req.body);
    const config = providers[input.provider];
    const apiKey = process.env[config.env];
    if (!apiKey) {
      return res.status(503).json({
        error: { code: "missing_api_key", message: "Falta configurar " + config.env + " en Render." }
      });
    }

    let text;
    if (input.provider === "openai") {
      text = await callOpenAICompatible("https://api.openai.com/v1", apiKey, config.model, input.messages, input.system);
    } else if (input.provider === "deepseek") {
      text = await callOpenAICompatible("https://api.deepseek.com", apiKey, config.model, input.messages, input.system);
    } else if (input.provider === "anthropic") {
      text = await callAnthropic(apiKey, config.model, input.messages, input.system);
    } else {
      text = await callGemini(apiKey, config.model, input.messages, input.system);
    }
    res.json({ text });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({
      error: {
        code: error.code || "server_error",
        message: error.message || "Error interno del servidor."
      }
    });
  }
});

// La app estática se sirve desde public/ si existe; el index.html del repositorio
// puede moverse a public/index.html para que Render lo publique automáticamente.
const publicDir = path.join(__dirname, "public");
const hasPublicFrontend = fs.existsSync(path.join(publicDir, "index.html"));
if (hasPublicFrontend) app.use(express.static(publicDir));
app.get("*", (_req, res) => {
  const indexPath = path.join(hasPublicFrontend ? publicDir : __dirname, "index.html");
  res.sendFile(indexPath, err => {
    if (err) res.status(404).send("GOJI AI: falta index.html en la raíz o public/.");
  });
});

app.listen(PORT, () => {
  console.log("GOJI AI backend activo en el puerto " + PORT);
});

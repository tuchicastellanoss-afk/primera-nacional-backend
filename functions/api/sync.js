import { json, auth } from "../_shared.js";

export async function onRequest({ request: req, env }) {
  if (!auth(req, env)) return json({ error: "no autorizado" }, 401);
  if (!env.TALLER) return json({ error: "falta el KV TALLER" }, 500);
  const url = new URL(req.url);
  if (req.method === "GET") {
    const meta = await env.TALLER.get("meta", { type: "json" });
    if (url.searchParams.get("meta")) return json({ ts: meta?.ts || 0 });
    const data = await env.TALLER.get("estado", { type: "json" });
    return json({ ts: meta?.ts || 0, data: data || null });
  }
  if (req.method === "PUT") {
    const body = await req.text();
    if (body.length > 4_000_000) return json({ error: "demasiado grande" }, 413);
    try { JSON.parse(body); } catch { return json({ error: "json inválido" }, 400); }
    await env.TALLER.put("estado", body);
    const ts = Date.now();
    await env.TALLER.put("meta", JSON.stringify({ ts }));
    return json({ ts });
  }
  return json({ error: "no encontrado" }, 404);
}

import { json, auth } from "../_shared.js";

export async function onRequest({ request: req, env }) {
  if (!auth(req, env)) return json({ error: "no autorizado" }, 401);
  if (!env.TALLER) return json({ error: "falta el KV TALLER" }, 500);
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!/^[a-f0-9]{40}$/.test(id)) return json({ error: "id inválido" }, 400);
  const k = "foto-" + id;
  if (req.method === "GET") {
    const buf = await env.TALLER.get(k, { type: "arrayBuffer" });
    if (url.searchParams.get("check")) return json({ have: !!buf });
    if (!buf) return new Response("", { status: 404 });
    return new Response(buf, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000" } });
  }
  if (req.method === "PUT") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 5_500_000) return json({ error: "foto demasiado grande" }, 413);
    await env.TALLER.put(k, buf);
    return json({ ok: true });
  }
  return json({ error: "no encontrado" }, 404);
}

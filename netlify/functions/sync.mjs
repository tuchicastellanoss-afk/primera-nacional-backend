// Guarda el estado del Taller en Netlify Blobs para que la compu y el celu vean lo mismo.
import { getStore } from "@netlify/blobs";

// Mismo "código" que usa la pantalla de contraseña del Taller (es el hash de la contraseña).
// Si querés uno propio, definí la variable TALLER_KEY en Netlify (Site configuration > Environment variables).
const DEFAULT_KEY = "76ad7747516ce6c12bbe22568989077e60d991b680f11deaf86fbe4b7eeb6c00";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default async (req) => {
  const key = (typeof Netlify !== "undefined" && Netlify.env.get("TALLER_KEY")) || DEFAULT_KEY;
  if (req.headers.get("x-taller-key") !== key) return json({ error: "no autorizado" }, 401);

  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const store = getStore({ name: "taller", consistency: "strong" });

  if (path.endsWith("/sync")) {
    if (req.method === "GET") {
      const meta = await store.get("meta", { type: "json" });
      if (url.searchParams.get("meta")) return json({ ts: meta?.ts || 0 });
      const data = await store.get("estado", { type: "json" });
      return json({ ts: meta?.ts || 0, data: data || null });
    }
    if (req.method === "PUT") {
      const body = await req.text();
      if (body.length > 4_000_000) return json({ error: "demasiado grande" }, 413);
      JSON.parse(body); // valida
      await store.set("estado", body);
      const ts = Date.now();
      await store.setJSON("meta", { ts });
      return json({ ts });
    }
  }

  if (path.endsWith("/photo")) {
    const id = url.searchParams.get("id") || "";
    if (!/^[a-f0-9]{40}$/.test(id)) return json({ error: "id inválido" }, 400);
    const k = "foto-" + id;
    if (req.method === "GET") {
      if (url.searchParams.get("check")) return json({ have: !!(await store.getMetadata(k)) });
      const buf = await store.get(k, { type: "arrayBuffer" });
      if (!buf) return new Response("", { status: 404 });
      return new Response(buf, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=31536000" } });
    }
    if (req.method === "PUT") {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 5_500_000) return json({ error: "foto demasiado grande" }, 413);
      await store.set(k, buf);
      return json({ ok: true });
    }
  }
  return json({ error: "no encontrado" }, 404);
};

export const config = { path: ["/api/sync", "/api/photo"] };

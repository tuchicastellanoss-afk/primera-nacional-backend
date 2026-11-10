// Código compartido por las funciones del Taller (Cloudflare Pages Functions + KV).
// Mismo "código" que usa la pantalla de contraseña (hash). Para uno propio: variable TALLER_KEY en Cloudflare.
export const DEFAULT_KEY = "76ad7747516ce6c12bbe22568989077e60d991b680f11deaf86fbe4b7eeb6c00";
export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const auth = (req, env) => req.headers.get("x-taller-key") === (env.TALLER_KEY || DEFAULT_KEY);

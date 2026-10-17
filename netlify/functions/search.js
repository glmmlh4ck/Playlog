// Función serverless: la clave de RAWG vive en la variable de entorno RAWG_KEY (nunca en el navegador).
const cache = new Map(), hits = new Map();
const H = { "Content-Type": "application/json" };
const out = (statusCode, obj, extra = {}) => ({ statusCode, headers: { ...H, ...extra }, body: typeof obj === "string" ? obj : JSON.stringify(obj) });

exports.handler = async (event) => {
  const q = (event.queryStringParameters?.q || "").trim().slice(0, 80);
  if (q.length < 2) return out(400, { error: "Escribe al menos 2 letras" });
  const key = process.env.RAWG_KEY;
  if (!key) return out(500, { error: "Falta configurar RAWG_KEY" });

  // Límite por IP: 30 búsquedas por minuto (por instancia, mejor esfuerzo)
  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 30) return out(429, { error: "Demasiadas búsquedas, espera un minuto" });
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 2000) hits.clear();

  // Caché 24 h para no gastar peticiones con búsquedas repetidas
  const ck = "v2:" + q.toLowerCase(), c = cache.get(ck);
  if (c && now - c.t < 864e5) return out(200, c.b, { "X-Cache": "HIT" });

  try {
    const r = await fetch(`https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(q)}&page_size=20`);
    if (!r.ok) return out(502, { error: "RAWG respondió " + r.status });
    const d = await r.json();
    const body = JSON.stringify({ results: (d.results || []).map(g => ({
      id: g.id, name: g.name, released: g.released, background_image: g.background_image, metacritic: g.metacritic ?? null,
      platforms: (g.platforms || []).map(p => ({ platform: { name: p.platform.name } })),
      genres: (g.genres || []).map(x => ({ name: x.name })) })) });
    cache.set(ck, { t: now, b: body });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return out(200, body, { "X-Cache": "MISS" });
  } catch (e) { return out(502, { error: "No se pudo contactar con RAWG" }); }
};

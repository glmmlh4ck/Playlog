// Búsqueda en IGDB: cada juego sale por separado (sin agrupar versiones), separa oficiales y no oficiales,
// busca también por nombres alternativos (p. ej. títulos en español) y ordena por fecha (más recientes primero).
// Variables de entorno en Netlify: TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET
const cache = new Map(), hits = new Map();
let tok = null;
const H = { "Content-Type": "application/json" };
const out = (code, o) => ({ statusCode: code, headers: H, body: typeof o === "string" ? o : JSON.stringify(o) });
const ID = () => process.env.TWITCH_CLIENT_ID, SEC = () => process.env.TWITCH_CLIENT_SECRET;

async function token() {
  if (tok && tok.exp > Date.now() + 60000) return tok.v;
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${ID()}&client_secret=${SEC()}&grant_type=client_credentials`, { method: "POST" });
  if (!r.ok) throw new Error("Twitch " + r.status);
  const d = await r.json();
  tok = { v: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return tok.v;
}
async function igdb(ep, body) {
  const r = await fetch("https://api.igdb.com/v4/" + ep, {
    method: "POST",
    headers: { "Client-ID": ID(), Authorization: "Bearer " + (await token()), Accept: "application/json" },
    body
  });
  if (!r.ok) throw new Error("IGDB " + r.status);
  return r.json();
}
const names = a => (a || []).map(x => x.name).filter(Boolean);
const hrs = s => (s ? Math.round((s / 3600) * 10) / 10 : null);
const iso = g => (g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : "");
const cov = g => (g.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg` : "");
const FIELDS = "name,first_release_date,summary,cover.image_id,platforms.name,genres.name,themes.name,game_modes.name,player_perspectives.name,similar_games.name,involved_companies.publisher,alternative_names.name,version_parent.name";

exports.handler = async (event) => {
  const q = (event.queryStringParameters?.q || "").trim().slice(0, 80).replace(/["\\*]/g, "");
  if (q.length < 2) return out(400, { error: "Escribe al menos 2 letras" });
  if (!ID() || !SEC()) return out(500, { error: "Falta configurar IGDB" });

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) return out(429, { error: "Demasiadas búsquedas, espera un minuto" });
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 2000) hits.clear();

  const ck = "v6:" + q.toLowerCase(), c = cache.get(ck);
  if (c && now - c.t < 864e5) return out(200, c.b);

  try {
    const pool = new Map();
    const page = off => igdb("games", `search "${q}"; fields ${FIELDS}; limit 100; offset ${off};`);
    (await page(0)).forEach(g => pool.set(g.id, g));
    (await Promise.all([100, 200].map(o => page(o).catch(() => [])))).flat().forEach(g => pool.set(g.id, g));
    // Nombres alternativos (títulos en español u otros idiomas), si IGDB los tiene registrados
    try { (await igdb("games", `fields ${FIELDS}; where alternative_names.name ~ *"${q}"*; limit 50;`)).forEach(g => pool.has(g.id) || pool.set(g.id, g)); } catch (e) { /* opcional */ }
    // Descarta solo las "ediciones" de otro juego (p. ej. "X Deluxe Edition"); versiones con nombre propio (Let's Go Pikachu / Eevee) se mantienen
    const keep = g => { const pn = (g.version_parent?.name || "").toLowerCase(); return !pn || !g.name.toLowerCase().includes(pn); };
    [...pool.values()].forEach(g => keep(g) || pool.delete(g.id));
    const ids = [...pool.keys()];
    let ttb = {};
    if (ids.length) {
      try {
        const t = await igdb("game_time_to_beats", `fields game_id,hastily,normally,completely; where game_id = (${ids.join(",")}); limit 200;`);
        t.forEach(x => (ttb[x.game_id] = { fast: hrs(x.hastily), main: hrs(x.normally), full: hrs(x.completely) }));
      } catch (e) { /* la duración es opcional */ }
    }
    const ql = q.toLowerCase();
    const results = [...pool.values()].map(g => {
      const alt = names(g.alternative_names).find(n => n.toLowerCase().includes(ql) && !g.name.toLowerCase().includes(ql)) || "";
      const comps = g.involved_companies || [];
      const upcoming = !g.first_release_date || g.first_release_date * 1000 > Date.now();
      return {
        id: g.id, title: g.name, alt, released: iso(g), cover: cov(g),
        platforms: names(g.platforms), genres: names(g.genres),
        tags: [...names(g.game_modes), ...names(g.player_perspectives), ...names(g.themes)],
        summary: g.summary || "", similar: names(g.similar_games).slice(0, 8), ttb: ttb[g.id] || null,
        // Oficial: tiene editora registrada; los anunciados o sin fecha con empresa implicada también cuentan
        official: comps.some(c => c.publisher) || (upcoming && comps.length > 0),
        versions: []
      };
    }).sort((a, b) => (b.released || "").localeCompare(a.released || ""));
    const body = JSON.stringify({ results });
    cache.set(ck, { t: now, b: body });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return out(200, body);
  } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
};

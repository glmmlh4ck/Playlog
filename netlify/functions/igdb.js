// Búsqueda en IGDB: agrupa versiones (remakes, remasters, ports y ediciones), separa oficiales y no oficiales,
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
const rel = g => [...(g.remakes || []), ...(g.remasters || []), ...(g.ports || [])];
// Título "base": quita sufijos de edición (Definitive Edition, Remastered, HD, 3D...) para agrupar versiones
const base = n => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/\s*\(.*?\)\s*$/, "")
  .replace(/\s*[:\-–]\s*[^:\-–]*\b(definitive|remaster(ed)?|remake|hd|deluxe|complete|ultimate|anniversary|enhanced|edition|director'?s cut|goty|game of the year)\b.*$/, "")
  .replace(/\s+(3d|hd|remastered|remaster|remake|definitive edition|deluxe edition|complete edition)$/, "")
  .replace(/[^a-z0-9]/g, "");
const FIELDS = "name,first_release_date,summary,cover.image_id,platforms.name,genres.name,themes.name,game_modes.name,player_perspectives.name,similar_games.name,total_rating_count,involved_companies.publisher,remakes,remasters,ports,alternative_names.name";

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

  const ck = "v3:" + q.toLowerCase(), c = cache.get(ck);
  if (c && now - c.t < 864e5) return out(200, c.b);

  try {
    const pool = new Map();
    (await igdb("games", `search "${q}"; fields ${FIELDS}; where version_parent = null; limit 100;`)).forEach(g => pool.set(g.id, g));
    // Nombres alternativos (títulos en español u otros idiomas), si IGDB los tiene registrados
    try { (await igdb("games", `fields ${FIELDS}; where alternative_names.name ~ *"${q}"* & version_parent = null; limit 50;`)).forEach(g => pool.has(g.id) || pool.set(g.id, g)); } catch (e) { /* opcional */ }
    // Trae también las versiones relacionadas (remakes, remasters, ports) que no salieron en la búsqueda
    const miss = new Set();
    pool.forEach(g => rel(g).forEach(i => pool.has(i) || miss.add(i)));
    if (miss.size) {
      try { (await igdb("games", `fields ${FIELDS}; where id = (${[...miss].slice(0, 80).join(",")}); limit 80;`)).forEach(g => pool.set(g.id, g)); } catch (e) { /* opcional */ }
    }
    const ids = [...pool.keys()];
    let ttb = {};
    if (ids.length) {
      try {
        const t = await igdb("game_time_to_beats", `fields game_id,hastily,normally,completely; where game_id = (${ids.join(",")}); limit 200;`);
        t.forEach(x => (ttb[x.game_id] = { fast: hrs(x.hastily), main: hrs(x.normally), full: hrs(x.completely) }));
      } catch (e) { /* la duración es opcional */ }
    }
    // Agrupa versiones: por relaciones de IGDB y por título base
    const par = new Map(ids.map(k => [k, k]));
    const find = x => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    const uni = (a, b) => par.set(find(a), find(b));
    pool.forEach(g => rel(g).forEach(i => pool.has(i) && uni(g.id, i)));
    const byBase = new Map();
    pool.forEach(g => { const k = base(g.name); if (!k) return; if (byBase.has(k)) uni(g.id, byBase.get(k)); else byBase.set(k, g.id); });
    const groups = new Map();
    pool.forEach(g => { const r = find(g.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(g); });
    const ql = q.toLowerCase();
    const results = [...groups.values()].map(list => {
      const p = [...list].sort((a, b) => a.name.length - b.name.length || (b.total_rating_count || 0) - (a.total_rating_count || 0))[0];
      const dates = list.map(iso).filter(Boolean).sort();
      const alt = list.flatMap(g => names(g.alternative_names)).find(n => n.toLowerCase().includes(ql) && !p.name.toLowerCase().includes(ql)) || "";
      return {
        id: p.id, title: p.name, alt, released: dates[0] || "", cover: cov(p) || list.map(cov).find(Boolean) || "",
        platforms: [...new Set(list.flatMap(g => names(g.platforms)))], genres: names(p.genres),
        tags: [...names(p.game_modes), ...names(p.player_perspectives), ...names(p.themes)],
        summary: p.summary || "", similar: names(p.similar_games).slice(0, 8), ttb: ttb[p.id] || null,
        official: list.some(g => (g.involved_companies || []).some(c => c.publisher)),
        pop: Math.max(...list.map(g => g.total_rating_count || 0)),
        versions: list.length > 1 ? list.map(g => ({ title: g.name, released: iso(g), cover: cov(g), platforms: names(g.platforms) }))
          .sort((a, b) => (a.released || "9").localeCompare(b.released || "9")) : []
      };
    }).sort((a, b) => b.pop - a.pop).slice(0, 60)
      .sort((a, b) => (b.released || "").localeCompare(a.released || ""))
      .map(({ pop, ...r }) => r);
    const body = JSON.stringify({ results });
    cache.set(ck, { t: now, b: body });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return out(200, body);
  } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
};

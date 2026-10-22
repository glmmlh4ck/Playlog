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
const shot = g => (g.screenshots || []).slice(0, 5).map(x => `https://images.igdb.com/igdb/image/upload/t_screenshot_big/${x.image_id}.jpg`);
const sim = g => (g.similar_games || []).slice(0, 8).map(x => ({ id: x.id, name: x.name, cover: x.cover?.image_id ? `https://images.igdb.com/igdb/image/upload/t_cover_big/${x.cover.image_id}.jpg` : "" }));
const dev = g => { const c = (g.involved_companies || []); const d = c.find(x => x.developer) || c.find(x => x.publisher) || c[0]; return d?.company?.name || ""; };
const FIELDS = "name,first_release_date,summary,cover.image_id,platforms.name,genres.name,themes.name,game_modes.name,player_perspectives.name,similar_games.name,involved_companies.publisher,involved_companies.developer,involved_companies.company.name,aggregated_rating,aggregated_rating_count,alternative_names.name,version_parent.name";

// Convierte un juego de IGDB en el formato que usa la app
const shape = (g, ttb, ql) => {
      const alt = names(g.alternative_names).find(n => n.toLowerCase().includes(ql) && !g.name.toLowerCase().includes(ql)) || "";
      const comps = g.involved_companies || [];
      const upcoming = !g.first_release_date || g.first_release_date * 1000 > Date.now();
      return {
        id: g.id, title: g.name, alt, released: iso(g), cover: cov(g),
        platforms: names(g.platforms), genres: names(g.genres),
        tags: [...names(g.game_modes), ...names(g.player_perspectives), ...names(g.themes)],
        summary: g.summary || "", similar: names(g.similar_games).slice(0, 8), ttb: ttb[g.id] || null,
        dev: dev(g), critic: g.aggregated_rating ? Math.round(g.aggregated_rating) : null, criticN: g.aggregated_rating_count || 0,
        // Oficial: tiene editora registrada; los anunciados o sin fecha con empresa implicada también cuentan
        official: comps.some(c => c.publisher) || (upcoming && comps.length > 0),
        versions: []
      };
};

// Detalle de un juego (se pide al abrir su ficha): hasta 5 capturas y hasta 8 juegos similares.
// Si IGDB trae menos de 8 similares, se completan con juegos populares de los mismos géneros/temas.
// Ficha completa de un juego por id (al pulsar un "juego similar")
async function oneGame(id) {
  const [g] = await igdb("games", `fields ${FIELDS}; where id = ${id};`);
  if (!g) return { game: null };
  const ttb = {};
  try {
    const t = await igdb("game_time_to_beats", `fields game_id,hastily,normally,completely; where game_id = ${id}; limit 1;`);
    t.forEach(x => (ttb[x.game_id] = { fast: hrs(x.hastily), main: hrs(x.normally), full: hrs(x.completely) }));
  } catch (e) { /* la duración es opcional */ }
  return { game: shape(g, ttb, "") };
}
// Utilidades para DLCs: encontrar el id de IGDB por título y buscar DLCs/expansiones por nombre
const fgc = new Map(), dqc = new Map(), mh = new Map();
const cleanQ = v => String(v || "").trim().slice(0, 60).replace(/["\\*]/g, "");
async function findId(t) {
  const r = await igdb("games", `search "${t}"; fields name; where version_parent = null & parent_game = null; limit 1;`);
  return { id: r[0]?.id || 0 };
}
async function dlcSearch(q, parent) {
  const w = ["parent_game != null"]; if (parent) w.push(`parent_game = ${parent}`);
  const r = await igdb("games", `${q ? `search "${q}"; ` : ""}fields name,first_release_date,cover.image_id,parent_game.name; where ${w.join(" & ")}; limit 30;`);
  return { items: r.map(g => ({ id: g.id, name: g.name, kind: /expansi/i.test(g.name) ? "Expansión" : "DLC", released: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : "", parent: g.parent_game?.name || "" })) };
}
// Juegos populares para que el usuario elija sus gustos (máx. 5 por género para que haya variedad)
const GENRES = ["Adventure","Arcade","Card & Board Game","Fighting","Hack and slash/Beat 'em up","Indie","MOBA","Music","Pinball","Platform","Point-and-click","Puzzle","Quiz/Trivia","Racing","Real Time Strategy (RTS)","Role-playing (RPG)","Shooter","Simulator","Sport","Strategy","Tactical","Turn-based strategy (TBS)","Visual Novel"];
let upc = { t: 0, b: "" }; let rcC = { t: 0, b: "" }; let popC = { t: 0, b: "" }; const recC = new Map();
async function popular() {
  const r = await igdb("games", "fields name,cover.image_id,genres.name; where total_rating_count > 400 & version_parent = null & parent_game = null & cover != null & genres != null; sort total_rating_count desc; limit 150;");
  const per = {}, out_ = [];
  for (const g of r) { const k = g.genres?.[0]?.name || "?"; per[k] = (per[k] || 0) + 1; if (per[k] > 5) continue; out_.push({ id: g.id, title: g.name, cover: cov(g), genres: (g.genres || []).map(x => x.name) }); if (out_.length >= 36) break; }
  return { items: out_ };
}
// Recomendaciones: juegos similares a los que le gustan + juegos bien valorados de sus géneros favoritos
async function recommend(like, gn, ex) {
  const items = [], seen = new Set(ex);
  const add = (g, why) => { if (!g || seen.has(g.id) || !g.cover?.image_id) return; seen.add(g.id); items.push({ id: g.id, title: g.name, cover: cov(g), released: iso(g), genres: (g.genres || []).map(x => x.name).slice(0, 2), why }); };
  if (like.length) {
    try { const r = await igdb("games", `fields similar_games.name,similar_games.cover.image_id,similar_games.first_release_date,similar_games.genres.name; where id = (${like.join(",")}); limit 20;`); r.forEach(g => (g.similar_games || []).forEach(x => add(x, "sim"))); } catch (e) { /* opcional */ }
  }
  if (gn.length && items.length < 16) {
    try { const w = [`genres.name = (${gn.map(x => `"${x}"`).join(",")})`, "total_rating_count > 250", "version_parent = null", "parent_game = null", "cover != null"]; if (seen.size) w.push(`id != (${[...seen].slice(0, 80).join(",")})`);
      const r = await igdb("games", `fields name,cover.image_id,first_release_date,genres.name; where ${w.join(" & ")}; sort total_rating desc; limit 40;`); r.forEach(g => add(g, "gen")); } catch (e) { /* opcional */ }
  }
  return { items: items.slice(0, 18) };
}
const dcache = new Map(), dhits = new Map();
async function detail(id) {
  const [g] = await igdb("games", `fields screenshots.image_id,similar_games.name,similar_games.cover.image_id,genres,themes,dlcs.name,dlcs.first_release_date,dlcs.cover.image_id,expansions.name,expansions.first_release_date,expansions.cover.image_id,standalone_expansions.name,standalone_expansions.first_release_date,standalone_expansions.cover.image_id; where id = ${id};`);
  if (!g) return { screens: [], simG: [] };
  const simG = sim(g), seen = new Set([Number(id), ...(g.similar_games || []).map(x => x.id)]);
  const gen = g.genres || [], th = g.themes || [];
  for (const [a, z] of [["[", "]"], ["(", ")"]]) {
    if (simG.length >= 8 || !gen.length) break;
    try {
      const w = [`genres = ${a}${gen.join(",")}${z}`, `id != (${[...seen].join(",")})`, "cover != null", "version_parent = null", "total_rating_count > 10"];
      if (th.length) w.push(`themes = (${th.join(",")})`);
      const more = await igdb("games", `fields name,cover.image_id; where ${w.join(" & ")}; sort total_rating_count desc; limit 20;`);
      for (const x of more) { if (simG.length >= 8) break; if (seen.has(x.id)) continue; seen.add(x.id); simG.push({ id: x.id, name: x.name, cover: cov(x) }); }
    } catch (e) { /* opcional */ }
  }
  const dl = [];
  [["dlcs", "DLC"], ["expansions", "Expansión"], ["standalone_expansions", "Expansión"]].forEach(([f, kind]) => (g[f] || []).forEach(x => {
    if (!dl.some(d => d.id === x.id)) dl.push({ id: x.id, name: x.name, kind, released: x.first_release_date ? new Date(x.first_release_date * 1000).toISOString().slice(0, 10) : "", cover: cov(x) });
  }));
  dl.sort((a, b) => (a.released || "9").localeCompare(b.released || "9"));
  return { screens: shot(g), simG, dlcs: dl.slice(0, 30) };
}

exports.handler = async (event) => {
  const q = (event.queryStringParameters?.q || "").trim().slice(0, 80).replace(/["\\*]/g, "");
  if (!ID() || !SEC()) return out(500, { error: "Falta configurar IGDB" });

  if (event.queryStringParameters && event.queryStringParameters.recent !== undefined) {
    const rn = Date.now();
    if (rcC.b && rn - rcC.t < 6 * 36e5) return out(200, rcC.b);
    try {
      const now = Math.floor(rn / 1000), from = now - 30 * 864e2;
      const base = `fields name,first_release_date,cover.image_id,platforms.abbreviation,platforms.name,hypes,genres.name; where first_release_date >= ${from} & first_release_date <= ${now} & cover != null & version_parent = null`;
      let r = await igdb("games", `${base} & hypes > 0; sort hypes desc; limit 14;`);
      if (r.length < 8) {
        const extra = await igdb("games", `${base}; sort first_release_date desc; limit 14;`);
        const have = new Set(r.map(g => g.id));
        r = r.concat(extra.filter(g => !have.has(g.id))).slice(0, 14);
      }
      const body = JSON.stringify({ items: r.sort((a, b) => b.first_release_date - a.first_release_date).map(g => ({
        id: g.id, title: g.name, released: new Date(g.first_release_date * 1000).toISOString().slice(0, 10),
        cover: `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`,
        platforms: (g.platforms || []).slice(0, 3).map(p => p.abbreviation || p.name),
        genres: (g.genres || []).map(x => x.name)
      })) });
      rcC = { t: rn, b: body };
      return out(200, body);
    } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
  }
  if (event.queryStringParameters && event.queryStringParameters.upcoming !== undefined) {
    const un = Date.now();
    if (upc.b && un - upc.t < 6 * 36e5) return out(200, upc.b);
    try {
      const now = Math.floor(un / 1000);
      const F = "fields name,first_release_date,cover.image_id,platforms.abbreviation,platforms.name,hypes,genres.name;";
      let r = await igdb("games", `${F} where first_release_date > ${now} & first_release_date < ${now + 150 * 864e2} & cover != null & hypes > 2 & version_parent = null; sort hypes desc; limit 14;`);
      if (r.length < 6) {
        // Si hay pocos con tanto "hype", se amplía la ventana y se baja el listón
        const more = await igdb("games", `${F} where first_release_date > ${now} & first_release_date < ${now + 400 * 864e2} & cover != null & hypes > 0 & version_parent = null; sort hypes desc; limit 14;`);
        const have = new Set(r.map(g => g.id));
        r = r.concat(more.filter(g => !have.has(g.id))).slice(0, 14);
      }
      if (!r.length) return out(200, { items: [] });
      const body = JSON.stringify({ items: r.sort((a, b) => a.first_release_date - b.first_release_date).map(g => ({
        id: g.id, title: g.name, released: new Date(g.first_release_date * 1000).toISOString().slice(0, 10),
        cover: `https://images.igdb.com/igdb/image/upload/t_cover_big/${g.cover.image_id}.jpg`,
        platforms: (g.platforms || []).slice(0, 3).map(p => p.abbreviation || p.name),
        genres: (g.genres || []).map(x => x.name)
      })) });
      upc = { t: un, b: body };
      return out(200, body);
    } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
  }
  const qp = event.queryStringParameters || {};
  if (qp.popular !== undefined || qp.rec !== undefined) {
    const pip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?", pn = Date.now();
    const pr = (mh.get("p" + pip) || []).filter(t => pn - t < 60000);
    if (pr.length >= 20) return out(429, { error: "Demasiadas peticiones, espera un momento" });
    pr.push(pn); mh.set("p" + pip, pr);
    try {
      if (qp.popular !== undefined) {
        if (!popC.b || pn - popC.t > 864e5) popC = { t: pn, b: JSON.stringify(await popular()) };
        return out(200, popC.b);
      }
      const ids = v => String(v || "").split(",").filter(x => /^\d{1,9}$/.test(x)).slice(0, 12), like = ids(qp.like), ex = ids(qp.ex).concat(like);
      const gn = String(qp.gn || "").split("|").map(x => x.trim()).filter(x => GENRES.includes(x)).slice(0, 4);
      if (!like.length && !gn.length) return out(200, { items: [] });
      const rk = [like.sort().join(","), gn.sort().join("|"), ex.slice(0, 40).sort().join(",")].join("#"), rc = recC.get(rk);
      if (rc && pn - rc.t < 432e5) return out(200, rc.b);
      const body = JSON.stringify(await recommend(like, gn, ex.slice(0, 60)));
      recC.set(rk, { t: pn, b: body }); if (recC.size > 500) recC.delete(recC.keys().next().value);
      return out(200, body);
    } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
  }
  if (qp.findid !== undefined || qp.dlcq !== undefined) {
    const mip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?", mn = Date.now();
    const mr = (mh.get(mip) || []).filter(t => mn - t < 60000);
    if (mr.length >= 40) return out(429, { error: "Demasiadas peticiones, espera un momento" });
    mr.push(mn); mh.set(mip, mr); if (mh.size > 2000) mh.clear();
    const isF = qp.findid !== undefined, cq = cleanQ(isF ? qp.findid : qp.dlcq), par = /^\d{1,9}$/.test(qp.parent || "") ? qp.parent : "";
    if (cq.length < 2 && !(par && !isF)) return out(400, { error: "Escribe al menos 2 letras" });
    const ck = (isF ? "f1:" : "q1:") + cq.toLowerCase() + ":" + par, mc = (isF ? fgc : dqc).get(ck);
    if (mc && mn - mc.t < 864e5) return out(200, mc.b);
    try {
      const body = JSON.stringify(isF ? await findId(cq) : await dlcSearch(cq, par));
      const m = isF ? fgc : dqc; m.set(ck, { t: mn, b: body }); if (m.size > 800) m.delete(m.keys().next().value);
      return out(200, body);
    } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
  }

  const did = (event.queryStringParameters?.id || "").trim(), gid = (event.queryStringParameters?.gid || "").trim();
  if (did || gid) {
    if (!/^\d{1,9}$/.test(did || gid)) return out(400, { error: "id no válido" });
    const dip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?", dn = Date.now();
    const dr = (dhits.get(dip) || []).filter(t => dn - t < 60000);
    if (dr.length >= 60) return out(429, { error: "Demasiadas peticiones, espera un minuto" });
    dr.push(dn); dhits.set(dip, dr); if (dhits.size > 2000) dhits.clear();
    const dk = (gid ? "g10:" + gid : "d10:" + did), dc = dcache.get(dk);
    if (dc && dn - dc.t < 864e5) return out(200, dc.b);
    try {
      const body = JSON.stringify(gid ? await oneGame(gid) : await detail(did));
      dcache.set(dk, { t: dn, b: body });
      if (dcache.size > 500) dcache.delete(dcache.keys().next().value);
      return out(200, body);
    } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
  }

  if (q.length < 2) return out(400, { error: "Escribe al menos 2 letras" });

  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= 20) return out(429, { error: "Demasiadas búsquedas, espera un minuto" });
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 2000) hits.clear();

  const ck = "v8:" + q.toLowerCase(), c = cache.get(ck);
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
    const results = [...pool.values()].map(g => shape(g, ttb, ql)    ).sort((a, b) => (b.released || "").localeCompare(a.released || ""));
    const body = JSON.stringify({ results });
    cache.set(ck, { t: now, b: body });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    return out(200, body);
  } catch (e) { return out(502, { error: "No se pudo contactar con IGDB" }); }
};

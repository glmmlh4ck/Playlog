// Cuentas y sincronización en la nube con Supabase. Las claves quedan en el servidor (variables de Netlify):
//   SUPABASE_URL          -> https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY  -> clave "service_role" (Project Settings > API)
// Acciones (POST JSON { action, ... }): signup, login, refresh, recover, reset, pull, push, setpublic, search, profile
const URL_ = () => (process.env.SUPABASE_URL || "").replace(/\/$/, ""), KEY = () => process.env.SUPABASE_SERVICE_KEY || "";
const J = (code, o) => ({ statusCode: code, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }, body: JSON.stringify(o) });
const hits = new Map();
// Claves nuevas de Supabase (sb_secret_...): no son un JWT, así que van solo en "apikey". Las antiguas (service_role, JWT) también en Authorization.
const hdr = (tok) => { const h = { apikey: KEY(), "content-type": "application/json" }; if (tok) h.Authorization = "Bearer " + tok; else if (!KEY().startsWith("sb_")) h.Authorization = "Bearer " + KEY(); return h; };
async function sb(path, opt = {}, tok) {
  const r = await fetch(URL_() + path, { ...opt, headers: { ...hdr(tok), ...(opt.headers || {}) } });
  const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch (_) { b = { raw: t }; }
  return { ok: r.ok, status: r.status, b };
}
const okUser = u => /^[a-z0-9_]{3,20}$/.test(u), okMail = m => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m) && m.length <= 120;
const session = (b, username) => ({ access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at || Math.floor(Date.now() / 1000) + (b.expires_in || 3600), username });
const XPR = { session: 10, perHour: 20, maxMin: 600, done: 100 };
const okCover = c => (typeof c === "string" && /^https:\/\/(images\.igdb\.com|media\.rawg\.io)\//.test(c) ? c : "");
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, h: Math.round(v / 6) / 10 }));
// Resumen público: solo cifras y juegos (sin notas, reseñas ni sesiones sueltas)
function summarize(d) {
  const games = Array.isArray(d.games) ? d.games : [], ses = Array.isArray(d.sessions) ? d.sessions : [];
  const gm = {}, dm = {}, gen = {}, plt = {};
  const byId = new Map(games.map(g => [g.id, g]));
  ses.forEach(x => { const g = byId.get(x.gameId); if (!g || g.status === "wish" || typeof x.min !== "number") return; gm[x.gameId] = (gm[x.gameId] || 0) + x.min; dm[x.date] = (dm[x.date] || 0) + x.min;
    String(g.genre || "").split(",").map(z => z.trim()).filter(Boolean).forEach(z => gen[z] = (gen[z] || 0) + x.min); const p = x.platform || g.platform; if (p) plt[p] = (plt[p] || 0) + x.min; });
  let xp = 0; Object.values(dm).forEach(m => xp += Math.min(m, XPR.maxMin) / 60 * XPR.perHour);
  const done = games.filter(g => g.status === "done").length;
  xp = Math.round(xp + ses.length * XPR.session + done * XPR.done);
  const days = Object.keys(dm).sort(); let rec = 0, run = 0, pv = null;
  days.forEach(x => { const t = new Date(x + "T12:00:00Z"); run = pv && Math.round((t - pv) / 864e5) === 1 ? run + 1 : 1; pv = t; rec = Math.max(rec, run); });
  const tot = Object.values(gm).reduce((a, b) => a + b, 0);
  return { xp, lv: Math.floor(Math.sqrt(xp / 50)) + 1, hours: Math.round(tot / 6) / 10, sessions: ses.length, done, games: games.length, rec,
    genres: top(gen, 5), platforms: top(plt, 5), name: String(d.user?.name || "").slice(0, 30),
    list: games.slice(0, 400).map(g => ({ t: String(g.title || "").slice(0, 80), c: okCover(g.cover), s: g.status, r: g.rating?.score ?? null, h: Math.round((gm[g.id] || 0) / 6) / 10, p: String(g.platform || "").slice(0, 30) })) };
}
async function userFromToken(tok) {
  if (!tok) return null;
  const r = await sb("/auth/v1/user", {}, tok); if (!r.ok || !r.b?.id) return null;
  const p = await sb(`/rest/v1/profiles?id=eq.${r.b.id}&select=username,is_public`);
  return { id: r.b.id, username: p.b?.[0]?.username || "", pub: !!p.b?.[0]?.is_public };
}
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return J(405, { error: "Método no permitido" });
  if (!URL_() || !KEY()) return J(500, { error: "Las cuentas aún no están configuradas en el servidor (faltan variables de Supabase)." });
  const ip = event.headers["x-nf-client-connection-ip"] || event.headers["x-forwarded-for"] || "?", now = Date.now();
  const h = (hits.get(ip) || []).filter(t => now - t < 60000); if (h.length >= 40) return J(429, { error: "Demasiados intentos, espera un minuto." });
  h.push(now); hits.set(ip, h); if (hits.size > 3000) hits.clear();
  let a; try { a = JSON.parse(event.body || "{}"); } catch (_) { return J(400, { error: "Petición no válida" }); }
  const act = a.action, tok = (event.headers.authorization || "").replace(/^Bearer /i, "");
  try {
    if (act === "signup") {
      const u = String(a.username || "").trim().toLowerCase(), m = String(a.email || "").trim().toLowerCase(), pw = String(a.password || "");
      if (!okUser(u)) return J(400, { error: "El usuario debe tener 3-20 letras, números o _" });
      if (!okMail(m)) return J(400, { error: "Correo no válido" });
      if (pw.length < 8 || pw.length > 72) return J(400, { error: "La contraseña debe tener entre 8 y 72 caracteres" });
      const ex = await sb(`/rest/v1/profiles?username=eq.${encodeURIComponent(u)}&select=id`);
      if (ex.ok && ex.b?.length) return J(409, { error: "Ese nombre de usuario ya está cogido" });
      const c = await sb("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email: m, password: pw, email_confirm: true, user_metadata: { username: u } }) });
      if (!c.ok) return J(c.status === 422 || c.status === 409 ? 409 : 502, { error: /already|registered|exists/i.test(JSON.stringify(c.b)) ? "Ese correo ya tiene una cuenta" : "No se pudo crear la cuenta" });
      const p = await sb("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: c.b.id, username: u, email: m, is_public: a.public !== false }), headers: { Prefer: "return=minimal" } });
      if (!p.ok) { await sb(`/auth/v1/admin/users/${c.b.id}`, { method: "DELETE" }); return J(409, { error: "Ese nombre de usuario ya está cogido" }); }
      const l = await sb("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email: m, password: pw }) });
      if (!l.ok) return J(502, { error: "Cuenta creada, pero no se pudo iniciar sesión. Prueba a entrar." });
      return J(200, { session: session(l.b, u) });
    }
    if (act === "login") {
      const id = String(a.username || "").trim().toLowerCase(), pw = String(a.password || "");
      if (!id || !pw) return J(400, { error: "Escribe usuario y contraseña" });
      let email = id, uname = "";
      if (!id.includes("@")) { if (!okUser(id)) return J(401, { error: "Usuario o contraseña incorrectos" }); const p = await sb(`/rest/v1/profiles?username=eq.${encodeURIComponent(id)}&select=email,username`); if (!p.b?.[0]) return J(401, { error: "Usuario o contraseña incorrectos" }); email = p.b[0].email; uname = p.b[0].username; }
      const l = await sb("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password: pw }) });
      if (!l.ok) return J(401, { error: "Usuario o contraseña incorrectos" });
      if (!uname) { const p = await sb(`/rest/v1/profiles?id=eq.${l.b.user.id}&select=username`); uname = p.b?.[0]?.username || id; }
      return J(200, { session: session(l.b, uname) });
    }
    if (act === "refresh") {
      const l = await sb("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: String(a.refresh_token || "") }) });
      if (!l.ok) return J(401, { error: "Sesión caducada" });
      return J(200, { session: session(l.b, String(a.username || "")) });
    }
    if (act === "recover") {
      const id = String(a.id || "").trim().toLowerCase(); let email = id;
      if (id && !id.includes("@")) { const p = okUser(id) ? await sb(`/rest/v1/profiles?username=eq.${encodeURIComponent(id)}&select=email`) : null; email = p?.b?.[0]?.email || ""; }
      if (email && okMail(email)) await sb("/auth/v1/recover", { method: "POST", body: JSON.stringify({ email }) });
      return J(200, { ok: true }); // siempre igual: no revela si la cuenta existe
    }
    if (act === "reset") {
      const pw = String(a.password || ""); if (pw.length < 8 || pw.length > 72) return J(400, { error: "La contraseña debe tener entre 8 y 72 caracteres" });
      const r = await sb("/auth/v1/user", { method: "PUT", body: JSON.stringify({ password: pw }) }, String(a.token || ""));
      return r.ok ? J(200, { ok: true }) : J(401, { error: "El enlace ha caducado. Pide otro desde 'Olvidé mi contraseña'." });
    }
    if (act === "pull" || act === "push") {
      const u = await userFromToken(tok); if (!u) return J(401, { error: "Sesión caducada" });
      if (act === "pull") { const r = await sb(`/rest/v1/saves?user_id=eq.${u.id}&select=data,updated_at`); return J(200, { data: r.b?.[0]?.data || null, updated_at: r.b?.[0]?.updated_at || null, username: u.username, is_public: u.pub }); }
      const d = a.data; if (!d || typeof d !== "object") return J(400, { error: "Datos no válidos" });
      if (JSON.stringify(d).length > 4e6) return J(413, { error: "Demasiados datos" });
      const r = await sb("/rest/v1/saves", { method: "POST", body: JSON.stringify({ user_id: u.id, data: d, updated_at: new Date().toISOString() }), headers: { Prefer: "resolution=merge-duplicates,return=minimal" } });
      if (r.ok) { try { await sb(`/rest/v1/profiles?id=eq.${u.id}`, { method: "PATCH", body: JSON.stringify({ summary: summarize(d) }), headers: { Prefer: "return=minimal" } }); } catch (_) { /* opcional */ } }
      return r.ok ? J(200, { ok: true, updated_at: new Date().toISOString() }) : J(502, { error: "No se pudo guardar en la nube" });
    }
    if (act === "setpublic" || act === "search" || act === "profile") {
      const u = await userFromToken(tok); if (!u) return J(401, { error: "Sesión caducada" });
      if (act === "setpublic") { const r = await sb(`/rest/v1/profiles?id=eq.${u.id}`, { method: "PATCH", body: JSON.stringify({ is_public: (a.public ?? a.value) === true }), headers: { Prefer: "return=minimal" } }); return r.ok ? J(200, { ok: true, public: (a.public ?? a.value) === true }) : J(502, { error: "No se pudo cambiar" }); }
      if (act === "search") {
        const q = String(a.q || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20); if (q.length < 2) return J(400, { error: "Escribe al menos 2 letras" });
        const r = await sb(`/rest/v1/profiles?username=ilike.${q}*&is_public=eq.true&select=username,summary&order=username.asc&limit=15`);
        return J(200, { items: (r.b || []).map(x => ({ username: x.username, lv: x.summary?.lv || 1, hours: x.summary?.hours || 0, done: x.summary?.done || 0 })) });
      }
      const name = String(a.username || "").toLowerCase(); if (!okUser(name)) return J(404, { error: "Usuario no encontrado" });
      const p = await sb(`/rest/v1/profiles?username=eq.${encodeURIComponent(name)}&select=id,username,is_public`);
      const row = p.b?.[0]; if (!row || (!row.is_public && row.id !== u.id)) return J(404, { error: "Este perfil no existe o es privado" });
      const sv = await sb(`/rest/v1/saves?user_id=eq.${row.id}&select=data`); const d = sv.b?.[0]?.data;
      if (!d) return J(404, { error: "Este usuario aún no tiene datos" });
      return J(200, { username: row.username, ...summarize(d) });
    }
    return J(400, { error: "Acción desconocida" });
  } catch (e) { return J(502, { error: "No se pudo contactar con el servidor de cuentas" }); }
};

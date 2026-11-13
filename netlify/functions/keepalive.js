// Mantiene activo el proyecto gratuito de Supabase (que se pausa tras ~1 semana sin actividad).
// Netlify lo ejecuta solo, una vez al día (ver "schedule" más abajo). Hace una consulta mínima.
const URL_ = () => (process.env.SUPABASE_URL || "").replace(/\/$/, ""), KEY = () => process.env.SUPABASE_SERVICE_KEY || "";
exports.config = { schedule: "0 8 * * *" };
exports.handler = async () => {
  try {
    const h = { apikey: KEY() };
    if (!KEY().startsWith("sb_")) h.Authorization = "Bearer " + KEY();
    const r = await fetch(URL_() + "/rest/v1/profiles?select=id&limit=1", { headers: h });
    console.log("keepalive supabase:", r.status);
    return { statusCode: 200, body: "ok " + r.status };
  } catch (e) {
    console.log("keepalive error:", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};

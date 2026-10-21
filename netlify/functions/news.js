// Noticias de videojuegos en español: lee varios feeds RSS públicos y los junta.
// Para cambiar de medios, edita la lista FEEDS (cualquier feed RSS/Atom sirve).
const FEEDS = [
  ["Eurogamer", "https://www.eurogamer.es/feed"],
  ["IGN España", "https://es.ign.com/feed.xml"],
  ["Vidaextra", "https://www.vidaextra.com/feedburner.xml"],
  ["Area Jugones", "https://www.areajugones.es/feed/"],
  ["Nintenderos", "https://www.nintenderos.com/feed/"],
  ["GeneraciónXbox", "https://www.generacionxbox.com/feed/"],
  ["Vandal", "https://vandal.elespanol.com/xml.cgi"],
  ["HobbyConsolas", "https://www.hobbyconsolas.com/rss"]
];
const H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=900" };
const dec = s => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
const tag = (x, t) => { const m = x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`, "i")); return m ? dec(m[1]) : ""; };
const attr = (x, re) => { const m = x.match(re); return m ? dec(m[1]) : ""; };
function parse(xml, src) {
  const items = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return items.slice(0, 12).map(x => {
    const title = tag(x, "title").replace(/<[^>]+>/g, "");
    const link = tag(x, "link") || attr(x, /<link[^>]*href="([^"]+)"/i);
    const d = new Date(tag(x, "pubDate") || tag(x, "published") || tag(x, "updated") || tag(x, "dc:date"));
    const img = attr(x, /<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i) || attr(x, /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) || attr(x, /<img[^>]*src="([^"]+)"/i) || attr(dec(x), /<img[^>]*src="([^"]+)"/i);
    return { title, link, src, img: /^https:\/\//.test(img) ? img : "", t: isNaN(d) ? 0 : d.getTime() };
  }).filter(i => i.title && /^https?:\/\//.test(i.link));
}
const cache = new Map();
exports.handler = async (event) => {
  // ?src=Eurogamer|IGN España  -> solo esas editoriales (vacío = todas)
  const want = String(event?.queryStringParameters?.src || "").split("|").map(x => x.trim()).filter(Boolean);
  const feeds = want.length ? FEEDS.filter(f => want.includes(f[0])) : FEEDS, ck = feeds.map(f => f[0]).sort().join("|"), cc = cache.get(ck);
  if (cc && Date.now() - cc.t < 15 * 60 * 1000) return { statusCode: 200, headers: H, body: cc.b };
  const res = await Promise.allSettled(feeds.map(async ([n, u]) => {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
    try { const r = await fetch(u, { signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 Playlog", accept: "application/rss+xml, application/xml, text/xml, */*" } }); if (!r.ok) throw 0; return parse(await r.text(), n); } finally { clearTimeout(to); }
  }));
  const all = res.flatMap(r => (r.status === "fulfilled" ? r.value : []));
  // Intercala medios (máx. 4 por fuente) y ordena por fecha
  const per = {}, items = all.sort((a, b) => b.t - a.t).filter(i => (per[i.src] = (per[i.src] || 0) + 1) <= Math.max(4, Math.ceil(20 / feeds.length))).slice(0, 20);
  const body = JSON.stringify({ items });
  if (items.length) { cache.set(ck, { t: Date.now(), b: body }); if (cache.size > 60) cache.delete(cache.keys().next().value); }
  return { statusCode: 200, headers: H, body };
};

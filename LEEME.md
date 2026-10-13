# Playlog – publicar con Netlify (clave de RAWG oculta)

1. En rawg.io/apidocs pulsa **Refresh Key** y copia la clave nueva.
2. Crea una cuenta gratis en github.com → **New repository** (nombre: playlog).
3. En el repositorio: **Add file → Upload files** y arrastra TODO el contenido de esta carpeta
   (index.html, netlify.toml y la carpeta netlify con functions/search.js). Pulsa **Commit changes**.
4. En app.netlify.com: **Add new site → Import an existing project → GitHub** y elige el repositorio. Deja todo por defecto y pulsa Deploy.
5. En Netlify: **Site configuration → Environment variables → Add a variable**:
   Clave `RAWG_KEY`, valor = tu clave nueva. Después **Deploys → Trigger deploy → Deploy site**.
6. Abre la dirección del sitio, pulsa **+ Juego** y busca "Pokémon".
7. Pon esa dirección en tu perfil de RAWG (Site/App url) y mantén el enlace "Datos: RAWG" visible.

Notas: cada persona guarda sus datos solo en su propio navegador (no hay cuentas todavía).
La caché y el límite por IP funcionan por instancia, así que son un ahorro, no una garantía.

## IGDB (portadas verticales, duración, etiquetas, resumen y juegos similares)
En dev.twitch.tv/console registra una aplicación (Client Type: Confidential, OAuth Redirect URL: http://localhost),
crea un Client Secret y añade en Netlify las variables TWITCH_CLIENT_ID y TWITCH_CLIENT_SECRET. Después, Trigger deploy.
Si IGDB no está configurado, la app usa RAWG automáticamente..

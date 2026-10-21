# Playlog — qué subir a GitHub y qué configurar

## Archivos
| Archivo | Dónde va |
|---|---|
| `index.html`, `sw.js`, `netlify.toml` | raíz del repositorio |
| `netlify/functions/igdb.js`, `search.js` (necesita `RAWG_KEY`), `news.js`, `account.js` | carpeta `netlify/functions/` |
| `supabase.sql` | no se sube: se pega en Supabase (paso 2) |

## Cuentas y sincronización (opcional, solo si quieres usar cuentas)
1. Crea un proyecto gratis en https://supabase.com
2. En Supabase > SQL Editor pega el contenido de `supabase.sql` y pulsa Run. (Si ya lo ejecutaste antes, vuelve a ejecutarlo: es seguro y añade las columnas del buscador de usuarios.)
3. En Supabase > Authentication > Providers > Email: deja activado "Email" (no hace falta confirmar el correo para registrarse).
4. En Supabase > Authentication > URL Configuration: pon como "Site URL" la dirección de tu web de Netlify (así el enlace del correo de "olvidé mi contraseña" vuelve a tu app).
5. En Supabase > Project Settings > API copia la "Project URL" (en Settings > General o en la pestaña Data API) y la **Secret key** (`sb_secret_...`; en proyectos antiguos se llama service_role).
6. En Netlify > Site configuration > Environment variables añade:
   - `SUPABASE_URL` = la Project URL
   - `SUPABASE_SERVICE_KEY` = la Secret key (¡secreta, solo en Netlify!)
7. En Netlify haz "Trigger deploy". Después, en la app: Perfil > Ajustes > Cuenta.

Las variables de IGDB (`TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` o como las tengas) siguen igual.

## Noticias
`news.js` lee los feeds RSS de la lista `FEEDS` (arriba del archivo). Si algún medio no carga, se ignora; puedes cambiar o añadir feeds.

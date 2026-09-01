// server.js
// Servidor que expone la tabla de posiciones de Primera Nacional, con los
// próximos 5 partidos de cada equipo YA INCLUIDOS en la misma respuesta de
// /tabla (para que funcione con la versión de la página que ya está
// publicada, sin necesitar volver a subir nada a Netlify).
//
// Cómo probarlo en tu compu (si tenés Node.js instalado):
//   npm install express node-fetch cors
//   node server.js
//   Abrí http://localhost:3000/tabla en el navegador
//
// Para subirlo gratis a internet, seguí la guía de despliegue en Render.

const path = require('path');
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

// ============================================================
// ESCUDOS PROPIOS (override)
// ------------------------------------------------------------
// ESPN a veces tiene cargado un escudo incorrecto o desactualizado
// para algún equipo. Acá podés forzar el escudo correcto: se sirve
// directamente desde este mismo servidor (carpeta /public/escudos)
// en vez de usar el link que manda ESPN.
//
// Para agregar más equipos: copiá el PNG a public/escudos/ y sumá
// una línea nueva con un fragmento (en minúsculas) del nombre del
// equipo tal como lo devuelve ESPN.
// ============================================================
// Se deja disponible por si hace falta para pruebas locales, pero el link
// que se manda al frontend NO apunta acá (ver URL_BASE_ESCUDOS más abajo):
// Render "duerme" el servicio gratuito, y si el navegador pide una imagen
// justo cuando está dormido, esa imagen puntual tarda 30-50 segundos en
// aparecer mientras las demás (que vienen del CDN de ESPN) cargan al toque.
app.use('/escudos', express.static(path.join(__dirname, 'public', 'escudos')));

// Dominio donde están alojadas las imágenes de escudos corregidos.
// Usá tu dominio de Vercel (CDN rápido, sin cold-start) subiendo el archivo
// a /escudos/central-norte.png en la raíz de ese proyecto.
// Se puede pisar sin tocar código: en Render → tu servicio → Environment →
// agregá la variable URL_BASE_ESCUDOS con tu dominio real si difiere del de abajo.
const URL_BASE_ESCUDOS = process.env.URL_BASE_ESCUDOS || 'https://primeranacionalok.vercel.app';

const ESCUDOS_OVERRIDE = [
  { contiene: 'central norte', archivo: 'central-norte.png' },
];

function aplicarOverrideEscudo(nombreEquipo, escudoOriginal) {
  const nombreNormalizado = (nombreEquipo || '').toLowerCase();
  const override = ESCUDOS_OVERRIDE.find((o) => nombreNormalizado.includes(o.contiene));
  if (override) {
    return `${URL_BASE_ESCUDOS}/escudos/${override.archivo}`;
  }
  return escudoOriginal;
}

// Código de la Primera Nacional en el sistema de ESPN: arg.2
const LEAGUE_ID = 'arg.2';
const ESPN_STANDINGS_URL = `https://site.api.espn.com/apis/v2/sports/soccer/${LEAGUE_ID}/standings`;
const ESPN_SCHEDULE_URL = (teamId) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE_ID}/teams/${teamId}/schedule?fixture=true`;

// ============================================================
// CACHE de la tabla completa ya armada (posiciones + próximos
// partidos de todos los equipos). La primera visita después de
// que vence (20 min) tarda más porque arma todo de nuevo; las
// que vienen después son instantáneas.
// ============================================================
let cacheTabla = { datos: null, timestamp: 0 };
const CACHE_TABLA_MS = 20 * 60 * 1000; // 20 minutos

// Cache individual por equipo: si se arma la tabla de nuevo pero un
// equipo puntual no cambió, no le volvemos a pedir el calendario a ESPN.
const cacheProximosPorEquipo = new Map(); // teamId -> { datos, timestamp }
const CACHE_PROXIMOS_MS = 60 * 60 * 1000; // 1 hora

async function obtenerProximosPartidos(teamId) {
  const ahora = Date.now();
  const enCache = cacheProximosPorEquipo.get(teamId);

  if (enCache && (ahora - enCache.timestamp) < CACHE_PROXIMOS_MS) {
    return enCache.datos;
  }

  try {
    const respuesta = await fetch(ESPN_SCHEDULE_URL(teamId));
    if (!respuesta.ok) return [];

    const datos = await respuesta.json();
    const eventos = datos.events || [];
    const ahoraFecha = new Date();

    const proximos = eventos
      .filter((ev) => new Date(ev.date) > ahoraFecha)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5)
      .map((ev) => {
        const competencia = ev.competitions?.[0];
        const competidores = competencia?.competitors || [];
        const rival = competidores.find((c) => String(c.team.id) !== String(teamId));
        const local = competidores.find((c) => c.homeAway === 'home');
        const esLocal = local && String(local.team.id) === String(teamId);

        const nombreRival = rival?.team?.shortDisplayName || rival?.team?.displayName || '?';
        const escudoRivalOriginal = rival?.team?.logo || rival?.team?.logos?.[0]?.href || null;

        return {
          rival: nombreRival,
          escudoRival: aplicarOverrideEscudo(nombreRival, escudoRivalOriginal),
          fecha: ev.date,
          local: !!esLocal,
        };
      });

    cacheProximosPorEquipo.set(teamId, { datos: proximos, timestamp: ahora });
    return proximos;
  } catch (error) {
    console.error(`Error trayendo calendario del equipo ${teamId}:`, error.message);
    return [];
  }
}

async function construirTablaCompleta() {
  const respuesta = await fetch(ESPN_STANDINGS_URL);
  if (!respuesta.ok) {
    throw new Error(`ESPN respondió con estado ${respuesta.status}`);
  }

  const datos = await respuesta.json();
  const grupos = datos.children || [];

  const zonas = await Promise.all(
    grupos.map(async (grupo) => {
      const entradas = grupo.standings?.entries || [];

      const equipos = await Promise.all(
        entradas.map(async (entrada) => {
          const stats = {};
          entrada.stats.forEach((s) => { stats[s.name] = s.value; });

          const proximos = await obtenerProximosPartidos(entrada.team.id);

          const nombreEquipo = entrada.team.displayName;
          const escudoOriginal = entrada.team.logos?.[0]?.href || null;

          return {
            id: entrada.team.id,
            equipo: nombreEquipo,
            escudo: aplicarOverrideEscudo(nombreEquipo, escudoOriginal),
            pj: stats.gamesPlayed || 0,
            pg: stats.wins || 0,
            pe: stats.ties || 0,
            pp: stats.losses || 0,
            dg: stats.pointDifferential || 0,
            pts: stats.points || 0,
            proximos,
          };
        })
      );

      equipos.sort((a, b) => b.pts - a.pts);

      return {
        nombre: grupo.name || grupo.abbreviation || 'Zona',
        equipos,
      };
    })
  );

  return {
    actualizado: new Date().toISOString(),
    liga: 'Primera Nacional',
    zonas,
  };
}

app.get('/tabla', async (req, res) => {
  try {
    const ahora = Date.now();

    if (cacheTabla.datos && (ahora - cacheTabla.timestamp) < CACHE_TABLA_MS) {
      return res.json(cacheTabla.datos);
    }

    const datosFrescos = await construirTablaCompleta();
    cacheTabla = { datos: datosFrescos, timestamp: ahora };

    res.json(datosFrescos);
  } catch (error) {
    console.error('Error consultando ESPN:', error.message);

    if (cacheTabla.datos) {
      return res.json(cacheTabla.datos);
    }

    res.status(500).json({ error: 'No se pudo obtener la tabla en este momento' });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor de tabla de posiciones de Primera Nacional. Probá /tabla');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

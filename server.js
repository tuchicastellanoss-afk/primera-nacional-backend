// server.js
// Servidor que expone:
//  - /tabla: posiciones y puntos, RÁPIDO (una sola consulta a ESPN)
//  - /proximos-todos: los próximos 5 partidos de TODOS los equipos juntos,
//    un poco más lento (consulta el calendario de cada uno), pensado para
//    pedirse aparte y no bloquear la carga inicial de la tabla.
//
// Cómo probarlo en tu compu (si tenés Node.js instalado):
//   npm install express node-fetch cors
//   node server.js
//   Abrí http://localhost:3000/tabla en el navegador
//
// Para subirlo gratis a internet, seguí la guía de despliegue en Render.

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors());

// Código de la Primera Nacional en el sistema de ESPN: arg.2
const LEAGUE_ID = 'arg.2';
const ESPN_STANDINGS_URL = `https://site.api.espn.com/apis/v2/sports/soccer/${LEAGUE_ID}/standings`;
const ESPN_SCHEDULE_URL = (teamId) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE_ID}/teams/${teamId}/schedule?fixture=true`;

// ============================================================
// CACHE de la tabla de posiciones (rápida: una sola consulta a ESPN)
// ============================================================
let cacheTabla = { datos: null, timestamp: 0 };
const CACHE_TABLA_MS = 15 * 60 * 1000; // 15 minutos

// ============================================================
// CACHE de "próximos partidos" por equipo. La primera vez que se
// pide (o cuando venció la hora de cache) se le pregunta a ESPN;
// las siguientes veces se devuelve lo guardado, al instante.
// ============================================================
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

        return {
          rival: rival?.team?.shortDisplayName || rival?.team?.displayName || '?',
          escudoRival: rival?.team?.logo || rival?.team?.logos?.[0]?.href || null,
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

async function construirTabla() {
  const respuesta = await fetch(ESPN_STANDINGS_URL);
  if (!respuesta.ok) {
    throw new Error(`ESPN respondió con estado ${respuesta.status}`);
  }

  const datos = await respuesta.json();
  const grupos = datos.children || [];

  const zonas = grupos.map((grupo) => {
    const entradas = grupo.standings?.entries || [];

    const equipos = entradas.map((entrada) => {
      const stats = {};
      entrada.stats.forEach((s) => { stats[s.name] = s.value; });

      return {
        id: entrada.team.id,
        equipo: entrada.team.displayName,
        escudo: entrada.team.logos?.[0]?.href || null,
        pj: stats.gamesPlayed || 0,
        pg: stats.wins || 0,
        pe: stats.ties || 0,
        pp: stats.losses || 0,
        dg: stats.pointDifferential || 0,
        pts: stats.points || 0,
      };
    });

    equipos.sort((a, b) => b.pts - a.pts);

    return {
      nombre: grupo.name || grupo.abbreviation || 'Zona',
      equipos,
    };
  });

  return {
    actualizado: new Date().toISOString(),
    liga: 'Primera Nacional',
    zonas,
  };
}

// Tabla de posiciones: rápida, sin calendario
app.get('/tabla', async (req, res) => {
  try {
    const ahora = Date.now();

    if (cacheTabla.datos && (ahora - cacheTabla.timestamp) < CACHE_TABLA_MS) {
      return res.json(cacheTabla.datos);
    }

    const datosFrescos = await construirTabla();
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

// Próximos partidos de TODOS los equipos, en un solo pedido. Se llama
// aparte de /tabla, así no la hace más lenta. La primera vez (o cada
// hora) tarda un poco más; después es instantáneo por el cache.
app.get('/proximos-todos', async (req, res) => {
  try {
    if (!cacheTabla.datos) {
      // si todavía no se armó la tabla, la armamos para tener los IDs
      cacheTabla = { datos: await construirTabla(), timestamp: Date.now() };
    }

    const todosLosEquipos = cacheTabla.datos.zonas.flatMap((z) => z.equipos);

    const resultados = await Promise.all(
      todosLosEquipos.map(async (equipo) => ({
        id: equipo.id,
        proximos: await obtenerProximosPartidos(equipo.id),
      }))
    );

    const mapa = {};
    resultados.forEach((r) => { mapa[r.id] = r.proximos; });

    res.json({ proximosPorEquipo: mapa });
  } catch (error) {
    console.error('Error trayendo próximos partidos:', error.message);
    res.status(500).json({ error: 'No se pudieron obtener los próximos partidos' });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor de tabla de posiciones de Primera Nacional. Probá /tabla');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

// server.js
// Servidor que expone la tabla de posiciones de Primera Nacional y, por
// separado, los próximos 5 partidos de cada equipo (a demanda, no todos
// juntos), usando los datos públicos que ESPN usa en su propio sitio.
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
// CACHE de "próximos partidos" POR EQUIPO. Cada equipo se guarda
// por separado y solo se pide a ESPN la primera vez que alguien
// lo consulta (cuando el usuario toca esa fila en la web), no
// los 36 equipos de una. Así la tabla principal carga rápido.
// ============================================================
const cacheProximos = new Map(); // teamId -> { datos, timestamp }
const CACHE_PROXIMOS_MS = 60 * 60 * 1000; // 1 hora (el calendario cambia poco)

async function obtenerProximosPartidos(teamId) {
  const ahora = Date.now();
  const enCache = cacheProximos.get(teamId);

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

    cacheProximos.set(teamId, { datos: proximos, timestamp: ahora });
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

// Tabla de posiciones: rápida, sin calendario, solo una consulta a ESPN
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

// Próximos partidos de UN equipo puntual: se pide solo cuando hace falta
// (cuando el usuario toca esa fila en la web), no de los 36 juntos.
app.get('/proximos/:teamId', async (req, res) => {
  try {
    const proximos = await obtenerProximosPartidos(req.params.teamId);
    res.json({ proximos });
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

// server.js
// Servidor simple que expone la tabla de posiciones de Primera Nacional
// usando los datos públicos que ESPN usa en su propio sitio (sin API key).
//
// Cómo probarlo en tu compu (si tenés Node.js instalado):
//   npm install express node-fetch cors
//   node server.js
//   Abrí http://localhost:3000/tabla en el navegador
//
// Para subirlo gratis a internet, seguí la guía de despliegue en Render
// que te paso en el chat.

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
app.use(cors()); // permite que tu página web le pida datos a este servidor

// Código de la Primera Nacional en el sistema de ESPN: arg.2
const LEAGUE_ID = 'arg.2';
const ESPN_URL = `https://site.api.espn.com/apis/v2/sports/soccer/${LEAGUE_ID}/standings`;

app.get('/tabla', async (req, res) => {
  try {
    const respuesta = await fetch(ESPN_URL);

    if (!respuesta.ok) {
      throw new Error(`ESPN respondió con estado ${respuesta.status}`);
    }

    const datos = await respuesta.json();

    // Los datos de ESPN vienen en una estructura anidada. Los "aplanamos"
    // para que sean fáciles de usar en la página web.
    const grupo = datos.children?.[0]?.standings?.entries || [];

    const tabla = grupo.map((entrada) => {
      const stats = {};
      entrada.stats.forEach((s) => { stats[s.name] = s.value; });

      return {
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

    // Ordenamos por puntos, de mayor a menor (por si ESPN no lo manda ordenado)
    tabla.sort((a, b) => b.pts - a.pts);

    res.json({
      actualizado: new Date().toISOString(),
      liga: 'Primera Nacional',
      tabla,
    });
  } catch (error) {
    console.error('Error consultando ESPN:', error.message);
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

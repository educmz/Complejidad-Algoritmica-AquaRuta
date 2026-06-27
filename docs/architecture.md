# AquaRuta architecture

## Capas

- `frontend/src/pages` y `frontend/src/components`: seleccionan parametros, muestran estados y representan resultados.
- `frontend/src/services`: funciones de API por flujo. Todas usan `apiClient.js` para base URL, JSON, timeout y errores HTTP.
- `backend/app.py`: crea FastAPI, CORS, servicios y rutas HTTP publicas.
- `backend/src/api/models`: modelos Pydantic de entrada para conservar contratos JSON.
- `backend/src/services`: validacion funcional, carga de datos oficiales, construccion de entradas y transformacion de respuestas.
- `backend/src/algorithms`: implementaciones algorítmicas centrales.
- `backend/src/builders`: pipeline offline para generar archivos en `data/processed` y `frontend/src/data`.

## Fuente de verdad algorítmica

React no ejecuta UFDS, TSP-DP, Dijkstra, BFS, DFS, Backtracking ni sectorizacion recursiva. Los flujos interactivos llaman endpoints FastAPI, que delegan en servicios backend y luego en `backend/src/algorithms`.

## Configuracion

Los limites compartidos viven en `backend/src/config/algorithm_limits.py`. Las constantes operativas de distancia, velocidad, costo y timeout viven en `backend/src/config/operational_constants.py`.

# Dashboard seslabs — estado y lo que falta

## Ya está listo (en este zip)
- `scripts/fetch_data.py` — script que lee (solo lectura) las 2 carpetas de Drive
  + el feed público de ThingSpeak, y genera `data/latest.json` con ventana móvil
  de 21 días.
- `requirements.txt` — dependencias del script.
- `.github/workflows/update-data.yml` — GitHub Action que corre el script cada
  ~30 min (`*/30 * * * *` + botón manual `workflow_dispatch`) y comitea
  `data/latest.json` solo si cambió.

## Lo que falta (para que tú lo termines)

### 1. `data/latest.json` (datos iniciales)
No lo generé — intenté 3 veces bajar los CSV completos dentro de la conversación
y eso fue lo que gastó el 70% del token budget. La buena noticia: **no hace
falta generarlo a mano**. En cuanto configures el Google Service Account y el
secreto en GitHub (paso 3 abajo) y actives el Action, el primer run del
workflow lo genera solo, leyendo Drive directo. Si quieres probarlo sin
esperar el cron, hay un botón "Run workflow" (workflow_dispatch) en la pestaña
Actions de GitHub para correrlo manual la primera vez.

### 2. Front-end del dashboard (`index.html`, `assets/app.js`, `assets/style.css`)
No se construyó todavía. Plan que teníamos:
- Chart.js (desde cdnjs.cloudflare.com) con eje de categorías (labels HH:MM),
  sin librería de fechas extra.
- Lee `data/latest.json` por fetch() y arma una gráfica por sensor:
  piranometro, sq_calibrador, spektron, sp722, celda_1..celda_6,
  promedio_bajo_costo.
- Selector simple de día/hora arriba, y texto con "última actualización"
  (generated_at) para que se vea claro que sigue vivo.
- Esto es html/js plano, no necesita más llamadas a Drive — se puede armar
  sin gastar tokens de Drive, avísame cuando quieras que lo retome.

### 3. Configuración en GitHub (la tienes que hacer tú, son clicks, no código)
1. Crear repo en GitHub (público o "unlisted" está bien) y subir esta carpeta.
2. Activar GitHub Pages (Settings → Pages → deploy from branch, carpeta raíz).
3. Crear una Service Account de Google (console.cloud.google.com → IAM →
   Service Accounts), descargar su JSON.
4. Compartir las 2 carpetas de Drive con el email de esa service account,
   como **Viewer/Lector únicamente** (nunca editor):
   - "Datos promedios": `1g2Pf7mj40r8ITWUNCy-NTAsBfgxcr8m2`
   - "Monitoreo Agrivoltaica SC electric": `1651WIlkKvQXt7W7vNuSmGZmr_UKzoJ9L`
5. En el repo de GitHub → Settings → Secrets and variables → Actions →
   New repository secret → nombre `GOOGLE_SERVICE_ACCOUNT_JSON`, pegar el
   contenido completo del JSON descargado.
6. Activar Actions si no está activo. Correr el workflow una vez manual
   (Actions → "Actualizar datos del dashboard" → Run workflow) para generar
   el primer `data/latest.json`.

## IDs de archivos de Drive ya verificados (por si los necesitas)
Heurística usada: cuando hay duplicados para la misma fecha, el archivo
más pesado (bytes) es el del día completo; los pequeños (~4.6-4.7 KB) son
solo de la noche / incompletos. Esto ya está automatizado en
`list_files_in_window()` dentro de `fetch_data.py`, no necesitas hacer nada
manual — esta lista es solo referencia de lo que ya se validó:

**Calibrador ("Datos promedios", `Promedios_YYYY-MM-DD.csv`):**
- 09-10: `1dgp92UFapzl_5EiOWws6GhvjTf4qBBKs`
- 09-11: `1TrZUDoKvx4J_lIn5xb70MrnA0xkvccLi`
- 09-12: `1LUrqljufdn8KZ15SiUWhVRkEhQQfEwwf`
- 09-13: `1u-PXnIP75vKtkuBU8gpuQTQM7fiFndwe`
- 09-14: `1io6Pvo2OHCtC1OQfY-cg7ERv-Kp2ktwT`
- 09-15: `1qQ0lp0rYnCictmPrc-o-JApzVfHstgSI`
- 09-16: `1bi0-B_zkGnfeUjwfnT_-XWFXSJyRK6zZ`
- 09-17: `16V61S6WjMds8WP1Q8WsAf9NjUuqyweoM`
- 09-18: `1ry9oUI6BnAGpXppPt5LO1eFMTIsh5eEX`
- 09-09: no hay archivo completo confiable (solo duplicados nocturnos de
  ~4.6KB) — hueco real de datos.

**SC electric ("Monitoreo Agrivoltaica SC electric", `Monitoreo_YYYY-MM-DD.csv`):**
- 09-09: `1bIbJWPHQ2THZ5pgE27MNslF7-QSkN7RF`
- 09-10: `1-mH1WbUiGw7rkARbulhCWvwD4zwEAkqG`
- 09-11: `1YQNcyH1NPpR9M0dETrJrMI1C_3TmlYwm`
- 09-12: `1QFmx29m1YA1RwCr3YF8EFTyzVQHpOAFu`
- 09-17: `1g8fe7PpmwqbcNP9SIj5_n3-lCU79VtUp`
- 09-18: `1LLdt2cUkfU6xS3ZvAJ3NDusjua3XxshE`
- 09-13, 09-14, 09-15, 09-16: confirmado que NO existen archivos para esas
  fechas en esta carpeta (hueco real en la fuente, no es bug).

## Columnas de los CSV (por si editas el parseo)

**Calibrador** (`Promedios_YYYY-MM-DD.csv`):
`Timestamp,SQ_Cal_Output_Avg [µmol/m^2s],SQ_Detector_mV_Avg [mV],MS_Irr_Comp_Avg [W/m^2],MS_Tilt_X_Avg [°],MS_Tilt_Y_Avg [°],MS_Irr_Raw_Avg [W/m^2],MS_Voltage_Avg [mV],MS_Temp_Avg [°C],MS_Hum_Alert_Avg`

**SC electric** (`Monitoreo_YYYY-MM-DD.csv`):
`timestamp,Voltaje PV1 [V],Corriente PV1 [A],Potencia PV1 [W],Voltaje PV2 [V],Corriente PV2 [A],Potencia PV2 [W],Potencia total [Wac],Frecuencia,Voltaje [Vac],Corriente [Aac],Energia hoy [Wh],Energia total [Wh],Temperatura inversor [C],Energia PV1 [Wh],Energia PV2 [Wh],codigo_error,temp_vertical,temp_inclinado,irradiancia_incidente,irradiancia_reflejada,albedo,Irradiancia_incidente_SP722 [W/m2],Irradiancia_reflejada_SP722 [W/m2],Detector_incidente_SP722 [mV],Detector_reflejado_SP722 [mV],Albedo_SP722`

## Cuando quieras que retome
Avísame y sigo con el front-end (`index.html` + `assets/app.js`) — eso no
requiere tocar Drive, así que es barato en tokens. Lo de `data/latest.json`
literal no necesita que yo lo genere: se genera solo en el primer run del
Action una vez esté el secreto configurado.

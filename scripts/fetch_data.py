#!/usr/bin/env python3
"""
fetch_data.py
--------------
Corre dentro de GitHub Actions (ver .github/workflows/update-data.yml).

Lee SOLO EN MODO LECTURA (nunca escribe ni modifica nada) las 2 carpetas
compartidas de Google Drive del proyecto "seslabs":
  - "Datos promedios" (calibrador / Piranometro / SQ)          -> DRIVE_FOLDER_CALIBRADOR
  - "Monitoreo Agrivoltaica SC electric" (Spektron / SP722)    -> DRIVE_FOLDER_SC_ELECTRIC

Ademas jala el feed publico de ThingSpeak (canal de Adrian, 6 celdas de bajo costo).

Genera data/latest.json con una ventana movil de los ultimos WINDOW_DAYS dias,
que es lo que consume el dashboard (index.html + assets/app.js).

Requiere la variable de entorno GOOGLE_SERVICE_ACCOUNT_JSON con el contenido
completo del JSON de una cuenta de servicio de Google que tenga acceso de
"Lector" (Viewer) a las 2 carpetas de Drive de arriba. Esa cuenta de servicio
NO necesita ni debe tener permiso de editor/escritura sobre esas carpetas.
"""

import base64
import csv
import io
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build

# ------------------------------------------------------------------
# Configuracion
# ------------------------------------------------------------------

WINDOW_DAYS = int(os.environ.get("WINDOW_DAYS", "21"))
MAX_POINTS_PER_SENSOR = int(os.environ.get("MAX_POINTS_PER_SENSOR", "3000"))

DRIVE_FOLDER_CALIBRADOR = os.environ.get(
    "DRIVE_FOLDER_CALIBRADOR", "1g2Pf7mj40r8ITWUNCy-NTAsBfgxcr8m2"
)
DRIVE_FOLDER_SC_ELECTRIC = os.environ.get(
    "DRIVE_FOLDER_SC_ELECTRIC", "1651WIlkKvQXt7W7vNuSmGZmr_UKzoJ9L"
)
THINGSPEAK_CHANNEL_ID = os.environ.get("THINGSPEAK_CHANNEL_ID", "3100981")

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "latest.json")

SCOPES = ["https://www.googleapis.com/auth/drive.readonly"]


# ------------------------------------------------------------------
# Google Drive (SOLO LECTURA)
# ------------------------------------------------------------------

def get_drive_service():
    raw = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not raw:
        print("AVISO: no hay GOOGLE_SERVICE_ACCOUNT_JSON -- se omite Drive.", file=sys.stderr)
        return None
    info = json.loads(raw)
    creds = service_account.Credentials.from_service_account_info(info, scopes=SCOPES)
    return build("drive", "v3", credentials=creds, cache_discovery=False)


def list_files_in_window(service, folder_id, prefix, start_date, end_date):
    """Devuelve {fecha_str: file_id} eligiendo, si hay archivos duplicados
    para la misma fecha, el de mayor tamano (heuristica ya validada: los
    archivos 'dia completo' pesan mucho mas que los que solo tienen datos
    de la noche)."""
    best_by_date = {}
    d = start_date
    while d <= end_date:
        date_str = d.strftime("%Y-%m-%d")
        query = f"'{folder_id}' in parents and name contains '{prefix}{date_str}'"
        page_token = None
        candidates = []
        while True:
            resp = service.files().list(
                q=query,
                fields="nextPageToken, files(id, name, size)",
                pageToken=page_token,
                pageSize=100,
            ).execute()
            candidates.extend(resp.get("files", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        if candidates:
            best = max(candidates, key=lambda f: int(f.get("size", 0)))
            best_by_date[date_str] = best["id"]
        d += timedelta(days=1)
    return best_by_date


def download_csv_text(service, file_id):
    request = service.files().get_media(fileId=file_id)
    buf = io.BytesIO()
    from googleapiclient.http import MediaIoBaseDownload

    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue().decode("utf-8", errors="replace")


def parse_csv_column(csv_text, timestamp_col, value_col):
    points = []
    reader = csv.DictReader(io.StringIO(csv_text))
    for row in reader:
        ts = row.get(timestamp_col)
        raw_val = row.get(value_col)
        if ts is None or raw_val in (None, ""):
            continue
        try:
            val = float(raw_val)
        except (TypeError, ValueError):
            continue
        points.append([ts.strip(), val])
    return points


# ------------------------------------------------------------------
# ThingSpeak (publico, sin credenciales)
# ------------------------------------------------------------------

def fetch_thingspeak(channel_id, start_date, end_date):
    url = f"https://api.thingspeak.com/channels/{channel_id}/feed.csv"
    params = {
        "start": start_date.strftime("%Y-%m-%d 00:00:00"),
        "end": (end_date + timedelta(days=1)).strftime("%Y-%m-%d 00:00:00"),
    }
    try:
        resp = requests.get(url, params=params, timeout=60)
        resp.raise_for_status()
    except requests.RequestException as exc:
        print(f"AVISO: no se pudo leer ThingSpeak: {exc}", file=sys.stderr)
        return {f"celda_{i}": [] for i in range(1, 7)} | {"promedio_bajo_costo": []}

    reader = csv.DictReader(io.StringIO(resp.text))
    celdas = {f"celda_{i}": [] for i in range(1, 7)}
    promedio = []
    for row in reader:
        ts = row.get("created_at")
        if not ts:
            continue
        vals = []
        for i in range(1, 7):
            raw = row.get(f"field{i}")
            if raw in (None, ""):
                continue
            try:
                v = float(raw)
            except ValueError:
                continue
            celdas[f"celda_{i}"].append([ts, v])
            vals.append(v)
        if vals:
            promedio.append([ts, sum(vals) / len(vals)])
    celdas["promedio_bajo_costo"] = promedio
    return celdas


# ------------------------------------------------------------------
# Utilidades
# ------------------------------------------------------------------

def downsample(points, max_points):
    if len(points) <= max_points:
        return points
    step = len(points) / max_points
    out = []
    i = 0.0
    while int(i) < len(points):
        out.append(points[int(i)])
        i += step
    return out


def build_sensor(label, unit, source, points):
    points = sorted(points, key=lambda p: p[0])
    points = downsample(points, MAX_POINTS_PER_SENSOR)
    return {"label": label, "unit": unit, "source": source, "points": points}


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------

def main():
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=WINDOW_DAYS - 1)

    sensors = {}
    gaps = []

    service = get_drive_service()

    # --- Calibrador: Piranometro (MS_Irr_Comp_Avg) + SQ (reservado) ---
    piranometro_pts, sq_pts = [], []
    if service is not None:
        cal_files = list_files_in_window(
            service, DRIVE_FOLDER_CALIBRADOR, "Promedios_", start_date, end_date
        )
        found_dates = set(cal_files)
        for date_str, file_id in cal_files.items():
            try:
                text = download_csv_text(service, file_id)
            except Exception as exc:  # noqa: BLE001
                print(f"AVISO: fallo al leer calibrador {date_str}: {exc}", file=sys.stderr)
                continue
            piranometro_pts += parse_csv_column(text, "Timestamp", "MS_Irr_Comp_Avg")
            sq_pts += parse_csv_column(text, "Timestamp", "SQ_Cal_Output_Avg")
        missing = [
            (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(WINDOW_DAYS)
            if (start_date + timedelta(days=i)).strftime("%Y-%m-%d") not in found_dates
        ]
        if missing:
            gaps.append(
                "Calibrador (Datos promedios): sin archivo Promedios_ para: " + ", ".join(missing)
            )

    sensors["piranometro"] = build_sensor(
        "Piranometro (MS_Irr_Comp_Avg)", "W/m2", "Drive - Datos promedios", piranometro_pts
    )
    sensors["sq_calibrador"] = build_sensor(
        "SQ Calibrador (reservado, no se usa en comparativas)",
        "umol/m2s",
        "Drive - Datos promedios",
        sq_pts,
    )

    # --- SC electric: Spektron (irradiancia_incidente) + SP722 ---
    spektron_pts, sp722_pts = [], []
    if service is not None:
        sc_files = list_files_in_window(
            service, DRIVE_FOLDER_SC_ELECTRIC, "Monitoreo_", start_date, end_date
        )
        found_dates = set(sc_files)
        for date_str, file_id in sc_files.items():
            try:
                text = download_csv_text(service, file_id)
            except Exception as exc:  # noqa: BLE001
                print(f"AVISO: fallo al leer SC electric {date_str}: {exc}", file=sys.stderr)
                continue
            spektron_pts += parse_csv_column(text, "timestamp", "irradiancia_incidente")
            sp722_pts += parse_csv_column(text, "timestamp", "Irradiancia_incidente_SP722")
        missing = [
            (start_date + timedelta(days=i)).strftime("%Y-%m-%d")
            for i in range(WINDOW_DAYS)
            if (start_date + timedelta(days=i)).strftime("%Y-%m-%d") not in found_dates
        ]
        if missing:
            gaps.append(
                "SC electric (Monitoreo): sin archivo Monitoreo_ para: " + ", ".join(missing)
            )

    sensors["spektron"] = build_sensor(
        "Spektron (irradiancia_incidente)", "W/m2", "Drive - SC electric", spektron_pts
    )
    sensors["sp722"] = build_sensor(
        "SP722 (Irradiancia_incidente_SP722)", "W/m2", "Drive - SC electric", sp722_pts
    )

    # --- ThingSpeak: 6 celdas de bajo costo + promedio ---
    ts_series = fetch_thingspeak(THINGSPEAK_CHANNEL_ID, start_date, end_date)
    for i in range(1, 7):
        sensors[f"celda_{i}"] = build_sensor(
            f"ThingSpeak Celda {i} (Adrian)",
            "raw",
            f"ThingSpeak canal {THINGSPEAK_CHANNEL_ID} field{i}",
            ts_series[f"celda_{i}"],
        )
    sensors["promedio_bajo_costo"] = build_sensor(
        "Promedio 6 celdas de bajo costo",
        "raw",
        "Calculado a partir de ThingSpeak",
        ts_series["promedio_bajo_costo"],
    )

    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "window": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
            "days": WINDOW_DAYS,
        },
        "sensors": sensors,
        "gaps_conocidos": gaps,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=1)

    total_points = sum(len(s["points"]) for s in sensors.values())
    print(f"OK: {OUTPUT_PATH} escrito con {total_points} puntos totales en {len(sensors)} sensores.")


if __name__ == "__main__":
    main()

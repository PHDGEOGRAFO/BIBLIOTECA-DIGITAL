"""Servicio privado de descargas: Drive (solo lectura) -> ZIP/Excel temporal."""
import io
import json
import os
import re
import sqlite3
import tempfile
import unicodedata
import zipfile
from pathlib import Path

from dbfread import DBF
from fastapi import FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import google.auth
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from openpyxl import Workbook
from starlette.background import BackgroundTask

ROOT = Path(__file__).resolve().parent
MANIFEST = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
ENTRIES = {item["name"]: item for item in MANIFEST["entries"]}
CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
ALLOWED_EMAILS = {x.strip().lower() for x in os.environ.get("ALLOWED_EMAILS", "").split(",") if x.strip()}
ALLOWED_DOMAIN = os.environ.get("ALLOWED_DOMAIN", "").strip().lower()
MAX_BYTES = int(os.environ.get("MAX_FILE_BYTES", str(300 * 1024 * 1024)))
ORIGIN = os.environ.get("FRONTEND_ORIGIN", "https://phdgeografo.github.io").rstrip("/")
app = FastAPI(title="Biblioteca Digital — descarga protegida", docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=[ORIGIN], allow_credentials=False, allow_methods=["GET"], allow_headers=["Authorization", "Content-Type"])

def authenticate(authorization: str | None):
    if not CLIENT_ID or (not ALLOWED_EMAILS and not ALLOWED_DOMAIN):
        raise HTTPException(503, "Servidor sin autenticación configurada")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Inicia sesión con tu cuenta autorizada")
    try:
        info = id_token.verify_oauth2_token(authorization[7:], Request(), CLIENT_ID)
    except Exception:
        raise HTTPException(401, "Identidad no verificada")
    email = str(info.get("email", "")).lower()
    if not info.get("email_verified") or not (email in ALLOWED_EMAILS or (ALLOWED_DOMAIN and email.endswith("@" + ALLOWED_DOMAIN))):
        raise HTTPException(403, "Usuario no autorizado")
    return email

def drive():
    # Application Default Credentials de Cloud Run: acceso de lectura concedido a su cuenta de servicio.
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/drive.readonly"])
    return build("drive", "v3", credentials=credentials, cache_discovery=False)

def metadata(api, file_id):
    return api.files().get(fileId=file_id, fields="id,name,mimeType,size,parents,trashed", supportsAllDrives=True).execute()

def read_drive(api, file_id, dest):
    meta = metadata(api, file_id)
    if meta.get("trashed"):
        raise HTTPException(404, "El archivo de origen fue eliminado")
    size = int(meta.get("size") or 0)
    if size > MAX_BYTES:
        raise HTTPException(413, "Archivo supera el tamaño máximo configurado")
    request = api.files().get_media(fileId=file_id, supportsAllDrives=True)
    total = 0
    with open(dest, "wb") as stream:
        dl = MediaIoBaseDownload(stream, request, chunksize=2*1024*1024)
        finished = False
        while not finished:
            status, finished = dl.next_chunk()
            total = stream.tell()
            if total > MAX_BYTES:
                raise HTTPException(413, "Descarga excede el tamaño permitido")
    return meta

def clean_name(name):
    name = str(name).split("/")[-1].split("\\")[-1]
    return re.sub(r"[^0-9A-Za-zÁÉÍÓÚÑáéíóúñ_. -]", "_", name)[:160]

def shapefile_parts(api, shp):
    """Encuentra componentes obligatorios del mismo prefijo y en la misma carpeta."""
    stem = Path(shp["name"]).stem.casefold()
    folder = (shp.get("parents") or [None])[0]
    if not folder:
        raise HTTPException(422, "Shapefile sin carpeta de origen")
    quoted = folder.replace("'", "\\'")
    fields = "nextPageToken,files(id,name,mimeType,size,parents,trashed)"
    found = []
    token = None
    while True:
        page = api.files().list(
            q="'" + quoted + "' in parents and trashed = false",
            fields=fields, pageSize=1000, pageToken=token,
            supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
        for row in page.get("files", []):
            if Path(row["name"]).stem.casefold() == stem:
                found.append(row)
        token = page.get("nextPageToken")
        if not token:
            break
    lookup = {Path(f["name"]).suffix.lower(): f for f in found}
    missing = [ext for ext in (".shp", ".shx", ".dbf", ".prj") if ext not in lookup]
    if missing:
        raise HTTPException(422, "Shapefile incompleto en Drive: faltan " + ", ".join(missing))
    return [lookup[ext] for ext in (".shp", ".shx", ".dbf", ".prj", ".cpg", ".qpj", ".sbn", ".sbx") if ext in lookup]

def target_layer(connection, desired, user_choice):
    try:
        tables = [r[0] for r in connection.execute("SELECT table_name FROM gpkg_contents WHERE data_type IN ('features','attributes')")]
    except sqlite3.DatabaseError:
        raise HTTPException(422, "No es un GeoPackage válido")
    if not tables:
        raise HTTPException(422, "GeoPackage sin tablas de atributos publicables")
    if user_choice:
        if user_choice not in tables:
            raise HTTPException(422, "Capa solicitada no existe")
        return user_choice
    if desired in tables:
        return desired
    for name in tables:
        if name.casefold() == desired.casefold():
            return name
    if len(tables) == 1:
        return tables[0]
    raise HTTPException(409, {"message": "El GeoPackage contiene varias capas; elige una", "layers": tables})

def write_excel_gpkg(gpkg_path, outfile, desired, chosen=None):
    db = sqlite3.connect("file:" + gpkg_path.as_posix() + "?mode=ro&immutable=1", uri=True)
    try:
        table = target_layer(db, desired, chosen)
        geom = {r[0] for r in db.execute("SELECT column_name FROM gpkg_geometry_columns WHERE table_name = ?", (table,))}
        cols = [row[1] for row in db.execute('PRAGMA table_info("' + table.replace('"', '""') + '")') if row[1] not in geom]
        if not cols:
            raise HTTPException(422, "Capa sin atributos exportables")
        wb = Workbook(write_only=True)
        ws = wb.create_sheet("Atributos")
        ws.append(cols)
        sql = 'SELECT ' + ','.join('"' + col.replace('"', '""') + '"' for col in cols) + ' FROM "' + table.replace('"', '""') + '"'
        for row in db.execute(sql):
            ws.append([v if isinstance(v, (str, int, float, bool, type(None))) else str(v) for v in row])
            if ws._current_row >= 1048576:
                raise HTTPException(413, "Número de filas excede capacidad de Excel")
        wb.save(outfile)
    finally:
        db.close()

def write_excel_dbf(dbf_path, outfile):
    wb = Workbook(write_only=True)
    ws = wb.create_sheet("Atributos")
    table = DBF(str(dbf_path), load=False, char_decode_errors="replace")
    ws.append(list(table.field_names))
    for record in table:
        ws.append([str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v for v in record.values()])
        if ws._current_row >= 1048576:
            raise HTTPException(413, "Número de filas excede capacidad de Excel")
    wb.save(outfile)

@app.get("/health")
def health():
    return {"status": "ready" if (CLIENT_ID and (ALLOWED_EMAILS or ALLOWED_DOMAIN)) else "unconfigured"}

@app.get("/api/capabilities")
def capabilities(authorization: str | None = Header(default=None)):
    authenticate(authorization)
    return {"coverage_names": list(ENTRIES), "zip": True, "xlsx": True}

@app.get("/api/download/{coverage_name}")
def download(coverage_name: str, format: str = Query("zip", pattern="^(zip|xlsx)$"),
             layer: str | None = None, authorization: str | None = Header(default=None)):
    authenticate(authorization)
    entry = ENTRIES.get(coverage_name)
    if not entry:
        raise HTTPException(404, "Cobertura sin enlace verificado en manifiesto")
    temp = tempfile.TemporaryDirectory(prefix="stgo_")
    work = Path(temp.name)
    try:
        api = drive()
        meta = metadata(api, entry["drive_file_id"])
        if entry["format"] == "SHP":
            parts = shapefile_parts(api, meta)
        else:
            if not meta["name"].lower().endswith(".gpkg"):
                raise HTTPException(422, "El archivo de Drive no corresponde a un GPKG")
            parts = [meta]
        local = []
        for part in parts:
            path = work / clean_name(part["name"])
            read_drive(api, part["id"], path)
            local.append(path)
        if format == "zip":
            outfile = work / (clean_name(coverage_name) + ".zip")
            with zipfile.ZipFile(outfile, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=4, allowZip64=True) as archive:
                for path in local:
                    archive.write(path, arcname=path.name)
        else:
            outfile = work / (clean_name(coverage_name) + "_atributos.xlsx")
            if entry["format"] == "SHP":
                write_excel_dbf(next(x for x in local if x.suffix.lower() == ".dbf"), outfile)
            else:
                write_excel_gpkg(local[0], outfile, entry.get("layer", coverage_name), layer)
        return FileResponse(outfile, media_type="application/zip" if format == "zip" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                            filename=outfile.name, background=BackgroundTask(temp.cleanup),
                            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
    except Exception:
        temp.cleanup()
        raise

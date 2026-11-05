# Descargas protegidas de Biblioteca Digital (Google Drive)

El servidor lee archivos de la carpeta principal de Drive a través de la cuenta de servicio autorizada (solo lectura). Las descargas generadas no se guardan en Drive ni modifican los originales.

## Preparación
1. Crear proyecto Google Cloud autorizado por informática municipal y activar **Google Drive API**.
2. Configurar cuenta de servicio de Cloud Run con acceso **Lector** a los archivos de Biblioteca Digital, o delegación de dominio autorizada cuando la organización no permita compartirlos directamente con cuentas de servicio.
3. Crear OAuth 2.0 Client ID para aplicación web con origen permitido `https://phdgeografo.github.io`.
4. Desplegar `backend/` en Cloud Run (o equivalente) con HTTPS y estas variables:
   - `GOOGLE_CLIENT_ID`: OAuth Client ID público de la interfaz; debe coincidir con la audiencia del ID token.
   - `ALLOWED_EMAILS`: correos autorizados separados por comas. Alternativa: `ALLOWED_DOMAIN` como dominio institucional permitido, únicamente con aprobación de informática.
   - `FRONTEND_ORIGIN=https://phdgeografo.github.io`.
   - `MAX_FILE_BYTES`: límite de lectura por archivo (predeterminado: 314572800).
5. El endpoint requiere **token de identidad Google firmado y validado por el backend** (no es suficiente la sesión del HTML). No guardar secretos OAuth ni llaves de servicio en GitHub.
6. Una vez desplegado, completar `territorial/descargas-config.json` con `apiBase` (URL del backend HTTPS) y `googleClientId`. Antes de esta configuración, las descargas autenticadas permanecen deshabilitadas.

## Flujo
- `GET /health` diagnóstico sin datos sensibles.
- `GET /api/capabilities` devuelve coberturas habilitadas tras autenticar.
- `GET /api/download/NOMBRE?format=zip` genera ZIP temporal del GPKG o SHP completo.
- `GET /api/download/NOMBRE?format=xlsx` exporta las tablas del GPKG o DBF.
- Para GPKG multicapa, respuesta HTTP 409 incluye los nombres disponibles; reintentar con `layer=NOMBRE_INTERNO`.

## Seguridad y límites
- El `manifest.json` del backend es una lista de identificadores de Drive autorizados; nunca aceptar ID arbitrarios desde el navegador.
- Los permisos reales de Drive se respetan. Para uso municipal con datos reservados, revisar clasificación y autorización de publicación antes de agregar una cobertura.
- Los 26 enlaces del catálogo conocidos están en el manifiesto; **no significa que sus archivos sean accesibles por la cuenta de servicio hasta compartirlos**.
- Para Shapefiles, el servidor exige `.shp`, `.shx`, `.dbf` y `.prj` de la misma carpeta y nombre base; si faltan, responde 422.
- Los archivos se generan en el directorio temporal de la instancia; ningún original se altera.
- Cloud Run tiene límites de memoria, almacenamiento temporal, tiempo máximo y ancho de banda: dimensionar especialmente los GPKG grandes antes de habilitarlos.
- Restringir Cloud Run según política municipal. Si el endpoint debe recibir ID tokens de usuarios del navegador, protegerlo con verificación explícita de credenciales Google; no confiar en la autenticación visual del sitio.
- Cada actualización de enlaces nuevos requiere agregar la cobertura al manifiesto del backend, revisar permisos y redesplegar.

## Estado
Código y conexión de interfaz preparados. No se han desplegado credenciales, Cloud Run ni API pública: las descargas **no están operativas** hasta completar el despliegue y pruebas autenticadas de extremo a extremo.

## Pruebas del código

Desde la carpeta raíz del repositorio, con las dependencias instaladas:

```bash
python -m unittest discover -s backend/tests -v
```

Las pruebas no requieren conectarse a Drive: verifican exportación Excel desde SQLite/GeoPackage, integridad del original, selección de componentes SHP y errores ante componentes ausentes. Todavía no sustituyen la prueba integrada del servicio Cloud Run con las cuentas institucionales.

### Muestra revisada en Drive (5 noviembre 2026)

- `AMB_GIS_PLAZAS_2026`: existen `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg` en la carpeta de origen.
- `URB_LIMITE_COMUNA`: existen `.shp`, `.shx`, `.dbf`, `.prj`, `.cpg` en la carpeta de origen.
- `TUR_PTO_AIRBNB_STGO_2026` y `MOV_GIS_SINIESTROS_VIALES_STGO_ENE_JUL_2026`: metadatos de archivo GPKG verificados.

Estas comprobaciones se realizaron con el acceso del propietario de Drive. No validan todavía acceso desde la cuenta de servicio ni descargas de usuario final.

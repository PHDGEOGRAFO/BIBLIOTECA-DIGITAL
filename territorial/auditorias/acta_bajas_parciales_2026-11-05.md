# Acta de depuración parcial — 5 de noviembre de 2026

Origen de decisiones: captura del panel QGIS facilitada por el usuario. Las casillas marcadas se interpretan como selección explícita de bajas para este procedimiento; en QGIS, las casillas originalmente representan visibilidad, por lo que se mantiene esta procedencia documentada.

## Retirados del catálogo web (GitHub)

- ID 369: Barrios_Stgo — EDUCACION — 2025.
- ID 403: Barrios_Stgo — EDUCACION — 2025.
- ID 665: PRC_EXPROPIACION — SHAPES_PRC.
- ID 666: PRC_EXPROPIACION_POLIGONO — SHAPES_PRC.
- ID 667: PRC_ICH — SHAPES_PRC.
- ID 669: PRC_ZONA_TIPICA — SHAPES_PRC.

Catálogo JSON: de 972 a 966 entradas. Commit de cambio: 9d05baecf69530ddcc11e5c2a4828e3781c22709. Blob original previo: f00ef809ec3220533358c58d3fb5bebf6c22e3e0.

## Sin modificar en Drive por falta de identificación unívoca

Los seis registros retirados no tenían enlace individual a archivo de Google Drive. No se ha eliminado ningún archivo de Drive ni componentes de Shapefile. No corresponde borrar archivos por similitud nominal: primero deben identificarse los IDs exactos y el paquete completo (.shp/.shx/.dbf/.prj) o GPKG.

## Marcados en QGIS sin coincidencia exacta en catálogo

- DIFERENCIA_SIMETRICA_BARRIOS_A_C: resultado de comparación de QGIS, no encontrado con ese nombre en el índice.
- LIMITE_BARRIO_NORMALIZADA: no existe coincidencia nominal exacta en el índice. No equiparar automáticamente con URB_POL_LIMITE_BARRIOS_STGO ni URB_LIMITE_BARRIOS.

## Hoja de cálculo maestra

Respaldo creado como pestaña «RESPALDO ANTES BAJAS 2026-11-05» en el documento de catálogo. El intento de borrar filas de la hoja principal fue bloqueado por el entorno. La hoja principal conserva los registros: **pendiente de sincronizar**.

No se han eliminado registros del Drive físico. Cualquier baja pendiente exige el ID físico comprobado en la carpeta correspondiente y la validación del efecto sobre capas/visores dependientes.

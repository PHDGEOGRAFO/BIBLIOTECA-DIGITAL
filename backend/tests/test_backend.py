"""Pruebas locales sin acceso a Drive ni credenciales; ejecutar python -m unittest discover -s backend/tests."""
import importlib.util
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main

class DownloadTests(unittest.TestCase):
    def test_gpks_excel_excludes_geometry_and_original_stays_intact(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/"test.gpkg"
            conn=sqlite3.connect(path)
            conn.executescript("""
              CREATE TABLE gpkg_contents (table_name TEXT, data_type TEXT);
              CREATE TABLE gpkg_geometry_columns (table_name TEXT,column_name TEXT);
              CREATE TABLE sitios (fid INTEGER PRIMARY KEY, nombre TEXT, geom BLOB, cantidad INTEGER);
              INSERT INTO gpkg_contents VALUES ('sitios','features');
              INSERT INTO gpkg_geometry_columns VALUES ('sitios','geom');
              INSERT INTO sitios(nombre,geom,cantidad) VALUES ('Parque',x'000102',42);
            """)
            conn.commit();conn.close()
            original=path.read_bytes()
            target=Path(tmp)/"out.xlsx"
            main.write_excel_gpkg(path,target,"sitios")
            from openpyxl import load_workbook
            wb=load_workbook(target,read_only=True)
            self.assertEqual(list(wb.active.values),[("fid","nombre","cantidad"),(1,"Parque",42)])
            wb.close()
            self.assertEqual(path.read_bytes(),original)
    def test_missing_shapefile_component_is_rejected(self):
        api=MagicMock()
        api.files().list().execute.return_value={"files":[
            {"id":"1","name":"LIMITE_COMUNA.shp"},
            {"id":"2","name":"LIMITE_COMUNA.dbf"},
            {"id":"3","name":"LIMITE_COMUNA.shx"}]}
        with self.assertRaises(main.HTTPException) as ctx:
            main.shapefile_parts(api,{"name":"LIMITE_COMUNA.shp","parents":["parent"]})
        self.assertEqual(ctx.exception.status_code,422)
        self.assertIn(".prj",str(ctx.exception.detail))
    def test_shapefile_all_parts_are_included(self):
        api=MagicMock()
        files=[{"id":str(i),"name":"LIMITE_COMUNA"+ext} for i,ext in enumerate([".shp",".dbf",".shx",".prj",".cpg"])]
        files.append({"id":"20","name":"OTRA.shp"})
        api.files().list().execute.return_value={"files":files}
        result=main.shapefile_parts(api,{"name":"LIMITE_COMUNA.shp","parents":["parent"]})
        self.assertEqual({x["name"] for x in result},{x["name"] for x in files[:-1]})
    def test_zip_original_binary_unchanged(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/"example.gpkg";source.write_bytes(b"SQLite format 3\x00test")
            z=Path(tmp)/"example.zip"
            with zipfile.ZipFile(z,"w",compression=zipfile.ZIP_DEFLATED) as archive:
                archive.write(source,arcname=source.name)
            with zipfile.ZipFile(z) as archive:
                self.assertEqual(archive.read(source.name),source.read_bytes())
                self.assertIsNone(archive.testzip())

if __name__ == "__main__":
    unittest.main()

/* Exportadores locales, sin publicar geometrías en GitHub. */
window.BibliotecaGISExport=(()=>{
 const p='https://cdn.jsdelivr.net/npm/';
 const imports=new Map();
 const load=(url,test)=>{if(test())return Promise.resolve();if(imports.has(url))return imports.get(url);const task=new Promise((ok,bad)=>{const s=document.createElement('script');s.src=url;s.onload=()=>test()?ok():bad(Error('La librería no se inicializó'));s.onerror=()=>bad(Error('No se pudo cargar '+url));document.head.append(s)});imports.set(url,task);return task};
 const save=(bytes,name,mime)=>{const blob=bytes instanceof Blob?bytes:new Blob([bytes],{type:mime});const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),30000)};
 const clean=s=>String(s||'cobertura').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,80);
 const feats=g=>g?.type==='FeatureCollection'?g.features||[]:g?.type==='Feature'?[g]:[];
 const wgs84='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';
 async function shapefile(data,name){
  const features=feats(data).filter(f=>f&&f.geometry);
  if(!features.length)throw Error('No existen entidades para exportar');
  await load(p+'shp-write@0.3.2/shpwrite.js',()=>!!window.shpwrite?.write);
  await load(p+'jszip@3.10.1/dist/jszip.min.js',()=>!!window.JSZip?.prototype.generateAsync);
  const zip=new JSZip();
  const groups={POINT:[],POLYLINE:[],POLYGON:[]};
  for(const f of features){
   const t=f.geometry.type,coords=f.geometry.coordinates,props=f.properties||{};
   if(t==='Point')groups.POINT.push({coordinates:coords,properties:props});
   else if(t==='MultiPoint'){for(const pt of coords)groups.POINT.push({coordinates:pt,properties:props})}
   else if(t==='LineString'||t==='MultiLineString')groups.POLYLINE.push({coordinates:coords,properties:props});
   else if(t==='Polygon'||t==='MultiPolygon')groups.POLYGON.push({coordinates:coords,properties:props});
  }
  let written=0;
  for(const [type,arr] of Object.entries(groups)){
   if(!arr.length)continue;
   const geometric=arr.map(x=>x.coordinates),properties=arr.map(x=>x.properties);
   const out=await new Promise((resolve,reject)=>window.shpwrite.write(properties,type,geometric,(err,files)=>err?reject(err):resolve(files)));
   const prefix=clean(name)+'_'+({POINT:'puntos',POLYLINE:'lineas',POLYGON:'poligonos'}[type]);
   for(const ext of ['shp','shx','dbf']){
     let raw=out[ext];if(!raw)throw Error('El exportador no generó '+ext.toUpperCase());
     if(raw instanceof DataView)raw=new Uint8Array(raw.buffer,raw.byteOffset,raw.byteLength);
     zip.file(prefix+'.'+ext,raw);
   }
   zip.file(prefix+'.prj',wgs84);
   zip.file(prefix+'.cpg','UTF-8');
   written+=arr.length;
  }
  if(!written)throw Error('No se soportan los tipos de geometría seleccionados');
  const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}});
  const bytes=await blob.arrayBuffer();
  const check=await JSZip.loadAsync(bytes);
  const actual=Object.keys(check.files).filter(x=>x.endsWith('.shp'));
  if(!actual.length)throw Error('El ZIP no contiene archivos SHP');
  save(blob,clean(name)+'.zip','application/zip');
  return {features:written,layers:actual.length};
 }
 const geometryCodes={Point:1,LineString:2,Polygon:3,MultiPoint:4,MultiLineString:5,MultiPolygon:6,GeometryCollection:7};
 const bytesOf=(n)=>new Uint8Array(n);
 function wkb(g){
  const chunks=[],encoder=new TextEncoder();
  let total=0;
  const add=b=>{chunks.push(b);total+=b.byteLength};
  const uint=n=>{const b=bytesOf(4);new DataView(b.buffer).setUint32(0,n,true);add(b)};
  const point=p=>{const b=bytesOf(16),d=new DataView(b.buffer);d.setFloat64(0,+p[0],true);d.setFloat64(8,+p[1],true);add(b)};
  const rec=x=>{
   const t=geometryCodes[x?.type];if(!t)throw Error('Tipo geométrico no admitido: '+x?.type);
   add(new Uint8Array([1]));uint(t);
   if(t===1)point(x.coordinates);
   if(t===2){uint(x.coordinates.length);x.coordinates.forEach(point)}
   if(t===3){uint(x.coordinates.length);for(const ring of x.coordinates){uint(ring.length);ring.forEach(point)}}
   if(t>=4){const geometries=t===7?x.geometries:(x.coordinates||[]).map(c=>({type:({4:'Point',5:'LineString',6:'Polygon'})[t],coordinates:c}));uint(geometries.length);geometries.forEach(rec)}
  };
  rec(g);
  const out=bytesOf(total);let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.length}return out;
 }
 function gpkgBlob(g){
  const w=wkb(g),out=bytesOf(8+w.length);
  out[0]=71;out[1]=80;out[2]=0;out[3]=1;new DataView(out.buffer).setInt32(4,4326,true);out.set(w,8);return out;
 }
 function bound(g,b){
  if(!g)return;
  if(g.type==='GeometryCollection'){(g.geometries||[]).forEach(x=>bound(x,b));return}
  const travel=x=>{if(!Array.isArray(x))return;if(x.length>=2&&typeof x[0]==='number'&&typeof x[1]==='number'){const [lon,lat]=x;if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90)throw Error('Coordenadas fuera de EPSG:4326');b[0]=Math.min(b[0],lon);b[1]=Math.min(b[1],lat);b[2]=Math.max(b[2],lon);b[3]=Math.max(b[3],lat)}else x.forEach(travel)};travel(g.coordinates);
 }
 async function geopackage(data,name){
  const rows=feats(data);if(!rows.length)throw Error('No hay entidades para GeoPackage');
  await load('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',()=>!!window.initSqlJs);
  const SQL=await window.initSqlJs({locateFile:f=>'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/'+f});
  const db=new SQL.Database();
  const quote=s=>'"'+String(s).replace(/"/g,'""')+'"';
  const layer=clean(name).slice(0,52)||'cobertura';
  const keys=[...new Set(rows.flatMap(f=>Object.keys(f.properties||{})))].filter(k=>k!=='fid'&&k!=='geom').slice(0,120);
  const bounds=[Infinity,Infinity,-Infinity,-Infinity];
  for(const f of rows)if(f.geometry)bound(f.geometry,bounds);
  try{
   db.run('PRAGMA application_id=1196444487'); // 0x47504B47 GPKG
   db.run('PRAGMA user_version=10300');
   db.run('CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL,srs_id INTEGER NOT NULL PRIMARY KEY,organization TEXT NOT NULL,organization_coordsys_id INTEGER NOT NULL,definition TEXT NOT NULL,description TEXT)');
   db.run('CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY,data_type TEXT NOT NULL,identifier TEXT UNIQUE,description TEXT DEFAULT \'\',last_change DATETIME NOT NULL DEFAULT (strftime(\'%Y-%m-%dT%H:%M:%fZ\',\'now\')),min_x DOUBLE,min_y DOUBLE,max_x DOUBLE,max_y DOUBLE,srs_id INTEGER,CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id))');
   db.run('CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL,column_name TEXT NOT NULL,geometry_type_name TEXT NOT NULL,srs_id INTEGER NOT NULL,z TINYINT NOT NULL,m TINYINT NOT NULL,PRIMARY KEY (table_name,column_name),FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id))');
   const insert=db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)');
   for(const x of [['Undefined Cartesian',-1,'NONE',-1,'undefined','undefined Cartesian'],['Undefined geographic',0,'NONE',0,'undefined','undefined geographic'],['WGS 84',4326,'EPSG',4326,wgs84,'Longitude/latitude WGS84']]){insert.run(x)}insert.free();
   const typenames=[...new Set(rows.filter(x=>x.geometry).map(x=>x.geometry.type.toUpperCase()))];
   const geomtype=typenames.length===1?typenames[0]:'GEOMETRY';
   const cols=keys.map(k=>quote(k)+' '+(rows.every(f=>f.properties?.[k]==null||Number.isInteger(f.properties[k]))?'INTEGER':rows.every(f=>f.properties?.[k]==null||typeof f.properties[k]==='number')?'REAL':'TEXT')).join(',');
   db.run('CREATE TABLE '+quote(layer)+' (fid INTEGER PRIMARY KEY AUTOINCREMENT,geom BLOB'+(cols?','+cols:'')+')');
   const place=new Array(keys.length+1).fill('?').join(',');
   const stmt=db.prepare('INSERT INTO '+quote(layer)+' (geom'+keys.map(quote).map(x=>','+x).join('')+') VALUES ('+place+')');
   db.run('BEGIN');
   for(const f of rows){const vals=keys.map(k=>{const v=f.properties?.[k];return v==null?null:typeof v==='object'?JSON.stringify(v):typeof v==='boolean'?Number(v):v});stmt.run([f.geometry?gpkgBlob(f.geometry):null,...vals])}
   stmt.free();db.run('COMMIT');
   db.run('INSERT INTO gpkg_contents(table_name,data_type,identifier,description,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?)',[layer,'features',layer,'Biblioteca Digital - exportación del mapa',...bounds.map(x=>Number.isFinite(x)?x:null),4326]);
   db.run('INSERT INTO gpkg_geometry_columns VALUES (?,?,?,?,?,?)',[layer,'geom',geomtype,4326,0,0]);
   const exported=db.export();
   const verify=new SQL.Database(exported);
   const n=verify.exec('SELECT count(*) FROM '+quote(layer))[0].values[0][0];
   const metadata=verify.exec("SELECT srs_id FROM gpkg_geometry_columns WHERE table_name='"+layer+"'")[0].values[0][0];verify.close();
   if(n!==rows.length||metadata!==4326)throw Error('Falló la validación de registros del GeoPackage');
   save(exported,clean(name)+'.gpkg','application/geopackage+sqlite3');
   return {features:n,layer,crs:'EPSG:4326'};
  }finally{db.close()}
 }
 return {shapefile,geopackage};
})();
/* Prueba controlada: conversor local GIS. No carga archivos privados en GitHub. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const status=msg=>{$('converterStatus').textContent=msg};
const scripts={};
function load(src,check){if(check())return Promise.resolve();if(scripts[src])return scripts[src];return scripts[src]=new Promise((ok,fail)=>{const s=document.createElement('script');s.src=src;s.onload=()=>check()?ok():fail(Error('Biblioteca no disponible'));s.onerror=()=>fail(Error('No fue posible cargar '+src));document.head.appendChild(s)})}
function exportBlob(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
const clean=x=>String(x||'cobertura').replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,90);
let current=null,sourceFile=null,driveToken=null,tokenClient=null,sourceName='',layers=[],preferredCoverage=null,loadSequence=0;
window.BibliotecaDriveConnected=false;
window.addEventListener('biblioteca:geometry-loaded',e=>{current=e.detail.data;sourceName=e.detail.name;const count=current.features?.length||0;const geo=document.getElementById('convertGeojson'),csv=document.getElementById('convertCsv'),gpkg=document.getElementById('convertGpkg');if(geo)geo.disabled=count===0;if(csv)csv.disabled=count===0;if(gpkg)gpkg.disabled=count===0;});
window.addEventListener('biblioteca:coverage-selected',async e=>{const r=e.detail.coverage;preferredCoverage=r;const seq=++loadSequence;current=null;sourceFile=null;sourceName=r.n;layers=[];const geo=document.getElementById('convertGeojson'),csv=document.getElementById('convertCsv'),gpkg=document.getElementById('convertGpkg');if(geo)geo.disabled=true;if(csv)csv.disabled=true;if(gpkg)gpkg.disabled=true;if(driveToken&&r.driveFileId){try{status('Cargando capa seleccionada desde Google Drive: '+r.n+'…');await driveFile(r.driveFileId,r.n,seq)}catch(err){if(seq===loadSequence)status('No se pudo visualizar '+r.n+' desde Drive: '+err.message)}}else if(!r.driveFileId){status('No se encontró archivo individual de Drive para '+r.n+'. Puedes cargarlo desde tu equipo.')}else if(!document.getElementById('connectDrive')?.disabled){status('Para visualizar '+r.n+' desde Drive, conecta una cuenta autorizada.')}else{status('Seleccionaste '+r.n+'. Drive privado aún requiere configuración OAuth; puedes abrir el archivo desde Drive o cargarlo localmente.') }});
const maxRows=40000;
async function fromZip(bytes){await load('https://cdn.jsdelivr.net/npm/shpjs@6.2.0/dist/shp.min.js',()=>typeof window.shp==='function');let result=await window.shp(bytes);if(Array.isArray(result))return result.map((x,i)=>({name:x.fileName||'Capa '+(i+1),data:x}));return [{name:'Shapefile',data:result}];}
async function fromGpkg(bytes){
 await load('https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js',()=>typeof window.initSqlJs==='function');
 await load('https://cdnjs.cloudflare.com/ajax/libs/proj4js/2.12.1/proj4.js',()=>typeof window.proj4==='function');
 window.proj4.defs('EPSG:32719','+proj=utm +zone=19 +south +datum=WGS84 +units=m +no_defs');
 const SQL=await window.initSqlJs({locateFile:f=>'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/'+f});
 const db=new SQL.Database(new Uint8Array(bytes));let out=[];
 try{
 const tbl=db.exec("SELECT table_name,srs_id FROM gpkg_contents WHERE data_type='features'");
 if(!tbl.length)throw Error('El archivo GeoPackage no contiene capas vectoriales');
 for(const [table,srs] of tbl[0].values){
 const quote=x=>'"'+String(x).replace(/"/g,'""')+'"';
 const nameQuoted="'"+String(table).replace(/'/g,"''")+"'";
 const geocol=db.exec("SELECT column_name FROM gpkg_geometry_columns WHERE table_name="+nameQuoted);
 if(!geocol.length)continue;const geomcol=geocol[0].values[0][0];
 const count=db.exec('SELECT COUNT(*) FROM '+quote(table))[0].values[0][0];
 const rows=db.exec('SELECT * FROM '+quote(table)+' LIMIT '+maxRows);
 const features=[];if(rows.length){const names=rows[0].columns,gi=names.indexOf(geomcol);
 for(const rec of rows[0].values){try{const raw=rec[gi];if(!raw)continue;const buf=raw instanceof Uint8Array?raw:new Uint8Array(raw);
 const parsed=parseGpkgGeometry(buf,srs);const properties={};names.forEach((n,i)=>{if(i!==gi){let v=rec[i];properties[n]=v instanceof Uint8Array?'[BLOB]':v}});
 features.push({type:'Feature',geometry:parsed,properties});}catch(e){/* ignore invalid record only */}}}
 out.push({name:table,data:{type:'FeatureCollection',features},count,truncated:count>maxRows});
 }
 if(!out.length)throw Error('No se pudieron leer capas con geometría');
 return out;
 }finally{db.close()}
}
function parseGpkgGeometry(bytes,defaultSrs){
 const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(bytes.length<8||bytes[0]!==0x47||bytes[1]!==0x50)throw Error('Cabecera GeoPackage inválida');
 const flags=bytes[3],little=(flags&1)!==0,env=(flags>>1)&7,skip=[0,32,48,48,64][env];if(skip===undefined)throw Error('Envolvente no compatible');
 const srs=dv.getInt32(4,little),srid=srs||defaultSrs;let pos=8+skip;
 const u=le=>{let v=dv.getUint32(pos,le);pos+=4;return v};
 const d=le=>{let v=dv.getFloat64(pos,le);pos+=8;return v};
 let transform;
 if(srid===4326)transform=(x,y)=>[x,y];
 else if(srid===32719)transform=(x,y)=>window.proj4('EPSG:32719','EPSG:4326',[x,y]);
 else if(srid===3857)transform=(x,y)=>window.proj4('EPSG:3857','EPSG:4326',[x,y]);
 else throw Error('CRS '+srid+' no soportado en esta prueba');
 function geometry(){
 const le=bytes[pos++]===1;let code=u(le);let type=code%1000;const dimension=code>=3000?4:code>=1000?3:2;
 const point=()=>{const x=d(le),y=d(le);for(let i=2;i<dimension;i++)d(le);return transform(x,y)};
 if(type===1)return{type:'Point',coordinates:point()};
 if(type===2){let n=u(le),a=[];while(n--)a.push(point());return{type:'LineString',coordinates:a}}
 if(type===3){let n=u(le),a=[];while(n--){let m=u(le),ring=[];while(m--)ring.push(point());a.push(ring)}return{type:'Polygon',coordinates:a}}
 if([4,5,6,7].includes(type)){let n=u(le),a=[];while(n--)a.push(geometry());if(type===7)return{type:'GeometryCollection',geometries:a};return{type:({4:'MultiPoint',5:'MultiLineString',6:'MultiPolygon'})[type],coordinates:a.map(x=>x.coordinates)}}
 throw Error('WKB tipo '+type+' no soportado');
 }
 return geometry();
}
async function parseFile(file){
 const name=file.name.toLowerCase(),bytes=await file.arrayBuffer();
 if(name.endsWith('.geojson')||name.endsWith('.json'))return [{name:file.name,data:JSON.parse(new TextDecoder().decode(bytes))}];
 if(name.endsWith('.zip'))return fromZip(bytes);
 if(name.endsWith('.gpkg'))return fromGpkg(bytes);
 throw Error('Formato no admitido: utilice GeoJSON, ZIP SHP o GPKG');
}
function setLayer(i){const x=layers[i];if(!x)return;current=x.data;sourceName=x.name;preview=current;draw(current,x.name);updateDownload();const n=current.features?.length||0;status('Visualización real: '+x.name+' · '+n+' entidades'+(x.truncated?' · Muestra limitada; no usar exportación como archivo completo':'')+'.');$('convertGeojson').disabled=!n;$('convertCsv').disabled=!n;$('convertGpkg').disabled=!n;$('convertLayer').value=i;}
async function handleFile(file,targetName=null,seq=null){if(!file)return;status('Leyendo '+file.name+'…');try{const parsed=await parseFile(file);if(seq!==null&&seq!==loadSequence)return;layers=parsed;sourceFile=file;const sel=$('convertLayer');sel.replaceChildren();layers.forEach((x,i)=>{const o=document.createElement('option');o.value=i;o.textContent=x.name+(x.count?' ('+x.count+' registros)':'');sel.append(o)});sel.disabled=layers.length<2;const normalized=x=>String(x||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');const desired=normalized(targetName);const match=desired?layers.findIndex(x=>normalized(x.name)===desired||normalized(x.name).includes(desired)||desired.includes(normalized(x.name))):0;setLayer(Math.max(0,match));}catch(e){status('No se pudo procesar el archivo: '+e.message);$('convertGeojson').disabled=true;$('convertCsv').disabled=true;$('convertGpkg').disabled=true;}}
async function driveFile(id,targetName=null,seq=null){
 if(!driveToken)throw Error('Debes iniciar sesión autorizada de Google Drive');
 const metaResp=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,mimeType,parents,size',{headers:{Authorization:'Bearer '+driveToken}});
 if(!metaResp.ok)throw Error('Sin acceso a metadatos de Drive (HTTP '+metaResp.status+'). Verifica permisos, cuenta y OAuth.');
 const meta=await metaResp.json();let bytes,name=meta.name;
 if(/\.shp$/i.test(name)){
 if(!meta.parents?.[0])throw Error('No se puede localizar la carpeta del Shapefile');
 const parent=meta.parents[0],prefix=name.slice(0,-4);
 const query="'"+parent+"' in parents and trashed = false";
 let pageToken='',all=[];do{const queryParams=new URLSearchParams({q:query,fields:'nextPageToken,files(id,name)',pageSize:'1000',supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(pageToken)queryParams.set('pageToken',pageToken);const list=await fetch('https://www.googleapis.com/drive/v3/files?'+queryParams.toString(),{headers:{Authorization:'Bearer '+driveToken}});if(!list.ok)throw Error('Sin permiso para listar componentes SHP (HTTP '+list.status+')');const page=await list.json();all.push(...(page.files||[]));pageToken=page.nextPageToken||'';}while(pageToken);
 const components=all.filter(x=>x.name.toLowerCase().startsWith(prefix.toLowerCase()+'.')&&/\.(shp|shx|dbf|prj|cpg)$/i.test(x.name));
 if(!['shp','shx','dbf'].every(ext=>components.some(x=>x.name.toLowerCase()===prefix.toLowerCase()+'.'+ext)))throw Error('Faltan componentes SHP/SHX/DBF en la carpeta');
 await load('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',()=>!!window.JSZip);
 const zip=new JSZip();for(const x of components){const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(x.id)+'?alt=media',{headers:{Authorization:'Bearer '+driveToken}});if(!r.ok)throw Error('No se pudo leer '+x.name);zip.file(x.name,await r.arrayBuffer())}
 bytes=await zip.generateAsync({type:'blob'});name=prefix+'.zip';
 }else{
 const r=await fetch('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?alt=media',{headers:{Authorization:'Bearer '+driveToken}});
 if(!r.ok)throw Error('No autorizado para leer archivo (HTTP '+r.status+')');bytes=await r.blob();
 }
 await handleFile(new File([bytes],name),targetName,seq);if(seq===null||seq===loadSequence)status('Archivo de Drive leído correctamente: '+name+' · No se publicó en GitHub.');
}
async function configureOAuth(id){
 if(!/^[0-9]+-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id))throw Error('ID de cliente OAuth inválido. Debe terminar en .apps.googleusercontent.com');
 await load('https://accounts.google.com/gsi/client',()=>!!window.google?.accounts?.oauth2);
 tokenClient=google.accounts.oauth2.initTokenClient({client_id:id,scope:'https://www.googleapis.com/auth/drive.readonly',callback:async response=>{
  if(response.error)return status('OAuth Google: '+response.error);
  driveToken=response.access_token;window.BibliotecaDriveConnected=true;
  $('connectDrive').textContent='Reconectar Google Drive';
  $('driveLoad').disabled=false;
  status('Conexión de solo lectura a Google Drive autorizada; selecciona una cobertura para visualizarla.');
  if(window.selected?.driveFileId){try{const seq=++loadSequence;await driveFile(window.selected.driveFileId,window.selected.n,seq)}catch(e){status('Drive autorizado, pero la cobertura seleccionada no pudo cargarse: '+e.message)}}
 }});
 $('connectDrive').disabled=false;$('connectDrive').style.display='inline-block';
 $('driveLoad').style.display='inline-block';$('oauthSetup').style.display='none';
}
async function initDrive(){
 const cfg=await fetch('descargas-config.json',{cache:'no-store'}).then(r=>r.json()).catch(()=>({}));
 const id=String(cfg.googleClientId||sessionStorage.getItem('bibliotecaOAuthClientId')||'').trim();
 $('oauthSetup').style.display=id?'none':'flex';
 $('oauthClientInput').value=id;
 if(id){try{await configureOAuth(id);status('Cliente OAuth identificado. Presiona «Conectar Google Drive» para autorizar lectura.')}catch(e){$('oauthSetup').style.display='flex';status('Error de configuración OAuth: '+e.message)}}
 else status('Para leer coberturas privadas automáticamente, configura y autoriza un cliente OAuth de Google Drive. La carga local continúa disponible.');
}
function addUi(){
 const container=document.querySelector('.maphead');if(!container)return;
 const div=document.createElement('section');div.style.cssText='background:#f4f8f6;border:1px solid #d4e0da;border-radius:9px;padding:10px;margin:8px 0 10px;font-size:12px';
 div.innerHTML="<div style=\"display:flex;align-items:center;gap:7px;flex-wrap:wrap\"><span style=\"font-size:12px;font-weight:700;margin-right:4px\">Descargar capa visualizada:</span><button class=\"btn\" type=\"button\" id=\"convertGpkg\" disabled>GeoPackage (.gpkg)</button><button class=\"btn secondary format-info\" type=\"button\" data-format=\"gpkg\" aria-label=\"Información sobre GeoPackage\">?</button><button class=\"btn secondary\" type=\"button\" id=\"convertGeojson\" disabled>GeoJSON</button><button class=\"btn secondary format-info\" type=\"button\" data-format=\"geojson\" aria-label=\"Información sobre GeoJSON\">?</button><button class=\"btn secondary\" type=\"button\" id=\"convertCsv\" disabled>CSV</button><button class=\"btn secondary format-info\" type=\"button\" data-format=\"csv\" aria-label=\"Información sobre CSV\">?</button><label class=\"btn secondary\" style=\"cursor:pointer\">Cargar archivo local<input id=\"convertLocal\" type=\"file\" accept=\".gpkg,.zip,.geojson,.json\" hidden></label><select id=\"convertLayer\" disabled style=\"width:auto;max-width:210px\" aria-label=\"Capa interna GeoPackage\"></select><button class=\"btn secondary\" type=\"button\" id=\"connectDrive\" disabled style=\"display:none\">Conectar Google Drive</button><button class=\"btn secondary\" type=\"button\" id=\"driveLoad\" disabled style=\"display:none\">Cargar desde Drive</button></div><p id=\"converterStatus\" role=\"status\" style=\"font-size:11px;margin:7px 0 0;color:#536d64\">Selecciona una cobertura del catálogo. Las descargas se habilitan cuando su geometría está disponible.</p>";
 container.insertAdjacentElement('afterend',div);
 const oauth=document.createElement('div');oauth.id='oauthSetup';oauth.style.cssText='display:none;gap:6px;align-items:center;flex-wrap:wrap;padding:8px;background:#f8f7ee;border-radius:7px;margin-top:6px';oauth.innerHTML='<label for="oauthClientInput">ID de cliente OAuth:</label><input id="oauthClientInput" placeholder="...apps.googleusercontent.com" autocomplete="off" style="max-width:310px;padding:7px"><button id="saveOAuthId" class="btn secondary" type="button">Preparar conexión</button><a href="oauth-google-drive.html" target="_blank" rel="noopener">Instrucciones OAuth</a>';div.append(oauth);
 const explanations={
 gpkg:{title:'GeoPackage (.gpkg)',body:'Genera un GeoPackage nuevo con <b>solo la capa actualmente visualizada</b> y sus atributos, en EPSG:4326. No incluye otras capas del archivo fuente ni descarga automáticamente el original de Drive.'},
 geojson:{title:'GeoJSON (.geojson)',body:'Guarda la geometría y los atributos de la capa visualizada como GeoJSON, con coordenadas geográficas EPSG:4326. No incluye otras coberturas del catálogo.'},
 csv:{title:'CSV (.csv)',body:'Guarda únicamente los campos y registros de la tabla de atributos de la cobertura visualizada; no incluye coordenadas geométricas ni polígonos, salvo que existan como columnas ordinarias.'}
 };
 const info=document.createElement('dialog');info.id='formatInfo';info.style.cssText='max-width:480px;width:calc(100% - 32px);border:1px solid #bbd0c7;border-radius:10px;padding:20px;box-shadow:0 20px 60px #0005;color:#213b31';document.body.append(info);
 div.querySelectorAll('.format-info').forEach(b=>b.onclick=()=>{const d=explanations[b.dataset.format];info.innerHTML='<h3>'+d.title+'</h3><p style="line-height:1.5">'+d.body+'</p><button class="btn" id="closeFormatInfo" type="button">Cerrar</button>';info.querySelector('#closeFormatInfo').onclick=()=>info.close();info.showModal()});
 $('convertLocal').onchange=e=>handleFile(e.target.files[0]);
 $('convertLayer').onchange=e=>setLayer(Number(e.target.value));
 $('convertGeojson').onclick=()=>{if(current)exportBlob(new Blob([JSON.stringify(current)],{type:'application/geo+json'}),clean(sourceName)+'.geojson')};
 $('convertGpkg').onclick=async()=>{if(!current)return;const btn=$('convertGpkg');btn.disabled=true;try{if(layers.find(x=>x.data===current)?.truncated)throw Error('Esta capa solo contiene una muestra; no se permite exportar un GeoPackage incompleto');status('Generando GeoPackage EPSG:4326…');if(!window.BibliotecaGISExport?.geopackage)throw Error('Exportador GeoPackage no disponible');const result=await window.BibliotecaGISExport.geopackage(current,sourceName);status('GeoPackage generado: '+result.features+' entidades · '+result.layer+' · '+result.crs+'.')}catch(e){status('GeoPackage: '+e.message)}finally{btn.disabled=false}};
 $('convertCsv').onclick=()=>{if(!current)return;const data=current.features||[];const keys=[...new Set(data.flatMap(f=>Object.keys(f.properties||{})))];if(!keys.length){status('La cobertura no contiene columnas de atributos para exportar a CSV.');return;}const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';const rows=[keys.map(cell).join(';'),...data.map(f=>keys.map(k=>cell(f.properties?.[k])).join(';'))];exportBlob(new Blob(['\ufeff'+rows.join('\r\n')],{type:'text/csv;charset=utf-8'}),clean(sourceName)+'.csv')};
 $('saveOAuthId').onclick=async()=>{const id=$('oauthClientInput').value.trim();try{await configureOAuth(id);sessionStorage.setItem('bibliotecaOAuthClientId',id);status('Cliente OAuth preparado para esta sesión. Ahora presiona «Conectar Google Drive».')}catch(e){status('OAuth: '+e.message)}};
 $('connectDrive').onclick=()=>tokenClient?.requestAccessToken({prompt:'consent'});
 $('driveLoad').onclick=async()=>{if(!selected?.driveFileId)return status('La cobertura seleccionada no tiene archivo individual identificado en Drive.');try{status('Descargando cobertura autorizada…');await driveFile(selected.driveFileId,selected.n,++loadSequence)}catch(e){status('No se pudo cargar desde Drive: '+e.message)}};
 initDrive();
}
addUi();
})();
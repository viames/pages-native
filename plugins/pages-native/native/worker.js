/* Native JXA worker. Fixed program, JSON request on stdin. No eval or shell execution.
 * Copyright (c) 2026 Viames Marino. MIT License.
 */
ObjC.import('Foundation');
ObjC.import('AppKit');

function fail(code, message, details) {
  var error = new Error(message); error.nativeCode = code; error.details = details || {}; throw error;
}
function unwrap(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return { date: value.toISOString() };
  if (typeof value === 'number') return isFinite(value) ? value : null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  return String(value);
}
function color16(value) {
  if(!Array.isArray(value)||value.length!==3)return null;
  var normalized=value.every(function(v){return typeof v==='number'&&v>=0&&v<=1;});
  return value.map(function(v){return Math.round(normalized?v*65535:v);});
}
function getPath(d) { var f = d.file(); return f ? String(f) : null; }
function canonicalNativePath(path) { return path?ObjC.unwrap($.NSString.stringWithString(path).stringByResolvingSymlinksInPath):null; }
function pdfCapability() {
  try {ObjC.import('PDFKit');return {available:true,framework:'macOS PDFKit / AppKit'};}
  catch(e){return {available:false,message:e.message};}
}
function renderPreview(app,d,a) {
  if($.NSFileManager.defaultManager.fileExistsAtPath(a.path)||$.NSFileManager.defaultManager.fileExistsAtPath(a.image_path))fail('DESTINATION_EXISTS','Preview files must be new.');
  if(!pdfCapability().available)fail('PDFKIT_UNAVAILABLE','The native PDF renderer is unavailable.');
  var manager=$.NSFileManager.defaultManager;
  var parent=ObjC.unwrap($.NSString.stringWithString(a.path).stringByDeletingLastPathComponent);
  var temporary=parent+'/.pages-native-preview-'+ObjC.unwrap($.NSUUID.UUID.UUIDString);
  if(!manager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(temporary,false,$({}),null))fail('PREVIEW_RENDER_FAILED','Cannot create native preview staging directory.');
  var previous=null,stable=false,attempt,count,number=a.page||1,bitmap,png,pdfPath;
  try {
    // Pages can acknowledge document changes before its PDF output settles.
    // Render independent exports until the selected page matches twice, bounded.
    for(attempt=1;attempt<=4;attempt++) {
      $.NSThread.sleepForTimeInterval(attempt===1?0.5:0.4);
      pdfPath=temporary+'/'+attempt+'.pdf';app.export(d,{to:Path(pdfPath),as:'PDF'});
      var pdf=$.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(pdfPath));
      if(!pdf||pdf.isNil())fail('PREVIEW_PDF_INVALID','Pages exported an unreadable PDF.');
      count=Number(pdf.pageCount);
      if(number<1||number>count){manager.copyItemAtPathToPathError(pdfPath,a.path,null);fail('PREVIEW_PAGE_RANGE','Requested page exceeds the exported PDF.',{page_count:count,pdf_path:a.path});}
      var page=pdf.pageAtIndex(number-1),bounds=page.boundsForBox($.kPDFDisplayBoxMediaBox),edge=a.max_dimension||1200;
      var scale=edge/Math.max(bounds.size.width,bounds.size.height);
      var thumbnail=page.thumbnailOfSizeForBox($.NSMakeSize(bounds.size.width*scale,bounds.size.height*scale),$.kPDFDisplayBoxMediaBox);
      bitmap=$.NSBitmapImageRep.imageRepWithData(thumbnail.TIFFRepresentation);
      png=bitmap.representationUsingTypeProperties($.NSPNGFileType,$({}));
      if(!png||png.isNil())fail('PREVIEW_RENDER_FAILED','Native PNG rendering failed.');
      if(previous&&png.isEqualToData(previous)){stable=true;break;}
      previous=png;
    }
    if(!manager.copyItemAtPathToPathError(pdfPath,a.path,null))fail('PREVIEW_RENDER_FAILED','Cannot publish the new preview PDF.');
    var staged=temporary+'/page.png';
    if(!png.writeToFileAtomically(staged,true)||!manager.copyItemAtPathToPathError(staged,a.image_path,null))fail('PREVIEW_RENDER_FAILED','Cannot publish the new preview PNG.',{pdf_path:a.path});
    return {pdf_path:a.path,image_path:a.image_path,page:number,page_count:count,width:Number(bitmap.pixelsWide),height:Number(bitmap.pixelsHigh),renderer:'macOS PDFKit / AppKit',source_path:getPath(d),render_stable:stable,render_attempts:Math.min(attempt,4),...(!stable?{notice:'Selected-page output was still changing; inspect or generate a fresh preview.'}:{})};
  } finally {manager.removeItemAtPathError(temporary,null);}
}

function colName(n) { var s = ''; while(n > 0) { n--; s = String.fromCharCode(65+n%26)+s; n=Math.floor(n/26); } return s; }
function bounds(t, value) {
  var m = /^([A-Z]{1,3})([1-9][0-9]*)(?::([A-Z]{1,3})([1-9][0-9]*))?$/.exec(value);
  if (!m) fail('INVALID_RANGE', 'Expected table-relative A1 notation.');
  function column(s) { return s.split('').reduce(function(n,c){return n*26+c.charCodeAt(0)-64;},0); }
  var b={ column:column(m[1]), row:Number(m[2]), endColumn:column(m[3]||m[1]), endRow:Number(m[4]||m[2]) };
  if (b.endColumn<b.column || b.endRow<b.row || b.endColumn>t.columnCount() || b.endRow>t.rowCount()) fail('RANGE_OUT_OF_BOUNDS', 'Range exceeds this table. Resize the table explicitly first.');
  if ((b.endColumn-b.column+1)*(b.endRow-b.row+1)>2000) fail('CELL_LIMIT', 'Use at most 2,000 cells.');
  return b;
}
function readCells(t, range) {
  var b=bounds(t,range), r=t.ranges.byName(range), cells=[], row=[];
  // Four Apple Events for the entire range rather than four events per cell.
  var values=r.cells.value(), formatted=r.cells.formattedValue(), formulas=r.cells.formula(), formats=r.cells.format();
  var k=0;
  for(var y=b.row;y<=b.endRow;y++) {
    row=[];
    for(var x=b.column;x<=b.endColumn;x++,k++) row.push({address:colName(x)+y,value:formats[k]==='checkbox'&&values[k]!==null&&values[k]!==undefined?!!values[k]:unwrap(values[k]),formatted:unwrap(formatted[k]),formula:unwrap(formulas[k]),format:unwrap(formats[k])});
    cells.push(row);
  }
  return { range:range, cells:cells };
}
function assignValue(c,v,oldFormat,preserve) {
  var numeric=['automatic','number','currency','percent','duration','fraction','scientific','rating','slider','stepper'];
  var restore=null;
  if(typeof v==='string') {c.format='text';c.value=v;restore='text';}
  else if(v&&typeof v==='object'&&v.formula) {
    if(oldFormat==='text')c.format='automatic';c.value=v.formula;
    if(preserve&&oldFormat!=='text'&&oldFormat!=='other')restore=oldFormat;
  }
  else if(v&&typeof v==='object'&&v.date) {c.format='date and time';c.value=new Date(v.date);restore='date and time';}
  else if(typeof v==='boolean') fail('UNSUPPORTED_NATIVE_API','Pages coerces boolean cell values to numbers. Supply a deliberate number or literal text.');
  else {
    if(v!==null&&oldFormat==='text')c.format='automatic';c.value=v;
    if(preserve&&oldFormat!=='other'&&(v===null||numeric.indexOf(oldFormat)>=0))restore=oldFormat;
  }
  // Pages' value setter can reset even currency/percent to Automatic.
  if(restore)c.format=restore;
  return restore;
}

function resolveApp() {
  var url=$.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier('com.apple.iWork.Pages');
  if (url && !url.isNil()) return ObjC.unwrap(url.path);
  var paths=['/Applications/Pages.app',ObjC.unwrap($.NSHomeDirectory())+'/Applications/Pages.app'];
  for(var i=0;i<paths.length;i++) if($.NSFileManager.defaultManager.fileExistsAtPath(paths[i])) return paths[i];
  fail('PAGES_NOT_INSTALLED','Install Apple Pages on this Mac.');
}

function documentSummary(d) {return {document_id:d.id(),name:d.name(),path:getPath(d),modified:d.modified(),document_body:d.documentBody()};}
function info(d) {return documentSummary(d);}
function documentById(app,id) {var ds=app.documents().filter(function(d){return d.id()===id;});if(ds.length!==1)fail('DOCUMENT_NOT_FOUND','List or reopen the document for its current ID.');return ds[0];}
function indexed(collection,index,label) {if(index<1||index>collection.length)fail('INDEX_OUT_OF_BOUNDS','Invalid '+label+' index.');return collection[index-1];}
function tableInfo(t,i) {return {index:i,name:t.name(),rows:t.rowCount(),columns:t.columnCount(),header_rows:t.headerRowCount(),header_columns:t.headerColumnCount(),footer_rows:t.footerRowCount(),position:t.position(),width:t.width(),height:t.height(),locked:t.locked()};}
function inspect(d) {var r=info(d);r.page_count=d.pages.length;r.section_count=d.sections.length;r.tables=d.tables().map(function(t,i){return tableInfo(t,i+1);});r.objects={text:d.textItems.length,shape:d.shapes.length,image:d.images.length,chart:d.charts.length,line:d.lines.length,group:d.groups.length};return r;}
function geometry(o,a) {if(a.locked===false)o.locked=false;if(a.x!==undefined||a.y!==undefined){var p=o.position();o.position={x:a.x===undefined?p.x:a.x,y:a.y===undefined?p.y:a.y};}if(a.width!==undefined)o.width=a.width;if(a.height!==undefined)o.height=a.height;if(a.rotation!==undefined)o.rotation=a.rotation;if(a.opacity!==undefined)o.opacity=a.opacity;if(a.locked===true)o.locked=true;}
function collection(d,kind) {return d[{text:'textItems',shape:'shapes',image:'images',chart:'charts',line:'lines',group:'groups'}[kind]];}
function objects(d) {var out=[];['text','shape','image','chart','line','group'].forEach(function(k){collection(d,k)().forEach(function(o,i){var r={kind:k,index:i+1,position:o.position(),width:o.width(),height:o.height()};if(k!=='group')r.locked=o.locked();if(k==='text'||k==='shape'||k==='image'){r.rotation=o.rotation();r.opacity=o.opacity();}if(k==='text'||k==='shape')r.text=o.objectText();if(k==='image'){r.description=o.description();r.file_name=unwrap(o.fileName());}out.push(r);});});return {objects:out};}
function placeholders(d) {var out=[];for(var i=0;i<d.placeholderTexts.length;i++){var p=d.placeholderTexts[i];out.push({index:i+1,tag:p.tag(),text:String(p())});}return {placeholders:out};}
function exists(path) {return $.NSFileManager.defaultManager.fileExistsAtPath(path);}
function stableJSON(v) {
  if(Array.isArray(v))return '['+v.map(stableJSON).join(',')+']';
  if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(function(k){return JSON.stringify(k)+':'+stableJSON(v[k]);}).join(',')+'}';
  return JSON.stringify(v);
}
function cellState(t,range) {
  var state=readCells(t,range),cells=t.ranges.byName(range).cells;
  var properties=['name','fontName','fontSize','textColor','backgroundColor','alignment','verticalAlignment','textWrap'];
  state.styles={};
  properties.forEach(function(k){var values=cells[k]();state.styles[k]=values.map(function(v){return k==='textColor'||k==='backgroundColor'?color16(v):unwrap(v);});});
  return state;
}
function wholeTable(t) {
  if(t.rowCount()*t.columnCount()>2000)fail('GUARD_SCOPE_LIMIT','This operation needs a whole-table snapshot; use a table with at most 2,000 cells. No changes were made.');
  var state=cellState(t,'A1:'+colName(t.columnCount())+t.rowCount());
  state.row_heights=t.rows.height();state.column_widths=t.columns.width();return state;
}
function objectStyles(o) {
  var text=String(o.objectText());
  if(text.length>10000)fail('STYLE_LIMIT','Use an object with at most 10,000 characters for a guarded object mutation.');
  return {fonts:o.objectText.characters.font().map(unwrap),sizes:o.objectText.characters.size().map(unwrap),colors:o.objectText.characters.color().map(color16)};
}
function groupState(g,depth,budget) {
  if(depth>8)fail('GUARD_SCOPE_LIMIT','Nested group depth exceeds this guarded operation.');
  var content=objects(g).objects;
  budget.objects+=content.length;
  budget.characters+=content.reduce(function(n,o){return n+(o.text?o.text.length:0);},0);
  if(budget.objects>200||budget.characters>10000)fail('GUARD_SCOPE_LIMIT','Nested groups exceed 200 objects or 10,000 exposed text characters.');
  return {objects:content,tables:g.tables().map(function(t,i){budget.cells+=t.rowCount()*t.columnCount();if(budget.cells>2000)fail('GUARD_SCOPE_LIMIT','Nested groups exceed 2,000 table cells.');return {metadata:tableInfo(t,i+1),content:wholeTable(t)};}),text_styles:g.textItems().map(objectStyles),shape_styles:g.shapes().map(objectStyles),groups:g.groups().map(function(child){return groupState(child,depth+1,budget);})};
}
function changeState(d,action,a) {
  var state={document_id:d.id(),document_body:d.documentBody(),page_count:d.pages.length,section_count:d.sections.length};
  if(action==='settings'){state.facing_pages=d.facingPages();return state;}
  if(action==='object') {
    state.objects=objects(d).objects;
    if(state.objects.length>200)fail('GUARD_SCOPE_LIMIT','Guarded object mutations support at most 200 exposed document objects.');
    if(a.operation==='create')indexed(d.pages,a.page||1,'page');
    else {
      var object=indexed(collection(d,a.kind),a.index,'object');
      if(a.kind==='text'||a.kind==='shape')state.target_styles=objectStyles(object);
      if(a.kind==='group')state.group_contents=groupState(object,1,{objects:0,characters:0,cells:0});
      if(a.kind==='text'||a.kind==='shape'||a.kind==='image'){state.rotation=object.rotation();state.opacity=object.opacity();}
      if(a.kind!=='group'&&object.locked()&&a.locked!==false)fail('OBJECT_LOCKED','Unlock this native object explicitly before changing or deleting it.');
    }
    return state;
  }
  state.tables=d.tables().map(function(t,i){return tableInfo(t,i+1);});
  if(action==='table'&&a.operation==='create') {
    indexed(d.pages,a.page||1,'page');
    if(state.tables.some(function(t){return t.name===a.name;}))fail('NAME_EXISTS','A table has this name.');
    return state;
  }
  var t=indexed(d.tables,a.table,'table');
  if(t.locked()&&a.locked!==false)fail('OBJECT_LOCKED','Unlock this native table explicitly before changing it.');
  if(action==='table') {
    var rows=a.rows===undefined?t.rowCount():a.rows,cols=a.columns===undefined?t.columnCount():a.columns;
    if((a.header_rows===undefined?t.headerRowCount():a.header_rows)+(a.footer_rows===undefined?t.footerRowCount():a.footer_rows)>=rows||(a.header_columns===undefined?t.headerColumnCount():a.header_columns)>=cols)fail('TABLE_LAYOUT','Leave at least one body row and column.');
    if(a.name!==undefined&&state.tables.some(function(x){return x.index!==a.table&&x.name===a.name;}))fail('NAME_EXISTS','A table has this name.');
    state.content=wholeTable(t);
  } else if(action==='sort_table') {
    if(a.column>t.columnCount())fail('COLUMN_OUT_OF_BOUNDS','Sort column exceeds the table.');
    state.content=wholeTable(t);
  } else if(action==='table_dimensions') {
    var axis=a.axis==='row'?t.rows:t.columns;
    if(a.last<a.first||a.last>axis.length||a.last-a.first>=2000)fail('INDEX_OUT_OF_BOUNDS','Invalid native axis range.');
    state.dimensions=[];for(var i=a.first-1;i<a.last;i++)state.dimensions.push(a.axis==='row'?axis[i].height():axis[i].width());
  } else {
    var b=bounds(t,a.range);
    if(action==='merge_cells'&&a.operation==='merge') {
      var header=t.headerColumnCount(),hr=t.headerRowCount(),footer=t.rowCount()-t.footerRowCount();
      if((b.column<=header&&b.endColumn>header)||(b.row<=hr&&b.endRow>hr)||(b.row<=footer&&b.endRow>footer))fail('MERGE_BOUNDARY','Do not merge across native header/body/footer boundaries.');
    }
    state.content=cellState(t,a.range);
  }
  return state;
}
function searchInventory(d,a) {
  var targets=[],tables=[],cells=0,seen={};
  function add(t) {
    var key=t.kind+':'+(t.index||'');
    if(seen[key])fail('DUPLICATE_TARGET','Choose each native search target once.');
    seen[key]=true;targets.push(t);
    if(targets.length>100)fail('SEARCH_LIMIT','Search at most 100 native text targets; supply text_targets.');
  }
  if(a.text_targets) a.text_targets.forEach(function(t){
    if(t.kind==='body'){if(!d.documentBody())fail('NO_DOCUMENT_BODY','This document has no body text.');}
    else indexed(t.kind==='section'?d.sections:t.kind==='page'?d.pages:collection(d,t.kind),t.index,'text target');
    add(t);
  });
  else a.scopes.forEach(function(k){
    if(k==='table')return;
    if(k==='body'){if(d.documentBody())add({kind:'body'});return;}
    var c=k==='section'?d.sections:k==='page'?d.pages:collection(d,k);
    if(c.length+targets.length>100)fail('SEARCH_LIMIT','Search at most 100 native text targets; supply text_targets.');
    for(var i=1;i<=c.length;i++)add({kind:k,index:i});
  });
  if(a.scopes.indexOf('table')>=0) {
    if(!a.table_ranges&&d.tables.length>100)fail('SEARCH_LIMIT','Search at most 100 native tables; supply table_ranges.');
    var ranges=a.table_ranges||d.tables().map(function(t,i){return {table:i+1,range:'A1:'+colName(t.columnCount())+t.rowCount()};});
    var planned=ranges.map(function(r){var t=indexed(d.tables,r.table,'table'),b=bounds(t,r.range);cells+=(b.endColumn-b.column+1)*(b.endRow-b.row+1);return {table:r.table,name:t.name(),range:r.range};});
    if(cells>2000)fail('SEARCH_LIMIT','Search at most 2,000 cells; supply smaller table_ranges.');
    planned.forEach(function(r){tables.push({table:r.table,name:r.name,...readCells(indexed(d.tables,r.table,'table'),r.range)});});
  }
  return {targets:targets,tables:tables};
}
function execute(action,a) {
  var path=resolveApp(),app=Application(path),running=app.running();
  if(action==='status'||action==='diagnostics') {
    var r={installed:true,app_path:path,running:running,automation_tested:false,platform:'darwin',macos_version:ObjC.unwrap($.NSProcessInfo.processInfo.operatingSystemVersionString),native_api_only:true,preview_renderer:pdfCapability(),verification:'Native runtime acceptance tests must pass before release.'};
    var os=$.NSProcessInfo.processInfo.operatingSystemVersion;r.macos_version=[os.majorVersion,os.minorVersion,os.patchVersion].join('.');
    if(a.launch||running){r.pages_version=app.version();r.automation_tested=true;r.open_document_count=app.documents.length;}
    return r;
  }
  if(action==='templates') return {templates:app.templates().map(function(t){return {id:t.id(),name:t.name()};})};
  if(action==='documents') return {documents:app.documents().map(documentSummary)};
  if(action==='open') {var opened=app.open(Path(a.path));if(Array.isArray(opened))opened=opened[0];return info(opened);}
  if(action==='create') {
    if(exists(a.path))fail('DESTINATION_EXISTS','Choose a new native document destination.');
    var ts=app.templates().filter(function(t){return a.template_id?t.id()===a.template_id:/(^|\/)Blank(\/|$)/.test(t.id());});
    if(ts.length!==1)fail('TEMPLATE_REQUIRED','List native templates and supply an exact template_id.');
    var created=app.Document({documentTemplate:ts[0]});created.make();
    try {if(a.text!==undefined){if(!created.documentBody())fail('NO_DOCUMENT_BODY','This template has no document body.');created.bodyText=a.text;}app.save(created,{in:Path(a.path)});return inspect(created);}
    catch(e){fail('CREATE_INCOMPLETE','Creation did not finish. Inspect the new document before retrying.',{document_id:created.id(),native_message:e.message});}
  }
  if(action==='write_cells'&&a.values.some(function(row){return row.some(function(v){return typeof v==='boolean';});}))fail('UNSUPPORTED_NATIVE_API','Pages does not retain boolean cell values. No cells were written.');
  if(action==='format_cells'&&a.format==='checkbox')fail('UNSUPPORTED_NATIVE_API','Checkbox cell controls are Numbers-only.');
  var d=documentById(app,a.document_id);
  if(action==='search_inventory')return searchInventory(d,a);
  if(action==='change_snapshot')return changeState(d,a.action,a.request);
  if(['table','write_cells','format_cells','sort_table','merge_cells','table_dimensions','object'].indexOf(action)>=0||(action==='settings'&&a.facing_pages!==undefined)) {
    if(!a._expected_state)fail('PREVIEW_REQUIRED','Preview the native mutation before applying it.');
    if(stableJSON(changeState(d,action,a))!==stableJSON(a._expected_state))fail('REVISION_CHANGED','API-visible native state changed immediately before writing. Preview again.');
  }
  if(action==='inspect')return inspect(d);
  if(action==='save'){app.save(d);return info(d);}
  if(action==='close'){var before=info(d);app.close(d,{saving:a.save?'yes':'no'});return {closed:true,document_id:before.document_id,path:before.path};}
  if(action==='settings'){if(a.facing_pages!==undefined)d.facingPages=a.facing_pages;return {document_id:d.id(),facing_pages:d.facingPages(),document_body:d.documentBody()};}
  if(action==='export'){if(exists(a.path))fail('DESTINATION_EXISTS','Choose a new export destination.');var options={to:Path(a.path),as:{pdf:'PDF',txt:'unformatted text',rtf:'formatted text',epub:'EPUB',docx:'Microsoft Word'}[a.format]};if(a.options)options.withProperties=a.options;app.export(d,options);return {path:a.path,format:a.format,source_path:getPath(d),native_source_preserved:true};}
  if(action==='preview')return renderPreview(app,d,a);
  if(action==='placeholders')return placeholders(d);
  if(action==='objects')return objects(d);
  if(action==='object') {
    var o;
    if(a.operation==='create') {
      if(['text','shape','image'].indexOf(a.kind)<0)fail('UNSUPPORTED','Create text items, shapes or images; existing charts support geometry only.');
      var page=indexed(d.pages,a.page||1,'page');
      var properties=a.kind==='image'?{file:Path(a.source_path)}:{objectText:a.text||''};
      o=app[{text:'TextItem',shape:'Shape',image:'Image'}[a.kind]](properties);collection(page,a.kind).push(o);
    } else {
      o=indexed(collection(d,a.kind),a.index,'object');
      if(a.operation==='delete'){if(a.locked===false)o.locked=false;app.delete(o);return objects(d);}
      if(a.text!==undefined){if(a.kind!=='text'&&a.kind!=='shape')fail('UNSUPPORTED','This object has no editable native text.');o.objectText=a.text;}
    }
    geometry(o,Object.assign({},a,{locked:a.locked===true?undefined:a.locked}));
    if(a.kind==='image'&&a.description!==undefined)o.description=a.description;
    if(a.kind==='text'||a.kind==='shape'){if(a.font_name!==undefined)o.objectText.font=a.font_name;if(a.font_size!==undefined)o.objectText.size=a.font_size;if(a.color!==undefined)o.objectText.color=a.color;}
    if(a.locked===true)o.locked=true;
    return objects(d);
  }
  if(action==='table') {
    var t;
    if(a.operation==='create'){if(d.tables().some(function(t){return t.name()===a.name;}))fail('NAME_EXISTS','A table has this name.');var p=indexed(d.pages,a.page||1,'page');t=app.Table({name:a.name,rowCount:a.rows||6,columnCount:a.columns||3});p.tables.push(t);}
    else {t=indexed(d.tables,a.table,'table');if(a.operation==='delete'){if(a.locked===false)t.locked=false;app.delete(t);return inspect(d);}if(a.name!==undefined){if(d.tables().some(function(x){return x.name()===a.name&&x.name()!==t.name();}))fail('NAME_EXISTS','A table has this name.');t.name=a.name;}}
    if(a.locked===false)t.locked=false;
    var map={rows:'rowCount',columns:'columnCount',header_rows:'headerRowCount',header_columns:'headerColumnCount',footer_rows:'footerRowCount'};
    Object.keys(map).forEach(function(k){if(a[k]!==undefined)t[map[k]]=a[k];});geometry(t,a);return inspect(d);
  }
  var t=indexed(d.tables,a.table,'table');
  if(action==='read_cells')return readCells(t,a.range);
  if(action==='write_cells') {
    var b=bounds(t,a.range),n=0,expectations=[];
    if(!a._formats||a._formats.length!==a.values.flat().length)fail('FORMAT_PREFLIGHT_REQUIRED','Native format readback is required.');
    try{for(var y=0;y<a.values.length;y++)for(var x=0;x<a.values[y].length;x++){expectations.push(assignValue(t.cells.byName(colName(b.column+x)+(b.row+y)),a.values[y][x],a._formats[n],a.preserve_format));n++;}}
    catch(e){fail('PARTIAL_WRITE','Some cells may have changed. Read before retrying.',{completed_cells:n,native_message:e.message});}
    var out=readCells(t,a.range);out.written=n;out.format_expectations=expectations;return out;
  }
  if(action==='format_cells') {
    bounds(t,a.range);var r=t.ranges.byName(a.range),map={format:'format',font_name:'fontName',font_size:'fontSize',text_color:'textColor',background_color:'backgroundColor',alignment:'alignment',vertical_alignment:'verticalAlignment',text_wrap:'textWrap'};
    Object.keys(map).forEach(function(k){if(a[k]!==undefined)r[map[k]]=a[k];});return cellState(t,a.range);
  }
  if(action==='sort_table'){if(a.column>t.columnCount())fail('COLUMN_OUT_OF_BOUNDS','Sort column exceeds the table.');app.sort(t,{by:t.columns[a.column-1],direction:a.direction});return tableInfo(t,a.table);}
  if(action==='merge_cells'){bounds(t,a.range);app[a.operation](t.ranges.byName(a.range));return {operation:a.operation,range:a.range};}
  if(action==='table_dimensions'){
    var xs=a.axis==='row'?t.rows:t.columns;
    if(a.last<a.first||a.last>xs.length||a.last-a.first>=2000)fail('INDEX_OUT_OF_BOUNDS','Invalid native axis range.');
    for(var i=a.first-1;i<a.last;i++)xs[i][a.axis==='row'?'height':'width']=a.size;
    return {table:tableInfo(t,a.table),axis:a.axis,first:a.first,last:a.last,sizes:Array.prototype.slice.call(xs[a.axis==='row'?'height':'width'](),a.first-1,a.last)};
  }
  fail('UNKNOWN_ACTION','Unknown Pages Native action.');
}
function run() {
  try{var input=$.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;var request=JSON.parse(ObjC.unwrap($.NSString.alloc.initWithDataEncoding(input,$.NSUTF8StringEncoding)));return JSON.stringify({ok:true,result:execute(request.action,request.args||{})});}
  catch(e){var code=e.nativeCode||'NATIVE_ERROR',message=e.message||String(e),details=e.details||{};if(e.errorNumber===-1743||message.indexOf('-1743')>=0){code='AUTOMATION_DENIED';message='Allow the host to control Pages in System Settings > Privacy & Security > Automation.';}if(e.errorNumber===-1712){code='APPLE_EVENT_TIMEOUT';message='Pages timed out. Inspect it before retrying.';}if(e.errorNumber!==undefined)details.apple_event_number=e.errorNumber;return JSON.stringify({ok:false,error:{code:code,message:message,details:details}});}
}

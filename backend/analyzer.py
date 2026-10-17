from __future__ import annotations
import ast, fnmatch, hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
DEFAULT_EXCLUDED={".git",".venv","venv","env","__pycache__","node_modules","dist","build",".mypy_cache",".pytest_cache",".tox",".eggs",".idea",".vscode"}
def stable_id(prefix,value): return f"{prefix}:{hashlib.sha1(value.encode()).hexdigest()[:20]}"
@dataclass
class FileRecord:
 id:str; path:str; module:str; loc:int; source:str; symbols:list[str]=field(default_factory=list)
@dataclass
class SymbolRecord:
 id:str; kind:str; name:str; qualname:str; file_id:str; path:str; line:int; end_line:int; signature:str; docstring:str; decorators:list[str]; parent:str|None=None
class ProjectAnalyzer:
 def __init__(self,root,exclusions=None,max_files=2000,max_bytes=2000000):
  self.root=Path(root).expanduser().resolve(); self.exclusions=DEFAULT_EXCLUDED|set(exclusions or []); self.max_files=max_files; self.max_bytes=max_bytes
  self.files={}; self.symbols={}; self.module_to_file={}; self.module_symbols={}; self.imports={}; self.trees={}; self.warnings=[]; self.edges=[]; self._edge_keys=set()
 def _ignored(self,path):
  rel=path.relative_to(self.root).as_posix(); return any(p in self.exclusions for p in Path(rel).parts) or any(fnmatch.fnmatch(rel,p) for p in self.exclusions)
 def _module_name(self,path):
  parts=list(path.relative_to(self.root).with_suffix("").parts)
  if parts and parts[-1]=="__init__": parts.pop()
  return ".".join(parts)
 def _edge(self,source,target,relation,line,status="resolved",confidence=1.0,explanation="",evidence="",caller=None,callee=None):
  key=(source,target,relation,line,evidence)
  if key in self._edge_keys:return
  self._edge_keys.add(key); self.edges.append({"id":stable_id("edge","|".join(map(str,key))),"source":source,"target":target,"type":relation,"line":line,"status":status,"confidence":round(confidence,2),"explanation":explanation,"evidence":evidence,"caller":caller,"callee":callee})
 def _read_gitignore(self):
  try:return [x.strip().lstrip("/") for x in (self.root/".gitignore").read_text(encoding="utf-8").splitlines() if x.strip() and not x.lstrip().startswith("#")]
  except OSError:return []
 def _signature(self,node):
  try:return ast.unparse(node.args)
  except Exception:return ""
 def _decorators(self,node):
  out=[]
  for item in getattr(node,"decorator_list",[]):
   try:out.append(ast.unparse(item))
   except Exception:out.append(type(item).__name__)
  return out
 def _snippet(self,file,line,end_line):
  lines=file.source.splitlines(); return "\n".join(f"{n:>4} | {lines[n-1]}" for n in range(max(1,line),min(len(lines),end_line)+1))
 def _parse_files(self,progress):
  patterns=self._read_gitignore(); candidates=[]
  for path in self.root.rglob("*.py"):
   try:
    rel=path.relative_to(self.root).as_posix()
    if path.is_symlink() or self._ignored(path) or any(fnmatch.fnmatch(rel,p) for p in patterns):continue
    candidates.append(path)
   except (OSError,ValueError):continue
  candidates.sort()
  if len(candidates)>self.max_files:self.warnings.append({"code":"FILE_LIMIT","message":f"Only the first {self.max_files} Python files were analyzed."}); candidates=candidates[:self.max_files]
  for i,path in enumerate(candidates):
   rel=path.relative_to(self.root).as_posix()
   if progress:progress(i,len(candidates),f"Parsing {rel}")
   try:
    if path.stat().st_size>self.max_bytes:self.warnings.append({"code":"FILE_TOO_LARGE","message":f"Skipped {rel} because it exceeds {self.max_bytes} bytes."});continue
    source=path.read_text(encoding="utf-8"); tree=ast.parse(source,filename=rel)
   except SyntaxError as e:self.warnings.append({"code":"SYNTAX_ERROR","message":f"{rel}:{e.lineno}: {e.msg}"});continue
   except (OSError,UnicodeDecodeError) as e:self.warnings.append({"code":"READ_ERROR","message":f"{rel}: {e}"});continue
   module=self._module_name(path); fid=stable_id("file",rel); self.files[fid]=FileRecord(fid,rel,module,len(source.splitlines()),source); self.module_to_file[module]=fid; self.module_symbols[module]={}; self.imports[fid]={}; self.trees[fid]=tree; self._collect_symbols(self.files[fid],tree)
 def _collect_symbols(self,file,tree):
  def visit(body,parent,prefix):
   for node in body:
    if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef)):
     qual=f"{prefix}.{node.name}" if prefix else node.name; sid=stable_id("symbol",f"{file.path}:{qual}:{node.lineno}"); kind="async_function" if isinstance(node,ast.AsyncFunctionDef) else ("method" if parent and parent.kind=="class" else "function")
     s=SymbolRecord(sid,kind,node.name,qual,file.id,file.path,node.lineno,getattr(node,"end_lineno",node.lineno),self._signature(node),ast.get_docstring(node) or "",self._decorators(node),parent.id if parent else None); self.symbols[sid]=s; file.symbols.append(sid); self.module_symbols[file.module][node.name]=sid; self._edge(file.id,sid,"CONTAINS",node.lineno,evidence=f"def {node.name}"); visit(node.body,s,qual)
    elif isinstance(node,ast.ClassDef):
     qual=f"{prefix}.{node.name}" if prefix else node.name; sid=stable_id("symbol",f"{file.path}:{qual}:{node.lineno}"); s=SymbolRecord(sid,"class",node.name,qual,file.id,file.path,node.lineno,getattr(node,"end_lineno",node.lineno),"",ast.get_docstring(node) or "",self._decorators(node),parent.id if parent else None); self.symbols[sid]=s; file.symbols.append(sid); self.module_symbols[file.module][node.name]=sid; self._edge(file.id,sid,"CONTAINS",node.lineno,evidence=f"class {node.name}")
     for base in node.bases:self._record_inheritance(s,base)
     visit(node.body,s,qual)
    elif isinstance(node,ast.If):visit(node.body,parent,prefix);visit(node.orelse,parent,prefix)
  visit(tree.body,None,file.module)
 def _record_inheritance(self,symbol,base):
  try:text=ast.unparse(base)
  except Exception:return
  target=self._resolve_name(symbol.file_id,text); self._edge(symbol.id,target or f"external:class:{text}","INHERITS",symbol.line,"resolved" if target else "inferred",1 if target else .65,"" if target else "Base class could not be resolved to a project symbol.",text,callee=text)
 def _resolve_name(self,file_id,name):
  file=self.files[file_id]; root=name.split(".")[0]; imported=self.imports.get(file_id,{}).get(root)
  if imported:
   module,symbol=imported.split(":",1) if ":" in imported else (imported,""); module=module.lstrip("."); return self.module_symbols.get(module,{}).get(symbol) or self.module_to_file.get(module)
  if root in self.module_symbols.get(file.module,{}):return self.module_symbols[file.module][root]
  for symbol in self.symbols.values():
   if symbol.file_id==file_id and symbol.name==root:return symbol.id
  return None
 def _collect_imports(self):
  for fid,tree in self.trees.items():
   file=self.files[fid]
   for node in ast.walk(tree):
    if isinstance(node,ast.Import):
     for alias in node.names:
      local=alias.asname or alias.name.split(".")[0]; self.imports[fid][local]=alias.name; target=self.module_to_file.get(alias.name); self._edge(fid,target or f"external:module:{alias.name}","IMPORTS",node.lineno,"resolved" if target else "inferred",1 if target else .95,"" if target else "Import points outside the analyzed project.",ast.unparse(node))
    elif isinstance(node,ast.ImportFrom):
     base=node.module or ""
     if node.level:
      current=file.module.split(".")[:-node.level]; base=".".join(current+([node.module] if node.module else []))
     for alias in node.names:
      if alias.name=="*":continue
      local=alias.asname or alias.name; self.imports[fid][local]=f"{base}:{alias.name}"; target=self.module_symbols.get(base,{}).get(alias.name) or self.module_to_file.get(base); self._edge(fid,target or f"external:module:{base}","IMPORTS",node.lineno,"resolved" if target else "inferred",1 if target else .9,"" if target else "Import was not found in the project.",ast.unparse(node))
 def _enclosing_symbol(self,fid,line):
  m=[s for s in self.symbols.values() if s.file_id==fid and s.line<=line<=s.end_line]; return max(m,key=lambda s:s.line).id if m else None
 def _collect_behavior(self):
  http={"requests","httpx","aiohttp"}; routes={"get","post","put","patch","delete","options","head","route"}
  for fid,tree in self.trees.items():
   file=self.files[fid]
   for node in ast.walk(tree):
    if not isinstance(node,ast.Call):continue
    try:expr,evidence=ast.unparse(node.func),ast.unparse(node)
    except Exception:continue
    if expr.split(".")[0] in http:self._edge(fid,f"external:http:{expr}","HTTP_REQUEST",node.lineno,"inferred",.88,"Recognized requests/httpx/aiohttp client call.",evidence,file.path,expr);continue
    if expr.split(".")[-1] in routes and node.args:
     try:route=ast.literal_eval(node.args[0])
     except Exception:route=None
     if isinstance(route,str):self._edge(fid,f"external:route:{route}","DEFINES_ROUTE",node.lineno,"inferred",.86,"Framework-style route registration or decorator.",evidence,file.path,route)
    target=self._resolve_name(fid,expr)
    if target:
     caller=self._enclosing_symbol(fid,node.lineno) or fid; self._edge(caller,target,"CALLS",node.lineno,evidence=evidence,caller=caller,callee=self.symbols[target].qualname)
    elif "." not in expr and expr not in {"print","len","str","int","dict","list","set","super","isinstance"}:
     caller=self._enclosing_symbol(fid,node.lineno) or fid; self._edge(caller,f"unresolved:{expr}","CALLS",node.lineno,"unresolved",.2,"Dynamic dispatch or local scope could not be resolved statically.",evidence,caller,expr)
 def _aggregate(self,edges):
  result={}
  for e in edges:
   source=self.symbols[e["source"]].file_id if e["source"] in self.symbols else e["source"]; target=self.symbols[e["target"]].file_id if e["target"] in self.symbols else e["target"]
   if source==target or source not in self.files:continue
   key=(source,target,e["type"]); item=result.setdefault(key,{"id":stable_id("file-edge","|".join(key)),"source":source,"target":target,"type":e["type"],"count":0,"status":e["status"],"confidence":e["confidence"],"evidence":[]}); item["count"]+=1; item["confidence"]=min(item["confidence"],e["confidence"])
   if len(item["evidence"])<20:item["evidence"].append({"line":e["line"],"evidence":e["evidence"],"relationship_id":e["id"]})
  return list(result.values())
 def scan(self,progress=None):
  if not self.root.exists() or not self.root.is_dir():raise ValueError("Directory does not exist or is not a directory")
  self._parse_files(progress); self._collect_imports(); self._collect_behavior()
  nodes=[{"id":f.id,"kind":"file","label":f.path,"path":f.path,"module":f.module,"loc":f.loc,"symbol_count":len(f.symbols)} for f in self.files.values()]
  nodes += [{"id":s.id,"kind":s.kind,"label":s.name,"qualname":s.qualname,"path":s.path,"file_id":s.file_id,"line":s.line,"end_line":s.end_line,"signature":s.signature,"docstring":s.docstring,"decorators":s.decorators,"parent":s.parent,"snippet":self._snippet(self.files[s.file_id],s.line,s.end_line)} for s in self.symbols.values()]
  external={e["target"] for e in self.edges if str(e["target"]).startswith(("external:","unresolved:"))}
  for entity in sorted(external):
   parts=entity.split(":",2); kind=parts[1] if len(parts)>1 else "unknown"; label=parts[2] if len(parts)>2 else parts[-1]; nodes.append({"id":entity,"kind":"external","external_type":kind,"label":label})
  behavioral=[e for e in self.edges if e["type"]!="CONTAINS"]; file_edges=self._aggregate(behavioral)
  return {"schema_version":"1.1","root":str(self.root),"project":{"is_python":bool(self.files),"metadata":[n for n in ("pyproject.toml","setup.py","requirements.txt") if (self.root/n).exists()]},"nodes":nodes,"edges":behavioral,"file_edges":file_edges,"warnings":self.warnings,"stats":{"files":len(self.files),"symbols":len(self.symbols),"edges":len(behavioral),"file_edges":len(file_edges)},"limitations":["Static AST analysis cannot fully recover dynamic dispatch, reflection, monkey-patching, generated code, or runtime decorator behavior.","HTTP requests remain separate from local CALLS and are not mapped to local handlers without explicit static evidence."]}
def analyze_directory(path,exclusions=None,progress=None):return ProjectAnalyzer(path,exclusions).scan(progress)



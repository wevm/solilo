use serde::Deserialize;
use serde_json::{Value, json};
use solar_interface::{
    ColorChoice, Session, SourceMap,
    config::CompileOpts,
    diagnostics::{DiagCtxt, JsonEmitter},
    source_map::FileLoader,
};
use solar_sema::Compiler;
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{self, Write},
    ops::ControlFlow,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

mod rust;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    entry: String,
    sources: BTreeMap<String, String>,
    root: String,
    #[serde(default)]
    remappings: Vec<String>,
    #[serde(default)]
    include_paths: Vec<String>,
}

fn normalize(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::ParentDir => {
                result.pop();
            }
            Component::CurDir => {}
            _ => result.push(part),
        }
    }
    result
}

struct Loader {
    sources: BTreeMap<PathBuf, String>,
    requested: Arc<Mutex<BTreeSet<String>>>,
}
impl FileLoader for Loader {
    fn canonicalize_path(&self, path: &Path) -> io::Result<PathBuf> {
        let path = normalize(path);
        self.requested
            .lock()
            .unwrap()
            .insert(path.to_string_lossy().into_owned());
        if self.sources.contains_key(&path) || self.sources.keys().any(|p| p.starts_with(&path)) {
            Ok(path)
        } else {
            Err(io::ErrorKind::NotFound.into())
        }
    }
    fn load_file(&self, path: &Path) -> io::Result<String> {
        let path = normalize(path);
        self.requested
            .lock()
            .unwrap()
            .insert(path.to_string_lossy().into_owned());
        self.sources
            .get(&path)
            .cloned()
            .ok_or_else(|| io::ErrorKind::NotFound.into())
    }
    fn load_stdin(&self) -> io::Result<String> {
        Err(io::ErrorKind::Unsupported.into())
    }
    fn load_binary_file(&self, _: &Path) -> io::Result<Vec<u8>> {
        Err(io::ErrorKind::Unsupported.into())
    }
}

#[derive(Clone)]
struct Buffer(Arc<Mutex<Vec<u8>>>);
impl Write for Buffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn analyze(request: Request) -> Value {
    if !request.entry.ends_with(".rs") {
        return analyze_solidity(request);
    }
    let Some(source) = request.sources.get(&request.entry) else {
        return json!({"error": "Missing entry source"});
    };
    let blocks = match rust::interfaces(source) {
        Ok(blocks) => blocks,
        Err((range, message)) => {
            return json!({"contracts": [], "requested": [], "diagnostics": [{"severity": "error", "message": message, "sourceLocation": {"file": request.entry, "start": range.start, "end": range.end}}]});
        }
    };
    let mut contracts = Vec::new();
    let mut diagnostics = Vec::new();
    let mut names = BTreeSet::new();
    for block in blocks {
        let mut input = request.clone();
        input.sources.insert(input.entry.clone(), block);
        let output = analyze_solidity(input);
        for contract in output["contracts"].as_array().unwrap() {
            if !names.insert(contract["name"].as_str().unwrap().to_string()) {
                diagnostics.push(json!({"severity": "error", "message": "Duplicate interface export across sol! blocks"}));
            }
            contracts.push(contract.clone());
        }
        diagnostics.extend(output["diagnostics"].as_array().unwrap().iter().cloned());
    }
    if diagnostics.iter().any(|d| d["severity"] == "error") {
        contracts.clear();
    }
    json!({"contracts": contracts, "diagnostics": diagnostics, "requested": []})
}

fn analyze_solidity(request: Request) -> Value {
    let requested = Arc::new(Mutex::new(BTreeSet::new()));
    let sm = Arc::new(SourceMap::empty());
    sm.set_file_loader(Loader {
        sources: request
            .sources
            .into_iter()
            .map(|(k, v)| (PathBuf::from(k), v))
            .collect(),
        requested: requested.clone(),
    });
    let buffer = Buffer(Arc::new(Mutex::new(Vec::new())));
    let dcx = DiagCtxt::new(Box::new(JsonEmitter::new(
        Box::new(buffer.clone()),
        sm.clone(),
        ColorChoice::Never,
    )));
    let mut opts = CompileOpts {
        base_path: Some(request.root.into()),
        include_paths: request.include_paths.into_iter().map(Into::into).collect(),
        ..Default::default()
    };
    for mapping in request.remappings {
        match mapping.parse() {
            Ok(m) => opts.import_remappings.push(m),
            Err(e) => {
                return json!({"contracts": [], "diagnostics": [{"severity":"error", "message": format!("Invalid remapping: {e}")}], "requested": []});
            }
        }
    }
    let sess = Session::builder()
        .source_map(sm.clone())
        .dcx(dcx)
        .opts(opts)
        .single_threaded()
        .build();
    let mut compiler = Compiler::new(sess);
    let mut contracts = Vec::new();
    let _ = compiler.enter_mut(|c| -> solar_interface::Result<()> {
        let mut parser = c.parse();
        parser.load_file(Path::new(&request.entry))?;
        parser.parse();
        if let ControlFlow::Break(()) = c.lower_asts()? { return Ok(()); }
        if let ControlFlow::Break(()) = c.analysis()? { return Ok(()); }
        let gcx = c.gcx();
        for id in gcx.hir.contract_ids() {
            let contract = gcx.hir.contract(id);
            let loc = sm.span_to_source(contract.name.span).unwrap();
            if loc.file.name != Path::new(&request.entry) { continue; }
            let mut members = Vec::new();
            for item_id in contract.items {
                if !matches!(item_id, solar_sema::hir::ItemId::Function(_) | solar_sema::hir::ItemId::Event(_) | solar_sema::hir::ItemId::Error(_)) { continue; }
                let item = gcx.hir.item(*item_id);
                if let Some(name) = item.name() && gcx.has_abi_signature(*item_id) {
                    let span = sm.span_to_source(name.span).unwrap();
                    members.push(json!({"name": name.to_string(), "signature": gcx.item_signature(*item_id), "start": span.start, "end": span.end}));
                }
            }
            contracts.push(json!({"name": contract.name.to_string(), "start": loc.start, "end": loc.end, "abi": gcx.contract_abi(id), "members": members}));
        }
        Ok(())
    });
    let mut diagnostics: Vec<Value> = String::from_utf8(buffer.0.lock().unwrap().clone())
        .unwrap()
        .lines()
        .filter_map(|s| serde_json::from_str(s).ok())
        .collect();
    for diagnostic in &mut diagnostics {
        if matches!(diagnostic["errorCode"].as_str(), Some("5333" | "9511")) {
            diagnostic["severity"] = json!("error");
        }
    }
    if diagnostics.iter().any(|d| d["severity"] == "error") {
        contracts.clear();
    }
    json!({"contracts": contracts, "diagnostics": diagnostics, "requested": *requested.lock().unwrap()})
}

// Length-delimited UTF-8 JSON; allocation ownership always stays with the caller.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0u8; len].into_boxed_slice()).cast()
}

/// # Safety
/// `ptr` and `len` must describe an allocation returned by this module, not yet freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
    }
}

/// # Safety
/// Input must point to `len` readable bytes. Output packs length (high 32 bits) and pointer.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn analyze_json(ptr: *const u8, len: usize) -> u64 {
    let input = unsafe { std::slice::from_raw_parts(ptr, len) };
    let result = match serde_json::from_slice(input) {
        Ok(r) => analyze(r),
        Err(e) => json!({"error": e.to_string()}),
    };
    let bytes = serde_json::to_vec(&result).unwrap().into_boxed_slice();
    let len = bytes.len();
    let ptr = Box::into_raw(bytes).cast::<u8>() as usize;
    ((len as u64) << 32) | ptr as u64
}

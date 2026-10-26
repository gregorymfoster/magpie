// The Rust half of the Tauri host: files and SQLite for the core, which runs
// in a Web Worker and reaches here through ui/src/transport/tauri.ts. Each
// function matches one method of the Host interface in core/src/host.ts and
// must behave the way core/test/host-contract.ts says the Node host does.
// Plain functions, so they're tested here without a window.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rusqlite::{
    types::{Value, ValueRef},
    Connection, OpenFlags,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as Json};
use std::{
    collections::HashMap,
    fs, io,
    io::Write,
    path::Path,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
};

pub type Result<T> = std::result::Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn parent(path: &Path) -> io::Result<()> {
    match path.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => fs::create_dir_all(dir),
        _ => Ok(()),
    }
}

static TEMP: AtomicU32 = AtomicU32::new(0);

pub fn read(path: &str) -> Result<Vec<u8>> {
    fs::read(path).map_err(err)
}

/// Atomic: a reader sees the old file or the new one, never half of one.
pub fn write(path: &str, data: &[u8]) -> Result<()> {
    let p = Path::new(path);
    parent(p).map_err(err)?;
    let name = p.file_name().ok_or("no file name")?.to_string_lossy();
    let tmp = p.with_file_name(format!(".{name}.{}-{}.tmp", std::process::id(), TEMP.fetch_add(1, Ordering::Relaxed)));
    let mut f = fs::File::create(&tmp).map_err(err)?;
    f.write_all(data).and_then(|_| f.sync_all()).map_err(err)?;
    fs::rename(&tmp, p).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        err(e)
    })
}

/// On APFS this is a clone, so a 1 GB library copies in no time and no space.
pub fn copy(from: &str, to: &str) -> Result<()> {
    parent(Path::new(to)).map_err(err)?;
    fs::copy(from, to).map(|_| ()).map_err(err)
}

pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Entry {
    pub name: String,
    pub dir: bool,
}

pub fn list(dir: &str) -> Result<Vec<Entry>> {
    let Ok(rd) = fs::read_dir(dir) else { return Ok(vec![]) };
    let mut out = vec![];
    for e in rd.flatten() {
        out.push(Entry { name: e.file_name().to_string_lossy().into_owned(), dir: e.path().is_dir() });
    }
    Ok(out)
}

pub fn mkdir(path: &str) -> Result<()> {
    fs::create_dir_all(path).map_err(err)
}

pub fn remove(path: &str) -> Result<()> {
    let r = match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path),
        Err(e) => Err(e),
    };
    match r {
        Err(e) if e.kind() != io::ErrorKind::NotFound => Err(err(e)),
        _ => Ok(()),
    }
}

pub fn rename(from: &str, to: &str) -> Result<()> {
    parent(Path::new(to)).map_err(err)?;
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // Across disks rename can't work: copy, then remove.
    copy(from, to)?;
    remove(from)
}

pub fn free(path: &str) -> Option<f64> {
    let mut p = Path::new(path);
    while !p.exists() {
        p = p.parent()?;
    }
    let c = std::ffi::CString::new(p.as_os_str().as_encoded_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut s) } != 0 {
        return None;
    }
    #[allow(clippy::unnecessary_cast)]
    Some(s.f_bavail as f64 * s.f_frsize as f64)
}

/// The fs_write path header is percent-encoded so any file name survives HTTP headers.
pub fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Some(v) = std::str::from_utf8(&b[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok()) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// SQLite. Handles are numbers so they can cross to the worker and back.

#[derive(Default)]
pub struct Dbs {
    next: AtomicU32,
    open: Mutex<HashMap<u32, Arc<Mutex<Connection>>>>,
}

#[derive(Deserialize)]
pub struct Statement {
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Json>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct RunResult {
    pub changes: u64,
    #[serde(rename = "lastId")]
    pub last_id: i64,
}

/// Blobs arrive as {"$b64": "..."}; everything else is a JSON scalar.
fn to_sql(j: &Json) -> Result<Value> {
    Ok(match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(*b as i64),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().unwrap_or(0.0)),
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Object(o) => match o.get("$b64").and_then(Json::as_str) {
            Some(s) => Value::Blob(B64.decode(s).map_err(err)?),
            None => return Err("unsupported parameter".into()),
        },
        Json::Array(_) => return Err("unsupported parameter".into()),
    })
}

fn to_json(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::from(i),
        ValueRef::Real(f) => Json::from(f),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => {
            let mut o = Map::new();
            o.insert("$b64".into(), Json::String(B64.encode(b)));
            Json::Object(o)
        }
    }
}

fn params(p: &[Json]) -> Result<Vec<Value>> {
    p.iter().map(to_sql).collect()
}

/// Runs a statement to the end, rows or not, and reports what it changed.
fn run_on(conn: &Connection, sql: &str, p: &[Json]) -> Result<RunResult> {
    let mut stmt = conn.prepare(sql).map_err(err)?;
    let mut rows = stmt.query(rusqlite::params_from_iter(params(p)?)).map_err(err)?;
    while rows.next().map_err(err)?.is_some() {}
    Ok(RunResult { changes: conn.changes(), last_id: conn.last_insert_rowid() })
}

impl Dbs {
    fn get(&self, h: u32) -> Result<Arc<Mutex<Connection>>> {
        self.open.lock().map_err(err)?.get(&h).cloned().ok_or_else(|| "database is closed".to_string())
    }

    pub fn open(&self, path: &str, readonly: bool) -> Result<u32> {
        let conn = if readonly {
            Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        } else {
            parent(Path::new(path)).map_err(err)?;
            Connection::open(path)
        }
        .map_err(err)?;
        // The app and `magpie mcp` can have the same Library open; wait for each other's writes.
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(err)?;
        let h = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        self.open.lock().map_err(err)?.insert(h, Arc::new(Mutex::new(conn)));
        Ok(h)
    }

    pub fn all(&self, h: u32, sql: &str, p: &[Json]) -> Result<Vec<Map<String, Json>>> {
        let c = self.get(h)?;
        let conn = c.lock().map_err(err)?;
        let mut stmt = conn.prepare(sql).map_err(err)?;
        let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let mut rows = stmt.query(rusqlite::params_from_iter(params(p)?)).map_err(err)?;
        let mut out = vec![];
        while let Some(r) = rows.next().map_err(err)? {
            let mut o = Map::new();
            for (i, n) in names.iter().enumerate() {
                o.insert(n.clone(), to_json(r.get_ref(i).map_err(err)?));
            }
            out.push(o);
        }
        Ok(out)
    }

    pub fn run(&self, h: u32, sql: &str, p: &[Json]) -> Result<RunResult> {
        let c = self.get(h)?;
        let conn = c.lock().map_err(err)?;
        run_on(&conn, sql, p)
    }

    /// All of them, or none.
    pub fn batch(&self, h: u32, statements: &[Statement]) -> Result<()> {
        let c = self.get(h)?;
        let mut conn = c.lock().map_err(err)?;
        let tx = conn.transaction().map_err(err)?;
        for s in statements {
            run_on(&tx, &s.sql, &s.params)?;
        }
        tx.commit().map_err(err)
    }

    pub fn exec(&self, h: u32, sql: &str) -> Result<()> {
        let c = self.get(h)?;
        let conn = c.lock().map_err(err)?;
        conn.execute_batch(sql).map_err(err)
    }

    pub fn close(&self, h: u32) -> Result<()> {
        self.open.lock().map_err(err)?.remove(&h);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn write_is_atomic_and_makes_folders() {
        let d = tmp();
        let p = d.path().join("a/b/c.txt");
        let p = p.to_str().unwrap();
        write(p, b"one").unwrap();
        write(p, b"two").unwrap();
        assert_eq!(read(p).unwrap(), b"two");
        let names: Vec<_> = list(d.path().join("a/b").to_str().unwrap()).unwrap().into_iter().map(|e| e.name).collect();
        assert_eq!(names, vec!["c.txt"], "no temp files left behind");
    }

    #[test]
    fn list_remove_move_and_free() {
        let d = tmp();
        let root = d.path().to_str().unwrap();
        assert_eq!(list(&format!("{root}/missing")).unwrap(), vec![]);
        write(&format!("{root}/x/one.epub"), b"1").unwrap();
        rename(&format!("{root}/x/one.epub"), &format!("{root}/y/z/one.epub")).unwrap();
        assert!(!exists(&format!("{root}/x/one.epub")));
        assert!(exists(&format!("{root}/y/z/one.epub")));
        copy(&format!("{root}/y/z/one.epub"), &format!("{root}/w/two.epub")).unwrap();
        assert_eq!(read(&format!("{root}/w/two.epub")).unwrap(), b"1");
        remove(&format!("{root}/y")).unwrap();
        remove(&format!("{root}/y")).unwrap();
        assert!(!exists(&format!("{root}/y")));
        assert!(free(&format!("{root}/not/yet")).unwrap() > 0.0);
    }

    #[test]
    fn sqlite_round_trips_and_batches_roll_back() {
        let d = tmp();
        let dbs = Dbs::default();
        let h = dbs.open(d.path().join("t.db").to_str().unwrap(), false).unwrap();
        dbs.exec(h, "CREATE TABLE t (id INTEGER PRIMARY KEY, s TEXT, n REAL, b BLOB)").unwrap();
        let r = dbs.run(h, "INSERT INTO t (s, n, b) VALUES (?, ?, ?)", &[json!("é"), json!(1.5), json!({"$b64": "AAEC"})]).unwrap();
        assert_eq!(r, RunResult { changes: 1, last_id: 1 });
        let rows = dbs.all(h, "SELECT * FROM t", &[]).unwrap();
        assert_eq!(Json::Object(rows[0].clone()), json!({"id": 1, "s": "é", "n": 1.5, "b": {"$b64": "AAEC"}}));
        let bad = dbs.batch(
            h,
            &[
                Statement { sql: "INSERT INTO t (s) VALUES (?)".into(), params: vec![json!("kept?")] },
                Statement { sql: "INSERT INTO nope VALUES (1)".into(), params: vec![] },
            ],
        );
        assert!(bad.is_err());
        assert_eq!(dbs.all(h, "SELECT count(*) AS n FROM t", &[]).unwrap()[0]["n"], json!(1));
        dbs.close(h).unwrap();
        assert!(dbs.all(h, "SELECT 1", &[]).is_err());
    }

    #[test]
    fn decodes_paths() {
        assert_eq!(percent_decode("%2FUsers%2Fme%2FJane%20Austen%2F%C3%89mma.epub"), "/Users/me/Jane Austen/Émma.epub");
        assert_eq!(percent_decode("100%"), "100%");
    }
}

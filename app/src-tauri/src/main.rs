// The Mac app's shell: a window, the menu bar, and the host commands the
// core calls through ui/src/transport/tauri.ts. Everything Magpie actually
// does lives in core/; keep this file about the Mac.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod host;
mod menu;

use host::{Dbs, Entry, RunResult, Statement};
use serde::Serialize;
use serde_json::{Map, Value as Json};
use std::{io::Write, process::Command};
use tauri::{ipc, State};

type Result<T> = std::result::Result<T, String>;

#[tauri::command]
async fn fs_read(path: String) -> Result<ipc::Response> {
    host::read(&path).map(ipc::Response::new)
}

/// The bytes come as the raw request body, so a 20 MB book isn't turned into JSON.
#[tauri::command]
async fn fs_write(request: ipc::Request<'_>) -> Result<()> {
    let ipc::InvokeBody::Raw(data) = request.body() else { return Err("expected raw bytes".into()) };
    let path = request.headers().get("path").ok_or("missing path")?.to_str().map_err(|e| e.to_string())?;
    host::write(&host::percent_decode(path), data)
}

#[tauri::command]
async fn fs_copy(from: String, to: String) -> Result<()> {
    host::copy(&from, &to)
}

#[tauri::command]
async fn fs_exists(path: String) -> bool {
    host::exists(&path)
}

#[tauri::command]
async fn fs_list(dir: String) -> Result<Vec<Entry>> {
    host::list(&dir)
}

#[tauri::command]
async fn fs_mkdir(path: String) -> Result<()> {
    host::mkdir(&path)
}

#[tauri::command]
async fn fs_remove(path: String) -> Result<()> {
    host::remove(&path)
}

#[tauri::command]
async fn fs_move(from: String, to: String) -> Result<()> {
    host::rename(&from, &to)
}

#[tauri::command]
async fn fs_free(path: String) -> Option<f64> {
    host::free(&path)
}

#[tauri::command]
async fn db_open(path: String, readonly: bool, dbs: State<'_, Dbs>) -> Result<u32> {
    dbs.open(&path, readonly)
}

#[tauri::command]
async fn db_all(db: u32, sql: String, params: Vec<Json>, dbs: State<'_, Dbs>) -> Result<Vec<Map<String, Json>>> {
    dbs.all(db, &sql, &params)
}

#[tauri::command]
async fn db_run(db: u32, sql: String, params: Vec<Json>, dbs: State<'_, Dbs>) -> Result<RunResult> {
    dbs.run(db, &sql, &params)
}

#[tauri::command]
async fn db_batch(db: u32, statements: Vec<Statement>, dbs: State<'_, Dbs>) -> Result<()> {
    dbs.batch(db, &statements)
}

#[tauri::command]
async fn db_exec(db: u32, sql: String, dbs: State<'_, Dbs>) -> Result<()> {
    dbs.exec(db, &sql)
}

#[tauri::command]
async fn db_close(db: u32, dbs: State<'_, Dbs>) -> Result<()> {
    dbs.close(db)
}

/// Opens a file in its default app, like double-clicking it: an .eml becomes a Mail draft.
#[tauri::command]
async fn open_path(path: String) -> Result<()> {
    open(&path)
}

pub fn open(target: &str) -> Result<()> {
    let ok = Command::new("/usr/bin/open").arg(target).status().map_err(|e| e.to_string())?.success();
    if ok {
        Ok(())
    } else {
        Err(format!("Couldn't open {target}"))
    }
}

#[tauri::command]
async fn copy_text(text: String) -> Result<()> {
    let mut child = Command::new("/usr/bin/pbcopy").stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    child.stdin.take().ok_or("no stdin")?.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    child.wait().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
struct HostEnv {
    home: String,
    config: String,
    temp: String,
    volumes: String,
    version: String,
}

/// The same places the Node host uses (cli/src/node-host.ts), so the app, the CLI and `magpie mcp` share one Library.
#[tauri::command]
fn host_env(app: tauri::AppHandle) -> Result<HostEnv> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let temp = std::env::temp_dir().join("Magpie");
    Ok(HostEnv {
        config: format!("{home}/Library/Application Support/Magpie"),
        temp: temp.to_string_lossy().trim_end_matches('/').to_string(),
        volumes: "/Volumes".into(),
        version: app.package_info().version.to_string(),
        home,
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Dbs::default())
        .setup(|app| {
            app.set_menu(menu::build(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(menu::handle)
        .invoke_handler(tauri::generate_handler![
            fs_read, fs_write, fs_copy, fs_exists, fs_list, fs_mkdir, fs_remove, fs_move, fs_free, db_open, db_all, db_run, db_batch, db_exec, db_close,
            open_path, copy_text, host_env
        ])
        .run(tauri::generate_context!())
        .expect("Magpie failed to start");
}

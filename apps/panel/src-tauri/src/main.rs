#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod tide;

use serde::Serialize;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tide::{AppEntry, AppInfo, Res, Settings};

struct AppState {
    app_dir: Mutex<Option<String>>,
    launch_path: Option<String>,
    /// Process group of the running job (publish, promote, …), if any.
    job: Arc<Mutex<Option<u32>>>,
    cancelled: Arc<AtomicBool>,
}

fn current(state: &State<AppState>) -> Res<String> {
    state.app_dir.lock().unwrap().clone().ok_or_else(|| "No app open".to_string())
}

/// Where to start: the folder given on the command line, else the working directory.
#[tauri::command]
fn launch_path(state: State<AppState>) -> Option<String> {
    state.launch_path.clone()
}

#[tauri::command]
fn last_app() -> Option<String> {
    tide::last_app()
}

#[tauri::command(async)]
fn open_app(state: State<AppState>, path: String) -> Res<AppInfo> {
    let dir = tide::find_app(&path)?.to_string_lossy().into_owned();
    tide::remember_app(&dir);
    *state.app_dir.lock().unwrap() = Some(dir.clone());
    Ok(tide::app_info(&dir))
}

#[tauri::command(async)]
fn pick_app(app: AppHandle, state: State<AppState>) -> Res<Option<AppInfo>> {
    let Some(dir) = app.dialog().file().set_title("Open Expo App").blocking_pick_folder() else {
        return Ok(None);
    };
    let path = dir.into_path().map_err(|e| e.to_string())?;
    open_app(state, path.to_string_lossy().into_owned()).map(Some)
}

#[tauri::command(async)]
fn app_info(state: State<AppState>) -> Res<AppInfo> {
    Ok(tide::app_info(&current(&state)?))
}

#[tauri::command(async)]
fn discover_apps() -> Vec<AppEntry> {
    tide::discover_apps()
}

#[tauri::command(async)]
fn settings() -> Settings {
    tide::settings()
}

#[tauri::command(async)]
fn list_updates(state: State<AppState>, limit: u32) -> Res<serde_json::Value> {
    tide::list_updates(&current(&state)?, limit)
}

#[tauri::command(async)]
fn runtime_version(state: State<AppState>, platform: String, channel: String) -> Res<String> {
    tide::runtime_version(&current(&state)?, &platform, &channel)
}

#[derive(Serialize, Clone)]
struct JobLine {
    text: String,
    err: bool,
}

#[derive(Serialize, Clone)]
struct JobDone {
    code: Option<i32>,
    cancelled: bool,
}

/// Starts `tidepush <args>` in the app dir. Output arrives as `job-line` events, the end as `job-done`.
#[tauri::command(async)]
fn run_job(app: AppHandle, state: State<AppState>, args: Vec<String>) -> Res<()> {
    let dir = current(&state)?;
    let mut job = state.job.lock().unwrap();
    if job.is_some() {
        return Err("Something is already running".into());
    }
    let mut cmd = tide::cli(&dir, &args);
    // Own process group, so Cancel also stops `expo export` and its workers.
    cmd.process_group(0).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Could not start the tidepush CLI: {e}"))?;
    *job = Some(child.id());
    state.cancelled.store(false, Ordering::SeqCst);

    let pipe = |r: Box<dyn Read + Send>, err: bool, app: AppHandle| {
        std::thread::spawn(move || stream_lines(r, |text| {
            let _ = app.emit("job-line", JobLine { text, err });
        }))
    };
    let out = pipe(Box::new(child.stdout.take().unwrap()), false, app.clone());
    let errs = pipe(Box::new(child.stderr.take().unwrap()), true, app.clone());
    let slot = state.job.clone();
    let cancelled = state.cancelled.clone();
    std::thread::spawn(move || {
        let status = child.wait();
        let _ = out.join();
        let _ = errs.join();
        *slot.lock().unwrap() = None;
        let _ = app.emit(
            "job-done",
            JobDone { code: status.ok().and_then(|s| s.code()), cancelled: cancelled.load(Ordering::SeqCst) },
        );
    });
    Ok(())
}

/// Calls `emit` for each line; `\r` (progress redraws) also ends a line.
fn stream_lines(mut r: Box<dyn Read + Send>, emit: impl Fn(String)) {
    let mut buf = [0u8; 8192];
    let mut line: Vec<u8> = Vec::new();
    loop {
        match r.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                for &b in &buf[..n] {
                    if b == b'\n' || b == b'\r' {
                        if !line.is_empty() {
                            emit(String::from_utf8_lossy(&line).into_owned());
                            line.clear();
                        }
                    } else {
                        line.push(b);
                    }
                }
            }
        }
    }
    if !line.is_empty() {
        emit(String::from_utf8_lossy(&line).into_owned());
    }
}

#[tauri::command]
fn cancel_job(state: State<AppState>) -> Res<()> {
    let Some(pid) = *state.job.lock().unwrap() else { return Ok(()) };
    state.cancelled.store(true, Ordering::SeqCst);
    std::process::Command::new("kill")
        .args(["-TERM", &format!("-{pid}")])
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    let initial = std::env::args()
        .nth(1)
        .or_else(|| std::env::current_dir().ok().map(|p| p.to_string_lossy().into_owned()));

    tauri::Builder::default()
        // A second launch hands its folder to the running window instead of opening another one.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let _ = app.emit("open-path", argv.get(1).cloned().unwrap_or(cwd));
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            app_dir: Mutex::new(None),
            launch_path: initial,
            job: Arc::new(Mutex::new(None)),
            cancelled: Arc::new(AtomicBool::new(false)),
        })
        .setup(|app| {
            if let Some(w) = app.get_webview_window("main") {
                if let Ok(Some(m)) = w.current_monitor() {
                    let height = m.size().height as f64 / m.scale_factor() * 0.88;
                    let _ = w.set_size(tauri::LogicalSize::new(620.0, height.clamp(500.0, 1100.0)));
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_path,
            last_app,
            open_app,
            pick_app,
            app_info,
            discover_apps,
            settings,
            list_updates,
            runtime_version,
            run_job,
            cancel_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tidepanel");
}

// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use tauri::{Emitter, Manager, State};

use tauri_plugin_dialog;
struct Bridge(std::process::Child);
type Shared = Arc<Mutex<Option<Bridge>>>;

#[tauri::command]
fn send(payload: String, state: State<Shared>) -> Result<(), String> {
    let mut guard = state.lock().unwrap();
    let child = guard.as_mut().ok_or("bridge missing")?;
    let stdin = child.0.stdin.as_mut().ok_or("stdin")?;
    writeln!(stdin, "{payload}").map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let exe =
                std::env::current_exe()?
                    .parent()
                    .unwrap()
                    .join(if cfg!(target_os = "windows") {
                        "populator.exe"
                    } else {
                        "populator"
                    });

            let mut child = Command::new(exe)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .expect("spawn python");

            let stdout = child.stdout.take().ok_or("no stdout")?;
            let app_handle = app.handle().clone();

            // Spawn a thread to monitor stdout from Python
            thread::spawn(move || {
                let reader = BufReader::new(stdout);
                for line in reader.lines() {
                    if let Ok(line) = line {
                        let parsed: serde_json::Value =
                            serde_json::from_str(&line).unwrap_or_default();

                        if let Some(id) = parsed.get("id").and_then(|v| v.as_str()) {
                            let event = format!("py-response-{}", id);
                            app_handle.emit(event.as_str(), line.clone()).ok();
                        }
                    }
                }
            });

            app.manage(Arc::new(Mutex::new(Some(Bridge(child)))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![send])
        .run(tauri::generate_context!())
        .expect("run tauri");
}

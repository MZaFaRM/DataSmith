// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
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
            let debug_python =
                cfg!(debug_assertions) && env::var("DATASMITH_DEBUG_PYTHON").as_deref() == Ok("1");
            let mut sidecar_command;

            if debug_python {
                let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .expect("src-tauri must be inside the project root")
                    .to_path_buf();
                let python = env::var("DATASMITH_PYTHON").unwrap_or_else(|_| "python3".to_string());

                sidecar_command = Command::new(python);
                sidecar_command
                    .current_dir(&project_root)
                    .arg("-m")
                    .arg("debugpy")
                    .arg("--listen")
                    .arg("127.0.0.1:5678")
                    .arg("--wait-for-client")
                    .arg(project_root.join("cli.py"));
                eprintln!(
                    "[DataSmith] Starting Python source sidecar under debugpy on 127.0.0.1:5678"
                );
            } else {
                let exe = env::current_exe()?
                    .parent()
                    .expect("application executable must have a parent directory")
                    .join(if cfg!(target_os = "windows") {
                        "populator.exe"
                    } else {
                        "populator"
                    });
                sidecar_command = Command::new(exe);
            }

            let mut child = sidecar_command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .expect("spawn Python sidecar");

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
                            let event = if parsed.get("event").and_then(|v| v.as_str())
                                == Some("progress")
                            {
                                format!("py-progress-{}", id)
                            } else {
                                format!("py-response-{}", id)
                            };
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

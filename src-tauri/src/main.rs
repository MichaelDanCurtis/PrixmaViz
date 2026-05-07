use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::{process::CommandEvent, ShellExt};

#[derive(serde::Deserialize)]
struct Handshake {
    port: u16,
}

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = boot_sidecar(handle).await {
                    eprintln!("sidecar boot error: {e}");
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}

async fn boot_sidecar(app: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let project_root = std::env::current_dir()?
        .to_string_lossy()
        .to_string();

    let sidecar = app
        .shell()
        .sidecar("prixmaviz-server")?
        .args(["--port", "0", "--project-root", &project_root]);
    let (mut rx, child) = sidecar.spawn()?;

    let _child = Arc::new(Mutex::new(Some(child)));

    let port = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                let s = String::from_utf8_lossy(&line);
                if let Ok(hs) = serde_json::from_str::<Handshake>(s.trim()) {
                    return Ok::<u16, std::io::Error>(hs.port);
                }
            }
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            "no handshake from sidecar",
        ))
    })
    .await
    .map_err(|_| "sidecar handshake timeout")??;

    let url = format!("http://127.0.0.1:{}", port);
    let url = WebviewUrl::External(url.parse()?);

    let _window = WebviewWindowBuilder::new(&app, "main", url)
        .title("PrixmaViz")
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 560.0)
        .build()?;

    Ok(())
}

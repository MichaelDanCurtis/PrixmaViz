mod install;
mod cli_check;
mod uninstall;

// Cycle 4: the bundled-server sidecar is gone — PrixmaViz is hosted (or
// self-hosted via docker). The Tauri shell now opens the configured remote
// URL directly. The install/uninstall Rust modules remain available for
// optional self-host installers (registering the CC plugin marketplace).

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

const DEFAULT_REMOTE_URL: &str = "https://prixmaviz.alexis.com";

#[tauri::command]
fn install_mcp_plugin(binary_path: String) -> Result<bool, String> {
    install::install_entry(&binary_path)
}

#[tauri::command]
fn uninstall_plugin_cmd() -> Result<(bool, String), String> {
    let r = uninstall::uninstall_plugin()?;
    Ok((r.uninstalled, r.message))
}

#[tokio::main]
async fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![install_mcp_plugin, uninstall_plugin_cmd])
        .setup(|app| {
            // Native menu: PrixmaViz > Settings… / Uninstall plugin
            let settings_item = MenuItemBuilder::new("Settings…").id("settings").build(app)?;
            let uninstall_item = MenuItemBuilder::new("Uninstall plugin").id("uninstall").build(app)?;
            let prixmaviz_menu = SubmenuBuilder::new(app, "PrixmaViz")
                .item(&settings_item)
                .separator()
                .item(&uninstall_item)
                .build()?;
            let menu = MenuBuilder::new(app).item(&prixmaviz_menu).build()?;
            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| {
                match event.id().as_ref() {
                    "settings" => {
                        let _ = app_handle.emit("open-settings", ());
                    }
                    "uninstall" => {
                        let _ = app_handle.emit("open-uninstall", ());
                    }
                    _ => {}
                }
            });

            // First-launch install dialog (self-host installer hint)
            let app_handle = app.handle().clone();
            let first_run_flag = dirs::config_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("prixmaviz/installed.flag");
            if !first_run_flag.exists() {
                std::fs::create_dir_all(first_run_flag.parent().unwrap()).ok();
                let flag_path = first_run_flag.clone();
                app_handle
                    .dialog()
                    .message("PrixmaViz now runs as a hosted service. The Claude Code plugin lives at:\n\n  https://github.com/MichaelDanCurtis/PrixmaViz\n\nInstall via `claude plugins marketplace add ...` — see the README for instructions. You can dismiss this dialog; the desktop shell is now just a webview onto the hosted (or self-hosted) instance.")
                    .title("PrixmaViz — Cycle 4")
                    .buttons(MessageDialogButtons::Ok)
                    .show(move |_| {
                        let _ = std::fs::write(&flag_path, "1");
                    });
            }

            // Open the configured remote URL in the main window.
            let handle = app.handle().clone();
            if let Err(e) = open_remote_window(&handle) {
                eprintln!("failed to open remote window: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("tauri run failed");
}

fn open_remote_window(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = std::env::var("PRIXMAVIZ_REMOTE_URL")
        .unwrap_or_else(|_| DEFAULT_REMOTE_URL.to_string());
    let parsed = WebviewUrl::External(url.parse()?);
    let _window = WebviewWindowBuilder::new(app, "main", parsed)
        .title("PrixmaViz")
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 560.0)
        .build()?;
    Ok(())
}

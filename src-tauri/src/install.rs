use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::cli_check;

pub fn config_path() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    return dirs::home_dir().map(|h| h.join("Library/Application Support/Claude/claude_desktop_config.json"));
    #[cfg(target_os = "linux")]
    return dirs::config_dir().map(|c| c.join("Claude/claude_desktop_config.json"));
    #[cfg(target_os = "windows")]
    return dirs::config_dir().map(|c| c.join("Claude/claude_desktop_config.json"));
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    return None;
}

pub fn install_entry(binary_path: &str) -> Result<bool, String> {
    let path = config_path().ok_or("config path not found")?;
    let mut config: Value = if path.exists() {
        let txt = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_else(|_| "x".to_string());
        let mut bak = path.clone();
        let fname = format!("{}.bak.{}", path.file_name().unwrap().to_string_lossy(), stamp);
        bak.set_file_name(fname);
        fs::copy(&path, &bak).ok();
        serde_json::from_str(&txt).map_err(|e| format!("invalid JSON: {}", e))?
    } else {
        json!({})
    };

    let already = match config["mcpServers"].as_object() {
        Some(m) => m.get("prixmaviz").and_then(|v| v.get("command")).and_then(|v| v.as_str()) == Some(binary_path),
        None => false,
    };
    if already { return Ok(false); }

    if config["mcpServers"].as_object().is_none() {
        config["mcpServers"] = json!({});
    }
    config["mcpServers"]["prixmaviz"] = json!({
        "command": binary_path,
        "args": ["--mcp"]
    });

    if let Some(parent) = path.parent() { fs::create_dir_all(parent).ok(); }
    fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Result of a plugin install attempt.
pub struct PluginInstallResult {
    pub installed: bool,
    pub installed_path: Option<String>,
    pub message: String,
}

/// Install PrixmaViz as a Claude Code plugin.
/// `resource_dir` is the Tauri resource directory (where `resources/plugin/` lives).
/// `bundled_binary` is the path to the bundled prixmaviz binary inside the .app.
pub fn install_plugin_via_cli(
    resource_dir: &Path,
    bundled_binary: &Path,
) -> Result<PluginInstallResult, String> {
    // 1. Check claude CLI availability
    let claude = cli_check::check_claude_cli();
    if !claude.available {
        return Ok(PluginInstallResult {
            installed: false,
            installed_path: None,
            message: "Claude Code CLI not found on PATH. Install Claude Code first, then re-launch PrixmaViz.".to_string(),
        });
    }

    // 2. Run claude plugins marketplace add <marketplace.json>
    let marketplace_path = resource_dir.join("plugin/.claude-plugin/marketplace.json");
    if !marketplace_path.exists() {
        return Err(format!("marketplace.json not found at {:?}", marketplace_path));
    }
    let add_out = Command::new("claude")
        .arg("plugins")
        .arg("marketplace")
        .arg("add")
        .arg(marketplace_path.to_string_lossy().to_string())
        .output()
        .map_err(|e| format!("failed to run claude plugins marketplace add: {}", e))?;
    if !add_out.status.success() {
        let stderr = String::from_utf8_lossy(&add_out.stderr);
        // Idempotency: if marketplace is already added, claude returns non-zero — that's OK.
        if !stderr.contains("already") && !stderr.contains("exists") {
            return Err(format!("claude plugins marketplace add failed: {}", stderr));
        }
    }

    // 3. Run claude plugins install prixmaviz@prixmaviz-local
    let install_out = Command::new("claude")
        .arg("plugins")
        .arg("install")
        .arg("prixmaviz@prixmaviz-local")
        .output()
        .map_err(|e| format!("failed to run claude plugins install: {}", e))?;
    if !install_out.status.success() {
        let stderr = String::from_utf8_lossy(&install_out.stderr);
        if !stderr.contains("already installed") {
            return Err(format!("claude plugins install failed: {}", stderr));
        }
    }

    // 4. Locate the installed plugin path
    let installed_path = find_installed_plugin_path("prixmaviz")?;

    // 5. Copy bundled binary into <installed_path>/bin/prixmaviz
    let bin_dir = installed_path.join("bin");
    fs::create_dir_all(&bin_dir).map_err(|e| format!("create bin dir: {}", e))?;
    let dst_bin = bin_dir.join("prixmaviz");
    fs::copy(bundled_binary, &dst_bin).map_err(|e| format!("copy binary: {}", e))?;
    // chmod +x on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&dst_bin).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&dst_bin, perms).map_err(|e| e.to_string())?;
    }

    Ok(PluginInstallResult {
        installed: true,
        installed_path: Some(installed_path.to_string_lossy().to_string()),
        message: format!("PrixmaViz plugin installed at {:?}", installed_path),
    })
}

/// Look up the install path of `<plugin-name>` from `~/.claude/plugins/installed_plugins.json`.
fn find_installed_plugin_path(plugin_name: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("no home dir")?;
    let registry = home.join(".claude/plugins/installed_plugins.json");
    if !registry.exists() {
        return Err(format!("plugin registry not found at {:?}", registry));
    }
    let txt = fs::read_to_string(&registry).map_err(|e| e.to_string())?;
    let json: Value = serde_json::from_str(&txt).map_err(|e| e.to_string())?;
    let plugins = json.get("plugins").and_then(|v| v.as_object()).ok_or("plugins key missing")?;
    // Key looks like "prixmaviz@prixmaviz-local"
    let key_prefix = format!("{}@", plugin_name);
    for (key, entries) in plugins {
        if key.starts_with(&key_prefix) {
            if let Some(arr) = entries.as_array() {
                if let Some(entry) = arr.first() {
                    if let Some(p) = entry.get("installPath").and_then(|v| v.as_str()) {
                        return Ok(PathBuf::from(p));
                    }
                }
            }
        }
    }
    Err(format!("plugin '{}' not found in registry", plugin_name))
}

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;

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

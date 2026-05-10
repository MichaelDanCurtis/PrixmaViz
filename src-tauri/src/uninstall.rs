use std::fs;
use std::path::PathBuf;
use std::process::Command;

use crate::cli_check;

/// Result of an uninstall attempt.
pub struct UninstallResult {
    pub uninstalled: bool,
    pub message: String,
}

/// Uninstall the PrixmaViz Claude Code plugin.
pub fn uninstall_plugin() -> Result<UninstallResult, String> {
    // 1. Verify claude CLI is reachable
    let claude = cli_check::check_claude_cli();
    if !claude.available {
        // Without claude, we can still try to clean up filesystem state, but the registry can't be updated.
        return cleanup_filesystem_only();
    }

    // 2. Run claude plugins uninstall
    let out = Command::new("claude")
        .arg("plugins")
        .arg("uninstall")
        .arg("prixmaviz@prixmaviz-local")
        .output()
        .map_err(|e| format!("failed to run claude plugins uninstall: {}", e))?;

    let success = out.status.success();
    let stderr = String::from_utf8_lossy(&out.stderr);

    if !success && !stderr.contains("not installed") && !stderr.contains("not found") {
        return Err(format!("claude plugins uninstall failed: {}", stderr));
    }

    // 3. Best-effort marketplace removal (idempotent)
    let _ = Command::new("claude")
        .arg("plugins")
        .arg("marketplace")
        .arg("remove")
        .arg("prixmaviz-local")
        .output();

    // 4. Clean up any leftover plugin directory in the cache
    let cache_dir = plugin_cache_dir();
    if let Some(dir) = cache_dir {
        let _ = fs::remove_dir_all(&dir);
    }

    Ok(UninstallResult {
        uninstalled: true,
        message: "PrixmaViz plugin uninstalled. Restart Claude Code to refresh the tool list.".to_string(),
    })
}

fn plugin_cache_dir() -> Option<PathBuf> {
    let home = dirs::home_dir()?;
    let path = home.join(".claude/plugins/cache/prixmaviz-local/prixmaviz");
    if path.exists() { Some(path) } else { None }
}

fn cleanup_filesystem_only() -> Result<UninstallResult, String> {
    let mut removed_anything = false;
    if let Some(dir) = plugin_cache_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("remove plugin dir: {}", e))?;
        removed_anything = true;
    }
    Ok(UninstallResult {
        uninstalled: removed_anything,
        message: if removed_anything {
            "PrixmaViz plugin directory removed (claude CLI not found, registry not updated). Reinstall after installing Claude Code.".to_string()
        } else {
            "Nothing to uninstall — PrixmaViz plugin not found.".to_string()
        },
    })
}

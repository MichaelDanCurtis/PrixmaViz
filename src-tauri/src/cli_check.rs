use std::process::Command;

/// Result of checking whether the `claude` CLI is reachable.
pub struct ClaudeCliCheck {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

/// Check whether the `claude` Claude Code CLI is on PATH.
/// Returns ClaudeCliCheck with `available: true` and the resolved path/version when found.
/// On any failure (PATH miss, non-zero exit, missing binary) returns `available: false`.
pub fn check_claude_cli() -> ClaudeCliCheck {
    // 1. Resolve via `which` / `where`
    let which_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };
    let path = match Command::new(which_cmd).arg("claude").output() {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        _ => None,
    };

    if path.is_none() {
        return ClaudeCliCheck { available: false, path: None, version: None };
    }

    // 2. Verify it actually runs and reports a version
    let version = match Command::new("claude").arg("--version").output() {
        Ok(out) if out.status.success() => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        _ => None,
    };

    ClaudeCliCheck {
        available: version.is_some(),
        path,
        version,
    }
}

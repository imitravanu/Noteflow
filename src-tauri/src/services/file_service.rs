//! Writes exported text (JSON backups, Markdown notes) directly to disk from
//! Rust. The previous webview `<a download>` + Blob flow is not reliably
//! honored by bundled WebKitGTK builds, which would silently drop exports.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppResult;
use crate::services::note_service::now_millis;

/// Reduces a caller-supplied name to a safe basename: directory components
/// are stripped, only `[A-Za-z0-9._-]` survive (ASCII only), leading dots
/// are removed (no hidden files), and the result is length-capped. Never
/// empty.
pub fn sanitize_filename(raw: &str) -> String {
    let base = Path::new(raw)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mapped: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = mapped
        .trim_start_matches(['.', '-'])
        .trim_end_matches(['.', '-'])
        .to_string();
    let mut name = if trimmed.is_empty() {
        "noteflow-export".to_string()
    } else {
        trimmed
    };
    if name.len() > 200 {
        name.truncate(200);
        name = name.trim_end_matches('.').to_string();
    }
    name
}

/// Returns `dir/filename`, appending `-1`, `-2`… before the extension when a
/// file with that name already exists — exports never overwrite a user's
/// previous backup.
pub fn unique_path(dir: &Path, filename: &str) -> PathBuf {
    let direct = dir.join(filename);
    if !direct.exists() {
        return direct;
    }
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("noteflow-export");
    let ext = Path::new(filename).extension().and_then(|s| s.to_str());
    for i in 1..1_000u32 {
        let candidate = match ext {
            Some(e) => format!("{stem}-{i}.{e}"),
            None => format!("{stem}-{i}"),
        };
        let path = dir.join(candidate);
        if !path.exists() {
            return path;
        }
    }
    let stamp = now_millis();
    match ext {
        Some(e) => dir.join(format!("{stem}-{stamp}.{e}")),
        None => dir.join(format!("{stem}-{stamp}")),
    }
}

/// Prefers the user's download directory (`XDG_DOWNLOAD_DIR` from
/// `~/.config/user-dirs.dirs`, else `~/Downloads`), falling back to the app
/// data directory when the candidate doesn't exist as a directory.
pub fn resolve_target_dir(
    home: Option<&Path>,
    user_dirs: Option<&str>,
    data_dir: &Path,
) -> PathBuf {
    let xdg = user_dirs
        .and_then(|content| parse_xdg_download_dir(content, home))
        .or_else(|| home.map(|h| h.join("Downloads")));
    match xdg {
        Some(dir) if dir.is_dir() => dir,
        _ => data_dir.to_path_buf(),
    }
}

/// Parses `XDG_DOWNLOAD_DIR="$HOME/Downloads"` out of a user-dirs.dirs file.
fn parse_xdg_download_dir(content: &str, home: Option<&Path>) -> Option<PathBuf> {
    let home = home?;
    let line = content
        .lines()
        .find(|l| l.trim_start().starts_with("XDG_DOWNLOAD_DIR="))?;
    let value = line.split_once('=')?.1.trim().trim_matches('"');
    let expanded = value.replace("$HOME", &home.to_string_lossy());
    if expanded.is_empty() {
        return None;
    }
    Some(PathBuf::from(expanded))
}

/// Writes `content` under a sanitized, collision-free filename in the
/// preferred target dir and returns the full path written.
pub fn save_text_file(data_dir: &Path, raw_filename: &str, content: &str) -> AppResult<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let user_dirs = home
        .as_ref()
        .and_then(|h| fs::read_to_string(h.join(".config/user-dirs.dirs")).ok());
    let dir = resolve_target_dir(home.as_deref(), user_dirs.as_deref(), data_dir);
    write_unique(&dir, raw_filename, content)
}

/// Filesystem-only core of `save_text_file` (target dir already chosen) —
/// separated so tests can exercise it without touching the real `$HOME`.
pub fn write_unique(dir: &Path, raw_filename: &str, content: &str) -> AppResult<PathBuf> {
    let path = unique_path(dir, &sanitize_filename(raw_filename));
    fs::write(&path, content)?;
    log::info!("wrote {} ({} bytes)", path.display(), content.len());
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("noteflow-file-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn sanitize_strips_path_traversal_and_exotic_chars() {
        assert_eq!(sanitize_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_filename("back up: *.json"), "back-up---.json");
        assert_eq!(sanitize_filename("C:\\notes\\x.md"), "C--notes-x.md");
    }

    #[test]
    fn sanitize_never_returns_empty_or_hidden_names() {
        assert_eq!(sanitize_filename(""), "noteflow-export");
        assert_eq!(sanitize_filename("/"), "noteflow-export");
        assert_eq!(sanitize_filename(".."), "noteflow-export");
        assert_eq!(sanitize_filename(".bashrc"), "bashrc");
        let long = sanitize_filename(&format!("{}.md", "a".repeat(500)));
        assert!(long.len() <= 200, "length-capped, got {}", long.len());
    }

    #[test]
    fn unique_path_never_overwrites_existing_backups() {
        let dir = temp_dir();
        let first = unique_path(&dir, "backup.json");
        fs::write(&first, "one").unwrap();
        let second = unique_path(&dir, "backup.json");
        assert_ne!(first, second);
        assert!(second.to_string_lossy().ends_with("backup-1.json"));
        fs::write(&second, "two").unwrap();
        let third = unique_path(&dir, "backup.json");
        assert!(third.to_string_lossy().ends_with("backup-2.json"));
        assert_eq!(fs::read_to_string(&first).unwrap(), "one");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resolve_prefers_xdg_then_downloads_then_data_dir() {
        let data = temp_dir();
        let home = temp_dir();

        // ~/Downloads exists → chosen.
        let downloads = home.join("Downloads");
        fs::create_dir_all(&downloads).unwrap();
        assert_eq!(resolve_target_dir(Some(&home), None, &data), downloads);

        // XDG entry pointing at an existing dir wins over ~/Downloads.
        let alt = home.join("AltDL");
        fs::create_dir_all(&alt).unwrap();
        let user_dirs = format!("XDG_DOWNLOAD_DIR=\"{}/AltDL\"", home.display());
        assert_eq!(
            resolve_target_dir(Some(&home), Some(&user_dirs), &data),
            alt
        );

        // No HOME at all → app data dir.
        assert_eq!(resolve_target_dir(None, None, &data), data);

        // Candidates that don't exist → app data dir.
        let bare_home = temp_dir(); // no Downloads inside
        assert_eq!(resolve_target_dir(Some(&bare_home), None, &data), data);
        let missing = format!("XDG_DOWNLOAD_DIR=\"{}/Nope\"", home.display());
        assert_eq!(resolve_target_dir(Some(&home), Some(&missing), &data), data);

        fs::remove_dir_all(&data).ok();
        fs::remove_dir_all(&home).ok();
        fs::remove_dir_all(&bare_home).ok();
    }

    #[test]
    fn write_unique_creates_file_and_reports_path() {
        let dir = temp_dir();
        let path = write_unique(&dir, "note.md", "# hi").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "# hi");
        let again = write_unique(&dir, "note.md", "# two").unwrap();
        assert_ne!(path, again);
        assert_eq!(fs::read_to_string(&path).unwrap(), "# hi");
        fs::remove_dir_all(&dir).ok();
    }
}

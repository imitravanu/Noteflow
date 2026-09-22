use tauri::{Manager, State};

use crate::commands::{lock_conn, AppState};
use crate::error::{AppError, AppResult};
use crate::services::file_service;

/// Writes `content` under a sanitized, collision-free filename in the user's
/// download directory (falling back to the app data directory) and returns
/// the absolute path written. Used by Settings > Export Backup and the
/// editor's Markdown export — the webview `<a download>` flow is not
/// reliable in bundled WebKitGTK builds.
#[tauri::command(async)]
pub fn save_text_file(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    filename: String,
    content: String,
) -> AppResult<String> {
    drop(lock_conn(&state)?); // report connection problems honestly (parity with get_data_dir)
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Internal("Could not resolve the data directory.".into()))?;
    let path = file_service::save_text_file(&data_dir, &filename, &content)?;
    Ok(path.to_string_lossy().into_owned())
}

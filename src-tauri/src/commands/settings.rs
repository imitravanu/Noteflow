use tauri::{Manager, State};

use crate::commands::{lock_conn, AppState};
use crate::error::{AppError, AppResult};
use crate::services::settings_service;

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    let conn = lock_conn(&state)?;
    settings_service::get_setting(&conn, &key)
}

#[tauri::command]
pub fn set_setting(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    let conn = lock_conn(&state)?;
    settings_service::set_setting(&conn, &key, &value)
}

/// Exposes the on-disk database location for the Settings > Storage page.
#[tauri::command]
pub fn get_data_dir(app: tauri::AppHandle, state: State<'_, AppState>) -> AppResult<String> {
    drop(lock_conn(&state)?); // report connection problems honestly
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Internal("Could not resolve the data directory.".into()))?;
    Ok(dir.to_string_lossy().into_owned())
}


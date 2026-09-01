use tauri::State;

use crate::commands::{lock_conn, AppState};
use crate::error::AppResult;
use crate::models::Tag;
use crate::services::tag_service;

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> AppResult<Vec<Tag>> {
    let conn = lock_conn(&state)?;
    tag_service::list_tags(&conn)
}

#[tauri::command]
pub fn create_tag(state: State<'_, AppState>, name: String) -> AppResult<Tag> {
    let conn = lock_conn(&state)?;
    tag_service::create_tag(&conn, &name)
}

#[tauri::command]
pub fn rename_tag(state: State<'_, AppState>, id: String, name: String) -> AppResult<Tag> {
    let conn = lock_conn(&state)?;
    tag_service::rename_tag(&conn, &id, &name)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> AppResult<bool> {
    let conn = lock_conn(&state)?;
    tag_service::delete_tag(&conn, &id)
}


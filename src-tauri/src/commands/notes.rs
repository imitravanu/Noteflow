use tauri::State;

use crate::commands::{lock_conn, AppState};
use crate::error::AppResult;
use crate::models::{FlagPatch, Note, NotePatch, NoteView, Tag};
use crate::services::note_service::{self, Counts};

#[tauri::command]
pub fn list_notes(
    state: State<'_, AppState>,
    view: NoteView,
    tag_id: Option<String>,
    query: Option<String>,
) -> AppResult<Vec<Note>> {
    let conn = lock_conn(&state)?;
    note_service::list_notes(&conn, view, tag_id.as_deref(), query.as_deref())
}

#[tauri::command]
pub fn create_note(state: State<'_, AppState>, color: Option<String>) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::create_note(&conn, color.as_deref())
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>, id: String) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::get_note(&conn, &id)
}

#[tauri::command]
pub fn update_note(
    state: State<'_, AppState>,
    id: String,
    patch: NotePatch,
) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::update_note(&conn, &id, &patch)
}

#[tauri::command]
pub fn set_flags(
    state: State<'_, AppState>,
    id: String,
    flags: FlagPatch,
) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::set_flags(&conn, &id, &flags)
}

#[tauri::command]
pub fn trash_notes(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::trash_notes(&conn, &ids)
}

#[tauri::command]
pub fn restore_notes(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::restore_notes(&conn, &ids)
}

#[tauri::command]
pub fn delete_notes_permanent(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::delete_notes_permanent(&conn, &ids)
}

#[tauri::command]
pub fn empty_trash(state: State<'_, AppState>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::empty_trash(&conn)
}

#[tauri::command]
pub fn set_note_tags(
    state: State<'_, AppState>,
    note_id: String,
    tag_ids: Vec<String>,
) -> AppResult<Vec<Tag>> {
    let conn = lock_conn(&state)?;
    note_service::set_note_tags(&conn, &note_id, &tag_ids)
}

#[tauri::command]
pub fn get_counts(state: State<'_, AppState>) -> AppResult<Counts> {
    let conn = lock_conn(&state)?;
    note_service::get_counts(&conn)
}


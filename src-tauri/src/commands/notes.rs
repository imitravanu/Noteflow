use tauri::State;

use crate::commands::{lock_conn, AppState};
use crate::error::AppResult;
use crate::models::{FlagPatch, Note, NotePatch, NoteView, Tag};
use crate::services::note_service::{self, Counts, FlagRestore, ImportReport, TagRestore};

#[tauri::command(async)]
pub fn list_notes(
    state: State<'_, AppState>,
    view: NoteView,
    tag_id: Option<String>,
    query: Option<String>,
) -> AppResult<Vec<Note>> {
    let conn = lock_conn(&state)?;
    note_service::list_notes(&conn, view, tag_id.as_deref(), query.as_deref())
}

#[tauri::command(async)]
pub fn create_note(state: State<'_, AppState>, color: Option<String>) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::create_note(&conn, color.as_deref())
}

#[tauri::command(async)]
pub fn get_note(state: State<'_, AppState>, id: String) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::get_note(&conn, &id)
}

#[tauri::command(async)]
pub fn update_note(state: State<'_, AppState>, id: String, patch: NotePatch) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::update_note(&conn, &id, &patch)
}

#[tauri::command(async)]
pub fn set_flags(state: State<'_, AppState>, id: String, flags: FlagPatch) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::set_flags(&conn, &id, &flags)
}

#[tauri::command(async)]
pub fn set_flags_bulk(
    state: State<'_, AppState>,
    ids: Vec<String>,
    flags: FlagPatch,
) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::set_flags_bulk(&conn, &ids, &flags)
}

#[tauri::command(async)]
pub fn restore_flags_bulk(
    state: State<'_, AppState>,
    entries: Vec<FlagRestore>,
) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::restore_flags_bulk(&conn, &entries)
}

#[tauri::command(async)]
pub fn restore_tags_bulk(state: State<'_, AppState>, entries: Vec<TagRestore>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::restore_tags_bulk(&conn, &entries)
}

#[tauri::command(async)]
pub fn export_backup_snapshot(
    state: State<'_, AppState>,
) -> AppResult<note_service::BackupSnapshot> {
    let conn = lock_conn(&state)?;
    note_service::export_backup_snapshot(&conn)
}

/// Restore from a Settings backup file. `tags` is the backup's top-level tag
/// list (absent in backups created before 1.3.1 — `Option` covers both).
#[tauri::command(async)]
pub fn import_backup(
    state: State<'_, AppState>,
    notes: Vec<serde_json::Value>,
    tags: Option<Vec<serde_json::Value>>,
) -> AppResult<ImportReport> {
    let conn = lock_conn(&state)?;
    note_service::import_backup_values(&conn, notes, tags.unwrap_or_default())
}

#[tauri::command(async)]
pub fn trash_notes(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<Vec<String>> {
    let conn = lock_conn(&state)?;
    note_service::trash_notes_changed(&conn, &ids)
}

#[tauri::command(async)]
pub fn restore_notes(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::restore_notes(&conn, &ids)
}

#[tauri::command(async)]
pub fn delete_notes_permanent(state: State<'_, AppState>, ids: Vec<String>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::delete_notes_permanent(&conn, &ids)
}

#[tauri::command(async)]
pub fn empty_trash(state: State<'_, AppState>) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::empty_trash(&conn)
}

#[tauri::command(async)]
pub fn set_note_tags(
    state: State<'_, AppState>,
    note_id: String,
    tag_ids: Vec<String>,
) -> AppResult<Vec<Tag>> {
    let conn = lock_conn(&state)?;
    note_service::set_note_tags(&conn, &note_id, &tag_ids)
}

/// Apply or remove one tag across a whole selection in one transaction.
#[tauri::command(async)]
pub fn set_tags_bulk(
    state: State<'_, AppState>,
    ids: Vec<String>,
    tag_id: String,
    apply: bool,
) -> AppResult<usize> {
    let conn = lock_conn(&state)?;
    note_service::set_tags_bulk(&conn, &ids, &tag_id, apply)
}

#[tauri::command(async)]
pub fn get_counts(state: State<'_, AppState>) -> AppResult<Counts> {
    let conn = lock_conn(&state)?;
    note_service::get_counts(&conn)
}

#[tauri::command(async)]
pub fn set_reminder(
    state: State<'_, AppState>,
    id: String,
    reminder_at: Option<i64>,
) -> AppResult<Note> {
    let conn = lock_conn(&state)?;
    note_service::set_reminder(&conn, &id, reminder_at)
}

/// Returns the oldest due reminder without consuming it.
#[tauri::command(async)]
pub fn peek_due_reminder(state: State<'_, AppState>) -> AppResult<Option<Note>> {
    let conn = lock_conn(&state)?;
    note_service::peek_due_reminder(&conn, note_service::now_millis())
}

#[tauri::command(async)]
pub fn acknowledge_reminder(
    state: State<'_, AppState>,
    id: String,
    expected_at: i64,
) -> AppResult<bool> {
    let conn = lock_conn(&state)?;
    note_service::acknowledge_reminder(&conn, &id, expected_at)
}

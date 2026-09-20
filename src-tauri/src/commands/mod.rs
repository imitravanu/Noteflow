pub mod notes;
pub mod settings;
pub mod tags;

use std::sync::{Mutex, MutexGuard};

use rusqlite::Connection;
use tauri::State;

use crate::error::{AppError, AppResult};

/// Shared database handle managed by Tauri.
pub struct AppState {
    pub conn: Mutex<Connection>,
}

/// Locks the database connection, converting lock poisoning (a previous
/// panic mid-write) into a user-readable error instead of a second panic.
pub fn lock_conn<'a>(state: &'a State<'_, AppState>) -> AppResult<MutexGuard<'a, Connection>> {
    state.conn.lock().map_err(|_| {
        AppError::Internal(
            "The notes database hit an internal error and the app needs to be restarted. \
             Your saved notes are safe on disk."
                .into(),
        )
    })
}

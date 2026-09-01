pub mod migrations;

use std::fs;
use std::path::Path;

use rusqlite::Connection;

use crate::error::AppResult;

/// Opens (and if necessary creates) the SQLite database inside `dir`.
///
/// WAL journaling keeps readers and the writer from blocking each other, and
/// `synchronous = NORMAL` is the recommended durability/performance balance
/// for WAL: commits survive application crashes; only a power loss may lose
/// the most recent transaction, which the debounced autosave tolerates.
pub fn open_db(dir: &Path) -> AppResult<Connection> {
    fs::create_dir_all(dir)?;
    let db_path = dir.join("noteflow.db");
    let conn = Connection::open(&db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::run(&conn)?;
    Ok(conn)
}


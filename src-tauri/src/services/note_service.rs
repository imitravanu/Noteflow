use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, Row};

use crate::error::{AppError, AppResult};
use crate::models::{FlagPatch, Note, NotePatch, NoteView, Tag};

/// Colors the frontend can render (`src/types` NOTE_COLORS). Anything else
/// falls back to `default` so a bad client can't inject `color-<garbage>`
/// class names into the DOM.
const NOTE_COLORS: [&str; 8] = [
    "default", "red", "orange", "yellow", "green", "teal", "blue", "purple",
];

fn sanitize_color(color: &str) -> &str {
    if NOTE_COLORS.contains(&color) {
        color
    } else {
        "default"
    }
}

/// Last timestamp handed out; keeps `updated_at` monotonic even if the system
/// clock jumps backwards (NTP corrections, VM snapshots).
static LAST_MILLIS: AtomicI64 = AtomicI64::new(0);

pub fn now_millis() -> i64 {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let mut last = LAST_MILLIS.load(Ordering::Relaxed);
    loop {
        // Monotonic: never go backwards, and never hand out the same
        // millis twice so ORDER BY updated_at DESC stays deterministic.
        let target = now.max(last.saturating_add(1));
        match LAST_MILLIS.compare_exchange(last, target, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return target,
            Err(current) => {
                last = current;
            }
        }
    }
}

const NOTE_COLUMNS: &str =
    "id, title, content, color, created_at, updated_at, pinned, favorite, archived, deleted, deleted_at, reminder_at, checklist";

/// Maps a row to a `Note`. A corrupted checklist blob degrades to an empty
/// checklist instead of failing the whole list query.
fn row_to_note(row: &Row) -> rusqlite::Result<Note> {
    let checklist_json: String = row.get("checklist")?;
    let checklist = serde_json::from_str(&checklist_json).unwrap_or_default();
    Ok(Note {
        id: row.get("id")?,
        title: row.get("title")?,
        content: row.get("content")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        pinned: row.get::<_, i64>("pinned")? != 0,
        favorite: row.get::<_, i64>("favorite")? != 0,
        archived: row.get::<_, i64>("archived")? != 0,
        deleted: row.get::<_, i64>("deleted")? != 0,
        deleted_at: row.get("deleted_at")?,
        reminder_at: row.get("reminder_at")?,
        checklist,
        tags: Vec::new(),
    })
}

const CHUNK_SIZE: usize = 500;

/// Attaches tag lists to notes in batched queries instead of N+1, chunked
/// to guarantee we never exceed SQLite parameter limits.
fn attach_tags(conn: &Connection, mut notes: Vec<Note>) -> AppResult<Vec<Note>> {
    if notes.is_empty() {
        return Ok(notes);
    }

    let ids: Vec<String> = notes.iter().map(|n| n.id.clone()).collect();
    let mut tags_by_note: HashMap<String, Vec<Tag>> = HashMap::new();

    for chunk in ids.chunks(CHUNK_SIZE) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT nt.note_id, t.id, t.name
             FROM note_tags nt
             JOIN tags t ON t.id = nt.tag_id
             WHERE nt.note_id IN ({placeholders})
             ORDER BY t.name COLLATE NOCASE"
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                Tag {
                    id: row.get(1)?,
                    name: row.get(2)?,
                    note_count: None,
                },
            ))
        })?;
        for entry in rows {
            let (note_id, tag) = entry?;
            tags_by_note.entry(note_id).or_default().push(tag);
        }
    }

    for note in &mut notes {
        note.tags = tags_by_note.remove(&note.id).unwrap_or_default();
    }
    Ok(notes)
}

fn escape_like(query: &str) -> String {
    query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

pub fn create_note(conn: &Connection, color: Option<&str>) -> AppResult<Note> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_millis();
    let color = sanitize_color(color.unwrap_or("default")).to_string();

    conn.execute(
        "INSERT INTO notes (id, color, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![id, color, now],
    )?;

    get_note(conn, &id)
}

pub fn get_note(conn: &Connection, id: &str) -> AppResult<Note> {
    let sql = format!("SELECT {NOTE_COLUMNS} FROM notes WHERE id = ?1");
    let note = conn
        .query_row(&sql, params![id], row_to_note)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound("That note no longer exists.".into())
            }
            other => other.into(),
        })?;
    attach_tags(conn, vec![note]).map(|mut v| v.remove(0))
}

/// Applies a partial edit inside a transaction. Only fields present in the
/// patch are written, so autosave flushes never clobber concurrent flag
/// changes, and `updated_at` only moves for real content edits. An empty
/// patch is a no-op that still verifies the note exists (so callers get the
/// note back without a spurious `updated_at` bump / list re-sort).
pub fn update_note(conn: &Connection, id: &str, patch: &NotePatch) -> AppResult<Note> {
    let checklist_json = patch
        .checklist
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| AppError::Internal(format!("Could not save the checklist: {e}")))?;

    let has_edit = patch.title.is_some()
        || patch.content.is_some()
        || patch.color.is_some()
        || patch.checklist.is_some();

    let tx = conn.unchecked_transaction()?;
    if has_edit {
        let changed = tx.execute(
            "UPDATE notes SET
                title      = COALESCE(?1, title),
                content    = COALESCE(?2, content),
                color      = COALESCE(?3, color),
                checklist  = COALESCE(?4, checklist),
                updated_at = ?5
             WHERE id = ?6",
            params![
                patch.title.as_deref(),
                patch.content.as_deref(),
                patch.color.as_deref().map(sanitize_color),
                checklist_json.as_deref(),
                now_millis(),
                id
            ],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("That note no longer exists.".into()));
        }
    } else {
        // Empty patch: verify existence but write nothing, so `updated_at`
        // never moves and the list order is untouched.
        let exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM notes WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )?;
        if exists == 0 {
            return Err(AppError::NotFound("That note no longer exists.".into()));
        }
    }
    let note = get_note(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

pub fn set_flags(conn: &Connection, id: &str, flags: &FlagPatch) -> AppResult<Note> {
    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE notes SET
            pinned   = COALESCE(?1, pinned),
            favorite = COALESCE(?2, favorite),
            archived = COALESCE(?3, archived)
         WHERE id = ?4",
        params![
            flags.pinned.map(|b| b as i64),
            flags.favorite.map(|b| b as i64),
            flags.archived.map(|b| b as i64),
            id
        ],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("That note no longer exists.".into()));
    }
    let note = get_note(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

fn ids_placeholders(ids: &[String]) -> String {
    vec!["?"; ids.len()].join(",")
}

pub fn trash_notes(conn: &Connection, ids: &[String]) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let now = now_millis();
    let mut total = 0;
    for chunk in ids.chunks(CHUNK_SIZE) {
        let sql = format!(
            "UPDATE notes SET deleted = 1, deleted_at = ?1 WHERE id IN ({}) AND deleted = 0",
            ids_placeholders(chunk)
        );
        let mut stmt = tx.prepare(&sql)?;
        let bound = std::iter::once(rusqlite::types::Value::Integer(now)).chain(
            chunk
                .iter()
                .map(|id| rusqlite::types::Value::Text(id.clone())),
        );
        total += stmt.execute(rusqlite::params_from_iter(bound))?;
    }
    tx.commit()?;
    Ok(total)
}

/// Restores trashed notes to the active list. `archived` is cleared too, so
/// "Undo move to trash" never resurrects a note into the Archive (which the
/// All view does not show and users would read as a lost note).
pub fn restore_notes(conn: &Connection, ids: &[String]) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut total = 0;
    for chunk in ids.chunks(CHUNK_SIZE) {
        let sql = format!(
            "UPDATE notes SET deleted = 0, deleted_at = NULL, archived = 0
             WHERE id IN ({}) AND deleted = 1",
            ids_placeholders(chunk)
        );
        let mut stmt = tx.prepare(&sql)?;
        total += stmt.execute(rusqlite::params_from_iter(chunk))?;
    }
    tx.commit()?;
    Ok(total)
}

/// Hard delete. `note_tags` rows cascade automatically via foreign keys.
pub fn delete_notes_permanent(conn: &Connection, ids: &[String]) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut total = 0;
    for chunk in ids.chunks(CHUNK_SIZE) {
        let sql = format!(
            "DELETE FROM notes WHERE id IN ({})",
            ids_placeholders(chunk)
        );
        let mut stmt = tx.prepare(&sql)?;
        total += stmt.execute(rusqlite::params_from_iter(chunk))?;
    }
    tx.commit()?;
    Ok(total)
}

pub fn empty_trash(conn: &Connection) -> AppResult<usize> {
    let tx = conn.unchecked_transaction()?;
    let count = tx.execute("DELETE FROM notes WHERE deleted = 1", [])?;
    tx.commit()?;
    Ok(count)
}

pub fn set_note_tags(conn: &Connection, note_id: &str, tag_ids: &[String]) -> AppResult<Vec<Tag>> {
    let tx = conn.unchecked_transaction()?;
    let exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM notes WHERE id = ?1",
        params![note_id],
        |r| r.get(0),
    )?;
    if exists == 0 {
        return Err(AppError::NotFound("That note no longer exists.".into()));
    }

    // Validate tag ids up front so a stale/deleted id produces a friendly
    // error instead of a foreign-key violation (which surfaces as a generic
    // "local storage problem" message).
    let mut tag_check = tx.prepare("SELECT COUNT(*) FROM tags WHERE id = ?1")?;
    for tag_id in tag_ids {
        let tag_exists: i64 = tag_check.query_row(params![tag_id], |r| r.get(0))?;
        if tag_exists == 0 {
            drop(tag_check);
            return Err(AppError::NotFound("That tag no longer exists.".into()));
        }
    }
    drop(tag_check);

    tx.execute("DELETE FROM note_tags WHERE note_id = ?1", params![note_id])?;
    let mut stmt = tx.prepare("INSERT INTO note_tags (note_id, tag_id) VALUES (?1, ?2)")?;
    for tag_id in tag_ids {
        stmt.execute(params![note_id, tag_id])?;
    }
    drop(stmt);

    let note = get_note(&tx, note_id)?;
    tx.commit()?;
    Ok(note.tags)
}

/// Lists notes for a view, optionally narrowed to a tag and a free-text query
/// across title, body, and tag names. Pinned notes sort first so the UI can
/// render them as a dedicated section.
pub fn list_notes(
    conn: &Connection,
    view: NoteView,
    tag_id: Option<&str>,
    query: Option<&str>,
) -> AppResult<Vec<Note>> {
    let mut where_parts: Vec<&str> = Vec::new();
    let mut filter_params: Vec<String> = Vec::new();

    match view {
        NoteView::All => where_parts.push("deleted = 0 AND archived = 0"),
        NoteView::Pinned => where_parts.push("deleted = 0 AND archived = 0 AND pinned = 1"),
        NoteView::Favorites => where_parts.push("deleted = 0 AND archived = 0 AND favorite = 1"),
        NoteView::Archive => where_parts.push("deleted = 0 AND archived = 1"),
        NoteView::Trash => where_parts.push("deleted = 1"),
    }

    if let Some(tag) = tag_id {
        where_parts.push(
            "EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = notes.id AND nt.tag_id = ?)",
        );
        filter_params.push(tag.to_string());
    }

    if let Some(q) = query {
        let q = q.trim();
        if !q.is_empty() {
            where_parts.push(
                "(title LIKE ? ESCAPE '\\' OR content LIKE ? ESCAPE '\\'
                  OR EXISTS (
                      SELECT 1 FROM json_each(
                          CASE WHEN json_valid(notes.checklist)
                               THEN notes.checklist ELSE '[]' END
                      )
                      WHERE json_extract(value, '$.text') LIKE ? ESCAPE '\\'
                  )
                  OR EXISTS (
                      SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
                      WHERE nt.note_id = notes.id AND t.name LIKE ? ESCAPE '\\'
                  ))",
            );
            let pattern = format!("%{}%", escape_like(q));
            // Title + body patterns, then checklist item text and tag name.
            filter_params.push(pattern.clone());
            filter_params.push(pattern.clone());
            filter_params.push(pattern.clone());
            filter_params.push(pattern);
        }
    }

    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes WHERE {} ORDER BY pinned DESC, updated_at DESC",
        where_parts.join(" AND ")
    );

    let mut stmt = conn.prepare(&sql)?;
    let notes = stmt
        .query_map(
            rusqlite::params_from_iter(filter_params.iter()),
            row_to_note,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    attach_tags(conn, notes)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts {
    pub all: i64,
    pub pinned: i64,
    pub favorites: i64,
    pub archived: i64,
    pub trash: i64,
}

pub fn get_counts(conn: &Connection) -> AppResult<Counts> {
    let (all, pinned, favorites, archived, trash) = conn.query_row(
        "SELECT
            COUNT(CASE WHEN deleted = 0 AND archived = 0 THEN 1 END),
            COUNT(CASE WHEN deleted = 0 AND archived = 0 AND pinned = 1 THEN 1 END),
            COUNT(CASE WHEN deleted = 0 AND archived = 0 AND favorite = 1 THEN 1 END),
            COUNT(CASE WHEN deleted = 0 AND archived = 1 THEN 1 END),
            COUNT(CASE WHEN deleted = 1 THEN 1 END)
         FROM notes",
        [],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )?;
    Ok(Counts {
        all,
        pinned,
        favorites,
        archived,
        trash,
    })
}

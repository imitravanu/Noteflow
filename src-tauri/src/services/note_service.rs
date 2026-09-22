use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension, Row};

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

/// Raises the monotonic clock to at least `ts`. Import uses this so a backup
/// carrying timestamps from another machine's (fast) clock can never keep
/// subsequently edited notes sorting *below* the imported ones.
pub fn bump_last_millis(ts: i64) {
    let mut last = LAST_MILLIS.load(Ordering::Relaxed);
    while ts > last {
        match LAST_MILLIS.compare_exchange(last, ts, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => return,
            Err(current) => last = current,
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

/// Shortest query the trigram index can answer (FTS5 trigram tokens are three
/// characters wide, so a one- or two-character needle has no token to match).
const FTS_MIN_CHARS: usize = 3;

/// Renders a raw user query as an FTS5 string literal: quoting makes the FTS5
/// operators (`*`, `:`, `NEAR`, parentheses…) literal text, so searching for
/// `%` or `a-b` can only ever match those exact characters, and doubling an
/// embedded quote is how FTS5 escapes it inside a string.
fn fts_literal(query: &str) -> String {
    format!("\"{}\"", query.replace('"', "\"\""))
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
        .map_err(|e| {
            log::error!("checklist serialize failed during save: {e}");
            AppError::Internal(format!("Could not save the checklist: {e}"))
        })?;

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

/// Bulk flag update in a single transaction per chunk.
/// Returns number of rows touched; missing ids are simply ignored
/// (caller refreshes afterwards, so UI never ends half-flagged).
pub fn set_flags_bulk(conn: &Connection, ids: &[String], flags: &FlagPatch) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    if flags.pinned.is_none() && flags.favorite.is_none() && flags.archived.is_none() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;
    let mut total = 0;
    for chunk in ids.chunks(CHUNK_SIZE) {
        // All-anonymous placeholders: three flag values first, then the id
        // list — bound below in exactly that order.
        let sql = format!(
            "UPDATE notes SET
                pinned   = COALESCE(?, pinned),
                favorite = COALESCE(?, favorite),
                archived = COALESCE(?, archived)
             WHERE id IN ({})",
            ids_placeholders(chunk)
        );
        let mut stmt = tx.prepare(&sql)?;
        let params: Vec<rusqlite::types::Value> = vec![
            flags
                .pinned
                .map(|b| rusqlite::types::Value::Integer(b as i64))
                .unwrap_or(rusqlite::types::Value::Null),
            flags
                .favorite
                .map(|b| rusqlite::types::Value::Integer(b as i64))
                .unwrap_or(rusqlite::types::Value::Null),
            flags
                .archived
                .map(|b| rusqlite::types::Value::Integer(b as i64))
                .unwrap_or(rusqlite::types::Value::Null),
        ]
        .into_iter()
        .chain(
            chunk
                .iter()
                .map(|id| rusqlite::types::Value::Text(id.clone())),
        )
        .collect();
        total += stmt.execute(rusqlite::params_from_iter(params.iter()))?;
    }
    tx.commit()?;
    Ok(total)
}

/// Sets (or, with `None`, clears) a note's reminder.
///
/// Reminders are metadata, so — like flags — they deliberately leave
/// `updated_at` untouched: scheduling one on an old note must not yank it to
/// the top of the list under the user's cursor.
pub fn set_reminder(conn: &Connection, id: &str, reminder_at: Option<i64>) -> AppResult<Note> {
    if matches!(reminder_at, Some(ts) if ts <= 0) {
        return Err(AppError::Invalid("That reminder time is not valid.".into()));
    }
    let tx = conn.unchecked_transaction()?;
    let changed = tx.execute(
        "UPDATE notes SET reminder_at = ?1 WHERE id = ?2",
        params![reminder_at, id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound("That note no longer exists.".into()));
    }
    let note = get_note(&tx, id)?;
    tx.commit()?;
    Ok(note)
}

/// Hands back the oldest due reminder and clears it inside the same
/// transaction. Claiming it is what makes firing exactly-once: a later poll (or
/// a second window) can never announce the same reminder twice, and one that
/// came due while the app was closed still fires on the next launch rather than
/// piling up. One reminder per call keeps a backlog surfacing one snackbar at a
/// time instead of silently overwriting the earlier ones.
pub fn take_due_reminder(conn: &Connection, now: i64) -> AppResult<Option<Note>> {
    let tx = conn.unchecked_transaction()?;
    let due_id: Option<String> = tx
        .query_row(
            "SELECT id FROM notes
              WHERE deleted = 0 AND archived = 0
                AND reminder_at IS NOT NULL AND reminder_at <= ?1
              ORDER BY reminder_at ASC
              LIMIT 1",
            params![now],
            |row| row.get(0),
        )
        .optional()?;

    let Some(id) = due_id else {
        return Ok(None); // nothing to claim: the transaction rolls back as a no-op
    };

    tx.execute(
        "UPDATE notes SET reminder_at = NULL WHERE id = ?1",
        params![id],
    )?;
    let note = get_note(&tx, &id)?;
    tx.commit()?;
    Ok(Some(note))
}

/// Full snapshot for Settings > Backup: every note regardless of view,
/// in one read so the JSON file is always consistent.
pub fn export_all_notes(conn: &Connection) -> AppResult<Vec<Note>> {
    let sql = format!("SELECT {NOTE_COLUMNS} FROM notes ORDER BY updated_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let notes = stmt
        .query_map([], row_to_note)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    attach_tags(conn, notes)
}

/// What an import actually did: notes written vs. entries dropped by
/// validation — surfaced in Settings so oversized/invalid data can never be
/// skipped silently.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub inserted: usize,
    pub skipped: usize,
}

/// Restore from a Settings backup file. Never overwrites: existing ids are
/// skipped (not an error), oversize/invalid entries are skipped and counted,
/// tags merge by name (case-insensitive).
///
/// `extra_tags` is the backup's top-level tag list: restoring it lets tags
/// that currently reference no note (orphans) survive a backup round-trip.
/// They merge by name just like the per-note tags below, so re-imports of
/// old and new backups alike stay idempotent.
pub fn import_backup(
    conn: &Connection,
    notes: &[Note],
    extra_tags: &[Tag],
) -> AppResult<ImportReport> {
    let mut report = ImportReport {
        inserted: 0,
        skipped: 0,
    };
    if notes.is_empty() && extra_tags.is_empty() {
        return Ok(report);
    }
    if notes.len() > 5000 {
        return Err(AppError::Invalid(
            "Backup holds too many notes (max 5000).".into(),
        ));
    }
    if extra_tags.len() > 5000 {
        return Err(AppError::Invalid(
            "Backup holds too many tags (max 5000).".into(),
        ));
    }
    let tx = conn.unchecked_transaction()?;

    // Restore the top-level tag list first. Skip anything already present by
    // name (COLLATE NOCASE) or id, so a re-import or a tag that also appears
    // attached to a note never duplicates.
    for tag in extra_tags {
        let name = tag.name.trim();
        if name.is_empty() || name.chars().count() > 64 {
            report.skipped += 1; // invalid tag entry — counted in the summary
            continue;
        }
        let taken: Option<String> = tx
            .query_row(
                "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                params![name],
                |r| r.get(0),
            )
            .optional()?;
        if taken.is_some() {
            continue;
        }
        let id = if tag.id.trim().is_empty() || tag.id.len() > 64 {
            uuid::Uuid::new_v4().to_string()
        } else {
            tag.id.clone()
        };
        // OR IGNORE: a pathological backup with a colliding id loses that one
        // tag instead of aborting the whole restore.
        tx.execute(
            "INSERT OR IGNORE INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
            params![id, name, now_millis()],
        )?;
    }

    for note in notes {
        if note.id.trim().is_empty() || note.id.len() > 64 {
            report.skipped += 1; // unusable id — the note can never come back
            continue;
        }
        let exists: i64 = tx.query_row(
            "SELECT COUNT(*) FROM notes WHERE id = ?1",
            params![note.id],
            |r| r.get(0),
        )?;
        if exists > 0 {
            continue; // already present — re-imports stay idempotent, not an error
        }
        // Size caps mirror the editor's maxLength limits so everything the app
        // can save is restorable; oversized foreign entries are reported.
        if note.title.chars().count() > 5000 || note.content.chars().count() > 500_000 {
            report.skipped += 1;
            continue;
        }
        if note.checklist.len() > 500 {
            report.skipped += 1;
            continue;
        }
        let checklist_json = serde_json::to_string(&note.checklist).map_err(|e| {
            log::error!("checklist serialize failed during import: {e}");
            AppError::Internal(format!("Could not restore the checklist: {e}"))
        })?;
        let color = sanitize_color(note.color.trim()).to_string();
        let created = if note.created_at > 0 {
            note.created_at
        } else {
            now_millis()
        };
        let updated = if note.updated_at >= created {
            note.updated_at
        } else {
            created
        };
        // Fold the foreign clock into ours so a fast-clock backup can never
        // keep subsequent edits sorted below the imported notes.
        bump_last_millis(updated);
        tx.execute(
            "INSERT INTO notes (id, title, content, color, created_at, updated_at,
                                pinned, favorite, archived, deleted, deleted_at, reminder_at, checklist)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                note.id,
                note.title,
                note.content,
                color,
                created,
                updated,
                note.pinned as i64,
                note.favorite as i64,
                note.archived as i64,
                note.deleted as i64,
                note.deleted_at,
                note.reminder_at,
                checklist_json,
            ],
        )?;
        // Merge tags by name so re-imports never duplicate "Work"/"work".
        for tag in &note.tags {
            let name = tag.name.trim();
            if name.is_empty() || name.chars().count() > 64 {
                continue;
            }
            let existing: Option<String> = tx
                .query_row(
                    "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                    params![name],
                    |r| r.get(0),
                )
                .optional()?;
            let tag_id = match existing {
                Some(id) => id,
                None => {
                    let new_id = uuid::Uuid::new_v4().to_string();
                    tx.execute(
                        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
                        params![new_id, name, now_millis()],
                    )?;
                    new_id
                }
            };
            tx.execute(
                "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
                params![note.id, tag_id],
            )?;
        }
        report.inserted += 1;
    }
    tx.commit()?;
    Ok(report)
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

/// Applies (or removes) one tag on many notes in a single transaction.
/// The tag is validated once up front; note ids that no longer exist are
/// filtered out per chunk (a stale selection can never trip a foreign-key
/// error mid-batch), and the whole batch commits or rolls back as one unit —
/// the UI never ends up half-tagged. Returns the number of note↔tag links
/// created (or removed when `apply` is false); applying twice is a no-op.
pub fn set_tags_bulk(
    conn: &Connection,
    ids: &[String],
    tag_id: &str,
    apply: bool,
) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    let tx = conn.unchecked_transaction()?;

    let tag_exists: i64 = tx.query_row(
        "SELECT COUNT(*) FROM tags WHERE id = ?1",
        params![tag_id],
        |r| r.get(0),
    )?;
    if tag_exists == 0 {
        return Err(AppError::NotFound("That tag no longer exists.".into()));
    }

    let mut total = 0;
    for chunk in ids.chunks(CHUNK_SIZE) {
        // Drop ids that no longer reference a note (deleted since the UI
        // built its selection) so inserts stay FK-safe without failing.
        let find_sql = format!(
            "SELECT id FROM notes WHERE id IN ({})",
            ids_placeholders(chunk)
        );
        let mut find = tx.prepare(&find_sql)?;
        let existing: Vec<String> = find
            .query_map(rusqlite::params_from_iter(chunk.iter()), |r| r.get(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        drop(find);
        if existing.is_empty() {
            continue;
        }

        if apply {
            // Row-by-row keeps parameter count at 2 regardless of chunk size;
            // OR IGNORE makes re-applying an existing link a counted no-op.
            let mut stmt =
                tx.prepare("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?1, ?2)")?;
            for note_id in &existing {
                total += stmt.execute(params![note_id, tag_id])?;
            }
            drop(stmt);
        } else {
            let del_sql = format!(
                "DELETE FROM note_tags WHERE tag_id = ?1 AND note_id IN ({})",
                ids_placeholders(&existing)
            );
            let mut stmt = tx.prepare(&del_sql)?;
            let args = std::iter::once(rusqlite::types::Value::Text(tag_id.to_string())).chain(
                existing
                    .iter()
                    .map(|id| rusqlite::types::Value::Text(id.clone())),
            );
            total += stmt.execute(rusqlite::params_from_iter(args))?;
        }
    }
    tx.commit()?;
    Ok(total)
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

    // Trash sorts by when it was deleted (what its cards display); live views
    // keep pinned-first ordering.
    let order_by = if matches!(view, NoteView::Trash) {
        "COALESCE(deleted_at, updated_at) DESC"
    } else {
        "pinned DESC, updated_at DESC"
    };

    if let Some(tag) = tag_id {
        where_parts.push(
            "EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = notes.id AND nt.tag_id = ?)",
        );
        filter_params.push(tag.to_string());
    }

    if let Some(q) = query {
        let q = q.trim();
        if !q.is_empty() {
            if q.chars().count() >= FTS_MIN_CHARS {
                // Trigram FTS5 arms: unicode case-insensitive *substring*
                // matching through the index (see migrations v2) — this is what
                // lets "CAFÉ" find "Café", which LIKE cannot do. `notes_fts`
                // mirrors `notes.rowid`, so each arm is an index lookup keyed to
                // the row rather than a table scan.
                // One OR'd clause: a note matches when the query appears in its
                // own text *or* in one of its tags (the old LIKE arms were
                // combined the same way). `notes_fts` mirrors `notes.rowid`, so
                // each arm is an index lookup keyed to the row, not a scan.
                where_parts.push(
                    "(EXISTS (SELECT 1 FROM notes_fts
                              WHERE notes_fts.rowid = notes.rowid AND notes_fts MATCH ?)
                      OR EXISTS (SELECT 1 FROM note_tags nt
                                 JOIN tags t ON t.id = nt.tag_id
                                 JOIN tags_fts ON tags_fts.rowid = t.rowid
                                 WHERE nt.note_id = notes.id AND tags_fts MATCH ?))",
                );
                filter_params.push(fts_literal(q));
                filter_params.push(fts_literal(q));
            } else {
                // 1–2 characters: shorter than a trigram, so the index cannot
                // answer it. Escaped LIKE keeps the pre-1.4 behaviour (and its
                // ASCII-only case folding) for these two cases.
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
    }

    // NOTE: the indexed arms above fold unicode case correctly; the 1–2
    // character fallback keeps SQLite LIKE's ASCII-only folding, which is the
    // one remaining gap (trigram tokens are three characters wide).
    let sql = format!(
        "SELECT {NOTE_COLUMNS} FROM notes WHERE {} ORDER BY {order_by}",
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

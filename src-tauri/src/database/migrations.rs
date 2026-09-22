use rusqlite::Connection;

use crate::error::AppResult;

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS notes (
    id          TEXT PRIMARY KEY NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    content     TEXT NOT NULL DEFAULT '',
    color       TEXT NOT NULL DEFAULT 'default',
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    favorite    INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    deleted     INTEGER NOT NULL DEFAULT 0,
    deleted_at  INTEGER,
    reminder_at INTEGER,
    checklist   TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_deleted     ON notes(deleted);
CREATE INDEX IF NOT EXISTS idx_notes_pinned      ON notes(pinned);

CREATE TABLE IF NOT EXISTS tags (
    id         TEXT PRIMARY KEY NOT NULL,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS note_tags (
    note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag_id);

CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
";

/// The checklist text a search should be able to find: the item texts joined by
/// newlines, never the raw JSON (its `checked`/`id` keys must not match). Kept
/// as one fragment so the insert trigger, the update trigger and the backfill
/// cannot drift apart; the newline separator stops a query from matching across
/// two unrelated items.
macro_rules! checklist_text {
    ($col:expr) => {
        concat!(
            "(SELECT COALESCE(group_concat(json_extract(value, '$.text'), char(10)), '')",
            "   FROM json_each(CASE WHEN json_valid(",
            $col,
            ") THEN ",
            $col,
            " ELSE '[]' END))"
        )
    };
}

/// v2: FTS5 search indexes.
///
/// The trigram tokenizer is the one that matches this app's product promise:
/// it indexes every 3-character slice, so `MATCH` behaves like an *indexed
/// substring* search (`"oat milk"` matches "buy oat milk") while still folding
/// unicode case, which plain `LIKE` only does for ASCII ("CAFÉ" now finds
/// "Café"). Trigrams are also what forces the 3-character minimum: queries
/// shorter than that are answered by the `LIKE` fallback in `note_service`.
///
/// `notes_fts` and `tags_fts` are addressed by the *rowid* of their source
/// table (`notes.rowid` / `tags.rowid`) so search can join back with an index
/// lookup instead of scanning; the triggers keep the mirror in sync. Tag text
/// lives in a separate index on purpose: `note_tags` rows also disappear via
/// `ON DELETE CASCADE`, and cascaded deletes are not guaranteed to fire child
/// triggers, whereas a trigger on `tags` itself always sees the delete.
const SCHEMA_V2_FTS: &str = "
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title, content, checklist, tokenize = 'trigram'
);

CREATE VIRTUAL TABLE IF NOT EXISTS tags_fts USING fts5(
    name, tokenize = 'trigram'
);

CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content, checklist)
    VALUES (new.rowid, new.title, new.content, CHECKLIST_TEXT_NEW);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_au
AFTER UPDATE OF title, content, checklist ON notes BEGIN
    UPDATE notes_fts
       SET title     = new.title,
           content   = new.content,
           checklist = CHECKLIST_TEXT_NEW
     WHERE rowid = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
    DELETE FROM notes_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS tags_fts_ai AFTER INSERT ON tags BEGIN
    INSERT INTO tags_fts(rowid, name) VALUES (new.rowid, new.name);
END;

CREATE TRIGGER IF NOT EXISTS tags_fts_au AFTER UPDATE OF name ON tags BEGIN
    UPDATE tags_fts SET name = new.name WHERE rowid = new.rowid;
END;

CREATE TRIGGER IF NOT EXISTS tags_fts_ad AFTER DELETE ON tags BEGIN
    DELETE FROM tags_fts WHERE rowid = old.rowid;
END;
";

/// Applies schema migrations using SQLite's `user_version` pragma so future
/// versions can evolve the schema without touching existing user data.
pub fn run(conn: &Connection) -> AppResult<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;

    if version < 1 {
        // One transaction: a crash mid-migration can never leave a partial
        // schema behind (CREATE IF NOT EXISTS would make a rerun safe, but
        // atomic is cheaper to reason about).
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(SCHEMA_V1)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }

    if version < 2 {
        // The trigger body cannot take a bind parameter, so the checklist
        // fragment is injected into the DDL instead of hand-copied into it.
        let ddl = SCHEMA_V2_FTS.replace("CHECKLIST_TEXT_NEW", checklist_text!("new.checklist"));
        let backfill_notes = format!(
            "INSERT INTO notes_fts(rowid, title, content, checklist)
             SELECT rowid, title, content, {} FROM notes;",
            checklist_text!("notes.checklist")
        );
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(&ddl)?;
        // Index the notes the user already had. Guarded by `user_version`, so
        // this runs exactly once per database: the FTS mirror is derived data
        // and inserting the same rowids twice would duplicate every result.
        tx.execute_batch(&backfill_notes)?;
        tx.execute_batch("INSERT INTO tags_fts(rowid, name) SELECT rowid, name FROM tags;")?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }

    Ok(())
}

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::Tag;
use crate::services::note_service::now_millis;

fn validate_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("Tag name cannot be empty.".into()));
    }
    if trimmed.len() > 64 {
        return Err(AppError::Invalid(
            "Tag names are limited to 64 characters.".into(),
        ));
    }
    Ok(trimmed.to_string())
}

/// All tags with the number of notes using them. Counts only live, active
/// notes (deleted and archived excluded) so the badge matches what opening
/// the tag actually lists in the All view.
pub fn list_tags(conn: &Connection) -> AppResult<Vec<Tag>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name,
                (SELECT COUNT(*)
                   FROM note_tags nt JOIN notes n ON n.id = nt.note_id
                  WHERE nt.tag_id = t.id AND n.deleted = 0 AND n.archived = 0) AS note_count
         FROM tags t
         ORDER BY t.name COLLATE NOCASE",
    )?;
    let tags = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                note_count: row.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(tags)
}

pub fn create_tag(conn: &Connection, name: &str) -> AppResult<Tag> {
    let name = validate_name(name)?;
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE name = ?1 COLLATE NOCASE",
        params![name],
        |r| r.get(0),
    )?;
    if exists > 0 {
        return Err(AppError::Invalid(format!(
            "A tag named “{name}” already exists."
        )));
    }

    let tag = Tag {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        note_count: Some(0),
    };
    conn.execute(
        "INSERT INTO tags (id, name, created_at) VALUES (?1, ?2, ?3)",
        params![tag.id, tag.name, now_millis()],
    )?;
    Ok(tag)
}

pub fn rename_tag(conn: &Connection, id: &str, name: &str) -> AppResult<Tag> {
    let name = validate_name(name)?;
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM tags WHERE name = ?1 COLLATE NOCASE AND id != ?2",
        params![name, id],
        |r| r.get(0),
    )?;
    if exists > 0 {
        return Err(AppError::Invalid(format!(
            "A tag named “{name}” already exists."
        )));
    }
    let changed = conn.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![id, name])?;
    if changed == 0 {
        return Err(AppError::NotFound("That tag no longer exists.".into()));
    }
    Ok(Tag {
        id: id.to_string(),
        name,
        note_count: None,
    })
}

/// Returns true if a tag was removed. Notes keep their other tags untouched.
pub fn delete_tag(conn: &Connection, id: &str) -> AppResult<bool> {
    let changed = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(changed > 0)
}

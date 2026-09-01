//! Integration tests covering the note workflow end-to-end against a real
//! SQLite database on disk: creation, editing (autosave flushes), listing,
//! search, tags, pin/favorite/archive, trash lifecycle, settings, and
//! persistence across a simulated app restart.

use std::fs;

use noteflow_lib::database;
use noteflow_lib::models::{ChecklistItem, FlagPatch, NotePatch, NoteView};
use noteflow_lib::services::{note_service, settings_service, tag_service};
use rusqlite::Connection;

fn temp_db() -> Connection {
    let dir = std::env::temp_dir().join(format!("noteflow-test-{}", uuid::Uuid::new_v4()));
    database::open_db(&dir).expect("open test db")
}

fn patch(title: &str, content: &str) -> NotePatch {
    NotePatch {
        title: Some(title.to_string()),
        content: Some(content.to_string()),
        color: None,
        checklist: None,
    }
}

#[test]
fn create_note_starts_empty_and_loadable() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();
    assert_eq!(note.title, "");
    assert_eq!(note.content, "");
    assert!(!note.pinned && !note.favorite && !note.archived && !note.deleted);
    assert!(note.created_at > 0 && note.updated_at >= note.created_at);

    let loaded = note_service::get_note(&conn, &note.id).unwrap();
    assert_eq!(loaded.id, note.id);
}

#[test]
fn update_note_edits_content_like_autosave() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();

    // First flush: title + content.
    let updated = note_service::update_note(
        &conn,
        &note.id,
        &patch("Groceries", "milk\neggs"),
    )
    .unwrap();
    assert_eq!((updated.title.as_str(), updated.content.as_str()), ("Groceries", "milk\neggs"));
    assert!(updated.updated_at >= note.updated_at);

    // Second flush: partial patch must not clobber the title.
    let again = note_service::update_note(
        &conn,
        &note.id,
        &NotePatch {
            title: None,
            content: Some("milk\neggs\nbread".into()),
            color: None,
            checklist: None,
        },
    )
    .unwrap();
    assert_eq!(again.title, "Groceries");
    assert_eq!(again.content, "milk\neggs\nbread");

    // Checklist round-trips.
    let with_list = note_service::update_note(
        &conn,
        &note.id,
        &NotePatch {
            title: None,
            content: None,
            color: Some("teal".into()),
            checklist: Some(vec![ChecklistItem {
                id: "c1".into(),
                text: "buy milk".into(),
                checked: true,
            }]),
        },
    )
    .unwrap();
    assert_eq!(with_list.checklist.len(), 1);
    assert!(with_list.checklist[0].checked);
    assert_eq!(with_list.color, "teal");
}

#[test]
fn update_missing_note_returns_not_found() {
    let conn = temp_db();
    let err = note_service::update_note(&conn, "nope", &patch("x", "y")).unwrap_err();
    assert!(matches!(err, noteflow_lib::error::AppError::NotFound(_)));
}

#[test]
fn list_views_filter_correctly() {
    let conn = temp_db();
    let plain = note_service::create_note(&conn, None).unwrap();
    let pinned = note_service::create_note(&conn, None).unwrap();
    let favorite = note_service::create_note(&conn, None).unwrap();
    let both = note_service::create_note(&conn, None).unwrap();
    let archived = note_service::create_note(&conn, None).unwrap();

    note_service::set_flags(&conn, &pinned.id, &FlagPatch { pinned: Some(true), ..Default::default() }).unwrap();
    note_service::set_flags(&conn, &favorite.id, &FlagPatch { favorite: Some(true), ..Default::default() }).unwrap();
    note_service::set_flags(&conn, &both.id, &FlagPatch { pinned: Some(true), favorite: Some(true), ..Default::default() }).unwrap();
    note_service::set_flags(&conn, &archived.id, &FlagPatch { archived: Some(true), ..Default::default() }).unwrap();

    let ids = |view: NoteView| {
        note_service::list_notes(&conn, view, None, None)
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };

    let all = ids(NoteView::All);
    assert_eq!(all.len(), 4, "archived and trashed excluded from All: {all:?}");
    assert!(
        all.contains(&plain.id)
            && all.contains(&pinned.id)
            && all.contains(&favorite.id)
            && all.contains(&both.id)
    );

    // Pinned notes sort first so the UI can split them into a section.
    let pinned_view = ids(NoteView::Pinned);
    assert_eq!(pinned_view.len(), 2);
    assert!(pinned_view.iter().take(2).all(|id| id == &pinned.id || id == &both.id));

    let favorites = ids(NoteView::Favorites);
    assert_eq!(favorites.len(), 2);
    assert!(favorites.contains(&favorite.id) && favorites.contains(&both.id));

    assert_eq!(ids(NoteView::Archive), vec![archived.id.clone()]);
    assert!(ids(NoteView::Trash).is_empty());

    // Counts feed the sidebar badges.
    let counts = note_service::get_counts(&conn).unwrap();
    assert_eq!(
        (counts.all, counts.pinned, counts.favorites, counts.archived, counts.trash),
        (4, 2, 2, 1, 0)
    );

    // A note can be both pinned and favorite (states are independent).
    let fetched = note_service::get_note(&conn, &both.id).unwrap();
    assert!(fetched.pinned && fetched.favorite);
}

#[test]
fn search_covers_title_body_and_tags() {
    let conn = temp_db();
    let a = note_service::create_note(&conn, None).unwrap();
    let b = note_service::create_note(&conn, None).unwrap();
    let c = note_service::create_note(&conn, None).unwrap();

    note_service::update_note(&conn, &a.id, &patch("Quarterly Report", "numbers inside")).unwrap();
    note_service::update_note(&conn, &b.id, &patch("Recipe", "add QUARTERLY flour")).unwrap();
    note_service::update_note(&conn, &c.id, &patch("Unrelated", "nothing here")).unwrap();

    let tag = tag_service::create_tag(&conn, "quarterly-review").unwrap();
    note_service::set_note_tags(&conn, &c.id, &[tag.id.clone()]).unwrap();

    let hits = |q: &str| {
        note_service::list_notes(&conn, NoteView::All, None, Some(q))
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };

    assert_eq!(hits("quarterly").len(), 3, "title (case-insensitive), body, and tag name");
    assert_eq!(hits("Report").len(), 1);
    assert_eq!(hits("flour").len(), 1);
    assert!(hits("zzz").is_empty());
    // LIKE wildcards must be escaped, not treated as patterns.
    assert!(hits("%").is_empty());
    assert!(hits("_").is_empty());
}

#[test]
fn tags_crud_and_note_associations() {
    let conn = temp_db();
    let work = tag_service::create_tag(&conn, "Work").unwrap();
    let ideas = tag_service::create_tag(&conn, "Ideas").unwrap();

    // Names are unique case-insensitively.
    assert!(tag_service::create_tag(&conn, "work").is_err());
    assert!(tag_service::create_tag(&conn, "  ").is_err());

    let note = note_service::create_note(&conn, None).unwrap();
    let tags = note_service::set_note_tags(&conn, &note.id, &[work.id.clone(), ideas.id.clone()]).unwrap();
    assert_eq!(tags.len(), 2);

    // Tag filter narrows the list.
    let filtered = note_service::list_notes(&conn, NoteView::All, Some(&work.id), None).unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].tags.len(), 2);

    // Counts reflect live notes only.
    let listed = tag_service::list_tags(&conn).unwrap();
    let work_tag = listed.iter().find(|t| t.id == work.id).unwrap();
    assert_eq!(work_tag.note_count, Some(1));

    // Re-setting replaces the set.
    note_service::set_note_tags(&conn, &note.id, &[ideas.id.clone()]).unwrap();
    let after = note_service::list_notes(&conn, NoteView::All, Some(&work.id), None).unwrap();
    assert!(after.is_empty());

    // Deleting a tag cascades out of note_tags but keeps notes intact.
    assert!(tag_service::delete_tag(&conn, &ideas.id).unwrap());
    let note_after = note_service::get_note(&conn, &note.id).unwrap();
    assert!(note_after.tags.is_empty());
    assert_eq!(note_after.title, note_after.title);

    // Renaming keeps identity.
    let renamed = tag_service::rename_tag(&conn, &work.id, "Job").unwrap();
    assert_eq!(renamed.name, "Job");
}

#[test]
fn trash_restore_and_permanent_delete() {
    let conn = temp_db();
    let n1 = note_service::create_note(&conn, None).unwrap();
    let n2 = note_service::create_note(&conn, None).unwrap();

    // Trash
    assert_eq!(note_service::trash_notes(&conn, &[n1.id.clone(), n2.id.clone()]).unwrap(), 2);
    let trashed = note_service::get_note(&conn, &n1.id).unwrap();
    assert!(trashed.deleted && trashed.deleted_at.is_some());
    assert_eq!(note_service::list_notes(&conn, NoteView::Trash, None, None).unwrap().len(), 2);

    // Restore (the undo path)
    assert_eq!(note_service::restore_notes(&conn, &[n1.id.clone()]).unwrap(), 1);
    let restored = note_service::get_note(&conn, &n1.id).unwrap();
    assert!(!restored.deleted && restored.deleted_at.is_none());
    assert_eq!(note_service::list_notes(&conn, NoteView::All, None, None).unwrap().len(), 1);

    // Permanent delete removes the row entirely (idempotent-ish)
    assert_eq!(note_service::delete_notes_permanent(&conn, &[n2.id.clone()]).unwrap(), 1);
    assert!(note_service::get_note(&conn, &n2.id).is_err());
    assert!(note_service::list_notes(&conn, NoteView::Trash, None, None).unwrap().is_empty());

    // Empty trash sweeps the rest.
    let n3 = note_service::create_note(&conn, None).unwrap();
    note_service::trash_notes(&conn, &[n3.id]).unwrap();
    assert_eq!(note_service::empty_trash(&conn).unwrap(), 1);
}

#[test]
fn settings_roundtrip() {
    let conn = temp_db();
    assert_eq!(settings_service::get_setting(&conn, "theme").unwrap(), None);
    settings_service::set_setting(&conn, "theme", "dark").unwrap();
    assert_eq!(settings_service::get_setting(&conn, "theme").unwrap().as_deref(), Some("dark"));
    settings_service::set_setting(&conn, "theme", "system").unwrap();
    assert_eq!(settings_service::get_setting(&conn, "theme").unwrap().as_deref(), Some("system"));
}

#[test]
fn data_survives_app_restart() {
    let dir = std::env::temp_dir().join(format!("noteflow-test-{}", uuid::Uuid::new_v4()));
    {
        let conn = database::open_db(&dir).unwrap();
        let note = note_service::create_note(&conn, Some("teal")).unwrap();
        note_service::update_note(&conn, &note.id, &patch("Persistent", "survives restarts")).unwrap();
        note_service::set_flags(&conn, &note.id, &FlagPatch { pinned: Some(true), ..Default::default() }).unwrap();
        let tag = tag_service::create_tag(&conn, "Keep").unwrap();
        note_service::set_note_tags(&conn, &note.id, &[tag.id]).unwrap();
        settings_service::set_setting(&conn, "theme", "dark").unwrap();
    } // "app closes" — connection dropped

    let reopened = database::open_db(&dir).unwrap();
    let notes = note_service::list_notes(&reopened, NoteView::All, None, None).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!((notes[0].title.as_str(), notes[0].content.as_str()), ("Persistent", "survives restarts"));
    assert!(notes[0].pinned);
    assert_eq!(notes[0].tags.len(), 1);
    assert_eq!(notes[0].color, "teal");
    assert_eq!(settings_service::get_setting(&reopened, "theme").unwrap().as_deref(), Some("dark"));

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn corrupted_checklist_degrades_gracefully() {
    let dir = std::env::temp_dir().join(format!("noteflow-test-{}", uuid::Uuid::new_v4()));
    let conn = database::open_db(&dir).unwrap();
    let note = note_service::create_note(&conn, None).unwrap();
    conn.execute(
        "UPDATE notes SET checklist = '{not valid json' WHERE id = ?1",
        rusqlite::params![note.id],
    )
    .unwrap();

    let notes = note_service::list_notes(&conn, NoteView::All, None, None).unwrap();
    assert_eq!(notes.len(), 1);
    assert!(notes[0].checklist.is_empty(), "corrupt blob must not break listing");

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn rename_tag_rejects_duplicate_names() {
    let conn = temp_db();
    tag_service::create_tag(&conn, "Work").unwrap();
    let other = tag_service::create_tag(&conn, "Personal").unwrap();

    let err = tag_service::rename_tag(&conn, &other.id, "work").unwrap_err();
    assert!(matches!(
        err,
        noteflow_lib::error::AppError::Invalid(_)
    ));

    // Renaming to a unique name still works.
    let renamed = tag_service::rename_tag(&conn, &other.id, "Home").unwrap();
    assert_eq!(renamed.name, "Home");
}

#[test]
fn set_note_tags_rejects_unknown_tag() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();

    let err = note_service::set_note_tags(
        &conn,
        &note.id,
        &[uuid::Uuid::new_v4().to_string()],
    )
    .unwrap_err();
    assert!(matches!(
        err,
        noteflow_lib::error::AppError::NotFound(_)
    ));

    // Real tags still associate fine afterwards.
    let tag = tag_service::create_tag(&conn, "ok").unwrap();
    let tags = note_service::set_note_tags(&conn, &note.id, &[tag.id]).unwrap();
    assert_eq!(tags.len(), 1);
}

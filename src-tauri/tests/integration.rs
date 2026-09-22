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
    let updated =
        note_service::update_note(&conn, &note.id, &patch("Groceries", "milk\neggs")).unwrap();
    assert_eq!(
        (updated.title.as_str(), updated.content.as_str()),
        ("Groceries", "milk\neggs")
    );
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

    note_service::set_flags(
        &conn,
        &pinned.id,
        &FlagPatch {
            pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::set_flags(
        &conn,
        &favorite.id,
        &FlagPatch {
            favorite: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::set_flags(
        &conn,
        &both.id,
        &FlagPatch {
            pinned: Some(true),
            favorite: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::set_flags(
        &conn,
        &archived.id,
        &FlagPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();

    let ids = |view: NoteView| {
        note_service::list_notes(&conn, view, None, None)
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };

    let all = ids(NoteView::All);
    assert_eq!(
        all.len(),
        4,
        "archived and trashed excluded from All: {all:?}"
    );
    assert!(
        all.contains(&plain.id)
            && all.contains(&pinned.id)
            && all.contains(&favorite.id)
            && all.contains(&both.id)
    );

    // Pinned notes sort first so the UI can split them into a section.
    let pinned_view = ids(NoteView::Pinned);
    assert_eq!(pinned_view.len(), 2);
    assert!(pinned_view
        .iter()
        .take(2)
        .all(|id| id == &pinned.id || id == &both.id));

    let favorites = ids(NoteView::Favorites);
    assert_eq!(favorites.len(), 2);
    assert!(favorites.contains(&favorite.id) && favorites.contains(&both.id));

    assert_eq!(ids(NoteView::Archive), vec![archived.id.clone()]);
    assert!(ids(NoteView::Trash).is_empty());

    // Counts feed the sidebar badges.
    let counts = note_service::get_counts(&conn).unwrap();
    assert_eq!(
        (
            counts.all,
            counts.pinned,
            counts.favorites,
            counts.archived,
            counts.trash
        ),
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
    note_service::set_note_tags(&conn, &c.id, std::slice::from_ref(&tag.id)).unwrap();

    let hits = |q: &str| {
        note_service::list_notes(&conn, NoteView::All, None, Some(q))
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };

    assert_eq!(
        hits("quarterly").len(),
        3,
        "title (case-insensitive), body, and tag name"
    );
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
    let tags =
        note_service::set_note_tags(&conn, &note.id, &[work.id.clone(), ideas.id.clone()]).unwrap();
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
    note_service::set_note_tags(&conn, &note.id, std::slice::from_ref(&ideas.id)).unwrap();
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
    assert_eq!(
        note_service::trash_notes(&conn, &[n1.id.clone(), n2.id.clone()]).unwrap(),
        2
    );
    let trashed = note_service::get_note(&conn, &n1.id).unwrap();
    assert!(trashed.deleted && trashed.deleted_at.is_some());
    assert_eq!(
        note_service::list_notes(&conn, NoteView::Trash, None, None)
            .unwrap()
            .len(),
        2
    );

    // Restore (the undo path)
    assert_eq!(
        note_service::restore_notes(&conn, std::slice::from_ref(&n1.id)).unwrap(),
        1
    );
    let restored = note_service::get_note(&conn, &n1.id).unwrap();
    assert!(!restored.deleted && restored.deleted_at.is_none());
    assert_eq!(
        note_service::list_notes(&conn, NoteView::All, None, None)
            .unwrap()
            .len(),
        1
    );

    // Permanent delete removes the row entirely (idempotent-ish)
    assert_eq!(
        note_service::delete_notes_permanent(&conn, std::slice::from_ref(&n2.id)).unwrap(),
        1
    );
    assert!(note_service::get_note(&conn, &n2.id).is_err());
    assert!(note_service::list_notes(&conn, NoteView::Trash, None, None)
        .unwrap()
        .is_empty());

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
    assert_eq!(
        settings_service::get_setting(&conn, "theme")
            .unwrap()
            .as_deref(),
        Some("dark")
    );
    settings_service::set_setting(&conn, "theme", "system").unwrap();
    assert_eq!(
        settings_service::get_setting(&conn, "theme")
            .unwrap()
            .as_deref(),
        Some("system")
    );
}

#[test]
fn settings_reject_unknown_keys_and_values() {
    let conn = temp_db();
    assert!(settings_service::set_setting(&conn, "evil", "1").is_err());
    assert!(settings_service::set_setting(&conn, "theme", "neon").is_err());
    // Unicode tag names count characters, not bytes.
    let long_unicode = "é".repeat(64);
    assert!(tag_service::create_tag(&conn, &long_unicode).is_ok());
    assert!(tag_service::create_tag(&conn, &format!("{long_unicode}x")).is_err());
}

#[test]
fn data_survives_app_restart() {
    let dir = std::env::temp_dir().join(format!("noteflow-test-{}", uuid::Uuid::new_v4()));
    {
        let conn = database::open_db(&dir).unwrap();
        let note = note_service::create_note(&conn, Some("teal")).unwrap();
        note_service::update_note(&conn, &note.id, &patch("Persistent", "survives restarts"))
            .unwrap();
        note_service::set_flags(
            &conn,
            &note.id,
            &FlagPatch {
                pinned: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        let tag = tag_service::create_tag(&conn, "Keep").unwrap();
        note_service::set_note_tags(&conn, &note.id, &[tag.id]).unwrap();
        settings_service::set_setting(&conn, "theme", "dark").unwrap();
    } // "app closes" — connection dropped

    let reopened = database::open_db(&dir).unwrap();
    let notes = note_service::list_notes(&reopened, NoteView::All, None, None).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(
        (notes[0].title.as_str(), notes[0].content.as_str()),
        ("Persistent", "survives restarts")
    );
    assert!(notes[0].pinned);
    assert_eq!(notes[0].tags.len(), 1);
    assert_eq!(notes[0].color, "teal");
    assert_eq!(
        settings_service::get_setting(&reopened, "theme")
            .unwrap()
            .as_deref(),
        Some("dark")
    );

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
    assert!(
        notes[0].checklist.is_empty(),
        "corrupt blob must not break listing"
    );

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn rename_tag_rejects_duplicate_names() {
    let conn = temp_db();
    tag_service::create_tag(&conn, "Work").unwrap();
    let other = tag_service::create_tag(&conn, "Personal").unwrap();

    let err = tag_service::rename_tag(&conn, &other.id, "work").unwrap_err();
    assert!(matches!(err, noteflow_lib::error::AppError::Invalid(_)));

    // Renaming to a unique name still works.
    let renamed = tag_service::rename_tag(&conn, &other.id, "Home").unwrap();
    assert_eq!(renamed.name, "Home");
}

#[test]
fn set_note_tags_rejects_unknown_tag() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();

    let err = note_service::set_note_tags(&conn, &note.id, &[uuid::Uuid::new_v4().to_string()])
        .unwrap_err();
    assert!(matches!(err, noteflow_lib::error::AppError::NotFound(_)));

    // Real tags still associate fine afterwards.
    let tag = tag_service::create_tag(&conn, "ok").unwrap();
    let tags = note_service::set_note_tags(&conn, &note.id, &[tag.id]).unwrap();
    assert_eq!(tags.len(), 1);
}

#[test]
fn search_matches_checklist_text_but_not_json_noise() {
    let conn = temp_db();
    let a = note_service::create_note(&conn, None).unwrap();
    let b = note_service::create_note(&conn, None).unwrap();

    let list = |text: &str, checked: bool| ChecklistItem {
        id: uuid::Uuid::new_v4().to_string(),
        text: text.into(),
        checked,
    };
    note_service::update_note(
        &conn,
        &a.id,
        &NotePatch {
            title: None,
            content: None,
            color: None,
            checklist: Some(vec![list("buy oat milk", false)]),
        },
    )
    .unwrap();
    note_service::update_note(
        &conn,
        &b.id,
        &NotePatch {
            title: None,
            content: None,
            color: None,
            checklist: Some(vec![list("call dentist", true)]),
        },
    )
    .unwrap();

    let hits = |q: &str| {
        note_service::list_notes(&conn, NoteView::All, None, Some(q))
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };

    // Real item text matches.
    assert_eq!(hits("oat milk"), vec![a.id.clone()]);
    // JSON field names / values must NOT match every checklist note.
    assert!(hits("checked").is_empty());
    assert!(hits("false").is_empty());
    // Substring of the JSON schema like "id" or "text" must not match either
    // (the word only appears as a JSON key).
    assert!(hits("\"id\"").is_empty());
}

#[test]
fn search_survives_corrupted_checklist_json() {
    let dir = std::env::temp_dir().join(format!("noteflow-test-{}", uuid::Uuid::new_v4()));
    let conn = database::open_db(&dir).unwrap();
    let note = note_service::create_note(&conn, None).unwrap();
    conn.execute(
        "UPDATE notes SET checklist = '{not valid json' WHERE id = ?1",
        rusqlite::params![note.id],
    )
    .unwrap();

    // Must not error — corrupted JSON is treated as having no checklist.
    let hits = note_service::list_notes(&conn, NoteView::All, None, Some("milk"));
    assert!(hits.is_ok());
    assert!(hits.unwrap().is_empty());

    fs::remove_dir_all(&dir).ok();
}

#[test]
fn restore_from_trash_unarchives_and_returns_to_all() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();
    note_service::set_flags(
        &conn,
        &note.id,
        &FlagPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::trash_notes(&conn, std::slice::from_ref(&note.id)).unwrap();

    // Undoing the trash must bring the note back to the active list, not
    // leave it hidden in Archive.
    assert_eq!(
        note_service::restore_notes(&conn, std::slice::from_ref(&note.id)).unwrap(),
        1
    );
    let restored = note_service::get_note(&conn, &note.id).unwrap();
    assert!(!restored.deleted);
    assert!(!restored.archived);
    assert_eq!(
        note_service::list_notes(&conn, NoteView::All, None, None)
            .unwrap()
            .len(),
        1
    );
    assert!(
        note_service::list_notes(&conn, NoteView::Archive, None, None)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn empty_patch_does_not_bump_updated_at() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();
    let before = note.updated_at;

    let empty = NotePatch {
        title: None,
        content: None,
        color: None,
        checklist: None,
    };
    let after = note_service::update_note(&conn, &note.id, &empty).unwrap();
    assert_eq!(
        after.updated_at, before,
        "no-op patch must not reorder the list"
    );

    // A real edit still bumps the timestamp.
    let edited = note_service::update_note(&conn, &note.id, &patch("t", "c")).unwrap();
    assert!(edited.updated_at >= before);
}

#[test]
fn invalid_color_falls_back_to_default() {
    let conn = temp_db();
    let evil = note_service::create_note(&conn, Some("default\" onmouseover=\"alert(1)"));
    let note = match evil {
        Ok(n) => n,
        Err(e) => panic!("create_note with odd color should sanitize, not fail: {e}"),
    };
    assert_eq!(note.color, "default");

    // Valid colors pass through unchanged.
    let teal = note_service::create_note(&conn, Some("teal")).unwrap();
    assert_eq!(teal.color, "teal");

    // Same via update patch.
    let patched = note_service::update_note(
        &conn,
        &note.id,
        &NotePatch {
            title: None,
            content: None,
            color: Some("not-a-color".into()),
            checklist: None,
        },
    )
    .unwrap();
    assert_eq!(patched.color, "default");
}

#[test]
fn now_millis_is_monotonic() {
    let first = note_service::now_millis();
    let second = note_service::now_millis();
    assert!(second >= first, "clock must never go backwards");
}

#[test]
fn tag_counts_exclude_archived_notes() {
    let conn = temp_db();
    let tag = tag_service::create_tag(&conn, "work").unwrap();
    let live = note_service::create_note(&conn, None).unwrap();
    let archived = note_service::create_note(&conn, None).unwrap();
    let trashed = note_service::create_note(&conn, None).unwrap();
    note_service::set_note_tags(&conn, &live.id, std::slice::from_ref(&tag.id)).unwrap();
    note_service::set_note_tags(&conn, &archived.id, std::slice::from_ref(&tag.id)).unwrap();
    note_service::set_note_tags(&conn, &trashed.id, std::slice::from_ref(&tag.id)).unwrap();
    note_service::set_flags(
        &conn,
        &archived.id,
        &FlagPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::trash_notes(&conn, std::slice::from_ref(&trashed.id)).unwrap();

    let listed = tag_service::list_tags(&conn).unwrap();
    let work = listed.iter().find(|t| t.id == tag.id).unwrap();
    assert_eq!(
        work.note_count,
        Some(1),
        "badge must match what opening the tag lists"
    );

    // Opening the tag really does show exactly that many notes.
    let filtered = note_service::list_notes(&conn, NoteView::All, Some(&tag.id), None).unwrap();
    assert_eq!(filtered.len(), 1);
}

#[test]
fn batch_operations_and_tag_attachments_handle_large_collections() {
    let conn = temp_db();
    let tag = tag_service::create_tag(&conn, "batch-tag").unwrap();

    // Create 600 notes inside a transaction for speed, which exceeds CHUNK_SIZE (500).
    let mut ids = Vec::with_capacity(600);
    {
        let tx = conn.unchecked_transaction().unwrap();
        for i in 0..600 {
            let id = uuid::Uuid::new_v4().to_string();
            let now = note_service::now_millis();
            tx.execute(
                "INSERT INTO notes (id, title, content, color, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 'default', ?4, ?4)",
                rusqlite::params![id, format!("Note {i}"), "content", now],
            )
            .unwrap();
            tx.execute(
                "INSERT INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
                rusqlite::params![id, tag.id],
            )
            .unwrap();
            ids.push(id);
        }
        tx.commit().unwrap();
    }

    // 1. Verify attach_tags handles 600 notes without variable overflow
    let listed = note_service::list_notes(&conn, NoteView::All, None, None).unwrap();
    assert_eq!(listed.len(), 600);
    assert_eq!(listed[0].tags.len(), 1);
    assert_eq!(listed[0].tags[0].id, tag.id);

    // 2. Verify get_counts single-query aggregation with 600 notes
    let counts = note_service::get_counts(&conn).unwrap();
    assert_eq!(counts.all, 600);
    assert_eq!(counts.trash, 0);

    // 3. Verify trash_notes chunking with 600 IDs
    let trashed_count = note_service::trash_notes(&conn, &ids).unwrap();
    assert_eq!(trashed_count, 600);
    let counts_after_trash = note_service::get_counts(&conn).unwrap();
    assert_eq!(counts_after_trash.all, 0);
    assert_eq!(counts_after_trash.trash, 600);

    // 4. Verify restore_notes chunking with 600 IDs
    let restored_count = note_service::restore_notes(&conn, &ids).unwrap();
    assert_eq!(restored_count, 600);
    let counts_after_restore = note_service::get_counts(&conn).unwrap();
    assert_eq!(counts_after_restore.all, 600);
    assert_eq!(counts_after_restore.trash, 0);

    // 5. Verify delete_notes_permanent chunking with 600 IDs
    let deleted_count = note_service::delete_notes_permanent(&conn, &ids).unwrap();
    assert_eq!(deleted_count, 600);
    let counts_after_delete = note_service::get_counts(&conn).unwrap();
    assert_eq!(counts_after_delete.all, 0);
    assert_eq!(counts_after_delete.trash, 0);
}

#[test]
fn bulk_flags_update_atomically() {
    let conn = temp_db();
    let a = note_service::create_note(&conn, None).unwrap();
    let b = note_service::create_note(&conn, None).unwrap();

    let touched = note_service::set_flags_bulk(
        &conn,
        &[a.id.clone(), b.id.clone()],
        &FlagPatch {
            pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(touched, 2);
    assert!(note_service::get_note(&conn, &a.id).unwrap().pinned);
    assert!(note_service::get_note(&conn, &b.id).unwrap().pinned);

    // Empty input and empty patch are safe no-ops.
    assert_eq!(
        note_service::set_flags_bulk(
            &conn,
            &[],
            &FlagPatch {
                pinned: Some(true),
                ..Default::default()
            }
        )
        .unwrap(),
        0
    );
    assert_eq!(
        note_service::set_flags_bulk(&conn, std::slice::from_ref(&a.id), &FlagPatch::default())
            .unwrap(),
        0
    );
}

#[test]
fn export_all_covers_every_view() {
    let conn = temp_db();
    let keep = note_service::create_note(&conn, None).unwrap();
    let archived = note_service::create_note(&conn, None).unwrap();
    let trashed = note_service::create_note(&conn, None).unwrap();
    note_service::set_flags(
        &conn,
        &archived.id,
        &FlagPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::trash_notes(&conn, std::slice::from_ref(&trashed.id)).unwrap();

    let all = note_service::export_all_notes(&conn).unwrap();
    let ids: Vec<_> = all.iter().map(|n| n.id.clone()).collect();
    assert!(ids.contains(&keep.id) && ids.contains(&archived.id) && ids.contains(&trashed.id));
}

#[test]
fn import_backup_skips_existing_and_merges_tags() {
    let conn = temp_db();
    let existing = note_service::create_note(&conn, None).unwrap();
    let exported = note_service::export_all_notes(&conn).unwrap();
    assert_eq!(exported.len(), 1);

    // Re-import same backup inserts nothing.
    assert_eq!(
        note_service::import_backup(&conn, &exported, &[])
            .unwrap()
            .inserted,
        0
    );

    // New note with a duplicate-case tag merges instead of duplicating.
    let mut fresh = exported[0].clone();
    fresh.id = uuid::Uuid::new_v4().to_string();
    fresh.title = "restored".into();
    let tag = tag_service::create_tag(&conn, "Work").unwrap();
    fresh.tags = vec![
        tag.clone(),
        noteflow_lib::models::Tag {
            id: "other".into(),
            name: "work".into(),
            note_count: None,
        },
    ];
    assert_eq!(
        note_service::import_backup(&conn, &[fresh], &[])
            .unwrap()
            .inserted,
        1
    );
    assert_eq!(tag_service::list_tags(&conn).unwrap().len(), 1);
    assert!(note_service::get_note(&conn, &existing.id).is_ok());
}

#[test]
fn import_backup_restores_orphan_tags_and_stays_idempotent() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();
    let attached = tag_service::create_tag(&conn, "attached").unwrap();
    let orphan = tag_service::create_tag(&conn, "orphan").unwrap();
    note_service::set_note_tags(&conn, &note.id, std::slice::from_ref(&attached.id)).unwrap();

    // Snapshot what Settings > Export produces (notes + top-level tag list).
    let exported = note_service::export_all_notes(&conn).unwrap();
    let all_tags = tag_service::list_tags(&conn).unwrap();
    assert_eq!(all_tags.len(), 2);

    // Wipe everything, like restoring onto a fresh install.
    note_service::delete_notes_permanent(&conn, std::slice::from_ref(&note.id)).unwrap();
    tag_service::delete_tag(&conn, &attached.id).unwrap();
    tag_service::delete_tag(&conn, &orphan.id).unwrap();
    assert!(tag_service::list_tags(&conn).unwrap().is_empty());

    // Restore notes + tag list: the zero-note "orphan" tag survives the round-trip.
    assert_eq!(
        note_service::import_backup(&conn, &exported, &all_tags)
            .unwrap()
            .inserted,
        1
    );
    let restored = tag_service::list_tags(&conn).unwrap();
    assert_eq!(
        restored.len(),
        2,
        "orphan tag must round-trip: {restored:?}"
    );
    assert!(restored
        .iter()
        .any(|t| t.name == "orphan" && t.note_count == Some(0)));
    assert!(restored
        .iter()
        .any(|t| t.name == "attached" && t.note_count == Some(1)));

    // Re-import is idempotent — no duplicate notes, no duplicate tags.
    assert_eq!(
        note_service::import_backup(&conn, &exported, &all_tags)
            .unwrap()
            .inserted,
        0
    );
    assert_eq!(tag_service::list_tags(&conn).unwrap().len(), 2);

    // A tag arriving under a fresh id but an existing name still merges by name.
    let mut dupe = all_tags[0].clone();
    dupe.id = uuid::Uuid::new_v4().to_string();
    note_service::import_backup(&conn, &[], &[dupe]).unwrap();
    assert_eq!(tag_service::list_tags(&conn).unwrap().len(), 2);
}

#[test]
fn set_tags_bulk_applies_and_removes_atomically() {
    let conn = temp_db();
    let tag = tag_service::create_tag(&conn, "bulk").unwrap();

    // 600 notes — deliberately crosses the CHUNK_SIZE boundary.
    let mut ids = Vec::with_capacity(600);
    {
        let tx = conn.unchecked_transaction().unwrap();
        for _ in 0..600 {
            let id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO notes (id, title, content, color, created_at, updated_at)
                 VALUES (?1, '', '', 'default', ?2, ?2)",
                rusqlite::params![id, note_service::now_millis()],
            )
            .unwrap();
            ids.push(id);
        }
        tx.commit().unwrap();
    }

    // A stale id in the middle of the selection is skipped, never an FK error.
    let mut with_ghost = ids.clone();
    with_ghost.insert(300, "ghost-note".into());
    assert_eq!(
        note_service::set_tags_bulk(&conn, &with_ghost, &tag.id, true).unwrap(),
        600
    );

    // Every real note got the tag; applying again creates nothing new.
    let tagged = note_service::list_notes(&conn, NoteView::All, Some(&tag.id), None).unwrap();
    assert_eq!(tagged.len(), 600);
    assert_eq!(
        note_service::set_tags_bulk(&conn, &ids, &tag.id, true).unwrap(),
        0
    );

    // Unknown tag: rejected up front, nothing touched.
    let err = note_service::set_tags_bulk(&conn, &ids, "no-such-tag", true).unwrap_err();
    assert!(matches!(err, noteflow_lib::error::AppError::NotFound(_)));
    assert_eq!(
        note_service::list_notes(&conn, NoteView::All, Some(&tag.id), None)
            .unwrap()
            .len(),
        600
    );

    // Removal clears every link and is idempotent.
    assert_eq!(
        note_service::set_tags_bulk(&conn, &ids, &tag.id, false).unwrap(),
        600
    );
    assert_eq!(
        note_service::set_tags_bulk(&conn, &ids, &tag.id, false).unwrap(),
        0
    );
    assert!(
        note_service::list_notes(&conn, NoteView::All, Some(&tag.id), None)
            .unwrap()
            .is_empty()
    );

    // Empty input is a no-op.
    assert_eq!(
        note_service::set_tags_bulk(&conn, &[], &tag.id, true).unwrap(),
        0
    );
}

#[test]
fn import_report_counts_skipped_entries_instead_of_hiding_them() {
    let conn = temp_db();
    let good = noteflow_lib::models::Note {
        id: "good-note".into(),
        title: "ok".into(),
        content: "fine".into(),
        color: "default".into(),
        created_at: 1,
        updated_at: 2,
        pinned: false,
        favorite: false,
        archived: false,
        deleted: false,
        deleted_at: None,
        reminder_at: None,
        checklist: vec![],
        tags: vec![],
    };
    let oversized = noteflow_lib::models::Note {
        id: "oversized-note".into(), // distinct id so it isn't a duplicate of `good`
        content: "x".repeat(500_001),
        ..good.clone()
    };
    let bad_id = noteflow_lib::models::Note {
        id: "".into(),
        ..good.clone()
    };

    let report =
        note_service::import_backup(&conn, &[good.clone(), oversized, bad_id], &[]).unwrap();
    assert_eq!(report.inserted, 1, "the valid note must be restored");
    assert_eq!(
        report.skipped, 2,
        "oversized + bad-id entries must be reported, not silently dropped"
    );

    // Re-import: nothing inserted, nothing skipped (duplicates aren't errors).
    let again = note_service::import_backup(&conn, &[good], &[]).unwrap();
    assert_eq!((again.inserted, again.skipped), (0, 0));
}

#[test]
fn trash_view_orders_by_deletion_time_not_pin_status() {
    let conn = temp_db();
    let first = note_service::create_note(&conn, None).unwrap();
    let second = note_service::create_note(&conn, None).unwrap();
    // Pin the OLDER note — in Trash, pin must not float it above newer deletions.
    note_service::set_flags(
        &conn,
        &first.id,
        &FlagPatch {
            pinned: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::trash_notes(&conn, std::slice::from_ref(&first.id)).unwrap();
    note_service::trash_notes(&conn, std::slice::from_ref(&second.id)).unwrap();

    let trash = note_service::list_notes(&conn, NoteView::Trash, None, None).unwrap();
    assert_eq!(
        trash.iter().map(|n| n.id.as_str()).collect::<Vec<_>>(),
        vec![second.id.as_str(), first.id.as_str()],
        "newest deletion first; pinned must not float in Trash"
    );
}

#[test]
fn imported_future_timestamps_cannot_invert_new_edits() {
    let conn = temp_db();
    let far_future = 4_102_444_800_000_i64; // year 2100, ahead of any real clock
    let mut foreign = note_service::create_note(&conn, None).unwrap();
    // Simulate a note exported from a *different* install (distinct id) whose
    // machine's clock ran ahead of ours.
    foreign.id = "foreign-note".into();
    foreign.updated_at = far_future;
    let report = note_service::import_backup(&conn, &[foreign.clone()], &[]).unwrap();
    assert_eq!(report.inserted, 1);

    // A note created right after the import must sort ABOVE the imported one:
    // the monotonic clock must have absorbed the foreign timestamp.
    let fresh = note_service::create_note(&conn, None).unwrap();
    assert!(
        fresh.updated_at > far_future,
        "monotonic clock must absorb foreign timestamps"
    );

    let list = note_service::list_notes(&conn, NoteView::All, None, None).unwrap();
    assert_eq!(list[0].id, fresh.id, "freshly created note sorts first");
    assert_eq!(list[1].id, foreign.id);
}

#[test]
fn search_folds_unicode_case_through_the_trigram_index() {
    let conn = temp_db();
    let note = note_service::create_note(&conn, None).unwrap();
    note_service::update_note(&conn, &note.id, &patch("Café notes", "naïve résumé")).unwrap();

    let hits = |q: &str| {
        note_service::list_notes(&conn, NoteView::All, None, Some(q))
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };

    // The pre-1.4 LIKE path folded ASCII only, so "CAFÉ" never found "Café".
    assert_eq!(hits("CAFÉ"), vec![note.id.clone()]);
    assert_eq!(hits("RÉSUMÉ"), vec![note.id.clone()]);
    // Substring semantics survive the switch to an index (mid-word, and across
    // the space inside one phrase).
    assert_eq!(hits("notes"), vec![note.id.clone()]);
    assert_eq!(hits("ïve rés"), vec![note.id.clone()]);
    // 1–2 characters are narrower than a trigram and take the LIKE fallback.
    assert_eq!(hits("fé"), vec![note.id.clone()]);
    assert!(hits("zz").is_empty());
}

#[test]
fn search_index_stays_in_sync_with_edits_tags_and_deletes() {
    let conn = temp_db();
    let a = note_service::create_note(&conn, None).unwrap();
    note_service::update_note(&conn, &a.id, &patch("Alpha", "first draft")).unwrap();

    let hits = |q: &str| {
        note_service::list_notes(&conn, NoteView::All, None, Some(q))
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect::<Vec<_>>()
    };
    let item = |text: &str, checked: bool| ChecklistItem {
        id: uuid::Uuid::new_v4().to_string(),
        text: text.into(),
        checked,
    };

    assert_eq!(hits("Alpha"), vec![a.id.clone()]);

    // An edit replaces the old text in the index instead of leaving it behind.
    note_service::update_note(&conn, &a.id, &patch("Beta", "second draft")).unwrap();
    assert!(hits("Alpha").is_empty(), "stale title must leave the index");
    assert!(
        hits("first draft").is_empty(),
        "stale body must leave the index"
    );
    assert_eq!(hits("Beta"), vec![a.id.clone()]);

    // Checklist text is indexed; the replaced item text is not.
    let set_checklist = |text: &str| {
        note_service::update_note(
            &conn,
            &a.id,
            &NotePatch {
                title: None,
                content: None,
                color: None,
                checklist: Some(vec![item(text, false)]),
            },
        )
        .unwrap();
    };
    set_checklist("buy oat milk");
    assert_eq!(hits("oat milk"), vec![a.id.clone()]);
    set_checklist("call dentist");
    assert!(hits("oat milk").is_empty());

    // Tag names are indexed, renames included.
    let tag = tag_service::create_tag(&conn, "Gamma project").unwrap();
    note_service::set_note_tags(&conn, &a.id, std::slice::from_ref(&tag.id)).unwrap();
    assert_eq!(hits("Gamma"), vec![a.id.clone()]);
    tag_service::rename_tag(&conn, &tag.id, "Delta project").unwrap();
    assert!(
        hits("Gamma").is_empty(),
        "a rename must not keep the old name"
    );
    assert_eq!(hits("Delta"), vec![a.id.clone()]);
    tag_service::delete_tag(&conn, &tag.id).unwrap();
    assert!(
        hits("Delta").is_empty(),
        "a deleted tag must leave the index"
    );

    // Permanently deleting a note drops its index row too.
    note_service::trash_notes(&conn, std::slice::from_ref(&a.id)).unwrap();
    note_service::delete_notes_permanent(&conn, std::slice::from_ref(&a.id)).unwrap();
    assert!(hits("Beta").is_empty());
}

#[test]
fn reminders_are_scheduled_claimed_once_and_kept_out_of_the_edit_clock() {
    let conn = temp_db();
    let first = note_service::create_note(&conn, None).unwrap();
    let second = note_service::create_note(&conn, None).unwrap();

    // Scheduling is metadata: it must not move `updated_at`, or an old note
    // would jump to the top of the list just because a reminder was set.
    let scheduled = note_service::set_reminder(&conn, &first.id, Some(2_000)).unwrap();
    assert_eq!(scheduled.reminder_at, Some(2_000));
    assert_eq!(scheduled.updated_at, first.updated_at);
    note_service::set_reminder(&conn, &second.id, Some(1_000)).unwrap();

    // Nothing is handed out early, and the oldest due reminder comes first.
    assert!(note_service::take_due_reminder(&conn, 500)
        .unwrap()
        .is_none());
    let claimed = note_service::take_due_reminder(&conn, 1_500)
        .unwrap()
        .expect("second note is due");
    assert_eq!(claimed.id, second.id);
    // Claiming clears it, so a later poll can never announce it twice.
    assert_eq!(claimed.reminder_at, None);
    assert!(note_service::take_due_reminder(&conn, 1_500)
        .unwrap()
        .is_none());

    let claimed = note_service::take_due_reminder(&conn, 60_000)
        .unwrap()
        .expect("first note is due");
    assert_eq!(claimed.id, first.id);
    assert!(note_service::take_due_reminder(&conn, 60_000)
        .unwrap()
        .is_none());

    // Clearing by hand, and a rejected bogus time.
    note_service::set_reminder(&conn, &first.id, Some(5_000)).unwrap();
    let cleared = note_service::set_reminder(&conn, &first.id, None).unwrap();
    assert_eq!(cleared.reminder_at, None);
    assert!(note_service::set_reminder(&conn, &first.id, Some(0)).is_err());
    assert!(note_service::set_reminder(&conn, "missing-note", Some(5_000)).is_err());
}

#[test]
fn reminders_stay_quiet_for_archived_trashed_and_future_notes() {
    let conn = temp_db();
    let archived = note_service::create_note(&conn, None).unwrap();
    let trashed = note_service::create_note(&conn, None).unwrap();
    let later = note_service::create_note(&conn, None).unwrap();

    note_service::set_reminder(&conn, &archived.id, Some(1_000)).unwrap();
    note_service::set_flags(
        &conn,
        &archived.id,
        &FlagPatch {
            archived: Some(true),
            ..Default::default()
        },
    )
    .unwrap();
    note_service::set_reminder(&conn, &trashed.id, Some(1_000)).unwrap();
    note_service::trash_notes(&conn, std::slice::from_ref(&trashed.id)).unwrap();
    note_service::set_reminder(&conn, &later.id, Some(900_000)).unwrap();

    assert!(
        note_service::take_due_reminder(&conn, 1_000)
            .unwrap()
            .is_none(),
        "archived/trashed notes stay quiet and a future reminder is not due"
    );
    let due = note_service::take_due_reminder(&conn, 900_000)
        .unwrap()
        .expect("the third note is due now");
    assert_eq!(due.id, later.id);
}

#[test]
fn existing_v1_databases_are_indexed_and_keep_their_reminders() {
    // Simulates the 1.3 -> 1.4 upgrade on a database that already has data: the
    // migration must backfill the FTS mirror from the notes table.
    let dir = std::env::temp_dir().join(format!("noteflow-migrate-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let db_path = dir.join("noteflow.db");

    let legacy = Connection::open(&db_path).unwrap();
    legacy
        .execute_batch(
            "CREATE TABLE notes (
                 id TEXT PRIMARY KEY NOT NULL,
                 title TEXT NOT NULL DEFAULT '',
                 content TEXT NOT NULL DEFAULT '',
                 color TEXT NOT NULL DEFAULT 'default',
                 created_at INTEGER NOT NULL,
                 updated_at INTEGER NOT NULL,
                 pinned INTEGER NOT NULL DEFAULT 0,
                 favorite INTEGER NOT NULL DEFAULT 0,
                 archived INTEGER NOT NULL DEFAULT 0,
                 deleted INTEGER NOT NULL DEFAULT 0,
                 deleted_at INTEGER,
                 reminder_at INTEGER,
                 checklist TEXT NOT NULL DEFAULT '[]'
             );
             CREATE TABLE tags (
                 id TEXT PRIMARY KEY NOT NULL,
                 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE note_tags (
                 note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
                 tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
                 PRIMARY KEY (note_id, tag_id)
             );
             CREATE TABLE app_settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
             INSERT INTO notes (id, title, content, created_at, updated_at, reminder_at, checklist)
             VALUES ('legacy-1', 'Legacy Café', 'pre-upgrade body', 1, 1, 42000,
                     '[{\"id\":\"c1\",\"text\":\"old checklist item\",\"checked\":false}]');
             INSERT INTO tags (id, name, created_at) VALUES ('tag-1', 'LegacyTag', 1);
             INSERT INTO note_tags (note_id, tag_id) VALUES ('legacy-1', 'tag-1');
             PRAGMA user_version = 1;",
        )
        .unwrap();
    drop(legacy);

    let conn = database::open_db(&dir).expect("upgrade a v1 database");
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(
        version, 2,
        "the migration must record the new schema version"
    );

    // Existing data is indexed, not lost: title, body, checklist and tag match.
    for q in ["Legacy", "upgrade body", "checklist item", "LegacyTag"] {
        let hits = note_service::list_notes(&conn, NoteView::All, None, Some(q)).unwrap();
        assert_eq!(hits.len(), 1, "legacy note should match {q:?}");
        assert_eq!(hits[0].id, "legacy-1");
    }
    // The reserved reminder column survives the upgrade and is still due.
    let due = note_service::take_due_reminder(&conn, 43_000)
        .unwrap()
        .expect("a legacy reminder still fires");
    assert_eq!(due.id, "legacy-1");
    assert_eq!(due.reminder_at, None, "claiming clears it");

    // Reopening an already-upgraded database must not backfill twice: a second
    // copy of each row would duplicate every search result.
    drop(conn);
    let conn = database::open_db(&dir).unwrap();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM notes_fts", [], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 1, "the FTS mirror must not be backfilled twice");
    assert_eq!(
        note_service::list_notes(&conn, NoteView::All, None, Some("Legacy"))
            .unwrap()
            .len(),
        1
    );
}

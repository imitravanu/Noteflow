use serde::{Deserialize, Serialize};

use super::Tag;

/// A single checkbox item inside a note.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub checked: bool,
}

/// The complete note model returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub pinned: bool,
    pub favorite: bool,
    pub archived: bool,
    pub deleted: bool,
    pub deleted_at: Option<i64>,
    /// Reserved for a future reminder feature; stored now so data stays forward-compatible.
    pub reminder_at: Option<i64>,
    pub checklist: Vec<ChecklistItem>,
    pub tags: Vec<Tag>,
}

/// Partial update payload used by the autosave editor flush.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotePatch {
    pub title: Option<String>,
    pub content: Option<String>,
    pub color: Option<String>,
    pub checklist: Option<Vec<ChecklistItem>>,
}

/// Sidebar views the note list can be filtered by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NoteView {
    All,
    Pinned,
    Favorites,
    Archive,
    Trash,
}

/// Flag updates; `None` leaves the flag untouched.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagPatch {
    pub pinned: Option<bool>,
    pub favorite: Option<bool>,
    pub archived: Option<bool>,
}


use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};

const ALLOWED_KEYS: [&str; 1] = ["theme"];
const MAX_VALUE_LEN: usize = 256;

fn validate_setting(key: &str, value: Option<&str>) -> AppResult<()> {
    if !ALLOWED_KEYS.contains(&key) {
        return Err(AppError::Invalid("Unknown setting.".into()));
    }
    if let Some(v) = value {
        if v.chars().count() > MAX_VALUE_LEN {
            return Err(AppError::Invalid("Setting value is too long.".into()));
        }
        if key == "theme" && !matches!(v, "light" | "dark" | "system") {
            return Err(AppError::Invalid("Unknown theme.".into()));
        }
    }
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    let value = conn
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params![key],
            |r| r.get(0),
        )
        .optional()?;
    Ok(value)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    validate_setting(key, Some(value))?;
    conn.execute(
        "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

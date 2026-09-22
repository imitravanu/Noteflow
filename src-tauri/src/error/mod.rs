use serde::Serialize;

/// Application-wide error type. Command results serialize to short,
/// user-facing messages so technical internals never leak to the UI layer.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(rusqlite::Error),

    #[error("io error: {0}")]
    Io(std::io::Error),

    #[error("{0}")]
    NotFound(String),

    #[error("{0}")]
    Invalid(String),

    #[error("{0}")]
    Internal(String),
}

pub type AppResult<T> = Result<T, AppError>;

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let message = match self {
            AppError::NotFound(m) | AppError::Invalid(m) => m.clone(),
            AppError::Database(_) => {
                "A local storage problem occurred. Your notes are safe, but the last action could not be completed.".to_string()
            }
            AppError::Io(_) => {
                "The notes database could not be reached on disk. Check available disk space and try again.".to_string()
            }
            AppError::Internal(m) => m.clone(),
        };
        serializer.serialize_str(&message)
    }
}

// Manual `From` impls (instead of `#[from]`) so the technical detail is
// logged before the UI-facing message is collapsed to the friendly generic
// strings above — without this, field failures are undiagnosable.
impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        log::error!("sqlite error: {e}");
        AppError::Database(e)
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        log::error!("io error: {e}");
        AppError::Io(e)
    }
}

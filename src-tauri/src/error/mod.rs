use serde::Serialize;

/// Application-wide error type. Command results serialize to short,
/// user-facing messages so technical internals never leak to the UI layer.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

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

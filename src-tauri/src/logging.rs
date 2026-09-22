//! Appends backend diagnostics to `noteflow.log` next to the database.
//!
//! `AppError` deliberately shows the UI short, friendly messages (see
//! `error/mod.rs`), so this file is the only place the underlying technical
//! detail lands — without it a failure in the field would be undiagnosable.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use log::{Level, LevelFilter, Log, Metadata, Record};

/// Rotate the active log into `noteflow.log.1` once it passes 1 MiB so the
/// file can never grow without bound.
const MAX_LOG_BYTES: u64 = 1_048_576;

struct FileLogger {
    path: PathBuf,
    file: Mutex<std::fs::File>,
}

impl FileLogger {
    fn open(path: PathBuf) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(&path)?;
        Ok(Self {
            path,
            file: Mutex::new(file),
        })
    }

    fn write_line(&self, line: &str) {
        let mut file = match self.file.lock() {
            Ok(f) => f,
            Err(_) => return, // poisoned by a panicking writer — drop the line
        };
        let oversized = file
            .metadata()
            .map(|m| m.len() >= MAX_LOG_BYTES)
            .unwrap_or(false);
        if oversized {
            let _ = std::fs::rename(&self.path, self.path.with_extension("log.1"));
            match OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
            {
                Ok(f) => *file = f,
                Err(_) => return,
            }
        }
        let _ = file.write_all(line.as_bytes());
    }
}

impl Log for FileLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let level = match record.level() {
            Level::Error => "ERROR",
            Level::Warn => "WARN",
            Level::Info => "INFO",
            Level::Debug => "DEBUG",
            Level::Trace => "TRACE",
        };
        self.write_line(&format!(
            "[{millis}] [{level}] {}: {}\n",
            record.target(),
            record.args()
        ));
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

/// Installs the file logger at `data_dir/noteflow.log`. Best-effort: a
/// failure to open the log must never prevent the app from starting.
pub fn init(data_dir: &Path) {
    let path = data_dir.join("noteflow.log");
    match FileLogger::open(path) {
        Ok(logger) => {
            if log::set_boxed_logger(Box::new(logger)).is_ok() {
                log::set_max_level(if cfg!(debug_assertions) {
                    LevelFilter::Debug
                } else {
                    LevelFilter::Info
                });
                log::info!("noteflow logging started");
            }
        }
        Err(e) => eprintln!("noteflow: could not open log file: {e}"),
    }
}

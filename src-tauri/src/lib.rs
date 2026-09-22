pub mod commands;
pub mod database;
pub mod error;
mod logging;
pub mod models;
pub mod services;

use tauri::Manager;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("Could not resolve the app data directory: {e}"))?;
            logging::init(&data_dir);
            let conn = database::open_db(&data_dir).map_err(|e| {
                log::error!("failed to open the notes database: {e}");
                format!("Could not open the notes database: {e}")
            })?;
            app.manage(AppState {
                conn: std::sync::Mutex::new(conn),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::notes::list_notes,
            commands::notes::create_note,
            commands::notes::get_note,
            commands::notes::update_note,
            commands::notes::set_flags,
            commands::notes::set_flags_bulk,
            commands::notes::export_all_notes,
            commands::notes::import_backup,
            commands::notes::trash_notes,
            commands::notes::restore_notes,
            commands::notes::delete_notes_permanent,
            commands::notes::empty_trash,
            commands::notes::set_note_tags,
            commands::notes::set_tags_bulk,
            commands::notes::get_counts,
            commands::tags::list_tags,
            commands::tags::create_tag,
            commands::tags::rename_tag,
            commands::tags::delete_tag,
            commands::settings::get_setting,
            commands::settings::set_setting,
            commands::settings::get_data_dir,
            commands::files::save_text_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running NoteFlow");
}

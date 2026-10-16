mod auth;
mod claude;
mod startup;

use std::sync::Arc;
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(auth::SpotifyAuth::new()))
        .manage(claude::ClaudeClient::new())
        .invoke_handler(tauri::generate_handler![
            auth::spotify_configure,
            auth::spotify_auth_status,
            auth::spotify_start_login,
            auth::spotify_cancel_login,
            auth::spotify_logout,
            auth::spotify_get_valid_access_token,
            auth::spotify_get_profile,
            auth::spotify_probe_rate_limit,
            auth::open_external_url,
            claude::claude_status,
            claude::claude_configure,
            claude::claude_remove_key,
            claude::claude_recommend,
            claude::claude_plan_daily_mixes,
            claude::claude_similar_tracks,
            startup::startup_is_enabled,
            startup::startup_set_enabled,
        ])
        .setup(|app| {
            let level = if cfg!(debug_assertions) {
                log::LevelFilter::Info
            } else {
                log::LevelFilter::Error
            };
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .clear_targets()
                    .target(Target::new(TargetKind::LogDir {
                        file_name: Some("Queuer".to_owned()),
                    }))
                    .level(level)
                    .max_file_size(200_000)
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod auth;

use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(auth::SpotifyAuth::new()))
        .invoke_handler(tauri::generate_handler![
            auth::spotify_configure,
            auth::spotify_auth_status,
            auth::spotify_start_login,
            auth::spotify_cancel_login,
            auth::spotify_logout,
            auth::spotify_get_valid_access_token,
            auth::spotify_get_profile,
            auth::open_external_url,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

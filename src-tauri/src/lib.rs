//! VYRE 0.1.0: diagnostic-only implementation.
//! No system configuration changes or optimized ping claims occur here.
mod db;
mod games;
mod probe;

use db::{AppState, HistoryPoint, Settings};
use games::Game;
use probe::Probe;
use serde::Serialize;
use std::{sync::Mutex, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Manager, State};

#[derive(Serialize)]
struct Sample {
    id: i64,
    timestamp: i64,
    internet: Probe,
    game: Option<Probe>,
}

#[tauri::command]
fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    db::load_settings(&state)
}

#[tauri::command]
fn save_settings(settings: Settings, state: State<'_, AppState>) -> Result<Settings, String> {
    db::save_settings(&state, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn detect_games(state: State<'_, AppState>) -> Result<Vec<Game>, String> {
    if !db::load_settings(&state)?.auto_detect {
        return Ok(Vec::new());
    }
    Ok(games::detect())
}

#[tauri::command]
fn get_history(state: State<'_, AppState>) -> Result<Vec<HistoryPoint>, String> {
    db::load_history(&state)
}

#[tauri::command]
fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    db::clear_history(&state)
}

#[tauri::command]
async fn sample_network(state: State<'_, AppState>) -> Result<Sample, String> {
    // Never hold the database lock while a child process is running.
    let settings = db::load_settings(&state)?;
    let internet = probe::ping(&settings.internet_target).await;
    let game = if settings.game_target.is_empty() {
        None
    } else {
        Some(probe::ping(&settings.game_target).await)
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let id = db::store_sample(&state, timestamp, &internet, game.as_ref())?;
    Ok(Sample { id, timestamp, internet, game })
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            std::fs::create_dir_all(&root)?;
            let connection = db::open(&root.join("vyre.sqlite3"))?;
            app.manage(AppState { connection: Mutex::new(connection) });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings, save_settings, detect_games,
            get_history, clear_history, sample_network
        ])
        .run(tauri::generate_context!())
        .expect("VYRE failed to initialize");
}

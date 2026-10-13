use crate::probe::{valid_host, Probe};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Mutex};

pub struct AppState {
    pub connection: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub internet_target: String,
    pub game_target: String,
    pub interval_seconds: u32,
    pub auto_detect: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            internet_target: "1.1.1.1".into(),
            game_target: String::new(),
            interval_seconds: 5,
            auto_detect: true,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct HistoryPoint {
    id: i64,
    timestamp: i64,
    internet_ms: Option<f64>,
    game_ms: Option<f64>,
    internet_status: String,
    game_status: Option<String>,
}

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.busy_timeout(std::time::Duration::from_secs(3))?;
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         CREATE TABLE IF NOT EXISTS settings (
           id INTEGER PRIMARY KEY CHECK (id = 1),
           data TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS measurements (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           timestamp INTEGER NOT NULL,
           internet_ms REAL,
           game_ms REAL,
           internet_status TEXT NOT NULL,
           game_status TEXT
         );
         CREATE INDEX IF NOT EXISTS idx_measurements_timestamp ON measurements(timestamp);
         PRAGMA user_version = 1;"
    )?;
    Ok(conn)
}

pub fn load_settings(state: &AppState) -> Result<Settings, String> {
    let conn = state.connection.lock().map_err(|e| e.to_string())?;
    let data: Result<String, rusqlite::Error> =
        conn.query_row("SELECT data FROM settings WHERE id = 1", [], |r| r.get(0));
    match data {
        Ok(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(Settings::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save_settings(state: &AppState, settings: &Settings) -> Result<(), String> {
    if !valid_host(&settings.internet_target) {
        return Err("Internet reference must be a hostname or IP address, without URL or port.".into());
    }
    if !settings.game_target.is_empty() && !valid_host(&settings.game_target) {
        return Err("Game target must be a hostname or IP address, without URL or port.".into());
    }
    if ![3, 5, 10, 30].contains(&settings.interval_seconds) {
        return Err("Unsupported sample interval.".into());
    }
    let data = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    let conn = state.connection.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO settings(id, data) VALUES(1, ?1)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        params![data],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn store_sample(state: &AppState, timestamp: i64, internet: &Probe, game: Option<&Probe>) -> Result<i64, String> {
    let conn = state.connection.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO measurements(timestamp, internet_ms, game_ms, internet_status, game_status)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![timestamp, internet.latency_ms, game.and_then(|g| g.latency_ms),
            internet.status, game.map(|g| &g.status)],
    ).map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    // Keep at most 2,000 records to prevent unlimited background storage use.
    conn.execute(
        "DELETE FROM measurements WHERE id NOT IN
         (SELECT id FROM measurements ORDER BY id DESC LIMIT 2000)", [],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn load_history(state: &AppState) -> Result<Vec<HistoryPoint>, String> {
    let conn = state.connection.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT id, timestamp, internet_ms, game_ms, internet_status, game_status
         FROM (SELECT * FROM measurements ORDER BY id DESC LIMIT 200)
         ORDER BY id ASC"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |r| Ok(HistoryPoint {
        id: r.get(0)?, timestamp: r.get(1)?, internet_ms: r.get(2)?,
        game_ms: r.get(3)?, internet_status: r.get(4)?, game_status: r.get(5)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

pub fn clear_history(state: &AppState) -> Result<(), String> {
    state.connection.lock().map_err(|e| e.to_string())?
        .execute("DELETE FROM measurements", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_explicit() {
        let s = Settings::default();
        assert_eq!(s.internet_target, "1.1.1.1");
        assert!(s.game_target.is_empty());
    }

    #[test]
    fn sqlite_round_trip_and_delete() {
        let state = AppState { connection: Mutex::new(open(Path::new(":memory:")).unwrap()) };
        let saved = Settings { game_target: "192.0.2.1".into(), ..Settings::default() };
        save_settings(&state, &saved).unwrap();
        assert_eq!(load_settings(&state).unwrap().game_target, "192.0.2.1");
        let ping = Probe { target: "1.1.1.1".into(), latency_ms: Some(12.0), status: "ok".into(), error: None };
        store_sample(&state, 1, &ping, None).unwrap();
        assert_eq!(load_history(&state).unwrap().len(), 1);
        clear_history(&state).unwrap();
        assert_eq!(load_history(&state).unwrap().len(), 0);
    }

    #[test]
    fn refuse_unsafe_target_and_invalid_interval() {
        let state = AppState { connection: Mutex::new(open(Path::new(":memory:")).unwrap()) };
        let invalid = Settings { internet_target: "-f".into(), ..Settings::default() };
        assert!(save_settings(&state, &invalid).is_err());
        let invalid = Settings { interval_seconds: 1, ..Settings::default() };
        assert!(save_settings(&state, &invalid).is_err());
    }
}

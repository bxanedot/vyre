use serde::Serialize;
use std::collections::HashSet;
use sysinfo::{ProcessesToUpdate, System};

#[derive(Debug, Serialize)]
pub struct Game {
    name: String,
    executable: String,
    pid: u32,
    foreground: bool,
}

// Exact executable matches reduce launcher, browser and anti-cheat false positives.
// This catalog can be extended with persisted user-defined profiles in Phase 2.
const CATALOG: &[(&str, &str)] = &[
    ("cs2.exe", "Counter-Strike 2"),
    ("valorant-win64-shipping.exe", "VALORANT"),
    ("r5apex.exe", "Apex Legends"),
    ("fortniteclient-win64-shipping.exe", "Fortnite"),
    ("rocketleague.exe", "Rocket League"),
    ("overwatch.exe", "Overwatch 2"),
    ("league of legends.exe", "League of Legends"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("eldenring.exe", "Elden Ring"),
    ("sekiro.exe", "Sekiro"),
    ("deadbydaylight-win64-shipping.exe", "Dead by Daylight"),
    ("dota2.exe", "Dota 2"),
    ("hl2.exe", "Source game"),
    ("rainbowsix.exe", "Rainbow Six Siege"),
    ("warframe.x64.exe", "Warframe"),
    ("genshinimpact.exe", "Genshin Impact"),
    ("minecraft.windows.exe", "Minecraft Bedrock"),
];

#[cfg(windows)]
fn foreground_pid() -> Option<u32> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let handle = GetForegroundWindow();
        if handle.is_null() { return None; }
        let mut pid = 0u32;
        GetWindowThreadProcessId(handle, &mut pid);
        if pid == 0 { None } else { Some(pid) }
    }
}

#[cfg(not(windows))]
fn foreground_pid() -> Option<u32> {
    None // No desktop-compositor independent foreground-process API on Linux.
}

pub fn detect() -> Vec<Game> {
    let current = foreground_pid();
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for (pid, process) in system.processes() {
        let executable = process.name().to_string_lossy().to_string();
        let normalized = executable.to_ascii_lowercase();
        if let Some((_, name)) = CATALOG.iter().find(|(exe, _)| *exe == normalized) {
            let pid_number = pid.as_u32();
            if seen.insert(pid_number) {
                games.push(Game { name: name.to_string(), executable, pid: pid_number, foreground: current == Some(pid_number) });
            }
        }
    }
    games.sort_by(|a, b| b.foreground.cmp(&a.foreground).then_with(|| a.name.cmp(&b.name)));
    games
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn avoid_launcher_false_positives() {
        assert!(CATALOG.iter().all(|(name, _)| !["steam.exe","epicgameslauncher.exe","chrome.exe","riotclientservices.exe"].contains(name)));
    }
}

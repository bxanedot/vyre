export type View = "home" | "games" | "network" | "optimizer" | "history" | "settings";
export type Settings = {
  internet_target: string;
  game_target: string;
  interval_seconds: number;
  auto_detect: boolean;
};
export type Probe = {
  target: string;
  latency_ms: number | null;
  status: "ok" | "timeout" | "unavailable";
  error: string | null;
};
export type Sample = { id: number; timestamp: number; internet: Probe; game: Probe | null };
export type HistoryPoint = { id: number; timestamp: number; internet_ms: number | null; game_ms: number | null; internet_status: string; game_status: string | null };
export type Game = { name: string; executable: string; pid: number; foreground: boolean };

export const NEW_GAME_RADAR_SEEN_KEY = "tapmakerwork.tools.newGameRadar.seen";

export function readNewGameRadarSeen(): boolean {
  try {
    return localStorage.getItem(NEW_GAME_RADAR_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markNewGameRadarSeen(): void {
  try {
    localStorage.setItem(NEW_GAME_RADAR_SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

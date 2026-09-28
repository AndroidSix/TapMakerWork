import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function privateBrowserOpenScript(platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return `@echo off
setlocal EnableDelayedExpansion
set "url="
for %%A in (%*) do (
  echo %%A | findstr /i /b "http" >nul && set "url=%%~A"
)
if not defined url (
  "%SystemRoot%\\System32\\cmd.exe" %*
  exit /b %ERRORLEVEL%
)
if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (
  start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --incognito --new-window "%url%"
  exit /b 0
)
if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (
  start "" "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" --inprivate --new-window "%url%"
  exit /b 0
)
echo tapmakerwork-private-browser: fallback 1>&2
start "" "%url%"
exit /b 0
`;
  }
  const opener = platform === "darwin" ? "/usr/bin/open" : "xdg-open";
  const apps = platform === "darwin"
    ? [
      ["Google Chrome", "--incognito --new-window"],
      ["Microsoft Edge", "--inprivate --new-window"],
      ["Brave Browser", "--incognito --new-window"],
      ["Chromium", "--incognito --new-window"],
      ["Firefox", "--private-window"]
    ]
    : [];
  const tries = apps.map(([name, flags]) => `if [ -d "/Applications/${name}.app" ] || [ -d "$HOME/Applications/${name}.app" ]; then
  /usr/bin/open -na "${name}" --args ${flags} "$url"
  echo "tapmakerwork-private-browser: ${name}" >&2
  exit 0
fi`).join("\n");
  const linuxTries = platform === "linux" ? `if command -v google-chrome >/dev/null 2>&1; then
  google-chrome --incognito --new-window "$url" >/dev/null 2>&1 &
  echo "tapmakerwork-private-browser: Google Chrome" >&2
  exit 0
fi
if command -v chromium >/dev/null 2>&1; then
  chromium --incognito --new-window "$url" >/dev/null 2>&1 &
  echo "tapmakerwork-private-browser: Chromium" >&2
  exit 0
fi
if command -v firefox >/dev/null 2>&1; then
  firefox --private-window "$url" >/dev/null 2>&1 &
  echo "tapmakerwork-private-browser: Firefox" >&2
  exit 0
fi` : tries;
  return `#!/bin/sh
url=""
for arg in "$@"; do
  case "$arg" in
    https://*|http://*) url=$arg ;;
  esac
done
if [ -z "$url" ]; then
  exec ${opener} "$@"
fi
${linuxTries}
echo "tapmakerwork-private-browser: fallback" >&2
exec ${opener} "$url"
`;
}

export function createPrivateBrowserOverride(platform: NodeJS.Platform = process.platform): { pathDir: string; cleanup: () => void } {
  const pathDir = fs.mkdtempSync(path.join(os.tmpdir(), "tapmakerwork-browser-"));
  const fileName = platform === "win32" ? "cmd.bat" : platform === "darwin" ? "open" : "xdg-open";
  fs.writeFileSync(path.join(pathDir, fileName), privateBrowserOpenScript(platform), { mode: 0o755 });
  return {
    pathDir,
    cleanup: () => fs.rmSync(pathDir, { recursive: true, force: true })
  };
}

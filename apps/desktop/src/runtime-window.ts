export function scoreRuntimeWindow(name: string, projectName: string, executable = ""): number {
  const normalized = name.trim().toLocaleLowerCase();
  const project = projectName.trim().toLocaleLowerCase();
  const exe = executable.trim();
  let score = 0;
  if (/urhox|urho3d|taptap\s*maker|maker\s*preview|local\s*preview|game\s*runtime|游戏运行/i.test(name)) score += 240;
  if (project) {
    if (normalized === project) score += 10;
    else if (normalized.startsWith(`${project}:`) || normalized.startsWith(`${project}：`) || normalized.startsWith(`${project} - `)) score += 180;
    else if (normalized.includes(project)) score += 80;
  }
  if (/urhox|urho3d|taptap/i.test(exe)) score += 240;
  if (/^node(\.exe)?$/i.test(exe) && project && (normalized === project || normalized.startsWith(`${project}:`) || normalized.startsWith(`${project}：`) || normalized.startsWith(`${project} - `))) score += 160;
  if (/tapmakerwork|cursor|codex|visual studio code|vscode|terminal|finder|xcode/i.test(name)) score -= 500;
  if (/^(tapmakerwork|electron|cursor|code|code - insiders|devenv|powershell|pwsh|cmd|explorer|windowsterminal)(\.exe)?$/i.test(exe)) score -= 500;
  return score;
}

export function selectRuntimeWindow<T extends { name: string; executable?: string }>(sources: T[], projectName: string): T | undefined {
  const score = (source: T) => scoreRuntimeWindow(source.name, projectName, source.executable ?? "");
  const selected = [...sources].sort((left, right) => score(right) - score(left))[0];
  return selected && score(selected) >= 70 ? selected : undefined;
}

export function scoreRuntimeWindow(name: string, projectName: string): number {
  const normalized = name.trim().toLocaleLowerCase();
  const project = projectName.trim().toLocaleLowerCase();
  let score = 0;
  if (/urhox|taptap\s*maker|maker\s*preview|local\s*preview|game\s*runtime|游戏运行/i.test(name)) score += 240;
  if (project) {
    if (normalized === project) score += 10;
    else if (normalized.startsWith(`${project}:`) || normalized.startsWith(`${project}：`) || normalized.startsWith(`${project} - `)) score += 180;
    else if (normalized.includes(project)) score += 80;
  }
  if (/tapmakerwork|cursor|codex|visual studio code|vscode|terminal|finder|xcode/i.test(name)) score -= 500;
  return score;
}

export function selectRuntimeWindow<T extends { name: string }>(sources: T[], projectName: string): T | undefined {
  const selected = [...sources].sort((left, right) => scoreRuntimeWindow(right.name, projectName) - scoreRuntimeWindow(left.name, projectName))[0];
  return selected && scoreRuntimeWindow(selected.name, projectName) >= 70 ? selected : undefined;
}

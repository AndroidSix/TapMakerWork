export interface RuntimeWindowScoreOptions {
  /** Captured thumbnail / window width when known. */
  width?: number;
  /** Captured thumbnail / window height when known. */
  height?: number;
  /** Expected stage aspect (width/height), e.g. 720/1280 for portrait Maker games. */
  targetAspect?: number;
}

function looksLikeEditorTitle(name: string): boolean {
  return /(?:^|[\s—–\-|:：])(?:cursor|visual studio code|vscode|code - insiders|tapmakerwork|terminal|iterm|warp|xcode)(?:$|[\s—–\-|])/i.test(name)
    || /\.(tsx?|jsx?|lua|json|md|css|html|vue|py|cs|cpp|h|mm?)\b/i.test(name)
    || /(?:—|–|\s-\s).+/.test(name) && !/urhox|maker\s*preview|local\s*preview/i.test(name);
}

function aspectBonus(width: number | undefined, height: number | undefined, targetAspect: number | undefined): number {
  if (!width || !height || !targetAspect || !(targetAspect > 0)) return 0;
  const aspect = width / Math.max(1, height);
  const delta = Math.abs(Math.log(aspect / targetAspect));
  if (delta < 0.08) return 120;
  if (delta < 0.18) return 60;
  if (delta < 0.35) return 20;
  // Strongly wrong orientation (e.g. wide IDE vs portrait game).
  if (delta > 0.7) return -180;
  return -40;
}

export function scoreRuntimeWindow(
  name: string,
  projectName: string,
  executable = "",
  options: RuntimeWindowScoreOptions = {}
): number {
  const normalized = name.trim().toLocaleLowerCase();
  const project = projectName.trim().toLocaleLowerCase();
  const exe = executable.trim();
  let score = 0;
  if (/urhox|urho3d|taptap\s*maker|maker\s*preview|local\s*preview|game\s*runtime|游戏运行/i.test(name)) score += 240;
  if (project) {
    if (normalized === project) {
      // Maker local preview windows are commonly titled with the bare project name.
      score += 140;
    } else if (normalized.startsWith(`${project}:`) || normalized.startsWith(`${project}：`) || normalized.startsWith(`${project} - `)) {
      score += 180;
    } else if (normalized.includes(project)) {
      score += 80;
    }
  }
  if (/urhox|urho3d|taptap/i.test(exe)) score += 240;
  if (/^node(\.exe)?$/i.test(exe) && project && (normalized === project || normalized.startsWith(`${project}:`) || normalized.startsWith(`${project}：`) || normalized.startsWith(`${project} - `))) {
    score += 160;
  }
  if (/tapmakerwork|cursor|codex|visual studio code|vscode|terminal|finder|xcode/i.test(name)) score -= 500;
  if (/^(tapmakerwork|electron|cursor|code|code - insiders|devenv|powershell|pwsh|cmd|explorer|windowsterminal)(\.exe)?$/i.test(exe)) score -= 500;
  if (looksLikeEditorTitle(name)) score -= 260;
  score += aspectBonus(options.width, options.height, options.targetAspect);
  return score;
}

export function selectRuntimeWindow<T extends {
  name: string;
  executable?: string;
  width?: number;
  height?: number;
}>(
  sources: T[],
  projectName: string,
  options: RuntimeWindowScoreOptions = {}
): T | undefined {
  const score = (source: T) => scoreRuntimeWindow(source.name, projectName, source.executable ?? "", {
    ...(options.targetAspect != null ? { targetAspect: options.targetAspect } : {}),
    ...((source.width ?? options.width) != null ? { width: source.width ?? options.width } : {}),
    ...((source.height ?? options.height) != null ? { height: source.height ?? options.height } : {})
  });
  const selected = [...sources].sort((left, right) => score(right) - score(left))[0];
  return selected && score(selected) >= 70 ? selected : undefined;
}

export const GITEE_REPOSITORY_URL = "https://gitee.com/AndroidSUP/tap-maker-work";
export const GITEE_RELEASES_URL = `${GITEE_REPOSITORY_URL}/releases`;
export const GITEE_LATEST_RELEASE_API = "https://gitee.com/api/v5/repos/AndroidSUP/tap-maker-work/releases/latest";

export interface GiteeRelease {
  tag_name: string;
  name?: string | undefined;
  html_url?: string | undefined;
  prerelease?: boolean | string | undefined;
}

function versionParts(value: string): { numbers: number[]; prerelease: string } {
  const normalized = value.trim().replace(/^v/i, "");
  const [core = "0", prerelease = ""] = normalized.split("-", 2);
  return {
    numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    prerelease
  };
}

export function normalizeReleaseVersion(value: string): string {
  return value.trim().replace(/^v/i, "");
}

export function isVersionNewer(candidate: string, current: string): boolean {
  const left = versionParts(candidate);
  const right = versionParts(current);
  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.numbers[index] || 0) - (right.numbers[index] || 0);
    if (difference !== 0) return difference > 0;
  }
  if (left.prerelease === right.prerelease) return false;
  if (!left.prerelease) return true;
  if (!right.prerelease) return false;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true }) > 0;
}

export function giteeReleaseDownloadBase(tag: string): string {
  return `${GITEE_REPOSITORY_URL}/releases/download/${encodeURIComponent(tag.trim())}/`;
}

export interface SandboxStatus {
  available: boolean;
  reason: string;
}

export function sandboxStatus(): SandboxStatus {
  return {
    available: false,
    reason: "OS-backed project-only sandbox has not passed the macOS and Windows escape suite. Shell execution is disabled."
  };
}

export function assertSandboxAvailable(): never {
  throw new Error(sandboxStatus().reason);
}

import { act } from "react";
import { createRoot } from "react-dom/client";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export function renderHook<T>(hook: () => T) {
  const result = { current: undefined as T };
  function Probe() {
    result.current = hook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe />));
  return {
    result,
    unmount: () => act(() => root.unmount())
  };
}

export async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

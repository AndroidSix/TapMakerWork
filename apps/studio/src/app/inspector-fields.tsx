import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Pipette } from "lucide-react";
import type { UiValue } from "@tapmakerwork/protocol";
import { rgbaCss, rgbaFromHex, rgbaFromValue, rgbaToHex, type RgbaColor } from "../color-utils";
import { API } from "../bridge-api";
import type { AssetEntry } from "./types";

export function InspectorField({ label, property, value, onCommit, live = false, resetKey }: {
  label: string;
  property: string;
  value: UiValue | undefined;
  onCommit: (property: string, value: UiValue) => void;
  live?: boolean;
  /** Remount/sync token — usually the selected node id so drafts reset on selection change. */
  resetKey?: string;
}) {
  const display = Array.isArray(value) ? value.join(", ") : value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const [draft, setDraft] = useState(display);
  const focusedRef = useRef(false);
  const liveTimerRef = useRef<number | null>(null);
  const displayRef = useRef(display);
  displayRef.current = display;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const propertyRef = useRef(property);
  propertyRef.current = property;

  const parsedValue = (raw: string): UiValue => {
    // Keep `text` as a string — "123123" must not become number 123123 or Lua writeback breaks.
    if (property === "text") return raw;
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    if (raw.includes(",") && raw.split(",").every((part) => /^\s*\d+\s*$/.test(part))) return raw.split(",").map(Number);
    return raw;
  };

  const flush = useCallback((raw: string) => {
    if (liveTimerRef.current) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    if (raw === displayRef.current) return;
    onCommitRef.current(propertyRef.current, parsedValue(raw));
  }, []);

  // Selection / property identity changed: always drop stale draft.
  useEffect(() => {
    if (liveTimerRef.current) {
      window.clearTimeout(liveTimerRef.current);
      liveTimerRef.current = null;
    }
    focusedRef.current = false;
    setDraft(display);
  }, [resetKey, property]);

  useEffect(() => {
    if (!focusedRef.current) setDraft(display);
  }, [display]);

  useEffect(() => () => {
    if (liveTimerRef.current) window.clearTimeout(liveTimerRef.current);
  }, []);

  return (
    <label className="property-row">
      <span>{label}</span>
      <input
        value={draft}
        onFocus={() => { focusedRef.current = true; }}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (live) {
            if (liveTimerRef.current) window.clearTimeout(liveTimerRef.current);
            liveTimerRef.current = window.setTimeout(() => flush(next), 180);
          }
        }}
        onBlur={() => {
          focusedRef.current = false;
          flush(draftRef.current);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(displayRef.current);
            focusedRef.current = false;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

export function InspectorColorField({ label, property, value, onCommit, resetKey }: {
  label: string;
  property: string;
  value: UiValue | undefined;
  onCommit: (property: string, value: UiValue) => void;
  /** Selected node id — collapse editor when switching buttons/nodes. */
  resetKey?: string;
}) {
  const parsed = useMemo(() => rgbaFromValue(value), [value]);
  const [draft, setDraft] = useState<RgbaColor>(parsed);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [resetKey, property]);
  useEffect(() => setDraft(parsed), [parsed[0], parsed[1], parsed[2], parsed[3]]);
  const update = (next: RgbaColor) => {
    setDraft(next);
    onCommit(property, next);
  };
  const updateChannel = (index: number, raw: string) => {
    const next = [...draft] as RgbaColor;
    next[index] = Math.max(0, Math.min(255, Math.round(Number(raw) || 0)));
    update(next);
  };
  return (
    <div className={`property-color ${expanded ? "expanded" : ""}`}>
      <span className="property-color-label">{label}</span>
      <button
        type="button"
        className="property-color-summary"
        aria-expanded={expanded}
        aria-label={`${label} ${rgbaToHex(draft, true)}，点击${expanded ? "收起" : "展开"}颜色编辑器`}
        onClick={() => setExpanded((open) => !open)}
      >
        <i className="property-color-swatch" style={{ "--swatch": rgbaCss(draft) } as CSSProperties} />
        <code>{rgbaToHex(draft, true)}</code>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {expanded && (
        <div className="property-color-editor">
          <label className="property-color-native">
            <span><Pipette size={13} aria-hidden="true" />颜色</span>
            <input
              type="color"
              value={rgbaToHex(draft)}
              aria-label={`${label}系统颜色选择器`}
              onChange={(event) => update(rgbaFromHex(event.target.value, draft))}
            />
          </label>
          {(["R", "G", "B", "A"] as const).map((channel, index) => (
            <label key={channel} className="property-color-channel">
              <span>{channel}</span>
              <input type="range" min="0" max="255" value={draft[index]} aria-label={`${label} ${channel}`} onChange={(event) => updateChannel(index, event.target.value)} />
              <input type="number" min="0" max="255" value={draft[index]} aria-label={`${label} ${channel} 数值`} onChange={(event) => updateChannel(index, event.target.value)} />
            </label>
          ))}
          <label className="property-color-hex">
            <span>Hexadecimal</span>
            <input
              key={rgbaToHex(draft, true)}
              defaultValue={rgbaToHex(draft, true)}
              aria-label={`${label}十六进制 RGBA`}
              onBlur={(event) => update(rgbaFromHex(event.target.value, draft))}
              onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function InspectorAssetField({ value, assets, onCommit, onAssetsChanged, toast }: {
  value: UiValue | undefined;
  assets: AssetEntry[];
  onCommit: (property: string, value: UiValue) => void;
  onAssetsChanged?: () => void;
  toast?: (message: string, kind?: "info" | "success" | "error" | "warn") => void;
}) {
  const current = typeof value === "string" ? value : "";
  const options = assets
    .filter((asset) => asset.kind === "image")
    .map((asset) => ({ label: asset.name, value: asset.path.replace(/^assets\//i, "") }));
  const isWindows = typeof navigator !== "undefined" && /Win/i.test(navigator.userAgent || navigator.platform || "");
  const handleAdopt = async () => {
    const raw = window.prompt("粘贴 Windows 绝对路径（可带或不带 @image: 前缀）", "");
    if (!raw) return;
    const candidate = raw.trim();
    if (!candidate) return;
    try {
      const probeUrl = `${API}/api/project/asset?path=${encodeURIComponent("@image:" + candidate)}`;
      const probe = await fetch(probeUrl);
      const adoptedHeader = probe.headers.get("x-adopted-path");
      // eslint-disable-next-line no-console
      console.log("[adopt asset]", { url: probeUrl, status: probe.status, ok: probe.ok, adoptedHeader });
      if (!probe.ok) {
        const text = await probe.text().catch(() => "");
        toast?.(`采纳失败：${probe.status} ${text.slice(0, 200)}`, "error");
        return;
      }
      if (!adoptedHeader) {
        toast?.("bridge 未返回 x-adopted-path，请重启 npm run dev", "warn");
      }
      const adoptedRelative = adoptedHeader
        ? adoptedHeader.replace(/^assets\//i, "")
        : `_external/${candidate.split(/[\\/]/).filter(Boolean).pop() || candidate}`;
      onAssetsChanged?.();
      onCommit("backgroundImage", adoptedRelative);
      toast?.(`已采纳外部图片：${adoptedRelative}`, "success");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[adopt asset] error", error);
      toast?.(`采纳失败：${error instanceof Error ? error.message : String(error)}`, "error");
    }
  };
  return (
    <label className="property-row">
      <span>图片资源</span>
      <select value={current} onChange={(event) => onCommit("backgroundImage", event.target.value)}>
        <option value="">无图片</option>
        {current && !options.some((option) => option.value === current) && <option value={current}>{current}</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.value}</option>)}
      </select>
      {isWindows && onAssetsChanged && (
        <button type="button" className="property-asset-adopt" onClick={handleAdopt}>采纳 Windows 路径</button>
      )}
    </label>
  );
}

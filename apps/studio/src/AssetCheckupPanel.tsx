import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, Image as ImageIcon, RefreshCw, RotateCcw, Stethoscope, Trash2, X } from "lucide-react";
import type { AssetKind, AssetSizeReport, TrashedAsset } from "@tapmakerwork/protocol";
import { formatBytes } from "./app/format";
import type { AssetEntry } from "./app/types";

const KIND_LABEL: Record<AssetKind, string> = {
  image: "图片",
  audio: "音频",
  video: "视频",
  model: "模型",
  font: "字体",
  other: "其他"
};

interface AssetCheckupPanelProps {
  apiBase: string;
  onClose: () => void;
  onChanged: () => void;
  onOpenCompress: () => void;
}

interface TrashMoveResponse {
  moved: TrashedAsset[];
  skipped: Array<{ path: string; reason: string }>;
}

interface TrashRestoreResponse {
  restored: TrashedAsset[];
  skipped: Array<{ id: string; reason: string }>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

export function AssetCheckupPanel({ apiBase, onClose, onChanged, onOpenCompress }: AssetCheckupPanelProps) {
  const [report, setReport] = useState<AssetSizeReport | null>(null);
  const [trash, setTrash] = useState<TrashedAsset[]>([]);
  const [unreferenced, setUnreferenced] = useState<AssetEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [reportResponse, assetsResponse] = await Promise.all([
        fetch(`${apiBase}/api/assets/report`),
        fetch(`${apiBase}/api/project/assets`)
      ]);
      const reportData = await reportResponse.json() as { report?: AssetSizeReport; trash?: TrashedAsset[]; error?: string };
      if (!reportResponse.ok || !reportData.report) throw new Error(reportData.error || `HTTP ${reportResponse.status}`);
      const assetsData = await assetsResponse.json() as { assets?: AssetEntry[] };
      setReport(reportData.report);
      setTrash(reportData.trash ?? []);
      setUnreferenced((assetsData.assets ?? []).filter((asset) => asset.status === "unreferenced"));
      setSelectedPaths(new Set());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [apiBase]);

  useEffect(() => { void load(); }, [load]);

  const runAndReload = useCallback(async (action: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage(await action());
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
    await load();
  }, [load, onChanged]);

  const moveSelectedToTrash = () => runAndReload(async () => {
    const result = await postJson<TrashMoveResponse>(`${apiBase}/api/assets/trash`, { paths: [...selectedPaths] });
    const skipped = result.skipped.length ? `，${result.skipped.length} 个已被引用或不存在，未移动` : "";
    return `已移入回收站 ${result.moved.length} 个文件${skipped}。随时可在下方恢复。`;
  });

  const restore = (ids: string[]) => runAndReload(async () => {
    const result = await postJson<TrashRestoreResponse>(`${apiBase}/api/assets/restore`, { ids });
    const conflicts = result.skipped.filter((item) => item.reason === "target_exists").length;
    return `已恢复 ${result.restored.length} 个文件${conflicts ? `，${conflicts} 个原位置已有同名文件，未覆盖` : ""}。`;
  });

  const purge = (ids: string[]) => {
    if (!window.confirm(`永久删除回收站中的 ${ids.length} 个文件？此操作无法恢复。`)) return;
    void runAndReload(async () => {
      const result = await postJson<{ purged: TrashedAsset[] }>(`${apiBase}/api/assets/purge`, { ids });
      return `已永久删除 ${result.purged.length} 个文件。`;
    });
  };

  const toggle = (assetPath: string) => setSelectedPaths((current) => {
    const next = new Set(current);
    if (next.has(assetPath)) next.delete(assetPath);
    else next.add(assetPath);
    return next;
  });

  const allSelected = unreferenced.length > 0 && selectedPaths.size === unreferenced.length;
  const selectedBytes = useMemo(
    () => unreferenced.filter((asset) => selectedPaths.has(asset.path)).reduce((sum, asset) => sum + asset.bytes, 0),
    [selectedPaths, unreferenced]
  );
  const kindRows = report
    ? (Object.entries(report.byKind) as Array<[AssetKind, { count: number; bytes: number }]>).filter(([, stat]) => stat.count > 0)
    : [];

  return (
    <section className="overlay-panel panel tools-panel" aria-label="资源体检">
      <div className="overlay-heading">
        <strong><Stethoscope size={15} aria-hidden="true" />工具集 · 资源体检</strong>
        <div className="asset-checkup-heading-actions">
          <button type="button" disabled={busy} onClick={() => void load()} aria-label="重新体检"><RefreshCw size={13} className={busy ? "spin" : ""} />重新体检</button>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={14} />关闭</button>
        </div>
      </div>
      <div className="image-compress-panel">
        {message && <p className="image-compress-message" role="status">{message}</p>}

        {report && (
          <section className="image-compress-card">
            <h4>包体概览</h4>
            <div className="asset-checkup-stats">
              <div><small>素材总量</small><strong>{formatBytes(report.totalBytes)}</strong></div>
              <div className={report.unreferenced.count ? "is-warn" : ""}><small>未引用</small><strong>{report.unreferenced.count} 个 · {formatBytes(report.unreferenced.bytes)}</strong></div>
              <div><small>可压缩图片</small><strong>{report.compressCandidates.count} 张 · {formatBytes(report.compressCandidates.bytes)}</strong></div>
              <div><small>回收站</small><strong>{report.trash.count} 个 · {formatBytes(report.trash.bytes)}</strong></div>
            </div>
            <ul className="asset-checkup-kinds">
              {kindRows.map(([kind, stat]) => (
                <li key={kind}>
                  <span>{KIND_LABEL[kind]} · {stat.count}</span>
                  <i style={{ width: `${percent(stat.bytes, report.totalBytes)}%` }} />
                  <small>{formatBytes(stat.bytes)} · {percent(stat.bytes, report.totalBytes)}%</small>
                </li>
              ))}
            </ul>
            {report.compressCandidates.count > 0 && (
              <div className="desktop-card-actions">
                <button type="button" onClick={onOpenCompress}><ImageIcon size={13} />压缩这些图片</button>
                <span className="desktop-card-note">≥50 KB 的 png/jpg/webp，已压缩且未改动的会自动跳过</span>
              </div>
            )}
          </section>
        )}

        {report && report.largest.length > 0 && (
          <section className="image-compress-card">
            <h4>体积最大的素材</h4>
            <ol className="image-compress-files">
              {report.largest.map((item) => (
                <li key={item.path} className={item.referenced ? "is-compressed" : "is-failed"}>
                  <strong title={item.path}>{item.path}</strong>
                  <span>{KIND_LABEL[item.kind]} · {item.referenced ? "已引用" : "未引用"}</span>
                  <small>{formatBytes(item.bytes)}</small>
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="image-compress-card">
          <div className="desktop-card-heading">
            <div>
              <h4>未引用素材</h4>
              <p>脚本和配置里都没找到文件名。动态拼接的路径可能误判，移入回收站后可随时恢复。</p>
            </div>
          </div>
          {unreferenced.length === 0 ? (
            <p className="desktop-card-note">没有未引用素材。</p>
          ) : (
            <>
              <label className="asset-checkup-select-all">
                <input type="checkbox" checked={allSelected} onChange={() => setSelectedPaths(allSelected ? new Set() : new Set(unreferenced.map((asset) => asset.path)))} />
                全选 {unreferenced.length} 个
              </label>
              <ul className="asset-checkup-list">
                {unreferenced.map((asset) => (
                  <li key={asset.path}>
                    <label>
                      <input type="checkbox" checked={selectedPaths.has(asset.path)} onChange={() => toggle(asset.path)} />
                      <span title={asset.path}>{asset.path}</span>
                      <small>{formatBytes(asset.bytes)}</small>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="desktop-card-actions">
                <button type="button" className="primary" disabled={busy || selectedPaths.size === 0} onClick={() => void moveSelectedToTrash()}>
                  <Archive size={13} />移入回收站{selectedPaths.size ? `（${selectedPaths.size} 个 · ${formatBytes(selectedBytes)}）` : ""}
                </button>
                <span className="desktop-card-note">存放在项目 .tapmakerwork/trash，不参与构建</span>
              </div>
            </>
          )}
        </section>

        <section className="image-compress-card">
          <div className="desktop-card-heading">
            <div>
              <h4>回收站</h4>
              <p>恢复会放回原位置；原位置已有同名文件时不会覆盖。</p>
            </div>
            {trash.length > 0 && (
              <div className="asset-checkup-heading-actions">
                <button type="button" disabled={busy} onClick={() => void restore(trash.map((entry) => entry.id))}><RotateCcw size={13} />全部恢复</button>
                <button type="button" className="danger" disabled={busy} onClick={() => purge(trash.map((entry) => entry.id))}><Trash2 size={13} />清空</button>
              </div>
            )}
          </div>
          {trash.length === 0 ? (
            <p className="desktop-card-note">回收站是空的。</p>
          ) : (
            <ul className="asset-checkup-list">
              {trash.map((entry) => (
                <li key={entry.id}>
                  <span title={entry.originalPath}>{entry.originalPath}</span>
                  <small>{formatBytes(entry.bytes)} · {new Date(entry.trashedAt).toLocaleString()}</small>
                  <button type="button" disabled={busy} aria-label={`恢复 ${entry.originalPath}`} onClick={() => void restore([entry.id])}><RotateCcw size={12} />恢复</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

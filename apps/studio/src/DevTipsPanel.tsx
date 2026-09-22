import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, ExternalLink, Lightbulb } from "lucide-react";
import { DEV_TIP_CATEGORIES } from "./dev-tips-content";

interface DevTipsPanelProps {
  onClose: () => void;
  onCopy: (text: string) => void | Promise<void>;
  onOpenExternal: (url: string) => void;
}

export function DevTipsPanel({ onClose, onCopy, onOpenExternal }: DevTipsPanelProps) {
  const categories = useMemo(() => DEV_TIP_CATEGORIES, []);
  const [activeCategory, setActiveCategory] = useState(categories[0]?.id || "local-token");
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const current = categories.find((item) => item.id === activeCategory) || categories[0];

  return (
    <section className="overlay-panel panel tips-panel" aria-label="开发技巧">
      <div className="overlay-heading">
        <strong><Lightbulb size={15} aria-hidden="true" />开发技巧</strong>
        <button onClick={onClose}>关闭</button>
      </div>
      <div className="tips-layout">
        <nav className="tips-nav" aria-label="技巧分类">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className={category.id === current?.id ? "active" : ""}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.title}
            </button>
          ))}
        </nav>
        <div className="tips-body">
          {current ? (
            <>
              <header className="tips-category-header">
                <h3>{current.title}</h3>
                <p>{current.description}</p>
              </header>
              <div className="tips-card-list">
                {current.items.map((item) => {
                  const expanded = expandedIds[item.id] ?? true;
                  return (
                    <article key={item.id} className="tips-card">
                      <div className="tips-card-heading">
                        <h4>{item.title}</h4>
                      </div>
                      <p>{item.summary}</p>
                      {item.links?.length ? (
                        <div className="tips-card-links">
                          {item.links.map((link) => (
                            <button key={link.url} type="button" onClick={() => onOpenExternal(link.url)}>
                              <ExternalLink size={13} />{link.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <div className="tips-copy-preview">
                        <button
                          type="button"
                          className="tips-preview-toggle"
                          aria-expanded={expanded}
                          onClick={() => setExpandedIds((state) => ({ ...state, [item.id]: !expanded }))}
                        >
                          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          {expanded ? "收起复制内容" : "查看复制内容"}
                        </button>
                        {expanded && <pre className="tips-copy-text">{item.copyText}</pre>}
                      </div>
                      <button type="button" className="primary tips-copy" onClick={() => void onCopy(item.copyText)}>
                        <Copy size={13} />{item.copyLabel || "一键复制给 AI"}
                      </button>
                    </article>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

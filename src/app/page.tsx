"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Row = Record<string, string>;

type Game = {
  title: string;
  coverUrl: string;

  platforms: string[];
  genres: string[];
  yearPlayed: string[];

  status: string;
  ownership: string;
  format: string;

  releaseDate: string;
  backlog: string;
  completed: string;
  dateCompleted: string;
  dateAdded: string; // NEW (from sheet column "DateAdded" on Web)
};

const COLORS = {
  bg: "#0b0b0f",
  panel: "#0f1117",
  panelTopFade: "rgba(255,255,255,0.03)",
  card: "#111827",
  border: "#1f2937",
  input: "#020617",
  text: "#e5e7eb",
  muted: "#9ca3af",
  rowHover: "rgba(255,255,255,0.04)",
  rowActive: "rgba(96,165,250,0.14)",
  badgeBg: "rgba(255,255,255,0.06)",
  badgeBorder: "rgba(255,255,255,0.10)",
  green: "#22c55e",
};

function norm(v: unknown) {
  return (v ?? "").toString().trim();
}

function splitTags(s: string) {
  return norm(s)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function pickCover(row: Row) {
  const coverUrl = norm(row["CoverURL"]);
  if (coverUrl) return coverUrl;

  const cover = norm(row["Cover"]);
  if (cover.startsWith("http")) return cover;

  return "";
}

function toBool(v: string) {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "checked" || s === "x";
}

function toDateNum(s: string) {
  const v = norm(s);
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function titleKey(title: string) {
  return norm(title).toLowerCase();
}

function rowToGame(row: Row): Game | null {
  const title = norm(row["Title"]);
  if (!title) return null;

  return {
    title,
    coverUrl: pickCover(row),

    platforms: splitTags(row["Platforms"] || row["Platform"]),
    genres: splitTags(row["Genres"]),
    yearPlayed: splitTags(row["YearPlayed"]),

    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    releaseDate: norm(row["ReleaseDate"]),
    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
    dateCompleted: norm(row["DateCompleted"]),
    dateAdded: norm(row["DateAdded"]),
  };
}

// Dedupe by Title, merge arrays
function dedupeByTitle(rows: Game[]) {
  const map = new Map<string, Game>();

  for (const g of rows) {
    const k = titleKey(g.title);
    const existing = map.get(k);

    if (!existing) {
      map.set(k, g);
      continue;
    }

    map.set(k, {
      ...existing,
      coverUrl: existing.coverUrl || g.coverUrl,
      platforms: uniqueSorted([...existing.platforms, ...g.platforms]),
      genres: uniqueSorted([...existing.genres, ...g.genres]),
      yearPlayed: uniqueSorted([...existing.yearPlayed, ...g.yearPlayed]),
      backlog: toBool(existing.backlog) || toBool(g.backlog) ? "true" : "",
      completed: toBool(existing.completed) || toBool(g.completed) ? "true" : "",
      // releaseDate: earliest
      releaseDate:
        toDateNum(existing.releaseDate) && toDateNum(g.releaseDate)
          ? (toDateNum(existing.releaseDate) <= toDateNum(g.releaseDate) ? existing.releaseDate : g.releaseDate)
          : (existing.releaseDate || g.releaseDate),
      // dateCompleted: latest
      dateCompleted:
        toDateNum(existing.dateCompleted) && toDateNum(g.dateCompleted)
          ? (toDateNum(existing.dateCompleted) >= toDateNum(g.dateCompleted) ? existing.dateCompleted : g.dateCompleted)
          : (existing.dateCompleted || g.dateCompleted),
      // dateAdded: earliest (or just prefer existing)
      dateAdded:
        toDateNum(existing.dateAdded) && toDateNum(g.dateAdded)
          ? (toDateNum(existing.dateAdded) <= toDateNum(g.dateAdded) ? existing.dateAdded : g.dateAdded)
          : (existing.dateAdded || g.dateAdded),
      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,
    });
  }

  return Array.from(map.values());
}

function CountBadge({ n }: { n: number }) {
  return (
    <span
      style={{
        minWidth: 28,
        height: 16,
        padding: "0 6px",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: `1px solid rgba(255,255,255,0.10)`,
        color: COLORS.muted,
        fontSize: 11,
        lineHeight: "16px",
      }}
    >
      {n}
    </span>
  );
}

function SmallSelect({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: "100%",
        padding: "8px 10px",
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
        background: COLORS.input,
        color: COLORS.text,
        fontSize: 12,
      }}
    >
      {children}
    </select>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        color: COLORS.text,
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// ---- Drag tile ----
function SortableTile({
  id,
  title,
  coverUrl,
  tileSize,
  onClick,
}: {
  id: string;
  title: string;
  coverUrl: string;
  tileSize: number;
  onClick?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.75 : 1,
    cursor: "grab",
    userSelect: "none",
    touchAction: "none", // helps on mobile
  };

  return (
    <button
      ref={setNodeRef}
      style={{
        ...style,
        aspectRatio: "2 / 3",
        background: COLORS.card,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 20px 40px rgba(0,0,0,.6)",
        border: isDragging ? `1px solid ${COLORS.green}` : "none",
        padding: 0,
        textAlign: "left",
      }}
      title={title}
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={title}
          loading="lazy"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontSize: 12 }}>
          No cover
        </div>
      )}
    </button>
  );
}

export default function HomePage() {
  const csvUrl = process.env.NEXT_PUBLIC_SHEET_CSV_URL;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ default cover size = 100
  const [tileSize, setTileSize] = useState(100);

  const [q, setQ] = useState("");

  const [onlyBacklog, setOnlyBacklog] = useState(false);
  const [onlyCompleted, setOnlyCompleted] = useState(false);

  // Sort modes (Custom included)
  const [sortBy, setSortBy] = useState<"custom" | "title" | "releaseDate" | "dateCompleted" | "dateAdded">("releaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // ✅ Custom order list (array of title keys)
  const CUSTOM_ORDER_KEY = "gg_clone_custom_order_v1";
  const [customOrder, setCustomOrder] = useState<string[]>([]);

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor)
  );

  // Load custom order from localStorage once
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_ORDER_KEY);
      if (raw) setCustomOrder(JSON.parse(raw));
    } catch {}
  }, []);

  // Persist custom order
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_ORDER_KEY, JSON.stringify(customOrder));
    } catch {}
  }, [customOrder]);

  useEffect(() => {
    async function load() {
      if (!csvUrl) return;
      setLoading(true);

      const res = await fetch(csvUrl, { cache: "no-store" });
      const text = await res.text();

      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      const mapped = (parsed.data as Row[]).map(rowToGame).filter(Boolean) as Game[];

      const deduped = dedupeByTitle(mapped);
      setGames(deduped);

      // If customOrder is empty, initialize it with current titles once
      setCustomOrder((prev) => {
        if (prev.length) return prev;
        return deduped.map((g) => titleKey(g.title));
      });

      setLoading(false);
    }

    load();
  }, [csvUrl]);

  // Your current “base list” (search + checkbox filters)
  const baseFiltered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return games.filter((g) => {
      if (query && !g.title.toLowerCase().includes(query)) return false;
      if (onlyBacklog && !toBool(g.backlog)) return false;
      if (onlyCompleted && !toBool(g.completed)) return false;
      return true;
    });
  }, [games, q, onlyBacklog, onlyCompleted]);

  // Apply sorting
  const sorted = useMemo(() => {
    const arr = [...baseFiltered];
    const dir = sortDir === "asc" ? 1 : -1;

    if (sortBy === "custom") {
      // Sort by the order array; unknown items fall to bottom
      const idx = new Map(customOrder.map((k, i) => [k, i]));
      arr.sort((a, b) => {
        const ia = idx.get(titleKey(a.title));
        const ib = idx.get(titleKey(b.title));
        const va = ia == null ? 1e12 : ia;
        const vb = ib == null ? 1e12 : ib;
        return (va - vb) * 1; // always ascending for custom
      });
      return arr;
    }

    arr.sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title) * dir;
      if (sortBy === "releaseDate") return (toDateNum(a.releaseDate) - toDateNum(b.releaseDate)) * dir;
      if (sortBy === "dateCompleted") return (toDateNum(a.dateCompleted) - toDateNum(b.dateCompleted)) * dir;
      if (sortBy === "dateAdded") return (toDateNum(a.dateAdded) - toDateNum(b.dateAdded)) * dir;
      return 0;
    });

    return arr;
  }, [baseFiltered, sortBy, sortDir, customOrder]);

  // On drag end: reorder + auto switch to custom
  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    if (active.id === over.id) return;

    // Only allow reordering when you're in "Games" default view
    // (Right now we’re not handling tabs; if you have tabs, we can scope it.)
    const activeId = String(active.id);
    const overId = String(over.id);

    // Build current list ids based on the *sorted* list shown
    const ids = sorted.map((g) => titleKey(g.title));
    const oldIndex = ids.indexOf(activeId);
    const newIndex = ids.indexOf(overId);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextIds = arrayMove(ids, oldIndex, newIndex);

    // ✅ save
    setCustomOrder(nextIds);

    // ✅ auto-switch to custom sorting if user drags anything
    setSortBy("custom");
    setSortDir("asc");
  }

  function clearFilters() {
    setQ("");
    setOnlyBacklog(false);
    setOnlyCompleted(false);
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <aside
        style={{
          width: 340,
          padding: 16,
          background: COLORS.panel,
          borderRight: `1px solid ${COLORS.border}`,
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          scrollbarWidth: "none",
          msOverflowStyle: "none",
        }}
      >
        <style>{`aside::-webkit-scrollbar { display: none; }`}</style>

        <div
          style={{
            padding: "12px 10px",
            borderRadius: 14,
            background: COLORS.panelTopFade,
            border: `1px solid ${COLORS.border}`,
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 10 }}>Chris&apos; Game Library</div>

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            style={{
              width: "100%",
              padding: "9px 10px",
              borderRadius: 12,
              border: `1px solid ${COLORS.border}`,
              background: COLORS.input,
              color: COLORS.text,
              fontSize: 12,
            }}
          />

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>SORT</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <SmallSelect value={sortBy} onChange={(v) => setSortBy(v as any)}>
                <option value="releaseDate">Release Date</option>
                <option value="dateAdded">Date Added</option>
                <option value="title">Title</option>
                <option value="dateCompleted">Date Completed</option>
                <option value="custom">Custom (drag)</option>
              </SmallSelect>

              <SmallSelect value={sortDir} onChange={(v) => setSortDir(v as any)}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </SmallSelect>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>FILTERS</div>
            <CheckboxRow label="Backlog" checked={onlyBacklog} onChange={setOnlyBacklog} />
            <CheckboxRow label="Completed" checked={onlyCompleted} onChange={setOnlyCompleted} />
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>COVER SIZE</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6 }}>{tileSize}px</div>
            <input
              type="range"
              min={90}
              max={260}
              value={tileSize}
              onChange={(e) => setTileSize(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>

          <button
            onClick={clearFilters}
            style={{
              marginTop: 10,
              width: "100%",
              padding: "9px 10px",
              borderRadius: 12,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.text,
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            Clear Filters
          </button>

          <div style={{ marginTop: 10, fontSize: 11, color: COLORS.muted }}>
            Showing {sorted.length} / {games.length}
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: COLORS.muted }}>
            Tip: drag any cover → auto switches to <b>Custom</b>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, padding: 18 }}>
        {loading ? (
          <div>Loading…</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sorted.map((g) => titleKey(g.title))} strategy={rectSortingStrategy}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
                  gap: 16,
                }}
              >
                {sorted.map((g) => (
                  <SortableTile
                    key={titleKey(g.title)}
                    id={titleKey(g.title)}
                    title={g.title}
                    coverUrl={g.coverUrl}
                    tileSize={tileSize}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>
    </div>
  );
}

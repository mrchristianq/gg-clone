"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

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

  releaseDate: string; // yyyy-mm-dd
  dateAdded: string; // yyyy-mm-dd or empty

  backlog: string; // TRUE/FALSE or 1/0 or Yes/No
  completed: string;

  igdbId: string;
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

const COLORS = {
  bg: "#0b0c0f",
  panel: "#0f1117",
  card: "#10131b",
  border: "rgba(255,255,255,0.08)",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.58)",
  accent: "#20c997", // green
};

function norm(v: any) {
  return String(v ?? "").trim();
}
function titleKey(s: string) {
  return norm(s).toLowerCase();
}
function splitTags(v: any) {
  const s = norm(v);
  if (!s) return [];
  return s
    .split(/[,;|]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}
function toBool(v: any) {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}
function parseDateMs(s: string) {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

function rowToGame(row: Row): Game {
  const title = norm(row["Title"] || row["Name"]);
  const coverUrl = norm(row["CoverURL"] || row["CoverUrl"] || row["Cover"]);
  const platforms = splitTags(row["Platforms"] || row["Platform"]);
  const genres = splitTags(row["Genres"] || row["Genre"]);
  const yearPlayed = splitTags(row["YearPlayed"] || row["Year Played"] || row["Year Played "]);

  return {
    title,
    coverUrl,
    platforms,
    genres,
    yearPlayed,
    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),
    releaseDate: norm(row["ReleaseDate"] || row["Release Date"]),
    dateAdded: norm(row["DateAdded"] || row["Date Added"]),
    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
    igdbId: norm(row["IGDB_ID"] || row["IGDB ID"] || row["IGDB_ID_Override"] || ""),
  };
}

// Dedupe by title (keeps first and merges lists)
function dedupeByTitle(games: Game[]) {
  const m = new Map<string, Game>();
  for (const g of games) {
    const k = titleKey(g.title);
    if (!k) continue;
    if (!m.has(k)) {
      m.set(k, g);
      continue;
    }
    const existing = m.get(k)!;
    const platforms = Array.from(new Set([...existing.platforms, ...g.platforms]));
    const genres = Array.from(new Set([...existing.genres, ...g.genres]));
    const yearPlayed = Array.from(new Set([...existing.yearPlayed, ...g.yearPlayed]));

    m.set(k, {
      ...existing,
      platforms,
      genres,
      yearPlayed,
      // prefer whichever has these filled
      coverUrl: existing.coverUrl || g.coverUrl,
      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,
      releaseDate: existing.releaseDate || g.releaseDate,
      dateAdded: existing.dateAdded || g.dateAdded,
      backlog: existing.backlog || g.backlog,
      completed: existing.completed || g.completed,
      igdbId: existing.igdbId || g.igdbId,
    });
  }
  return Array.from(m.values());
}

type SortKey = "ReleaseDate" | "Title" | "DateAdded" | "Custom";

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string>("");

  // UI
  const [coverSize, setCoverSize] = useState<number>(100); // ✅ default = 100
  const [sortKey, setSortKey] = useState<SortKey>("ReleaseDate");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Filters (keep minimal here; your existing page likely has more — add back as needed)
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set());

  const [filterBacklog, setFilterBacklog] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);
  const [filterNowPlaying, setFilterNowPlaying] = useState(false);
  const [filterAbandoned, setFilterAbandoned] = useState(false);

  // Top nav tabs
  const [viewTab, setViewTab] = useState<"Games" | "BacklogQueue" | "Wishlist">("Games");

  // Custom order (persisted)
  const STORAGE_KEY = "gg-clone-custom-order-v1";
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [dragTitle, setDragTitle] = useState<string | null>(null);

  // Load CSV
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError("");

        const res = await fetch(CSV_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
        const text = await res.text();

        const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
        const rows = (parsed.data || []).filter((r) => r && (r["Title"] || r["Name"]));
        const list = dedupeByTitle(rows.map(rowToGame).filter((g) => g.title));

        if (cancelled) return;
        setGames(list);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load custom order from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setCustomOrder(arr.map(String));
    } catch {
      // ignore
    }
  }, []);

  // Keep custom order valid as games list changes
  useEffect(() => {
    if (!games.length) return;
    setCustomOrder((prev) => {
      const set = new Set(prev);
      const all = games.map((g) => titleKey(g.title));
      const cleaned = prev.filter((k) => all.includes(k));
      // append any new titles at the end
      for (const k of all) if (!set.has(k)) cleaned.push(k);
      // save
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
      } catch {}
      return cleaned;
    });
  }, [games.length]);

  // Derived filter options
  const allGenres = useMemo(() => {
    const s = new Set<string>();
    games.forEach((g) => g.genres.forEach((x) => s.add(x)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const allPlatforms = useMemo(() => {
    const s = new Set<string>();
    games.forEach((g) => g.platforms.forEach((x) => s.add(x)));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const allYears = useMemo(() => {
    const s = new Set<string>();
    games.forEach((g) => g.yearPlayed.forEach((x) => s.add(x)));
    // sort numerically if possible
    return Array.from(s).sort((a, b) => Number(a) - Number(b));
  }, [games]);

  // Stats (top right)
  const stats = useMemo(() => {
    const total = games.length;
    const queued = games.filter((g) => titleKey(g.status) === "queued").length;
    const wishlist = games.filter((g) => titleKey(g.ownership) === "wishlist").length;

    const year = new Date().getFullYear();
    const playedThisYear = games.filter((g) => g.yearPlayed.includes(String(year))).length;

    return { total, queued, wishlist, year, playedThisYear };
  }, [games]);

  // Apply top tab filter
  const gamesByTab = useMemo(() => {
    if (viewTab === "BacklogQueue") {
      return games.filter((g) => titleKey(g.status) === "queued");
    }
    if (viewTab === "Wishlist") {
      return games.filter((g) => titleKey(g.ownership) === "wishlist");
    }
    return games;
  }, [games, viewTab]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = gamesByTab;

    if (selectedGenres.size) {
      list = list.filter((g) => g.genres.some((x) => selectedGenres.has(x)));
    }
    if (selectedPlatforms.size) {
      list = list.filter((g) => g.platforms.some((x) => selectedPlatforms.has(x)));
    }
    if (selectedYears.size) {
      list = list.filter((g) => g.yearPlayed.some((x) => selectedYears.has(x)));
    }

    if (filterBacklog) list = list.filter((g) => toBool(g.backlog));
    if (filterCompleted) list = list.filter((g) => toBool(g.completed));
    if (filterNowPlaying) list = list.filter((g) => titleKey(g.status) === "now playing");
    if (filterAbandoned) list = list.filter((g) => titleKey(g.status) === "abandoned");

    // Sort
    const copy = [...list];

    if (sortKey === "Custom") {
      const rank = new Map<string, number>();
      customOrder.forEach((k, i) => rank.set(k, i));
      copy.sort((a, b) => (rank.get(titleKey(a.title)) ?? 999999) - (rank.get(titleKey(b.title)) ?? 999999));
      return copy;
    }

    if (sortKey === "Title") {
      copy.sort((a, b) => a.title.localeCompare(b.title));
      return sortDir === "asc" ? copy : copy.reverse();
    }

    if (sortKey === "ReleaseDate") {
      copy.sort((a, b) => parseDateMs(a.releaseDate) - parseDateMs(b.releaseDate));
      return sortDir === "asc" ? copy : copy.reverse();
    }

    // DateAdded
    copy.sort((a, b) => parseDateMs(a.dateAdded) - parseDateMs(b.dateAdded));
    return sortDir === "asc" ? copy : copy.reverse();
  }, [
    gamesByTab,
    selectedGenres,
    selectedPlatforms,
    selectedYears,
    filterBacklog,
    filterCompleted,
    filterNowPlaying,
    filterAbandoned,
    sortKey,
    sortDir,
    customOrder,
  ]);

  // --- Drag & drop (HTML5) ---
  function onDragStart(title: string) {
    setDragTitle(title);
  }

  function onDropOn(targetTitle: string) {
    if (!dragTitle) return;
    if (dragTitle === targetTitle) return;

    // Switch to custom order automatically
    setSortKey("Custom");

    setCustomOrder((prev) => {
      const from = titleKey(dragTitle);
      const to = titleKey(targetTitle);

      // Ensure we have a full list
      const full = prev.length ? [...prev] : games.map((g) => titleKey(g.title));

      const fromIdx = full.indexOf(from);
      const toIdx = full.indexOf(to);
      if (fromIdx === -1 || toIdx === -1) return prev;

      full.splice(fromIdx, 1);
      full.splice(toIdx, 0, from);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(full));
      } catch {}
      return full;
    });

    setDragTitle(null);
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, set: Set<string>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  // Styles
  const fontFamily =
    'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

  const topTab = (active: boolean) => ({
    background: "transparent",
    border: "none",
    color: active ? COLORS.text : COLORS.muted,
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
    padding: "10px 2px",
    position: "relative" as const,
  });

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text, fontFamily }}>
      {/* Top header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "linear-gradient(180deg, rgba(11,12,15,0.98), rgba(11,12,15,0.88))",
          borderBottom: `1px solid ${COLORS.border}`,
          padding: "14px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 999,
                overflow: "hidden",
                border: `1px solid ${COLORS.border}`,
                flex: "0 0 auto",
              }}
            >
              <img
                src="https://lh3.googleusercontent.com/a/ACg8ocJytvmuklInlqxJZOFW4Xi1sk40VGv_-UYAYNmYqAzSlBbno9AKeQ=s288-c-no"
                alt="Chris"
                style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
              />
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Chris’ Game Library</div>
          </div>

          {/* Stats on right */}
          <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
            <StatItem label="Games" value={stats.total} />
            <StatItem label="Queued" value={stats.queued} />
            <StatItem label="Wishlist" value={stats.wishlist} />
            <StatItem label={`Played in ${stats.year}`} value={stats.playedThisYear} />
          </div>
        </div>

        {/* Tabs row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <div style={{ display: "flex", gap: 18 }}>
            <button onClick={() => setViewTab("Games")} style={topTab(viewTab === "Games")}>
              Games
              {viewTab === "Games" && <Underline />}
            </button>

            <button onClick={() => setViewTab("BacklogQueue")} style={topTab(viewTab === "BacklogQueue")}>
              Backlog Queue
              {viewTab === "BacklogQueue" && <Underline />}
            </button>

            <button onClick={() => setViewTab("Wishlist")} style={topTab(viewTab === "Wishlist")}>
              Wishlist
              {viewTab === "Wishlist" && <Underline />}
            </button>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 800 }}>Sort</div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{
                background: COLORS.panel,
                color: COLORS.text,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: "8px 10px",
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              <option value="ReleaseDate">Release Date</option>
              <option value="Title">Title</option>
              <option value="DateAdded">Date Added</option>
              <option value="Custom">Custom Order</option>
            </select>

            {sortKey !== "Custom" && (
              <button
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                style={{
                  background: COLORS.panel,
                  color: COLORS.text,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12,
                  padding: "8px 10px",
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {sortDir === "desc" ? "↓" : "↑"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 14,
          padding: 14,
        }}
      >
        {/* Left panel */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 12,
            height: "calc(100vh - 110px)",
            position: "sticky",
            top: 86,
            overflow: "hidden",
          }}
        >
          <div style={{ fontWeight: 900, fontSize: 12, color: COLORS.muted, marginBottom: 10 }}>FILTERS</div>

          {/* Backlog/Now Playing row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <CheckLine label="Backlog" checked={filterBacklog} onChange={setFilterBacklog} />
            <CheckLine label="Now Playing" checked={filterNowPlaying} onChange={setFilterNowPlaying} />
          </div>

          {/* Completed/Abandoned row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            <CheckLine label="Completed" checked={filterCompleted} onChange={setFilterCompleted} />
            <CheckLine label="Abandoned" checked={filterAbandoned} onChange={setFilterAbandoned} />
          </div>

          <Section title="Genres">
            <MultiList
              items={allGenres}
              selected={selectedGenres}
              onToggle={(v) => toggleSet(setSelectedGenres, selectedGenres, v)}
            />
          </Section>

          <Section title="Platforms">
            <MultiList
              items={allPlatforms}
              selected={selectedPlatforms}
              onToggle={(v) => toggleSet(setSelectedPlatforms, selectedPlatforms, v)}
            />
          </Section>

          <Section title="Year Played">
            <MultiList items={allYears} selected={selectedYears} onToggle={(v) => toggleSet(setSelectedYears, selectedYears, v)} />
          </Section>

          <div style={{ marginTop: 14, borderTop: `1px solid ${COLORS.border}`, paddingTop: 12 }}>
            <div style={{ fontWeight: 900, fontSize: 12, color: COLORS.muted, marginBottom: 8 }}>COVER SIZE</div>
            <input
              type="range"
              min={60}
              max={160}
              value={coverSize}
              onChange={(e) => setCoverSize(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        </aside>

        {/* Grid */}
        <main>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 800 }}>
              {loading ? "Loading…" : `${filtered.length} game${filtered.length === 1 ? "" : "s"}`}
              {sortKey === "Custom" ? " • Custom order (drag to reorder)" : ""}
            </div>

            {sortKey === "Custom" && (
              <button
                onClick={() => {
                  const order = games.map((g) => titleKey(g.title));
                  setCustomOrder(order);
                  try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
                  } catch {}
                }}
                style={{
                  background: "transparent",
                  color: COLORS.muted,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 12,
                  padding: "6px 10px",
                  fontWeight: 900,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Reset Custom Order
              </button>
            )}
          </div>

          {error && (
            <div
              style={{
                background: "rgba(255,0,0,0.08)",
                border: "1px solid rgba(255,0,0,0.2)",
                padding: 10,
                borderRadius: 12,
                marginBottom: 12,
                color: COLORS.text,
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
              gap: 10,
              alignItems: "start",
            }}
          >
            {filtered.map((g) => {
              const k = titleKey(g.title);
              return (
                <div
                  key={k}
                  draggable
                  onDragStart={() => onDragStart(g.title)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => onDropOn(g.title)}
                  style={{
                    aspectRatio: "2 / 3",
                    background: COLORS.card,
                    borderRadius: 14,
                    overflow: "hidden",
                    border: dragTitle && titleKey(dragTitle) === k ? `2px solid ${COLORS.accent}` : `1px solid ${COLORS.border}`,
                    boxShadow: "0 18px 36px rgba(0,0,0,.55)",
                    cursor: "grab",
                    userSelect: "none",
                  }}
                  title={sortKey === "Custom" ? "Drag to reorder" : g.title}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      loading="lazy"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
                      }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div
                      style={{
                        height: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: COLORS.muted,
                        fontSize: 12,
                        padding: 10,
                        textAlign: "center",
                      }}
                    >
                      No cover
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* Mobile layout quick fix */}
      <style>{`
        @media (max-width: 960px) {
          div[style*="grid-template-columns: 320px 1fr"] {
            grid-template-columns: 1fr !important;
          }
          aside {
            position: relative !important;
            top: auto !important;
            height: auto !important;
          }
        }
      `}</style>
    </div>
  );
}

function Underline() {
  return (
    <span
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -2,
        height: 3,
        borderRadius: 999,
        background: COLORS.accent,
      }}
    />
  );
}

function StatItem({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ textAlign: "right", minWidth: 76 }}>
      <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontWeight: 900, fontSize: 12, color: COLORS.muted, marginBottom: 6 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

function MultiList({
  items,
  selected,
  onToggle,
}: {
  items: string[];
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {items.map((v) => (
        <button
          key={v}
          onClick={() => onToggle(v)}
          style={{
            width: "100%",
            textAlign: "left",
            padding: "6px 8px",
            borderRadius: 10,
            border: `1px solid ${selected.has(v) ? "rgba(32,201,151,0.55)" : "transparent"}`,
            background: selected.has(v) ? "rgba(32,201,151,0.12)" : "transparent",
            color: selected.has(v) ? COLORS.text : COLORS.muted,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 800,
          }}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

function CheckLine({
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
        padding: "8px 8px",
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
        background: "transparent",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 12, fontWeight: 900, color: COLORS.text }}>{label}</span>
    </label>
  );
}

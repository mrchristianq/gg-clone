"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

type Row = Record<string, string>;

type Game = {
  title: string;
  coverUrl: string;

  // filters
  platforms: string[];
  genres: string[];
  yearPlayed: string[];

  status: string;
  ownership: string;
  format: string;

  backlog: string;
  completed: string;

  releaseDate: string; // ISO yyyy-mm-dd (or blank)
  dateAdded: string; // ISO yyyy-mm-dd (or blank)
};

const CSV_URL =
  process.env.NEXT_PUBLIC_CSV_URL ||
  "PASTE_YOUR_CSV_URL_HERE"; // keep as fallback, but ideally set env var

const COLORS = {
  bg: "#0b0f14",
  panel: "#0f1620",
  card: "#0f1620",
  border: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.58)",
  green: "#20c997",
  soft: "rgba(32,201,151,0.18)",
};

function splitTags(v: string | undefined | null): string[] {
  if (!v) return [];
  return String(v)
    .split(/[,|]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function norm(v: any): string {
  return String(v ?? "").trim();
}

function titleKey(t: string): string {
  return norm(t).toLowerCase();
}

function parseISODateToMs(s: string): number {
  const v = norm(s);
  if (!v) return 0;
  // Expect yyyy-mm-dd
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : 0;
}

function toBool(v: string): boolean {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}

function pickCover(row: Row): string {
  // Prefer LocalCoverURL if present; fall back to CoverURL
  const local = norm(row["LocalCoverURL"]);
  if (local) return local;
  return norm(row["CoverURL"] || row["Cover"] || row["CoverURL "]);
}

function rowToGame(row: Row): Game {
  const title = norm(row["Title"] || row["Name"] || row["title"]);
  return {
    title,
    coverUrl: pickCover(row),

    platforms: splitTags(row["Platforms"] || row["Platform"]),
    genres: splitTags(row["Genres"] || row["Genre"]),
    yearPlayed: splitTags(row["YearPlayed"] || row["Year Played"]),

    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),

    releaseDate: norm(row["ReleaseDate"] || row["Release Date"]),
    dateAdded: norm(row["DateAdded"] || row["Date Added"]),
  };
}

function uniqSorted(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function dedupeByTitle(games: Game[]): Game[] {
  const map = new Map<string, Game>();

  for (const g of games) {
    const key = titleKey(g.title);
    if (!key) continue;

    const existing = map.get(key);
    if (!existing) {
      map.set(key, g);
      continue;
    }

    // merge: union arrays, prefer whichever has cover, releaseDate, dateAdded, etc.
    const merged: Game = {
      title: existing.title || g.title,
      coverUrl: existing.coverUrl || g.coverUrl,

      platforms: uniqSorted([...existing.platforms, ...g.platforms]),
      genres: uniqSorted([...existing.genres, ...g.genres]),
      yearPlayed: uniqSorted([...existing.yearPlayed, ...g.yearPlayed]),

      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,

      backlog: existing.backlog || g.backlog,
      completed: existing.completed || g.completed,

      releaseDate: existing.releaseDate || g.releaseDate,
      dateAdded: existing.dateAdded || g.dateAdded,
    };

    map.set(key, merged);
  }

  return Array.from(map.values());
}

type SortKey = "releaseDate" | "title" | "dateAdded";
type SortDir = "desc" | "asc";

type ActiveTab = "games" | "queued" | "wishlist";

export default function Page() {
  const [rawRows, setRawRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  // UI state
  const [coverSize, setCoverSize] = useState<number>(100); // ✅ default 100
  const [activeTab, setActiveTab] = useState<ActiveTab>("games");

  // filters (multi-select sets)
  const [selPlatforms, setSelPlatforms] = useState<Set<string>>(new Set());
  const [selGenres, setSelGenres] = useState<Set<string>>(new Set());
  const [selYearPlayed, setSelYearPlayed] = useState<Set<string>>(new Set());

  // checkbox filters
  const [onlyBacklog, setOnlyBacklog] = useState(false);
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [onlyNowPlaying, setOnlyNowPlaying] = useState(false);
  const [onlyAbandoned, setOnlyAbandoned] = useState(false);

  // sort
  const [sortKey, setSortKey] = useState<SortKey>("releaseDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // collapsible sections
  const [openPlatform, setOpenPlatform] = useState(false);
  const [openGenre, setOpenGenre] = useState(false);
  const [openYearPlayed, setOpenYearPlayed] = useState(false);
  const [openSort, setOpenSort] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      setErr("");

      try {
        const res = await fetch(CSV_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
        const text = await res.text();

        const parsed = Papa.parse<Row>(text, {
          header: true,
          skipEmptyLines: true,
        });

        if (!alive) return;

        const rows = (parsed.data || []).filter(Boolean);
        setRawRows(rows);
      } catch (e: any) {
        if (!alive) return;
        setErr(String(e?.message || e));
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const gamesAll = useMemo(() => {
    const games = rawRows
      .map(rowToGame)
      .filter((g) => titleKey(g.title).length > 0);

    // ✅ remove duplicates
    return dedupeByTitle(games);
  }, [rawRows]);

  // sidebar option counts
  const platformCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gamesAll) for (const p of g.platforms) m.set(p, (m.get(p) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [gamesAll]);

  const genreCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gamesAll) for (const x of g.genres) m.set(x, (m.get(x) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [gamesAll]);

  const yearPlayedCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of gamesAll) for (const y of g.yearPlayed) m.set(y, (m.get(y) || 0) + 1);
    // numeric-ish sort desc
    return Array.from(m.entries()).sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [gamesAll]);

  const currentYear = new Date().getFullYear();

  // top stats
  const stats = useMemo(() => {
    const total = gamesAll.length;
    const queued = gamesAll.filter((g) => norm(g.status).toLowerCase() === "queued").length;
    const wish = gamesAll.filter((g) => norm(g.ownership).toLowerCase() === "wishlist").length;
    const playedThisYear = gamesAll.filter((g) => g.yearPlayed.includes(String(currentYear))).length;
    return { total, queued, wish, playedThisYear };
  }, [gamesAll, currentYear]);

  const filtered = useMemo(() => {
    let list = [...gamesAll];

    // top tabs behavior
    if (activeTab === "queued") {
      list = list.filter((g) => norm(g.status).toLowerCase() === "queued");
    } else if (activeTab === "wishlist") {
      list = list.filter((g) => norm(g.ownership).toLowerCase() === "wishlist");
    }

    // checkbox filters
    if (onlyBacklog) list = list.filter((g) => toBool(g.backlog));
    if (onlyCompleted) list = list.filter((g) => toBool(g.completed));
    if (onlyNowPlaying) list = list.filter((g) => norm(g.status).toLowerCase() === "now playing");
    if (onlyAbandoned) list = list.filter((g) => norm(g.status).toLowerCase() === "abandoned");

    // multi-select filters
    if (selPlatforms.size) {
      list = list.filter((g) => g.platforms.some((p) => selPlatforms.has(p)));
    }
    if (selGenres.size) {
      list = list.filter((g) => g.genres.some((x) => selGenres.has(x)));
    }
    if (selYearPlayed.size) {
      list = list.filter((g) => g.yearPlayed.some((y) => selYearPlayed.has(y)));
    }

    // sort
    const dir = sortDir === "asc" ? 1 : -1;

    list.sort((a, b) => {
      if (sortKey === "title") {
        return a.title.localeCompare(b.title) * dir;
      }
      if (sortKey === "dateAdded") {
        const am = parseISODateToMs(a.dateAdded);
        const bm = parseISODateToMs(b.dateAdded);
        if (am === bm) return a.title.localeCompare(b.title);
        return (am - bm) * dir;
      }
      // releaseDate
      const am = parseISODateToMs(a.releaseDate);
      const bm = parseISODateToMs(b.releaseDate);
      if (am === bm) return a.title.localeCompare(b.title);
      return (am - bm) * dir;
    });

    return list;
  }, [
    gamesAll,
    activeTab,
    onlyBacklog,
    onlyCompleted,
    onlyNowPlaying,
    onlyAbandoned,
    selPlatforms,
    selGenres,
    selYearPlayed,
    sortKey,
    sortDir,
  ]);

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, set: Set<string>, val: string) {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setter(next);
  }

  function clearAllFilters() {
    setSelPlatforms(new Set());
    setSelGenres(new Set());
    setSelYearPlayed(new Set());
    setOnlyBacklog(false);
    setOnlyCompleted(false);
    setOnlyNowPlaying(false);
    setOnlyAbandoned(false);
  }

  const Tab = ({
    id,
    label,
  }: {
    id: ActiveTab;
    label: string;
  }) => {
    const active = activeTab === id;
    return (
      <button
        onClick={() => setActiveTab(id)}
        style={{
          background: "transparent",
          border: "none",
          padding: "10px 8px",
          cursor: "pointer",
          color: active ? COLORS.text : COLORS.muted,
          fontSize: 18, // ✅ bigger font
          fontWeight: 900,
          letterSpacing: 0.2,
          position: "relative",
        }}
      >
        {label}
        <span
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            bottom: 4,
            height: 3,
            borderRadius: 999,
            background: active ? COLORS.green : "transparent", // ✅ green underline
          }}
        />
      </button>
    );
  };

  const Stat = ({ n, label }: { n: number; label: string }) => (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 18, fontWeight: 950, lineHeight: 1.1 }}>{n}</div>
      <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 800 }}>{label}</div>
    </div>
  );

  const CountPill = ({ n }: { n: number }) => (
    <span
      style={{
        minWidth: 24,
        height: 18,
        padding: "0 8px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(255,255,255,0.12)",
        color: COLORS.text,
        fontSize: 11,
        fontWeight: 900,
      }}
    >
      {n}
    </span>
  );

  const SectionHeader = ({
    title,
    open,
    onToggle,
  }: {
    title: string;
    open: boolean;
    onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      style={{
        width: "100%",
        background: "transparent",
        border: "none",
        padding: "10px 0",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        color: COLORS.text,
        fontWeight: 950,
        fontSize: 12,
        letterSpacing: 0.8,
        textTransform: "uppercase",
      }}
    >
      <span>{title}</span>
      <span style={{ color: COLORS.muted, fontSize: 12 }}>{open ? "–" : "+"}</span>
    </button>
  );

  const CheckRow = ({
    label,
    checked,
    onChange,
  }: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
  }) => (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        cursor: "pointer",
        userSelect: "none",
        fontSize: 12,
        fontWeight: 800,
        color: COLORS.text,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 14, height: 14 }}
      />
      {label}
    </label>
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      }}
    >
      {/* top header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          background: "rgba(11,15,20,0.86)",
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          {/* left: title + tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 18, fontWeight: 950 }}>Chris&apos; Game Library</div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Tab id="games" label="Games" />
              <Tab id="queued" label="Backlog Queue" />
              <Tab id="wishlist" label="Wishlist" />
            </div>
          </div>

          {/* right: stats */}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Stat n={stats.total} label="Games" />
            <Stat n={stats.queued} label="Queued" />
            <Stat n={stats.wish} label="Wishlist" />
            <Stat n={stats.playedThisYear} label={`Played in ${currentYear}`} />
          </div>
        </div>
      </div>

      {/* layout */}
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: 16,
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 16,
        }}
      >
        {/* left panel */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 14,
            height: "fit-content",
          }}
        >
          {/* Cover size */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 950, marginBottom: 8, letterSpacing: 0.8, textTransform: "uppercase" }}>
              Cover Size
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="range"
                min={60}
                max={180}
                value={coverSize}
                onChange={(e) => setCoverSize(Number(e.target.value))}
                style={{ width: "100%" }}
              />
              <div style={{ width: 40, textAlign: "right", color: COLORS.muted, fontWeight: 900, fontSize: 12 }}>
                {coverSize}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 12, fontWeight: 950, letterSpacing: 0.8, textTransform: "uppercase" }}>
                Filters
              </div>
              <button
                onClick={clearAllFilters}
                style={{
                  background: "transparent",
                  border: "none",
                  color: COLORS.green,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                Clear
              </button>
            </div>

            {/* ✅ aligned 2-column checkboxes */}
            <div
              style={{
                marginTop: 10,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px 14px",
              }}
            >
              <CheckRow label="Backlog" checked={onlyBacklog} onChange={setOnlyBacklog} />
              <CheckRow label="Now Playing" checked={onlyNowPlaying} onChange={setOnlyNowPlaying} />
              <CheckRow label="Completed" checked={onlyCompleted} onChange={setOnlyCompleted} />
              <CheckRow label="Abandoned" checked={onlyAbandoned} onChange={setOnlyAbandoned} />
            </div>
          </div>

          {/* Sort */}
          <div style={{ marginTop: 14 }}>
            <SectionHeader title="Sort" open={openSort} onToggle={() => setOpenSort((v) => !v)} />
            {openSort && (
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 12, fontWeight: 800, color: COLORS.text }}>
                  Sort by
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    style={{
                      width: "100%",
                      marginTop: 6,
                      padding: "10px 10px",
                      borderRadius: 12,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.bg,
                      color: COLORS.text,
                      fontWeight: 800,
                    }}
                  >
                    <option value="releaseDate">Release Date</option>
                    <option value="dateAdded">Date Added</option>
                    <option value="title">Title</option>
                  </select>
                </label>

                <label style={{ fontSize: 12, fontWeight: 800, color: COLORS.text }}>
                  Direction
                  <select
                    value={sortDir}
                    onChange={(e) => setSortDir(e.target.value as SortDir)}
                    style={{
                      width: "100%",
                      marginTop: 6,
                      padding: "10px 10px",
                      borderRadius: 12,
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.bg,
                      color: COLORS.text,
                      fontWeight: 800,
                    }}
                  >
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </label>
              </div>
            )}
          </div>

          {/* Platform */}
          <div style={{ marginTop: 8 }}>
            <SectionHeader title="Platform" open={openPlatform} onToggle={() => setOpenPlatform((v) => !v)} />
            {openPlatform && (
              <div style={{ display: "grid", gap: 6 }}>
                {platformCounts.map(([name, n]) => {
                  const active = selPlatforms.has(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggleSet(setSelPlatforms, selPlatforms, name)}
                      style={{
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        padding: "6px 0",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: active ? COLORS.text : COLORS.muted,
                        fontSize: 12,
                        fontWeight: active ? 950 : 800,
                      }}
                    >
                      <span>{name}</span>
                      <CountPill n={n} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Genre */}
          <div style={{ marginTop: 8 }}>
            <SectionHeader title="Genre" open={openGenre} onToggle={() => setOpenGenre((v) => !v)} />
            {openGenre && (
              <div style={{ display: "grid", gap: 6 }}>
                {genreCounts.map(([name, n]) => {
                  const active = selGenres.has(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggleSet(setSelGenres, selGenres, name)}
                      style={{
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        padding: "6px 0",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: active ? COLORS.text : COLORS.muted,
                        fontSize: 12,
                        fontWeight: active ? 950 : 800,
                      }}
                    >
                      <span>{name}</span>
                      <CountPill n={n} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Year Played */}
          <div style={{ marginTop: 8 }}>
            <SectionHeader title="Year Played" open={openYearPlayed} onToggle={() => setOpenYearPlayed((v) => !v)} />
            {openYearPlayed && (
              <div style={{ display: "grid", gap: 6 }}>
                {yearPlayedCounts.map(([name, n]) => {
                  const active = selYearPlayed.has(name);
                  return (
                    <button
                      key={name}
                      onClick={() => toggleSet(setSelYearPlayed, selYearPlayed, name)}
                      style={{
                        width: "100%",
                        background: "transparent",
                        border: "none",
                        padding: "6px 0",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        color: active ? COLORS.text : COLORS.muted,
                        fontSize: 12,
                        fontWeight: active ? 950 : 800,
                      }}
                    >
                      <span>{name}</span>
                      <CountPill n={n} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* info */}
          <div style={{ marginTop: 14, color: COLORS.muted, fontSize: 11, lineHeight: 1.4 }}>
            {loading ? "Loading..." : `Showing ${filtered.length} of ${gamesAll.length}`}
            {err ? <div style={{ marginTop: 6, color: "#ff6b6b" }}>{err}</div> : null}
          </div>
        </aside>

        {/* main grid */}
        <main>
          {loading ? (
            <div style={{ color: COLORS.muted, fontWeight: 800, padding: 10 }}>Loading…</div>
          ) : err ? (
            <div style={{ color: "#ff6b6b", fontWeight: 900, padding: 10 }}>{err}</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: COLORS.muted, fontWeight: 800, padding: 10 }}>
              No games match your filters.
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
                gap: 12,
                alignItems: "start",
              }}
            >
              {filtered.map((g, i) => (
                <div
                  key={`${titleKey(g.title)}-${i}`}
                  style={{
                    aspectRatio: "2 / 3",
                    background: COLORS.card,
                    borderRadius: 14,
                    overflow: "hidden",
                    border: `1px solid ${COLORS.border}`,
                    boxShadow: "0 20px 40px rgba(0,0,0,.55)",
                  }}
                  title={g.title}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      loading="lazy"
                      onError={(e) => {
                        // hide broken image
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
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
                        fontWeight: 800,
                        padding: 10,
                        textAlign: "center",
                      }}
                    >
                      No cover
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* responsive */}
      <style>{`
        @media (max-width: 980px) {
          .twoCol {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

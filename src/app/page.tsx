"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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

  releaseDate: string;
  dateAdded: string;

  backlog: string;
  completed: string;
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

const COLORS = {
  bg: "#0b0d10",
  panel: "#0f1318",
  card: "#141a22",
  border: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.60)",
  faint: "rgba(255,255,255,0.45)",
  green: "#22c55e",
  greenSoft: "rgba(34,197,94,0.22)",
};

const DEFAULT_COVER_SIZE = 100;
const MOBILE_BREAKPOINT = 860;

function titleKey(t: string) {
  return (t || "").trim().toLowerCase();
}

function norm(v?: string) {
  return String(v ?? "").trim();
}

function toBool(v: string) {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "checked";
}

function splitTags(v?: string) {
  const s = norm(v);
  if (!s) return [];
  // split on comma or semicolon
  return s
    .split(/[,;]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseDateLike(s: string): number {
  // Accept "yyyy-mm-dd" or "mm/dd/yyyy" etc.
  const t = norm(s);
  if (!t) return 0;
  const d = new Date(t);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function pickCover(row: Row) {
  // prefer CoverURL, fallback CoverURL column variants
  const a = norm(row["CoverURL"]);
  const b = norm(row["Cover Url"]);
  const c = norm(row["CoverURL "]);
  return a || b || c;
}

function rowToGame(row: Row): Game {
  const title = norm(row["Title"] || row["Name"]);

  return {
    title,
    coverUrl: pickCover(row),

    platforms: splitTags(row["Platforms"] || row["Platform"]),
    genres: splitTags(row["Genres"]),
    yearPlayed: splitTags(row["YearPlayed"] || row["Year Played"]),

    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    releaseDate: norm(row["ReleaseDate"] || row["Release Date"]),
    dateAdded: norm(row["DateAdded"] || row["Date Added"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
  };
}

function dedupeByTitle(games: Game[]) {
  // If there are duplicates due to multiple platforms, keep 1 per title and merge tags.
  const map = new Map<string, Game>();
  for (const g of games) {
    const k = titleKey(g.title);
    if (!k) continue;

    const existing = map.get(k);
    if (!existing) {
      map.set(k, g);
      continue;
    }

    const mergedPlatforms = Array.from(new Set([...(existing.platforms || []), ...(g.platforms || [])])).sort();
    const mergedGenres = Array.from(new Set([...(existing.genres || []), ...(g.genres || [])])).sort();
    const mergedYearPlayed = Array.from(new Set([...(existing.yearPlayed || []), ...(g.yearPlayed || [])])).sort();

    map.set(k, {
      ...existing,
      // prefer a cover if existing missing
      coverUrl: existing.coverUrl || g.coverUrl,
      platforms: mergedPlatforms,
      genres: mergedGenres,
      yearPlayed: mergedYearPlayed,
      // keep “best” strings if missing
      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,
      releaseDate: existing.releaseDate || g.releaseDate,
      dateAdded: existing.dateAdded || g.dateAdded,
      backlog: existing.backlog || g.backlog,
      completed: existing.completed || g.completed,
    });
  }

  return Array.from(map.values());
}

type TabKey = "games" | "nowPlaying" | "queued" | "wishlist" | "completed";

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [coverSize, setCoverSize] = useState<number>(DEFAULT_COVER_SIZE);

  // Filters
  const [selGenres, setSelGenres] = useState<string[]>([]);
  const [selPlatforms, setSelPlatforms] = useState<string[]>([]);
  const [selYearPlayed, setSelYearPlayed] = useState<string[]>([]);

  const [onlyBacklog, setOnlyBacklog] = useState(false);
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [onlyNowPlaying, setOnlyNowPlaying] = useState(false);
  const [onlyAbandoned, setOnlyAbandoned] = useState(false);

  const [sortBy, setSortBy] = useState<"releaseDate" | "title" | "dateAdded">("releaseDate");

  // Tabs
  const [activeTab, setActiveTab] = useState<TabKey>("games");

  // Responsive
  const [isMobile, setIsMobile] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const didInitFilters = useRef(false);

  useEffect(() => {
    const onResize = () => {
      const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
      setIsMobile(mobile);

      // initialize filtersOpen once based on current size
      if (!didInitFilters.current) {
        setFiltersOpen(!mobile); // ✅ closed on mobile, open on desktop
        didInitFilters.current = true;
      }
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);

    fetch(CSV_URL, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (!alive) return;
        const parsed = Papa.parse<Row>(text, {
          header: true,
          skipEmptyLines: true,
        });
        setRows((parsed.data || []).filter((r) => r && Object.keys(r).length));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(String(e));
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const games = useMemo(() => {
    const g = rows.map(rowToGame).filter((x) => x.title);
    return dedupeByTitle(g);
  }, [rows]);

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) for (const x of g.genres) set.add(x);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const allPlatforms = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) for (const x of g.platforms) set.add(x);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [games]);

  const allYears = useMemo(() => {
    const set = new Set<string>();
    for (const g of games) for (const y of g.yearPlayed) set.add(y);
    return Array.from(set).sort((a, b) => (a < b ? 1 : -1)); // newest first
  }, [games]);

  // Tab predicates (based on your new top menu logic)
  const tabFiltered = useMemo(() => {
    const nowPlaying = (g: Game) => norm(g.status).toLowerCase() === "now playing";
    const queued = (g: Game) => norm(g.status).toLowerCase() === "queued";
    const wishlist = (g: Game) => norm(g.ownership).toLowerCase() === "wishlist";
    const completed = (g: Game) => toBool(g.completed) || norm(g.status).toLowerCase() === "completed";

    return games.filter((g) => {
      if (activeTab === "games") return true;
      if (activeTab === "nowPlaying") return nowPlaying(g);
      if (activeTab === "queued") return queued(g);
      if (activeTab === "wishlist") return wishlist(g);
      if (activeTab === "completed") return completed(g);
      return true;
    });
  }, [games, activeTab]);

  const filtered = useMemo(() => {
    const sGenres = new Set(selGenres);
    const sPlatforms = new Set(selPlatforms);
    const sYears = new Set(selYearPlayed);

    return tabFiltered.filter((g) => {
      // left filters
      if (sGenres.size) {
        const hit = g.genres.some((x) => sGenres.has(x));
        if (!hit) return false;
      }
      if (sPlatforms.size) {
        const hit = g.platforms.some((x) => sPlatforms.has(x));
        if (!hit) return false;
      }
      if (sYears.size) {
        const hit = g.yearPlayed.some((x) => sYears.has(x));
        if (!hit) return false;
      }

      if (onlyBacklog && !toBool(g.backlog)) return false;
      if (onlyCompleted && !toBool(g.completed)) return false;

      if (onlyNowPlaying && norm(g.status).toLowerCase() !== "now playing") return false;
      if (onlyAbandoned && norm(g.status).toLowerCase() !== "abandoned") return false;

      return true;
    });
  }, [
    tabFiltered,
    selGenres,
    selPlatforms,
    selYearPlayed,
    onlyBacklog,
    onlyCompleted,
    onlyNowPlaying,
    onlyAbandoned,
  ]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === "title") {
      arr.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortBy === "dateAdded") {
      arr.sort((a, b) => parseDateLike(b.dateAdded) - parseDateLike(a.dateAdded));
    } else {
      // release date (default)
      arr.sort((a, b) => parseDateLike(b.releaseDate) - parseDateLike(a.releaseDate));
    }
    return arr;
  }, [filtered, sortBy]);

  const toggle = (list: string[], value: string) => {
    const s = new Set(list);
    if (s.has(value)) s.delete(value);
    else s.add(value);
    return Array.from(s);
  };

  // Stats on top right (like your inspiration)
  const totalGames = games.length;
  const totalQueued = games.filter((g) => norm(g.status).toLowerCase() === "queued").length;
  const totalWishlist = games.filter((g) => norm(g.ownership).toLowerCase() === "wishlist").length;
  const totalNowPlaying = games.filter((g) => norm(g.status).toLowerCase() === "now playing").length;
  const totalCompleted = games.filter((g) => toBool(g.completed) || norm(g.status).toLowerCase() === "completed").length;

  const topTabs: { key: TabKey; label: string }[] = [
    { key: "games", label: "Games" },
    { key: "nowPlaying", label: "Now Playing" },
    { key: "queued", label: "Queued" },
    { key: "wishlist", label: "Wishlist" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"',
      }}
    >
      {/* HEADER */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(11,13,16,0.92)",
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: isMobile ? "10px 12px" : "14px 18px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ fontSize: isMobile ? 16 : 18, fontWeight: 900, letterSpacing: 0.2 }}>
              Chris&apos; Game Library
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted }}>
              {loading ? "Loading…" : loadError ? "Error loading CSV" : `${games.length} games`}
            </div>
          </div>

          {/* Stats (compact on mobile) */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16 }}>
            <StatBox label="Games" value={totalGames} compact={isMobile} />
            <StatBox label="Queued" value={totalQueued} compact={isMobile} />
            <StatBox label="Wishlist" value={totalWishlist} compact={isMobile} />
            {!isMobile && <StatBox label="Now Playing" value={totalNowPlaying} compact={false} />}
            {!isMobile && <StatBox label="Completed" value={totalCompleted} compact={false} />}
          </div>
        </div>

        {/* Top tabs row */}
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: isMobile ? "6px 10px 10px" : "8px 18px 12px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: isMobile ? 8 : 14,
              alignItems: "center",
              flexWrap: "nowrap",
              width: "100%",
            }}
          >
            {topTabs.map((t) => {
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: active ? COLORS.text : COLORS.muted,
                    cursor: "pointer",
                    padding: isMobile ? "6px 6px" : "8px 10px",
                    fontSize: isMobile ? 12 : 15, // ✅ smaller on mobile to fit one row
                    fontWeight: 900,
                    letterSpacing: 0.2,
                    borderBottom: active ? `2px solid ${COLORS.green}` : "2px solid transparent",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    flex: isMobile ? "1 1 20%" : "0 0 auto", // ✅ helps fit 5 on one row
                    textAlign: "center",
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Mobile filter toggle */}
          {isMobile && (
            <button
              onClick={() => setFiltersOpen((v) => !v)}
              style={{
                marginLeft: 10,
                height: 34,
                padding: "0 10px",
                borderRadius: 12,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                cursor: "pointer",
                fontWeight: 900,
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              {filtersOpen ? "Hide Filters" : "Show Filters"}
            </button>
          )}
        </div>
      </header>

      <main
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: isMobile ? "12px" : "16px 18px 40px",
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "320px 1fr",
          gap: isMobile ? 12 : 16,
          alignItems: "start",
        }}
      >
        {/* FILTERS */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: isMobile ? 12 : 14,
            display: isMobile && !filtersOpen ? "none" : "block", // ✅ closed by default on mobile
          }}
        >
          {!isMobile && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 900 }}>Filters</div>
            </div>
          )}

          <Section title="Sort">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              style={selectStyle()}
            >
              <option value="releaseDate">Release Date</option>
              <option value="dateAdded">Date Added</option>
              <option value="title">Title</option>
            </select>

            <div style={{ height: 10 }} />

            <div style={{ color: COLORS.muted, fontSize: 12, marginBottom: 6 }}>Cover size</div>
            <input
              type="range"
              min={60}
              max={180}
              value={coverSize}
              onChange={(e) => setCoverSize(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>{coverSize}px</div>
          </Section>

          <Section title="Flags">
            {/* Row 1: Backlog + Now Playing */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <CheckRow
                label="Backlog"
                checked={onlyBacklog}
                onChange={setOnlyBacklog}
              />
              <CheckRow
                label="Now Playing"
                checked={onlyNowPlaying}
                onChange={setOnlyNowPlaying}
              />
            </div>

            {/* Row 2: Completed + Abandoned */}
            <div style={{ height: 6 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <CheckRow
                label="Completed"
                checked={onlyCompleted}
                onChange={setOnlyCompleted}
              />
              <CheckRow
                label="Abandoned"
                checked={onlyAbandoned}
                onChange={setOnlyAbandoned}
              />
            </div>
          </Section>

          <Section title="Platform">
            <OptionList
              options={allPlatforms}
              selected={selPlatforms}
              onToggle={(v) => setSelPlatforms(toggle(selPlatforms, v))}
              counts={countByOption(games, (g) => g.platforms)}
            />
          </Section>

          <Section title="Genre">
            <OptionList
              options={allGenres}
              selected={selGenres}
              onToggle={(v) => setSelGenres(toggle(selGenres, v))}
              counts={countByOption(games, (g) => g.genres)}
            />
          </Section>

          <Section title="Year Played">
            <OptionList
              options={allYears}
              selected={selYearPlayed}
              onToggle={(v) => setSelYearPlayed(toggle(selYearPlayed, v))}
              counts={countByOption(games, (g) => g.yearPlayed)}
            />
          </Section>

          <button
            onClick={() => {
              setSelGenres([]);
              setSelPlatforms([]);
              setSelYearPlayed([]);
              setOnlyBacklog(false);
              setOnlyCompleted(false);
              setOnlyNowPlaying(false);
              setOnlyAbandoned(false);
            }}
            style={{
              width: "100%",
              height: 40,
              borderRadius: 12,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.text,
              cursor: "pointer",
              fontWeight: 900,
              marginTop: 10,
            }}
          >
            Clear filters
          </button>
        </aside>

        {/* GRID */}
        <section>
          {loadError && (
            <div
              style={{
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.panel,
                color: COLORS.text,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Couldn’t load your sheet</div>
              <div style={{ color: COLORS.muted }}>{loadError}</div>
            </div>
          )}

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
              gap: 12,
            }}
          >
            {sorted.map((g, i) => (
              <div
                key={`${titleKey(g.title)}-${i}`}
                style={{
                  aspectRatio: "2 / 3",
                  background: COLORS.card,
                  borderRadius: 14,
                  overflow: "hidden",
                  boxShadow: "0 20px 40px rgba(0,0,0,.6)",
                  border: `1px solid ${COLORS.border}`,
                }}
                title={g.title}
              >
                {g.coverUrl ? (
                  <img
                    src={g.coverUrl}
                    alt={g.title}
                    loading="lazy"
                    onError={(e) => {
                      const img = e.currentTarget;
                      img.style.display = "none";
                      const parent = img.parentElement;
                      if (parent) parent.setAttribute("data-cover-failed", "1");
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
                    }}
                  >
                    No cover
                  </div>
                )}

                {/* Fallback label if image hidden */}
                <div
                  style={{
                    display: "none",
                    height: "100%",
                    padding: 10,
                    color: COLORS.muted,
                    fontSize: 12,
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  Cover failed
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

/* ---------- Components ---------- */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false); // default closed (your preference)
  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          color: COLORS.text,
          cursor: "pointer",
          padding: "6px 2px",
          fontWeight: 900,
        }}
      >
        <span>{title}</span>
        <span style={{ color: COLORS.muted, fontSize: 12 }}>{open ? "–" : "+"}</span>
      </button>

      {open && <div style={{ marginTop: 6 }}>{children}</div>}

      <div style={{ height: 1, background: COLORS.border, marginTop: 10 }} />
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.text }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontWeight: 800 }}>{label}</span>
    </label>
  );
}

function OptionList({
  options,
  selected,
  onToggle,
  counts,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
  counts: Map<string, number>;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {options.map((opt) => {
        const active = selected.includes(opt);
        const count = counts.get(opt) || 0;
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 2px", // tight spacing
              color: active ? COLORS.text : COLORS.muted,
              fontSize: 12, // smaller font
              fontWeight: 800,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt}</span>
            <span
              style={{
                minWidth: 22,
                height: 18,
                padding: "0 6px",
                borderRadius: 999,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: active ? COLORS.greenSoft : "rgba(255,255,255,0.08)",
                color: active ? COLORS.text : COLORS.muted,
                fontSize: 11,
                fontWeight: 900,
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StatBox({ label, value, compact }: { label: string; value: number; compact: boolean }) {
  return (
    <div style={{ textAlign: "right", minWidth: compact ? 44 : 64 }}>
      <div style={{ fontSize: compact ? 13 : 16, fontWeight: 900, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 2, whiteSpace: "nowrap" }}>{label}</div>
    </div>
  );
}

function countByOption(games: Game[], getter: (g: Game) => string[]) {
  const m = new Map<string, number>();
  for (const g of games) {
    const arr = getter(g) || [];
    for (const a of arr) {
      const k = norm(a);
      if (!k) continue;
      m.set(k, (m.get(k) || 0) + 1);
    }
  }
  return m;
}

function selectStyle(): React.CSSProperties {
  return {
    width: "100%",
    height: 38,
    borderRadius: 12,
    background: COLORS.card,
    border: `1px solid ${COLORS.border}`,
    color: COLORS.text,
    padding: "0 10px",
    fontWeight: 800,
    fontSize: 12,
    outline: "none",
  };
}

// DEPLOY_TEST: 2025-12-16
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

type Row = Record<string, string>;

type Game = {
  title: string;
  coverUrl: string;

  platform: string; // some sheets have single Platform
  platforms: string[];

  status: string;
  ownership: string;
  format: string;

  genres: string[];
  yearPlayed: string[];

  releaseDate: string;
  dateAdded: string;

  backlog: string;
  completed: string;

  igdbId: string;
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

// ---------- styling ----------
const COLORS = {
  bg: "#0b0d10",
  panel: "#0f1217",
  card: "#10141b",
  border: "rgba(255,255,255,0.08)",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.65)",
  faint: "rgba(255,255,255,0.45)",
  green: "#27e08a",
};

function toBool(v: string) {
  const s = String(v || "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y" || s === "checked";
}

function norm(v: string) {
  return String(v ?? "").trim();
}

function splitTags(v: string) {
  const s = norm(v);
  if (!s) return [];
  return s
    .split(/[;,|]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function titleKey(t: string) {
  return norm(t).toLowerCase();
}

function parseDateMs(s: string) {
  // expects yyyy-mm-dd mostly; Date() will handle some variants
  const d = new Date(s);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function pickCover(row: Row) {
  // Prefer CoverURL; keep your old fallback if you had CoverURL vs CoverURL column
  return norm(row["CoverURL"] || row["CoverUrl"] || row["Cover"] || row["Cover URL"]);
}

function rowToGame(row: Row): Game {
  const title = norm(row["Title"] || row["Name"] || "");
  const coverUrl = pickCover(row);

  const platforms = splitTags(row["Platforms"] || "");
  const platform = norm(row["Platform"] || "");

  return {
    title,
    coverUrl,

    platform,
    platforms,

    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    genres: splitTags(row["Genres"]),
    yearPlayed: splitTags(row["YearPlayed"]),

    releaseDate: norm(row["ReleaseDate"] || row["Release Date"]),
    dateAdded: norm(row["DateAdded"] || row["Date Added"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),

    igdbId: norm(row["IGDB_ID"] || row["IGDB ID"]),
  };
}

// Dedupe by IGDB_ID if possible; else Title
function dedupeGames(games: Game[]): Game[] {
  const byId = new Map<string, Game>();
  const byTitle = new Map<string, Game>();

  for (const g of games) {
    const id = norm(g.igdbId);
    if (id) {
      if (!byId.has(id)) byId.set(id, g);
      continue;
    }
    const k = titleKey(g.title);
    if (!k) continue;
    if (!byTitle.has(k)) byTitle.set(k, g);
  }

  // Keep stable-ish order: first all byId in insertion order, then byTitle
  return [...byId.values(), ...byTitle.values()];
}

type ViewMode = "games" | "nowPlaying" | "queued" | "wishlist" | "completed";

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // cover size default = 100
  const [coverSize, setCoverSize] = useState(100);

  // top nav
  const [view, setView] = useState<ViewMode>("games");

  // ---- your existing filters (keep as-is, add more if you already have them) ----
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string[]>([]);
  const [selectedOwnership, setSelectedOwnership] = useState<string[]>([]);
  const [selectedFormat, setSelectedFormat] = useState<string[]>([]);
  const [selectedYearPlayed, setSelectedYearPlayed] = useState<string[]>([]);

  const [filterBacklog, setFilterBacklog] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);

  // basic sorts (no custom)
  const [sortKey, setSortKey] = useState<"releaseDate" | "title" | "dateAdded">("releaseDate");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");

    fetch(CSV_URL, { cache: "no-store" })
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;
        const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
        const data = (parsed.data || []).filter((r) => r && Object.keys(r).length > 0);
        setRows(data);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setErr(String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const allGames = useMemo(() => {
    const games = rows
      .map(rowToGame)
      .filter((g) => g.title && g.coverUrl); // keep covers only; change if you want "No cover"
    return dedupeGames(games);
  }, [rows]);

  // build option lists
  const optionCounts = useMemo(() => {
    const counts = {
      genres: new Map<string, number>(),
      platforms: new Map<string, number>(),
      status: new Map<string, number>(),
      ownership: new Map<string, number>(),
      format: new Map<string, number>(),
      yearPlayed: new Map<string, number>(),
    };

    for (const g of allGames) {
      for (const x of g.genres) counts.genres.set(x, (counts.genres.get(x) || 0) + 1);

      const plats = g.platforms.length ? g.platforms : g.platform ? [g.platform] : [];
      for (const x of plats) counts.platforms.set(x, (counts.platforms.get(x) || 0) + 1);

      if (g.status) counts.status.set(g.status, (counts.status.get(g.status) || 0) + 1);
      if (g.ownership) counts.ownership.set(g.ownership, (counts.ownership.get(g.ownership) || 0) + 1);
      if (g.format) counts.format.set(g.format, (counts.format.get(g.format) || 0) + 1);

      for (const x of g.yearPlayed) counts.yearPlayed.set(x, (counts.yearPlayed.get(x) || 0) + 1);
    }

    const toList = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));

    return {
      genres: toList(counts.genres),
      platforms: toList(counts.platforms),
      status: toList(counts.status),
      ownership: toList(counts.ownership),
      format: toList(counts.format),
      yearPlayed: toList(counts.yearPlayed).sort((a, b) => Number(b.label) - Number(a.label)),
    };
  }, [allGames]);

  // Apply top-nav view filters FIRST
  const viewFiltered = useMemo(() => {
    return allGames.filter((g) => {
      if (view === "games") return true;
      if (view === "nowPlaying") return norm(g.status).toLowerCase() === "now playing";
      if (view === "queued") return norm(g.status).toLowerCase() === "queued";
      if (view === "wishlist") return norm(g.ownership).toLowerCase() === "wishlist";
      if (view === "completed") {
        const statusCompleted = norm(g.status).toLowerCase() === "completed";
        const completedFlag = toBool(g.completed);
        return statusCompleted || completedFlag;
      }
      return true;
    });
  }, [allGames, view]);

  // Apply left-panel filters
  const filtered = useMemo(() => {
    return viewFiltered.filter((g) => {
      if (filterBacklog && !toBool(g.backlog)) return false;
      if (filterCompleted && !toBool(g.completed) && norm(g.status).toLowerCase() !== "completed") return false;

      if (selectedGenres.length) {
        const set = new Set(g.genres.map((x) => x.toLowerCase()));
        if (!selectedGenres.some((x) => set.has(x.toLowerCase()))) return false;
      }

      if (selectedPlatforms.length) {
        const plats = g.platforms.length ? g.platforms : g.platform ? [g.platform] : [];
        const set = new Set(plats.map((x) => x.toLowerCase()));
        if (!selectedPlatforms.some((x) => set.has(x.toLowerCase()))) return false;
      }

      if (selectedStatus.length) {
        if (!selectedStatus.some((x) => x.toLowerCase() === g.status.toLowerCase())) return false;
      }

      if (selectedOwnership.length) {
        if (!selectedOwnership.some((x) => x.toLowerCase() === g.ownership.toLowerCase())) return false;
      }

      if (selectedFormat.length) {
        if (!selectedFormat.some((x) => x.toLowerCase() === g.format.toLowerCase())) return false;
      }

      if (selectedYearPlayed.length) {
        const set = new Set(g.yearPlayed.map((x) => x.toLowerCase()));
        if (!selectedYearPlayed.some((x) => set.has(x.toLowerCase()))) return false;
      }

      return true;
    });
  }, [
    viewFiltered,
    filterBacklog,
    filterCompleted,
    selectedGenres,
    selectedPlatforms,
    selectedStatus,
    selectedOwnership,
    selectedFormat,
    selectedYearPlayed,
  ]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    const dir = sortDir === "desc" ? -1 : 1;

    arr.sort((a, b) => {
      if (sortKey === "title") {
        return a.title.localeCompare(b.title) * dir;
      }
      if (sortKey === "dateAdded") {
        return (parseDateMs(a.dateAdded) - parseDateMs(b.dateAdded)) * dir;
      }
      // releaseDate default
      return (parseDateMs(a.releaseDate) - parseDateMs(b.releaseDate)) * dir;
    });

    return arr;
  }, [filtered, sortKey, sortDir]);

  // header stats (you can keep these even if you change later)
  const stats = useMemo(() => {
    const total = allGames.length;
    const queued = allGames.filter((g) => norm(g.status).toLowerCase() === "queued").length;
    const wishlist = allGames.filter((g) => norm(g.ownership).toLowerCase() === "wishlist").length;

    const now = new Date();
    const year = now.getFullYear();
    const playedThisYear = allGames.filter((g) => g.yearPlayed.includes(String(year))).length;

    return { total, queued, wishlist, playedThisYear, year };
  }, [allGames]);

  function toggleMulti(current: string[], value: string) {
    const v = value.trim();
    if (!v) return current;
    const exists = current.some((x) => x.toLowerCase() === v.toLowerCase());
    if (exists) return current.filter((x) => x.toLowerCase() !== v.toLowerCase());
    return [...current, v];
  }

  function OptionList({
    title,
    options,
    selected,
    onToggle,
  }: {
    title: string;
    options: { label: string; count: number }[];
    selected: string[];
    onToggle: (label: string) => void;
  }) {
    return (
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: COLORS.muted, marginBottom: 6 }}>
          {title.toUpperCase()}
        </div>

        <div style={{ display: "grid", gap: 4 }}>
          {options.map((o) => {
            const active = selected.some((x) => x.toLowerCase() === o.label.toLowerCase());
            return (
              <button
                key={o.label}
                onClick={() => onToggle(o.label)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "6px 8px",
                  borderRadius: 10,
                  background: active ? "rgba(39,224,138,0.12)" : "transparent",
                  border: active ? `1px solid rgba(39,224,138,0.35)` : `1px solid ${COLORS.border}`,
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                <span style={{ opacity: active ? 1 : 0.9 }}>{o.label}</span>
                <span
                  style={{
                    minWidth: 28,
                    textAlign: "center",
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 999,
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.muted,
                    background: "rgba(255,255,255,0.03)",
                  }}
                >
                  {o.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const Tab = ({
    id,
    label,
  }: {
    id: ViewMode;
    label: string;
  }) => {
    const active = view === id;
    return (
      <button
        onClick={() => setView(id)}
        style={{
          background: "transparent",
          border: "none",
          padding: "10px 8px",
          cursor: "pointer",
          color: active ? COLORS.text : COLORS.muted,
          fontWeight: 900,
          fontSize: 16, // ✅ bigger
          position: "relative",
          whiteSpace: "nowrap",
        }}
      >
        {label}
        <span
          style={{
            position: "absolute",
            left: 8,
            right: 8,
            bottom: 2,
            height: 2,
            borderRadius: 999,
            background: active ? COLORS.green : "transparent",
          }}
        />
      </button>
    );
  };

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
      {/* Header */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(11,13,16,0.92)",
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "14px 14px 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 14,
            flexWrap: "wrap", // ✅ ensures mobile stays visible
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img
              src="https://lh3.googleusercontent.com/a/ACg8ocJytvmuklInlqxJZOFW4Xi1sk40VGv_-UYAYNmYqAzSlBbno9AKeQ=s288-c-no"
              alt="Chris"
              style={{ width: 72, height: 72, borderRadius: 999, border: `1px solid ${COLORS.border}` }}
            />
            <div>
              <div style={{ fontWeight: 900, fontSize: 22, lineHeight: 1.1 }}>Chris&apos; Game Library</div>
              <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 2 }}>
                {loading ? "Loading…" : `${allGames.length} games`}
              </div>
            </div>
          </div>

          {/* Stats on right (kept minimal) */}
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{stats.total}</div>
              <div style={{ fontSize: 11, color: COLORS.muted }}>Games</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{stats.queued}</div>
              <div style={{ fontSize: 11, color: COLORS.muted }}>Queued</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{stats.wishlist}</div>
              <div style={{ fontSize: 11, color: COLORS.muted }}>Wishlist</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{stats.playedThisYear}</div>
              <div style={{ fontSize: 11, color: COLORS.muted }}>Played in {stats.year}</div>
            </div>
          </div>
        </div>

        {/* Top nav tabs */}
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "0 14px 10px",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap", // ✅ show on mobile too
          }}
        >
          <Tab id="games" label="Games" />
          <Tab id="nowPlaying" label="Now Playing" />
          <Tab id="queued" label="Queued" />
          <Tab id="wishlist" label="Wishlist" />
          <Tab id="completed" label="Completed" />
        </div>
      </header>

      {/* Layout */}
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: 14,
          display: "grid",
          gridTemplateColumns: "290px 1fr",
          gap: 14,
        }}
      >
        {/* Left panel */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: 12,
            height: "fit-content",
            position: "sticky",
            top: 140,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Filters</div>
            <button
              onClick={() => {
                setSelectedGenres([]);
                setSelectedPlatforms([]);
                setSelectedStatus([]);
                setSelectedOwnership([]);
                setSelectedFormat([]);
                setSelectedYearPlayed([]);
                setFilterBacklog(false);
                setFilterCompleted(false);
              }}
              style={{
                border: `1px solid ${COLORS.border}`,
                background: "transparent",
                color: COLORS.muted,
                padding: "6px 10px",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 800,
              }}
            >
              Clear
            </button>
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: COLORS.muted, marginBottom: 6 }}>COVER SIZE</div>
            <input
              type="range"
              min={60}
              max={200}
              value={coverSize}
              onChange={(e) => setCoverSize(Number(e.target.value))}
              style={{ width: "100%" }}
            />
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 6 }}>{coverSize}px</div>
          </div>

          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: COLORS.muted, marginBottom: 6 }}>SORT</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { id: "releaseDate", label: "Release Date" },
                { id: "dateAdded", label: "Date Added" },
                { id: "title", label: "Title" },
              ].map((o) => (
                <button
                  key={o.id}
                  onClick={() => setSortKey(o.id as any)}
                  style={{
                    border: `1px solid ${COLORS.border}`,
                    background: sortKey === o.id ? "rgba(39,224,138,0.12)" : "transparent",
                    color: sortKey === o.id ? COLORS.text : COLORS.muted,
                    padding: "6px 10px",
                    borderRadius: 999,
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {o.label}
                </button>
              ))}
              <button
                onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  background: "transparent",
                  color: COLORS.muted,
                  padding: "6px 10px",
                  borderRadius: 999,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 800,
                }}
              >
                {sortDir === "desc" ? "Desc" : "Asc"}
              </button>
            </div>
          </div>

          {/* Backlog / Completed flags */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 900, color: COLORS.muted, marginBottom: 6 }}>FLAGS</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.text }}>
              <input type="checkbox" checked={filterBacklog} onChange={(e) => setFilterBacklog(e.target.checked)} />
              Backlog
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.text, marginTop: 6 }}>
              <input type="checkbox" checked={filterCompleted} onChange={(e) => setFilterCompleted(e.target.checked)} />
              Completed
            </label>
          </div>

          {/* Multi-select option lists */}
          <OptionList
            title="Genres"
            options={optionCounts.genres}
            selected={selectedGenres}
            onToggle={(v) => setSelectedGenres((cur) => toggleMulti(cur, v))}
          />
          <OptionList
            title="Platforms"
            options={optionCounts.platforms}
            selected={selectedPlatforms}
            onToggle={(v) => setSelectedPlatforms((cur) => toggleMulti(cur, v))}
          />
          <OptionList
            title="Status"
            options={optionCounts.status}
            selected={selectedStatus}
            onToggle={(v) => setSelectedStatus((cur) => toggleMulti(cur, v))}
          />
          <OptionList
            title="Ownership"
            options={optionCounts.ownership}
            selected={selectedOwnership}
            onToggle={(v) => setSelectedOwnership((cur) => toggleMulti(cur, v))}
          />
          <OptionList
            title="Format"
            options={optionCounts.format}
            selected={selectedFormat}
            onToggle={(v) => setSelectedFormat((cur) => toggleMulti(cur, v))}
          />
          <OptionList
            title="Year Played"
            options={optionCounts.yearPlayed}
            selected={selectedYearPlayed}
            onToggle={(v) => setSelectedYearPlayed((cur) => toggleMulti(cur, v))}
          />
        </aside>

        {/* Main grid */}
        <main>
          {err ? (
            <div
              style={{
                border: `1px solid ${COLORS.border}`,
                background: COLORS.panel,
                borderRadius: 16,
                padding: 14,
                color: COLORS.text,
              }}
            >
              Error: {err}
            </div>
          ) : null}

          {loading ? (
            <div style={{ color: COLORS.muted, fontSize: 14 }}>Loading…</div>
          ) : null}

          {!loading && sorted.length === 0 ? (
            <div style={{ color: COLORS.muted, fontSize: 14 }}>No games match your filters.</div>
          ) : null}

          <div
            style={{
              marginTop: 10,
              display: "grid",
              gap: 10,
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
            }}
          >
            {sorted.map((g) => (
              <div
                key={g.igdbId ? `igdb-${g.igdbId}` : `t-${titleKey(g.title)}`}
                title={g.title}
                style={{
                  aspectRatio: "2 / 3",
                  background: COLORS.card,
                  borderRadius: 14,
                  overflow: "hidden",
                  border: `1px solid ${COLORS.border}`,
                  boxShadow: "0 18px 40px rgba(0,0,0,.55)",
                }}
              >
                <img
                  src={g.coverUrl}
                  alt={g.title}
                  loading="lazy"
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={(e) => {
                    // fallback: gray block if cover fails
                    const el = e.currentTarget;
                    el.style.display = "none";
                    const parent = el.parentElement;
                    if (parent && !parent.querySelector(".fallback")) {
                      const div = document.createElement("div");
                      div.className = "fallback";
                      div.style.height = "100%";
                      div.style.display = "flex";
                      div.style.alignItems = "center";
                      div.style.justifyContent = "center";
                      div.style.color = COLORS.muted;
                      div.style.fontSize = "12px";
                      div.textContent = "Cover failed";
                      parent.appendChild(div);
                    }
                  }}
                />
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Mobile layout tweak */}
      <style>{`
        @media (max-width: 980px) {
          .layout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

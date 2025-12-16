"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

type Row = Record<string, string>;

type Game = {
  igdbId: string;
  title: string;
  coverUrl: string;

  // Tags / lists
  platforms: string[];
  genres: string[];
  yearPlayed: string[];

  // Singles
  status: string;
  ownership: string;
  format: string;

  // Flags
  backlog: string;
  completed: string;

  // Dates
  releaseDate: string;
  dateAdded: string;

  // Custom ordering
  customOrder: number | null;
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

const COLORS = {
  bg: "#07080a",
  panel: "#0b0d10",
  card: "#0f1216",
  text: "#f2f3f5",
  muted: "rgba(242,243,245,.65)",
  border: "rgba(255,255,255,.10)",
  green: "#21c55d",
};

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function splitTags(v: unknown): string[] {
  const s = norm(v);
  if (!s) return [];
  // Handles "Action, RPG" or "Action|RPG" etc.
  return s
    .split(/[,|;/]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function toBool(v: unknown) {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "✅";
}

function titleKey(s: string) {
  return norm(s).toLowerCase();
}

function parseDateLoose(s: string): number {
  // returns ms timestamp or 0
  const v = norm(s);
  if (!v) return 0;
  const d = new Date(v);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function parseNumberLoose(s: string): number | null {
  const v = norm(s);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToGame(row: Row): Game {
  const igdbId = norm(row["IGDB_ID"]);
  const title = norm(row["Title"] || row["Name"] || "");
  const coverUrl = norm(row["CoverURL"] || row["CoverUrl"] || row["coverUrl"] || "");

  const status = norm(row["Status"]);
  const ownership = norm(row["Ownership"]);
  const format = norm(row["Format"]);

  const platforms = splitTags(row["Platforms"] || row["Platform"]);
  const genres = splitTags(row["Genres"] || row["Genre"]);
  const yearPlayedRaw = norm(row["YearPlayed"] || row["Year Played"]);
  // You asked earlier: do NOT combine years — if a cell has "2024, 2025" treat as two years.
  const yearPlayed = splitTags(yearPlayedRaw);

  const backlog = norm(row["Backlog"]);
  const completed = norm(row["Completed"]);

  const releaseDate = norm(row["ReleaseDate"] || row["Release Date"]);
  const dateAdded = norm(row["DateAdded"] || row["Date Added"]);
  const customOrder = parseNumberLoose(row["CustomOrder"]);

  return {
    igdbId,
    title,
    coverUrl,
    platforms,
    genres,
    yearPlayed,
    status,
    ownership,
    format,
    backlog,
    completed,
    releaseDate,
    dateAdded,
    customOrder,
  };
}

/**
 * Deduplicate by IGDB_ID (preferred), falling back to title if missing.
 * Merge tags/lists.
 */
function dedupeGames(games: Game[]): Game[] {
  const byId = new Map<string, Game>();
  const byTitle = new Map<string, Game>();

  function merge(a: Game, b: Game): Game {
    const uniq = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));
    return {
      ...a,
      // Prefer non-empty basics
      igdbId: a.igdbId || b.igdbId,
      title: a.title || b.title,
      coverUrl: a.coverUrl || b.coverUrl,
      status: a.status || b.status,
      ownership: a.ownership || b.ownership,
      format: a.format || b.format,
      backlog: a.backlog || b.backlog,
      completed: a.completed || b.completed,
      releaseDate: a.releaseDate || b.releaseDate,
      dateAdded: a.dateAdded || b.dateAdded,
      // Prefer CustomOrder if one exists
      customOrder: a.customOrder ?? b.customOrder ?? null,

      // Merge arrays
      platforms: uniq([...a.platforms, ...b.platforms]),
      genres: uniq([...a.genres, ...b.genres]),
      yearPlayed: uniq([...a.yearPlayed, ...b.yearPlayed]),
    };
  }

  for (const g of games) {
    const id = norm(g.igdbId);
    if (id) {
      const existing = byId.get(id);
      byId.set(id, existing ? merge(existing, g) : g);
      continue;
    }

    const tk = titleKey(g.title);
    if (!tk) continue;
    const existing = byTitle.get(tk);
    byTitle.set(tk, existing ? merge(existing, g) : g);
  }

  return [...byId.values(), ...byTitle.values()];
}

type TabKey = "games" | "queued" | "wishlist";

type SortKey = "releaseDate" | "title" | "dateAdded" | "custom";

export default function Page() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");

  // UI
  const [coverSize, setCoverSize] = useState<number>(100); // ✅ default 100
  const [tab, setTab] = useState<TabKey>("games");
  const [sortKey, setSortKey] = useState<SortKey>("releaseDate"); // default
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  // Filters
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [selectedGenres, setSelectedGenres] = useState<Set<string>>(new Set());
  const [selectedOwnership, setSelectedOwnership] = useState<Set<string>>(new Set());
  const [selectedFormat, setSelectedFormat] = useState<Set<string>>(new Set());
  const [selectedStatus, setSelectedStatus] = useState<Set<string>>(new Set());
  const [selectedYears, setSelectedYears] = useState<Set<string>>(new Set());

  const [filterBacklog, setFilterBacklog] = useState(false);
  const [filterNowPlaying, setFilterNowPlaying] = useState(false);
  const [filterCompleted, setFilterCompleted] = useState(false);
  const [filterAbandoned, setFilterAbandoned] = useState(false);

  // Left menu open/closed
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Platforms: false,
    Genres: false,
    Status: false,
    Ownership: false,
    Format: false,
    "Year Played": false,
    Filters: true,
    Sorting: true,
  });

  // Fetch CSV
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr("");

    fetch(CSV_URL, { cache: "no-store" })
      .then((r) => r.text())
      .then((csv) => {
        if (cancelled) return;
        const parsed = Papa.parse<Row>(csv, { header: true, skipEmptyLines: true });
        const data = (parsed.data || []).filter(Boolean);
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
    const games = dedupeGames(rows.map(rowToGame)).filter((g) => g.title);
    return games;
  }, [rows]);

  // Stats for top-right
  const nowYear = new Date().getFullYear().toString();
  const stats = useMemo(() => {
    const total = allGames.length;
    const queued = allGames.filter((g) => norm(g.status).toLowerCase() === "queued").length;
    const wishlist = allGames.filter((g) => norm(g.ownership).toLowerCase() === "wishlist").length;
    const playedThisYear = allGames.filter((g) => g.yearPlayed.includes(nowYear)).length;
    return { total, queued, wishlist, playedThisYear, nowYear };
  }, [allGames, nowYear]);

  // Apply tab (top nav) filtering
  const tabFiltered = useMemo(() => {
    if (tab === "queued") {
      return allGames.filter((g) => norm(g.status).toLowerCase() === "queued");
    }
    if (tab === "wishlist") {
      return allGames.filter((g) => norm(g.ownership).toLowerCase() === "wishlist");
    }
    return allGames;
  }, [allGames, tab]);

  // Build option counts for menu (based on tab + current filters? we’ll base on tab only to keep counts stable)
  const optionCounts = useMemo(() => {
    const base = tabFiltered;

    const countMap = (vals: string[]) => {
      const m = new Map<string, number>();
      for (const v of vals) {
        const k = norm(v);
        if (!k) continue;
        m.set(k, (m.get(k) || 0) + 1);
      }
      return m;
    };

    const platforms = countMap(base.flatMap((g) => g.platforms));
    const genres = countMap(base.flatMap((g) => g.genres));
    const status = countMap(base.map((g) => g.status));
    const ownership = countMap(base.map((g) => g.ownership));
    const format = countMap(base.map((g) => g.format));
    const years = countMap(base.flatMap((g) => g.yearPlayed));

    return { platforms, genres, status, ownership, format, years };
  }, [tabFiltered]);

  // Apply left filters
  const filtered = useMemo(() => {
    const matchesSet = (sel: Set<string>, vals: string[]) => {
      if (sel.size === 0) return true;
      return vals.some((v) => sel.has(v));
    };
    const matchesSingleSet = (sel: Set<string>, v: string) => {
      if (sel.size === 0) return true;
      return sel.has(v);
    };

    return tabFiltered.filter((g) => {
      // multi-select lists
      if (!matchesSet(selectedPlatforms, g.platforms)) return false;
      if (!matchesSet(selectedGenres, g.genres)) return false;
      if (!matchesSet(selectedYears, g.yearPlayed)) return false;

      // single value sets (we allow multi-select too)
      if (!matchesSingleSet(selectedStatus, g.status)) return false;
      if (!matchesSingleSet(selectedOwnership, g.ownership)) return false;
      if (!matchesSingleSet(selectedFormat, g.format)) return false;

      // checkboxes
      if (filterBacklog && !toBool(g.backlog)) return false;
      if (filterCompleted && !toBool(g.completed)) return false;
      if (filterNowPlaying && norm(g.status).toLowerCase() !== "now playing") return false;
      if (filterAbandoned && norm(g.status).toLowerCase() !== "abandoned") return false;

      return true;
    });
  }, [
    tabFiltered,
    selectedPlatforms,
    selectedGenres,
    selectedYears,
    selectedStatus,
    selectedOwnership,
    selectedFormat,
    filterBacklog,
    filterCompleted,
    filterNowPlaying,
    filterAbandoned,
  ]);

  // Sorting
  const sorted = useMemo(() => {
    const arr = [...filtered];

    const dirMul = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      if (sortKey === "title") {
        const aa = titleKey(a.title);
        const bb = titleKey(b.title);
        return aa.localeCompare(bb) * dirMul;
      }

      if (sortKey === "releaseDate") {
        const aa = parseDateLoose(a.releaseDate);
        const bb = parseDateLoose(b.releaseDate);
        if (aa === bb) return titleKey(a.title).localeCompare(titleKey(b.title));
        return (aa - bb) * dirMul;
      }

      if (sortKey === "dateAdded") {
        const aa = parseDateLoose(a.dateAdded);
        const bb = parseDateLoose(b.dateAdded);
        if (aa === bb) return titleKey(a.title).localeCompare(titleKey(b.title));
        return (aa - bb) * dirMul;
      }

      // ✅ Custom: lowest CustomOrder first; nulls last.
      const ao = a.customOrder;
      const bo = b.customOrder;
      const aHas = typeof ao === "number";
      const bHas = typeof bo === "number";

      if (aHas && bHas) {
        if (ao! === bo!) return titleKey(a.title).localeCompare(titleKey(b.title));
        return (ao! - bo!) * 1; // custom is always ascending “rank”
      }
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      // both missing -> fall back
      return titleKey(a.title).localeCompare(titleKey(b.title));
    });

    return arr;
  }, [filtered, sortKey, sortDir]);

  function toggleSection(name: string) {
    setOpenSections((p) => ({ ...p, [name]: !p[name] }));
  }

  function toggleInSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, val: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(val)) next.delete(val);
      else next.add(val);
      return next;
    });
  }

  // Optional helper: copy IGDB_ID + blank CustomOrder template (so you can paste into sheet / use as reference)
  function copyCustomOrderTemplate() {
    const lines = ["IGDB_ID,Title,CustomOrder"];
    for (const g of allGames) {
      const id = norm(g.igdbId);
      if (!id) continue;
      const t = (g.title || "").replace(/"/g, '""');
      const co = g.customOrder ?? "";
      lines.push(`${id},"${t}",${co}`);
    }
    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => alert("Copied template to clipboard. Paste into a sheet to help fill CustomOrder."))
      .catch(() => alert("Could not copy. Your browser may block clipboard access."));
  }

  const headerFont = `ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji"`;

  const tabButton = (key: TabKey, label: string) => {
    const active = tab === key;
    return (
      <button
        onClick={() => setTab(key)}
        style={{
          position: "relative",
          fontFamily: headerFont,
          background: "transparent",
          border: "none",
          color: active ? COLORS.text : COLORS.muted,
          fontWeight: 900,
          fontSize: 18,
          padding: "10px 6px",
          cursor: "pointer",
        }}
      >
        {label}
        {active && (
          <span
            style={{
              position: "absolute",
              left: 6,
              right: 6,
              bottom: 4,
              height: 3,
              borderRadius: 999,
              background: COLORS.green,
            }}
          />
        )}
      </button>
    );
  };

  const statBox = (big: number, label: string) => (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontWeight: 900, fontSize: 18, lineHeight: 1.1 }}>{big}</div>
      <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 800 }}>{label}</div>
    </div>
  );

  const sectionHeader = (name: string) => (
    <button
      onClick={() => toggleSection(name)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "transparent",
        border: "none",
        color: COLORS.text,
        fontWeight: 900,
        padding: "10px 10px",
        cursor: "pointer",
        borderRadius: 12,
      }}
    >
      <span style={{ fontSize: 13 }}>{name}</span>
      <span style={{ color: COLORS.muted, fontSize: 12 }}>{openSections[name] ? "▾" : "▸"}</span>
    </button>
  );

  const optionLine = (
    label: string,
    count: number,
    checked: boolean,
    onClick: () => void
  ) => (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        background: "transparent",
        border: "none",
        padding: "5px 10px",
        cursor: "pointer",
        color: checked ? COLORS.text : "rgba(242,243,245,.85)",
        fontSize: 12,
        fontWeight: checked ? 900 : 700,
        lineHeight: 1.2,
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span
        style={{
          minWidth: 28,
          height: 18,
          padding: "0 8px",
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 900,
          background: checked ? "rgba(33,197,93,.22)" : "rgba(255,255,255,.08)",
          color: checked ? COLORS.green : COLORS.muted,
          border: `1px solid ${checked ? "rgba(33,197,93,.35)" : "rgba(255,255,255,.10)"}`,
        }}
      >
        {count}
      </span>
    </button>
  );

  const checkboxLine = (label: string, checked: boolean, onChange: () => void) => (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
        fontWeight: 800,
        color: "rgba(242,243,245,.85)",
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ accentColor: COLORS.green }}
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
        fontFamily: headerFont,
      }}
    >
      {/* Top header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(7,8,10,.85)",
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "14px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 1000, letterSpacing: 0.2 }}>
              Chris&apos; Game Library
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {tabButton("games", "Games")}
              {tabButton("queued", "Backlog Queue")}
              {tabButton("wishlist", "Wishlist")}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
            {statBox(stats.total, "Games")}
            {statBox(stats.queued, "Queued")}
            {statBox(stats.wishlist, "Wishlist")}
            {statBox(stats.playedThisYear, `Played in ${stats.nowYear}`)}
          </div>
        </div>
      </div>

      {/* Content */}
      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "14px",
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 14,
        }}
      >
        {/* Left panel */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 10,
            alignSelf: "start",
          }}
        >
          {/* Loading */}
          <div style={{ padding: "8px 10px", color: COLORS.muted, fontSize: 12 }}>
            {loading ? "Loading…" : err ? `Error: ${err}` : `${sorted.length} shown`}
          </div>

          {/* Filters */}
          {sectionHeader("Filters")}
          {openSections["Filters"] && (
            <div style={{ padding: "0 10px 10px 10px" }}>
              {/* Make them align evenly: 2 columns grid */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                  paddingTop: 6,
                }}
              >
                {checkboxLine("Backlog", filterBacklog, () => setFilterBacklog((v) => !v))}
                {checkboxLine("Now Playing", filterNowPlaying, () => setFilterNowPlaying((v) => !v))}
                {checkboxLine("Completed", filterCompleted, () => setFilterCompleted((v) => !v))}
                {checkboxLine("Abandoned", filterAbandoned, () => setFilterAbandoned((v) => !v))}
              </div>
            </div>
          )}

          {/* Sorting */}
          {sectionHeader("Sorting")}
          {openSections["Sorting"] && (
            <div style={{ padding: "0 10px 10px 10px" }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 6 }}>
                {(["releaseDate", "title", "dateAdded", "custom"] as SortKey[]).map((k) => {
                  const active = sortKey === k;
                  const label =
                    k === "releaseDate"
                      ? "Release Date"
                      : k === "dateAdded"
                      ? "Date Added"
                      : k === "custom"
                      ? "Custom"
                      : "Title";
                  return (
                    <button
                      key={k}
                      onClick={() => setSortKey(k)}
                      style={{
                        background: active ? "rgba(33,197,93,.22)" : "rgba(255,255,255,.07)",
                        border: `1px solid ${
                          active ? "rgba(33,197,93,.35)" : "rgba(255,255,255,.10)"
                        }`,
                        color: active ? COLORS.text : "rgba(242,243,245,.85)",
                        fontWeight: 900,
                        fontSize: 12,
                        padding: "6px 10px",
                        borderRadius: 999,
                        cursor: "pointer",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}

                {/* Dir toggle (Custom always effectively asc, but this is useful for other sorts) */}
                <button
                  onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
                  style={{
                    background: "rgba(255,255,255,.07)",
                    border: `1px solid ${COLORS.border}`,
                    color: "rgba(242,243,245,.85)",
                    fontWeight: 900,
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                  title="Toggle ascending/descending"
                >
                  {sortDir === "asc" ? "Asc" : "Desc"}
                </button>

                {/* Optional helper */}
                <button
                  onClick={copyCustomOrderTemplate}
                  style={{
                    background: "rgba(255,255,255,.07)",
                    border: `1px solid ${COLORS.border}`,
                    color: "rgba(242,243,245,.85)",
                    fontWeight: 900,
                    fontSize: 12,
                    padding: "6px 10px",
                    borderRadius: 999,
                    cursor: "pointer",
                  }}
                  title="Copies IGDB_ID + Title + CustomOrder rows so you can fill CustomOrder in your sheet"
                >
                  Copy CustomOrder Template
                </button>
              </div>
            </div>
          )}

          {/* Platforms */}
          {sectionHeader("Platforms")}
          {openSections["Platforms"] && (
            <div style={{ paddingBottom: 8 }}>
              {Array.from(optionCounts.platforms.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) =>
                  optionLine(name, count, selectedPlatforms.has(name), () =>
                    toggleInSet(setSelectedPlatforms, name)
                  )
                )}
            </div>
          )}

          {/* Genres */}
          {sectionHeader("Genres")}
          {openSections["Genres"] && (
            <div style={{ paddingBottom: 8 }}>
              {Array.from(optionCounts.genres.entries())
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) =>
                  optionLine(name, count, selectedGenres.has(name), () =>
                    toggleInSet(setSelectedGenres, name)
                  )
                )}
            </div>
          )}

          {/* Status */}
          {sectionHeader("Status")}
          {openSections["Status"] && (
            <div style={{ paddingBottom: 8 }}>
              {Array.from(optionCounts.status.entries())
                .filter(([n]) => norm(n))
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) =>
                  optionLine(name, count, selectedStatus.has(name), () =>
                    toggleInSet(setSelectedStatus, name)
                  )
                )}
            </div>
          )}

          {/* Ownership */}
          {sectionHeader("Ownership")}
          {openSections["Ownership"] && (
            <div style={{ paddingBottom: 8 }}>
              {Array.from(optionCounts.ownership.entries())
                .filter(([n]) => norm(n))
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) =>
                  optionLine(name, count, selectedOwnership.has(name), () =>
                    toggleInSet(setSelectedOwnership, name)
                  )
                )}
            </div>
          )}

          {/* Format */}
          {sectionHeader("Format")}
          {openSections["Format"] && (
            <div style={{ paddingBottom: 8 }}>
              {Array.from(optionCounts.format.entries())
                .filter(([n]) => norm(n))
                .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
                .map(([name, count]) =>
                  optionLine(name, count, selectedFormat.has(name), () =>
                    toggleInSet(setSelectedFormat, name)
                  )
                )}
            </div>
          )}

          {/* Year Played */}
          {sectionHeader("Year Played")}
          {openSections["Year Played"] && (
            <div style={{ paddingBottom: 8 }}>
              {Array.from(optionCounts.years.entries())
                .filter(([n]) => norm(n))
                .sort((a, b) => Number(b[0]) - Number(a[0]))
                .map(([name, count]) =>
                  optionLine(name, count, selectedYears.has(name), () =>
                    toggleInSet(setSelectedYears, name)
                  )
                )}
            </div>
          )}

          {/* Cover size */}
          <div style={{ padding: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.text }}>Cover size</div>
              <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted }}>{coverSize}</div>
            </div>
            <input
              type="range"
              min={60}
              max={180}
              value={coverSize}
              onChange={(e) => setCoverSize(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </div>
        </aside>

        {/* Grid */}
        <main
          style={{
            background: "transparent",
            minHeight: "60vh",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
              gap: 12,
              alignItems: "start",
            }}
          >
            {sorted.map((g, i) => {
              const key = g.igdbId ? `igdb-${g.igdbId}` : `${titleKey(g.title)}-${i}`;
              return (
                <div
                  key={key}
                  style={{
                    aspectRatio: "2 / 3",
                    background: COLORS.card,
                    borderRadius: 14,
                    overflow: "hidden",
                    border: `1px solid ${COLORS.border}`,
                    boxShadow: "0 18px 35px rgba(0,0,0,.55)",
                  }}
                  title={g.title}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      loading="lazy"
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                      onError={(e) => {
                        // Soft fail styling if IGDB image fails
                        (e.currentTarget as HTMLImageElement).style.display = "none";
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
    </div>
  );
}

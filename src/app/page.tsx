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

  releaseDate: string;
  dateAdded: string;

  backlog: string;
  completed: string;
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

const COLORS = {
  bg: "#0b0d10",
  panel: "#0f1217",
  card: "#121722",
  border: "rgba(255,255,255,0.08)",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.62)",
  subtle: "rgba(255,255,255,0.10)",
  green: "#34d399",
};

function norm(v: unknown) {
  return String(v ?? "").trim();
}

function splitTags(v: string) {
  return norm(v)
    .split(/[,|]/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function toBool(v: string) {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}

function titleKey(title: string) {
  return norm(title).toLowerCase();
}

function parseDateToMs(s: string) {
  const t = Date.parse(s);
  return isNaN(t) ? 0 : t;
}

function pickCover(row: Row) {
  // If you later switch to LocalCoverURL, change priority here.
  return norm(row["CoverURL"] || row["CoverUrl"] || row["Cover"]);
}

function rowToGame(row: Row): Game {
  return {
    title: norm(row["Title"] || row["Name"] || ""),
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
  const map = new Map<string, Game>();
  for (const g of games) {
    const k = titleKey(g.title);
    if (!k) continue;
    if (!map.has(k)) {
      map.set(k, g);
      continue;
    }
    const existing = map.get(k)!;

    // Merge platforms/genres/yearPlayed
    const platforms = Array.from(new Set([...existing.platforms, ...g.platforms]));
    const genres = Array.from(new Set([...existing.genres, ...g.genres]));
    const yearPlayed = Array.from(new Set([...existing.yearPlayed, ...g.yearPlayed]));

    // Prefer a coverUrl if missing
    const coverUrl = existing.coverUrl || g.coverUrl;

    // Prefer non-empty strings
    const status = existing.status || g.status;
    const ownership = existing.ownership || g.ownership;
    const format = existing.format || g.format;
    const releaseDate = existing.releaseDate || g.releaseDate;
    const dateAdded = existing.dateAdded || g.dateAdded;

    const backlog = existing.backlog || g.backlog;
    const completed = existing.completed || g.completed;

    map.set(k, {
      ...existing,
      coverUrl,
      platforms,
      genres,
      yearPlayed,
      status,
      ownership,
      format,
      releaseDate,
      dateAdded,
      backlog,
      completed,
    });
  }
  return Array.from(map.values());
}

type TabKey = "games" | "queued" | "wishlist";
type SortKey = "releaseDate" | "title" | "dateAdded" | "custom";
type SortDir = "desc" | "asc";

type MultiSel = Record<string, Set<string>>;

function makeEmptyMulti(): MultiSel {
  return {
    Genres: new Set<string>(),
    Platform: new Set<string>(),
    Status: new Set<string>(),
    Ownership: new Set<string>(),
    Format: new Set<string>(),
    YearPlayed: new Set<string>(),
  };
}

function containsAny(haystack: string[], needles: Set<string>) {
  if (!needles.size) return true;
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}

function valueMatchesSet(val: string, set: Set<string>) {
  if (!set.size) return true;
  return set.has(val);
}

function countBy(values: string[]) {
  const m = new Map<string, number>();
  for (const v of values) {
    const k = norm(v);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function sortedKeys(m: Map<string, number>) {
  return Array.from(m.keys()).sort((a, b) => a.localeCompare(b));
}

function badge(n: number) {
  return (
    <span
      style={{
        marginLeft: 8,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        background: "rgba(255,255,255,0.10)",
        color: "rgba(255,255,255,0.80)",
      }}
    >
      {n}
    </span>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        color: active ? COLORS.text : COLORS.muted,
        fontWeight: 900,
        fontSize: 16,
        padding: "10px 0",
        cursor: "pointer",
        position: "relative",
      }}
    >
      {label}
      {active && (
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: -2,
            height: 3,
            borderRadius: 999,
            background: COLORS.green,
          }}
        />
      )}
    </button>
  );
}

function StatBlock({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontWeight: 950, fontSize: 18, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 800 }}>{label}</div>
    </div>
  );
}

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string>("");

  // Cover size (default 100)
  const [coverSize, setCoverSize] = useState<number>(100);

  // Sorting
  const [sortKey, setSortKey] = useState<SortKey>("releaseDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Tabs
  const [tab, setTab] = useState<TabKey>("games");

  // Filters
  const [multi, setMulti] = useState<MultiSel>(() => makeEmptyMulti());
  const [flagBacklog, setFlagBacklog] = useState(false);
  const [flagNowPlaying, setFlagNowPlaying] = useState(false);
  const [flagCompleted, setFlagCompleted] = useState(false);
  const [flagAbandoned, setFlagAbandoned] = useState(false);

  // Collapsible filter sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Sort: false,
    Filters: true,
    Platform: false,
    Genres: false,
    Status: false,
    Ownership: false,
    Format: false,
    YearPlayed: false,
  });

  // Custom ordering (per device)
  const CUSTOM_KEY = "gg_custom_order_v1";
  const [customOrder, setCustomOrder] = useState<string[]>([]); // array of titleKey
  const [customTouched, setCustomTouched] = useState(false);

  // Load custom order from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCustomOrder(parsed.map(String));
      }
    } catch {}
  }, []);

  // Persist custom order
  useEffect(() => {
    try {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(customOrder));
    } catch {}
  }, [customOrder]);

  // Fetch CSV
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");

    fetch(CSV_URL, { cache: "no-store" })
      .then((r) => r.text())
      .then((csvText) => {
        const parsed = Papa.parse<Row>(csvText, {
          header: true,
          skipEmptyLines: true,
        });

        if (parsed.errors?.length) {
          throw new Error(parsed.errors[0].message);
        }

        if (!alive) return;
        setRows((parsed.data || []).filter(Boolean));
        setLoading(false);
      })
      .catch((e) => {
        if (!alive) return;
        setError(String(e?.message || e));
        setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const gamesRaw = useMemo(() => rows.map(rowToGame).filter((g) => g.title), [rows]);
  const games = useMemo(() => dedupeByTitle(gamesRaw), [gamesRaw]);

  // Ensure customOrder contains any new games appended
  useEffect(() => {
    const keys = games.map((g) => titleKey(g.title)).filter(Boolean);
    if (!keys.length) return;

    setCustomOrder((prev) => {
      const prevSet = new Set(prev);
      const merged = [...prev];
      for (const k of keys) if (!prevSet.has(k)) merged.push(k);
      return merged;
    });
  }, [games]);

  // Top stats
  const currentYear = new Date().getFullYear();
  const totalGames = games.length;
  const queuedCount = games.filter((g) => norm(g.status).toLowerCase() === "queued").length;
  const wishlistCount = games.filter((g) => norm(g.ownership).toLowerCase() === "wishlist").length;
  const playedThisYearCount = games.filter((g) => g.yearPlayed.includes(String(currentYear))).length;

  // Build option counts (for left menu)
  const platformCounts = useMemo(() => {
    const all = games.flatMap((g) => g.platforms);
    return countBy(all);
  }, [games]);

  const genreCounts = useMemo(() => {
    const all = games.flatMap((g) => g.genres);
    return countBy(all);
  }, [games]);

  const yearCounts = useMemo(() => {
    const all = games.flatMap((g) => g.yearPlayed);
    return countBy(all);
  }, [games]);

  const statusCounts = useMemo(() => {
    const all = games.map((g) => g.status).filter(Boolean);
    return countBy(all);
  }, [games]);

  const ownershipCounts = useMemo(() => {
    const all = games.map((g) => g.ownership).filter(Boolean);
    return countBy(all);
  }, [games]);

  const formatCounts = useMemo(() => {
    const all = games.map((g) => g.format).filter(Boolean);
    return countBy(all);
  }, [games]);

  // Apply tab filter first (Games / Queued / Wishlist)
  const tabFiltered = useMemo(() => {
    if (tab === "games") return games;
    if (tab === "queued") return games.filter((g) => norm(g.status).toLowerCase() === "queued");
    return games.filter((g) => norm(g.ownership).toLowerCase() === "wishlist");
  }, [games, tab]);

  // Apply filters
  const filtered = useMemo(() => {
    const target = tabFiltered.filter((g) => {
      // Multi-selects
      if (!containsAny(g.genres, multi.Genres)) return false;
      if (!containsAny(g.platforms, multi.Platform)) return false;
      if (!containsAny(g.yearPlayed, multi.YearPlayed)) return false;

      if (!valueMatchesSet(g.status, multi.Status)) return false;
      if (!valueMatchesSet(g.ownership, multi.Ownership)) return false;
      if (!valueMatchesSet(g.format, multi.Format)) return false;

      // Flag checkboxes
      if (flagBacklog && !toBool(g.backlog)) return false;
      if (flagCompleted && !toBool(g.completed)) return false;

      if (flagNowPlaying && norm(g.status).toLowerCase() !== "now playing") return false;
      if (flagAbandoned && norm(g.status).toLowerCase() !== "abandoned") return false;

      return true;
    });

    // Sorting
    const list = [...target];

    const byTitle = (a: Game, b: Game) => a.title.localeCompare(b.title);

    const byRelease = (a: Game, b: Game) => {
      const av = parseDateToMs(a.releaseDate);
      const bv = parseDateToMs(b.releaseDate);
      return av - bv;
    };

    const byDateAdded = (a: Game, b: Game) => {
      const av = parseDateToMs(a.dateAdded);
      const bv = parseDateToMs(b.dateAdded);
      return av - bv;
    };

    if (sortKey === "title") list.sort(byTitle);
    else if (sortKey === "releaseDate") list.sort(byRelease);
    else if (sortKey === "dateAdded") list.sort(byDateAdded);
    else if (sortKey === "custom") {
      const index = new Map<string, number>();
      customOrder.forEach((k, i) => index.set(k, i));
      list.sort((a, b) => {
        const ai = index.get(titleKey(a.title)) ?? 999999;
        const bi = index.get(titleKey(b.title)) ?? 999999;
        return ai - bi;
      });
    }

    if (sortKey !== "custom") {
      if (sortDir === "desc") list.reverse();
    }

    return list;
  }, [
    tabFiltered,
    multi,
    flagBacklog,
    flagCompleted,
    flagNowPlaying,
    flagAbandoned,
    sortKey,
    sortDir,
    customOrder,
  ]);

  function toggleSection(name: string) {
    setOpenSections((p) => ({ ...p, [name]: !p[name] }));
  }

  function toggleMulti(group: keyof MultiSel, val: string) {
    setMulti((prev) => {
      const next = { ...prev };
      const set = new Set(next[group]);
      if (set.has(val)) set.delete(val);
      else set.add(val);
      next[group] = set;
      return next;
    });
  }

  function clearAllFilters() {
    setMulti(makeEmptyMulti());
    setFlagBacklog(false);
    setFlagNowPlaying(false);
    setFlagCompleted(false);
    setFlagAbandoned(false);
  }

  // Custom ordering helpers (no drag library)
  function moveInCustom(title: string, dir: -1 | 1) {
    const k = titleKey(title);
    setCustomOrder((prev) => {
      const idx = prev.indexOf(k);
      if (idx === -1) return prev;
      const next = [...prev];
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= next.length) return prev;
      const tmp = next[newIdx];
      next[newIdx] = next[idx];
      next[idx] = tmp;
      return next;
    });

    // auto switch to custom on first manual change
    if (sortKey !== "custom") setSortKey("custom");
    if (!customTouched) setCustomTouched(true);
  }

  // UI helpers
  const chip = (on: boolean) => ({
    background: on ? "rgba(52,211,153,0.14)" : "rgba(255,255,255,0.06)",
    border: `1px solid ${on ? "rgba(52,211,153,0.35)" : "rgba(255,255,255,0.10)"}`,
    color: on ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.78)",
  });

  const smallLabel = {
    fontSize: 11,
    fontWeight: 900 as const,
    color: COLORS.muted,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
  };

  return (
    <div style={{ minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 18,
          padding: 18,
        }}
      >
        {/* LEFT PANEL */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 14,
            height: "calc(100vh - 36px)",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 950, fontSize: 16 }}>Filters</div>
            <div style={{ flex: 1 }} />
            <button
              onClick={clearAllFilters}
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                color: COLORS.muted,
                fontWeight: 900,
                fontSize: 11,
                borderRadius: 12,
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>

          <div style={{ marginTop: 10, borderTop: `1px solid ${COLORS.border}` }} />

          {/* SORT */}
          <div style={{ marginTop: 12 }}>
            <button
              onClick={() => toggleSection("Sort")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Sort {openSections.Sort ? "▾" : "▸"}
            </button>

            {openSections.Sort && (
              <div style={{ paddingBottom: 8 }}>
                <div style={{ display: "grid", gap: 8 }}>
                  <select
                    value={sortKey}
                    onChange={(e) => setSortKey(e.target.value as SortKey)}
                    style={{
                      width: "100%",
                      background: COLORS.card,
                      color: COLORS.text,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: "10px 12px",
                      fontWeight: 800,
                    }}
                  >
                    <option value="releaseDate">Release Date</option>
                    <option value="dateAdded">Date Added</option>
                    <option value="title">Title</option>
                    <option value="custom">Custom</option>
                  </select>

                  {sortKey !== "custom" && (
                    <select
                      value={sortDir}
                      onChange={(e) => setSortDir(e.target.value as SortDir)}
                      style={{
                        width: "100%",
                        background: COLORS.card,
                        color: COLORS.text,
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 12,
                        padding: "10px 12px",
                        fontWeight: 800,
                      }}
                    >
                      <option value="desc">Descending</option>
                      <option value="asc">Ascending</option>
                    </select>
                  )}

                  {sortKey === "custom" && (
                    <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 800 }}>
                      Tip: use the ◀ / ▶ buttons on covers to reorder.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* FLAGS (aligned 2x2) */}
          <div style={{ marginTop: 12 }}>
            <div style={{ ...smallLabel, marginBottom: 8 }}>Flags</div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                <input
                  type="checkbox"
                  checked={flagBacklog}
                  onChange={(e) => setFlagBacklog(e.target.checked)}
                />
                Backlog
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                <input
                  type="checkbox"
                  checked={flagNowPlaying}
                  onChange={(e) => setFlagNowPlaying(e.target.checked)}
                />
                Now Playing
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                <input
                  type="checkbox"
                  checked={flagCompleted}
                  onChange={(e) => setFlagCompleted(e.target.checked)}
                />
                Completed
              </label>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${COLORS.border}`,
                  background: "rgba(255,255,255,0.03)",
                  fontSize: 12,
                  fontWeight: 900,
                }}
              >
                <input
                  type="checkbox"
                  checked={flagAbandoned}
                  onChange={(e) => setFlagAbandoned(e.target.checked)}
                />
                Abandoned
              </label>
            </div>
          </div>

          {/* MULTI SELECT LISTS */}
          <div style={{ marginTop: 14, borderTop: `1px solid ${COLORS.border}` }} />

          {/* Platform */}
          <div style={{ marginTop: 10 }}>
            <button
              onClick={() => toggleSection("Platform")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Platform {openSections.Platform ? "▾" : "▸"}
            </button>

            {openSections.Platform && (
              <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
                {sortedKeys(platformCounts).map((p) => {
                  const on = multi.Platform.has(p);
                  return (
                    <button
                      key={p}
                      onClick={() => toggleMulti("Platform", p)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.border}`,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        ...(chip(on) as any),
                      }}
                    >
                      <span>{p}</span>
                      {badge(platformCounts.get(p) || 0)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Genres */}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => toggleSection("Genres")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Genres {openSections.Genres ? "▾" : "▸"}
            </button>

            {openSections.Genres && (
              <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
                {sortedKeys(genreCounts).map((g) => {
                  const on = multi.Genres.has(g);
                  return (
                    <button
                      key={g}
                      onClick={() => toggleMulti("Genres", g)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.border}`,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        ...(chip(on) as any),
                      }}
                    >
                      <span>{g}</span>
                      {badge(genreCounts.get(g) || 0)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Year Played */}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => toggleSection("YearPlayed")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Year Played {openSections.YearPlayed ? "▾" : "▸"}
            </button>

            {openSections.YearPlayed && (
              <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
                {sortedKeys(yearCounts).map((y) => {
                  const on = multi.YearPlayed.has(y);
                  return (
                    <button
                      key={y}
                      onClick={() => toggleMulti("YearPlayed", y)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.border}`,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        ...(chip(on) as any),
                      }}
                    >
                      <span>{y}</span>
                      {badge(yearCounts.get(y) || 0)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Status */}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => toggleSection("Status")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Status {openSections.Status ? "▾" : "▸"}
            </button>

            {openSections.Status && (
              <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
                {sortedKeys(statusCounts).map((s) => {
                  const on = multi.Status.has(s);
                  return (
                    <button
                      key={s}
                      onClick={() => toggleMulti("Status", s)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.border}`,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        ...(chip(on) as any),
                      }}
                    >
                      <span>{s}</span>
                      {badge(statusCounts.get(s) || 0)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Ownership */}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => toggleSection("Ownership")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Ownership {openSections.Ownership ? "▾" : "▸"}
            </button>

            {openSections.Ownership && (
              <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
                {sortedKeys(ownershipCounts).map((o) => {
                  const on = multi.Ownership.has(o);
                  return (
                    <button
                      key={o}
                      onClick={() => toggleMulti("Ownership", o)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.border}`,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        ...(chip(on) as any),
                      }}
                    >
                      <span>{o}</span>
                      {badge(ownershipCounts.get(o) || 0)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Format */}
          <div style={{ marginTop: 6 }}>
            <button
              onClick={() => toggleSection("Format")}
              style={{
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                color: COLORS.text,
                cursor: "pointer",
                padding: "8px 0",
                fontWeight: 950,
              }}
            >
              Format {openSections.Format ? "▾" : "▸"}
            </button>

            {openSections.Format && (
              <div style={{ display: "grid", gap: 2, paddingBottom: 6 }}>
                {sortedKeys(formatCounts).map((f) => {
                  const on = multi.Format.has(f);
                  return (
                    <button
                      key={f}
                      onClick={() => toggleMulti("Format", f)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: `1px solid ${COLORS.border}`,
                        cursor: "pointer",
                        fontSize: 12,
                        fontWeight: 900,
                        ...(chip(on) as any),
                      }}
                    >
                      <span>{f}</span>
                      {badge(formatCounts.get(f) || 0)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* MAIN */}
        <main>
          {/* Header row */}
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              padding: 14,
              display: "flex",
              alignItems: "center",
              gap: 16,
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div style={{ fontWeight: 950, fontSize: 18 }}>Chris&apos; Game Library</div>

              <div style={{ display: "flex", gap: 18 }}>
                <TabButton label="Games" active={tab === "games"} onClick={() => setTab("games")} />
                <TabButton
                  label="Backlog Queue"
                  active={tab === "queued"}
                  onClick={() => setTab("queued")}
                />
                <TabButton
                  label="Wishlist"
                  active={tab === "wishlist"}
                  onClick={() => setTab("wishlist")}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <StatBlock value={totalGames} label="Games" />
              <StatBlock value={queuedCount} label="Queued" />
              <StatBlock value={wishlistCount} label="Wishlist" />
              <StatBlock value={playedThisYearCount} label={`Played in ${currentYear}`} />
            </div>
          </div>

          {/* Controls row */}
          <div
            style={{
              marginTop: 14,
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              padding: 14,
              display: "flex",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ ...smallLabel }}>Cover Size</div>
              <input
                type="range"
                min={60}
                max={220}
                value={coverSize}
                onChange={(e) => setCoverSize(Number(e.target.value))}
                style={{ width: 220 }}
              />
              <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 900 }}>{coverSize}</div>
            </div>

            <div style={{ flex: 1 }} />

            <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 900 }}>
              {loading ? "Loading…" : `${filtered.length} shown`}
              {customTouched && sortKey === "custom" ? " • custom order changed" : ""}
            </div>
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 14,
                border: `1px solid ${COLORS.border}`,
                background: "rgba(255,0,0,0.08)",
                color: "rgba(255,255,255,0.92)",
                fontWeight: 800,
              }}
            >
              Error: {error}
            </div>
          )}

          {/* Grid */}
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
              gap: 12,
            }}
          >
            {filtered.map((g) => {
              const k = titleKey(g.title);

              return (
                <div
                  key={k}
                  style={{
                    background: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 16,
                    overflow: "hidden",
                    boxShadow: "0 18px 40px rgba(0,0,0,.55)",
                  }}
                >
                  <div style={{ position: "relative", aspectRatio: "2 / 3" }}>
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
                          (e.currentTarget as HTMLImageElement).style.opacity = "0.25";
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
                          fontWeight: 900,
                        }}
                      >
                        No cover
                      </div>
                    )}
                  </div>

                  {/* Manual ordering controls (work even without drag libs) */}
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: 10,
                      borderTop: `1px solid ${COLORS.border}`,
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <button
                      onClick={() => moveInCustom(g.title, -1)}
                      style={{
                        flex: 1,
                        borderRadius: 12,
                        border: `1px solid ${COLORS.border}`,
                        background: "rgba(255,255,255,0.05)",
                        color: COLORS.text,
                        fontWeight: 950,
                        fontSize: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                      }}
                      title="Move earlier"
                    >
                      ◀
                    </button>
                    <div
                      style={{
                        flex: 3,
                        fontSize: 12,
                        fontWeight: 900,
                        color: COLORS.muted,
                        textAlign: "center",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        padding: "0 8px",
                      }}
                      title={g.title}
                    >
                      {g.title}
                    </div>
                    <button
                      onClick={() => moveInCustom(g.title, 1)}
                      style={{
                        flex: 1,
                        borderRadius: 12,
                        border: `1px solid ${COLORS.border}`,
                        background: "rgba(255,255,255,0.05)",
                        color: COLORS.text,
                        fontWeight: 950,
                        fontSize: 12,
                        padding: "8px 10px",
                        cursor: "pointer",
                      }}
                      title="Move later"
                    >
                      ▶
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* Mobile layout tweak */}
      <style>{`
        @media (max-width: 900px) {
          div[style*="grid-template-columns: 320px 1fr"] {
            grid-template-columns: 1fr !important;
          }
          aside {
            height: auto !important;
          }
        }
      `}</style>
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";

type Row = Record<string, string>;

type Game = {
  igdbId: string;
  title: string;
  coverUrl: string;

  platforms: string[];
  genres: string[];
  yearPlayed: string[];

  status: string;
  ownership: string;
  format: string;

  releaseDate: string; // yyyy-mm-dd (string)
  dateAdded: string;   // yyyy-mm-dd (string)

  backlog: string;     // "TRUE"/"FALSE" or "Yes"/"No"
  completed: string;   // "TRUE"/"FALSE" or "Yes"/"No"

  igdbRating: string;
  myRating: string;
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

const LS_COVER_SIZE = "gg_clone_cover_size_v1";
const LS_CUSTOM_ORDER = "gg_clone_custom_order_v1";
const LS_SORT_KEY = "gg_clone_sort_key_v1";
const LS_TAB_KEY = "gg_clone_tab_key_v1";

const COLORS = {
  bg: "#050506",
  panel: "#0b0b0e",
  card: "#0f0f14",
  border: "rgba(255,255,255,0.10)",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.62)",
  faint: "rgba(255,255,255,0.45)",
  accent: "#20c162",
};

function norm(v: unknown) {
  return String(v ?? "").trim();
}
function splitList(v: string) {
  const s = norm(v);
  if (!s) return [];
  // supports "Action, RPG" or "Action|RPG"
  return s
    .split(/[,|]/g)
    .map((x) => x.trim())
    .filter(Boolean);
}
function toBool(v: string) {
  const s = norm(v).toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1";
}
function titleKey(s: string) {
  return norm(s).toLowerCase().replace(/\s+/g, " ").trim();
}
function dateToSortable(d: string) {
  // expects yyyy-mm-dd
  const s = norm(d);
  if (!s) return "";
  return s;
}

function pickCover(row: Row) {
  // Prefer CoverURL (IGDB)
  return norm(row["CoverURL"] || row["CoverUrl"] || row["Cover"]);
}

function rowToGame(row: Row): Game {
  const igdbId = norm(row["IGDB_ID"] || row["IGDB Id"] || row["IGDBID"]);
  const title = norm(row["Title"] || row["Name"]);
  const coverUrl = pickCover(row);

  return {
    igdbId,
    title,
    coverUrl,

    platforms: splitList(row["Platforms"] || row["Platform"]),
    genres: splitList(row["Genres"] || row["Genre"]),
    yearPlayed: splitList(row["YearPlayed"] || row["Year Played"]),

    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    releaseDate: norm(row["ReleaseDate"] || row["Release Date"]),
    dateAdded: norm(row["DateAdded"] || row["Date Added"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),

    igdbRating: norm(row["IGDB Rating"] || row["IGDBRating"] || row["Rating"]),
    myRating: norm(row["My Rating"] || row["MyRating"]),
  };
}

function dedupeByIgdbId(games: Game[]) {
  // Keep first occurrence; merge lists if duplicates show up
  const byId = new Map<string, Game>();

  for (const g of games) {
    const id = g.igdbId || `title:${titleKey(g.title)}`;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, g);
      continue;
    }
    const merged: Game = {
      ...existing,
      // keep best cover
      coverUrl: existing.coverUrl || g.coverUrl,
      // merge arrays unique
      platforms: Array.from(new Set([...existing.platforms, ...g.platforms])).filter(Boolean),
      genres: Array.from(new Set([...existing.genres, ...g.genres])).filter(Boolean),
      yearPlayed: Array.from(new Set([...existing.yearPlayed, ...g.yearPlayed])).filter(Boolean),
      // prefer non-empty scalar values
      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,
      releaseDate: existing.releaseDate || g.releaseDate,
      dateAdded: existing.dateAdded || g.dateAdded,
      backlog: existing.backlog || g.backlog,
      completed: existing.completed || g.completed,
      igdbRating: existing.igdbRating || g.igdbRating,
      myRating: existing.myRating || g.myRating,
      // keep real igdb id if either has it
      igdbId: existing.igdbId || g.igdbId,
      title: existing.title || g.title,
    };
    byId.set(id, merged);
  }

  return Array.from(byId.values());
}

function buildCountMap(items: string[]) {
  const m = new Map<string, number>();
  for (const it of items) m.set(it, (m.get(it) || 0) + 1);
  return m;
}

type SortKey = "releaseDate" | "title" | "dateAdded" | "custom";
type TabKey = "games" | "queue" | "wishlist";

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string>("");

  // UI state
  const [coverSize, setCoverSize] = useState<number>(100); // default 100 as requested
  const [tab, setTab] = useState<TabKey>("games");
  const [sortKey, setSortKey] = useState<SortKey>("releaseDate");

  // Filters
  const [selPlatforms, setSelPlatforms] = useState<Set<string>>(new Set());
  const [selGenres, setSelGenres] = useState<Set<string>>(new Set());
  const [selYearPlayed, setSelYearPlayed] = useState<Set<string>>(new Set());
  const [selStatus, setSelStatus] = useState<Set<string>>(new Set());
  const [selOwnership, setSelOwnership] = useState<Set<string>>(new Set());
  const [selFormat, setSelFormat] = useState<Set<string>>(new Set());

  const [onlyBacklog, setOnlyBacklog] = useState(false);
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [onlyNowPlaying, setOnlyNowPlaying] = useState(false);
  const [onlyAbandoned, setOnlyAbandoned] = useState(false);

  // Custom order (ids)
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const draggingIdRef = useRef<string | null>(null);
  const lastDropAtRef = useRef<number>(0);

  // Load persisted UI
  useEffect(() => {
    try {
      const savedSize = localStorage.getItem(LS_COVER_SIZE);
      if (savedSize) {
        const n = Number(savedSize);
        if (!Number.isNaN(n)) setCoverSize(n);
      }

      const savedSort = localStorage.getItem(LS_SORT_KEY) as SortKey | null;
      if (savedSort) setSortKey(savedSort);

      const savedTab = localStorage.getItem(LS_TAB_KEY) as TabKey | null;
      if (savedTab) setTab(savedTab);

      const savedOrder = localStorage.getItem(LS_CUSTOM_ORDER);
      if (savedOrder) {
        const parsed = JSON.parse(savedOrder);
        if (Array.isArray(parsed)) setCustomOrder(parsed.map(String));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_COVER_SIZE, String(coverSize));
    } catch {}
  }, [coverSize]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_SORT_KEY, sortKey);
    } catch {}
  }, [sortKey]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_TAB_KEY, tab);
    } catch {}
  }, [tab]);

  useEffect(() => {
    // load CSV
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError("");
      try {
        const resp = await fetch(CSV_URL, { cache: "no-store" });
        if (!resp.ok) throw new Error(`CSV fetch failed: ${resp.status}`);
        const text = await resp.text();

        const parsed = Papa.parse<Row>(text, {
          header: true,
          skipEmptyLines: true,
        });

        const rows = (parsed.data || []).filter(Boolean);
        const mapped = rows.map(rowToGame).filter((g) => g.title);

        const deduped = dedupeByIgdbId(mapped);

        if (!cancelled) {
          setGames(deduped);

          // initialize custom order if empty: current list by release date then title
          if (customOrder.length === 0) {
            const ids = deduped
              .map((g) => g.igdbId || `title:${titleKey(g.title)}`)
              .filter(Boolean);
            setCustomOrder(ids);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reconcile custom order with current dataset (add new ids, remove missing)
  useEffect(() => {
    const idsNow = new Set(
      games.map((g) => g.igdbId || `title:${titleKey(g.title)}`)
    );
    if (idsNow.size === 0) return;

    setCustomOrder((prev) => {
      const kept = prev.filter((id) => idsNow.has(id));
      const missing = Array.from(idsNow).filter((id) => !kept.includes(id));
      const next = [...kept, ...missing];
      try {
        localStorage.setItem(LS_CUSTOM_ORDER, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [games]);

  // Build option counts from CURRENT filtered-by-tab list (so left counts feel right)
  const tabFilteredBase = useMemo(() => {
    if (tab === "queue") {
      return games.filter((g) => norm(g.status).toLowerCase() === "queued");
    }
    if (tab === "wishlist") {
      return games.filter((g) => norm(g.ownership).toLowerCase() === "wishlist");
    }
    return games;
  }, [games, tab]);

  const allPlatforms = useMemo(() => tabFilteredBase.flatMap((g) => g.platforms), [tabFilteredBase]);
  const allGenres = useMemo(() => tabFilteredBase.flatMap((g) => g.genres), [tabFilteredBase]);
  const allYears = useMemo(() => tabFilteredBase.flatMap((g) => g.yearPlayed), [tabFilteredBase]);
  const allStatuses = useMemo(() => tabFilteredBase.map((g) => g.status).filter(Boolean), [tabFilteredBase]);
  const allOwnerships = useMemo(() => tabFilteredBase.map((g) => g.ownership).filter(Boolean), [tabFilteredBase]);
  const allFormats = useMemo(() => tabFilteredBase.map((g) => g.format).filter(Boolean), [tabFilteredBase]);

  const platformCounts = useMemo(() => buildCountMap(allPlatforms), [allPlatforms]);
  const genreCounts = useMemo(() => buildCountMap(allGenres), [allGenres]);
  const yearCounts = useMemo(() => buildCountMap(allYears), [allYears]);
  const statusCounts = useMemo(() => buildCountMap(allStatuses), [allStatuses]);
  const ownershipCounts = useMemo(() => buildCountMap(allOwnerships), [allOwnerships]);
  const formatCounts = useMemo(() => buildCountMap(allFormats), [allFormats]);

  const uniqueSorted = (m: Map<string, number>) =>
    Array.from(m.entries())
      .filter(([k]) => k && k.trim())
      .sort((a, b) => a[0].localeCompare(b[0]));

  // Stats (top right style)
  const currentYear = new Date().getFullYear();
  const stats = useMemo(() => {
    const totalGames = games.length;
    const queued = games.filter((g) => norm(g.status).toLowerCase() === "queued").length;
    const wishlist = games.filter((g) => norm(g.ownership).toLowerCase() === "wishlist").length;
    const playedThisYear = games.filter((g) => g.yearPlayed.includes(String(currentYear))).length;
    return { totalGames, queued, wishlist, playedThisYear, currentYear };
  }, [games, currentYear]);

  const filtered = useMemo(() => {
    let list = tabFilteredBase;

    const hasAny = (set: Set<string>) => set.size > 0;

    if (hasAny(selPlatforms)) list = list.filter((g) => g.platforms.some((p) => selPlatforms.has(p)));
    if (hasAny(selGenres)) list = list.filter((g) => g.genres.some((p) => selGenres.has(p)));
    if (hasAny(selYearPlayed)) list = list.filter((g) => g.yearPlayed.some((p) => selYearPlayed.has(p)));
    if (hasAny(selStatus)) list = list.filter((g) => selStatus.has(g.status));
    if (hasAny(selOwnership)) list = list.filter((g) => selOwnership.has(g.ownership));
    if (hasAny(selFormat)) list = list.filter((g) => selFormat.has(g.format));

    if (onlyBacklog) list = list.filter((g) => toBool(g.backlog));
    if (onlyCompleted) list = list.filter((g) => toBool(g.completed));
    if (onlyNowPlaying) list = list.filter((g) => norm(g.status).toLowerCase() === "now playing");
    if (onlyAbandoned) list = list.filter((g) => norm(g.status).toLowerCase() === "abandoned");

    // Sort
    const copy = [...list];
    if (sortKey === "title") {
      copy.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortKey === "dateAdded") {
      copy.sort((a, b) => {
        const ad = dateToSortable(a.dateAdded);
        const bd = dateToSortable(b.dateAdded);
        // newest first
        if (ad && bd) return bd.localeCompare(ad);
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return a.title.localeCompare(b.title);
      });
    } else if (sortKey === "releaseDate") {
      copy.sort((a, b) => {
        const ad = dateToSortable(a.releaseDate);
        const bd = dateToSortable(b.releaseDate);
        // newest first
        if (ad && bd) return bd.localeCompare(ad);
        if (ad && !bd) return -1;
        if (!ad && bd) return 1;
        return a.title.localeCompare(b.title);
      });
    } else if (sortKey === "custom") {
      const idx = new Map<string, number>();
      customOrder.forEach((id, i) => idx.set(id, i));
      copy.sort((a, b) => {
        const aid = a.igdbId || `title:${titleKey(a.title)}`;
        const bid = b.igdbId || `title:${titleKey(b.title)}`;
        return (idx.get(aid) ?? 1e9) - (idx.get(bid) ?? 1e9);
      });
    }
    return copy;
  }, [
    tabFilteredBase,
    selPlatforms,
    selGenres,
    selYearPlayed,
    selStatus,
    selOwnership,
    selFormat,
    onlyBacklog,
    onlyCompleted,
    onlyNowPlaying,
    onlyAbandoned,
    sortKey,
    customOrder,
  ]);

  function toggleInSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function resetFilters() {
    setSelPlatforms(new Set());
    setSelGenres(new Set());
    setSelYearPlayed(new Set());
    setSelStatus(new Set());
    setSelOwnership(new Set());
    setSelFormat(new Set());
    setOnlyBacklog(false);
    setOnlyCompleted(false);
    setOnlyNowPlaying(false);
    setOnlyAbandoned(false);
  }

  // ---------- Drag & Drop (native, no libs) ----------
  function idForGame(g: Game) {
    return g.igdbId || `title:${titleKey(g.title)}`;
  }

  function persistOrder(next: string[]) {
    setCustomOrder(next);
    try {
      localStorage.setItem(LS_CUSTOM_ORDER, JSON.stringify(next));
    } catch {}
  }

  function reorderWithinCustomOrder(activeId: string, overId: string) {
    if (!activeId || !overId || activeId === overId) return;

    const now = Date.now();
    // small guard so touch devices don't spam reorder too hard
    if (now - lastDropAtRef.current < 40) return;
    lastDropAtRef.current = now;

    setSortKey("custom");

    persistOrder((() => {
      const prev = [...customOrder];
      const from = prev.indexOf(activeId);
      const to = prev.indexOf(overId);
      if (from === -1 || to === -1) return prev;
      prev.splice(from, 1);
      prev.splice(to, 0, activeId);
      return prev;
    })());
  }

  function onDragStartCover(id: string) {
    draggingIdRef.current = id;
    setSortKey("custom");
  }
  function onDragEndCover() {
    draggingIdRef.current = null;
  }

  // ---------- UI helpers ----------
  function TopTab({
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
          fontSize: 18,
          padding: "6px 0",
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
              bottom: -6,
              height: 3,
              background: COLORS.accent,
              borderRadius: 999,
            }}
          />
        )}
      </button>
    );
  }

  function Stat({ value, label }: { value: number; label: string }) {
    return (
      <div style={{ textAlign: "right", minWidth: 90 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: COLORS.text, lineHeight: 1.05 }}>
          {value}
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.faint, marginTop: 2 }}>
          {label}
        </div>
      </div>
    );
  }

  function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
      <div style={{ fontSize: 11, fontWeight: 900, color: COLORS.faint, letterSpacing: 0.8, marginTop: 14, marginBottom: 6 }}>
        {children}
      </div>
    );
  }

  function OptionLine({
    label,
    count,
    selected,
    onClick,
  }: {
    label: string;
    count: number;
    selected: boolean;
    onClick: () => void;
  }) {
    return (
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
          padding: "4px 0",
          cursor: "pointer",
          color: selected ? COLORS.text : COLORS.muted,
          fontSize: 12,
          fontWeight: selected ? 900 : 700,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
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
            background: selected ? "rgba(32,193,98,0.18)" : "rgba(255,255,255,0.08)",
            color: selected ? COLORS.text : COLORS.muted,
            fontSize: 11,
            fontWeight: 900,
          }}
        >
          {count}
        </span>
      </button>
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
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          color: COLORS.muted,
          fontWeight: 800,
          cursor: "pointer",
          userSelect: "none",
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
  }

  return (
    <div
      style={{
        background: COLORS.bg,
        minHeight: "100vh",
        color: COLORS.text,
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"',
      }}
    >
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
        {/* Left panel */}
        <aside
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 18,
            padding: 14,
            position: "sticky",
            top: 12,
            alignSelf: "start",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 950 }}>Filters</div>
            <button
              onClick={resetFilters}
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: 900,
                color: COLORS.muted,
                cursor: "pointer",
              }}
            >
              Reset
            </button>
          </div>

          {/* Checkboxes layout (2 columns, lined evenly) */}
          <SectionTitle>Quick Filters</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <CheckRow label="Backlog" checked={onlyBacklog} onChange={setOnlyBacklog} />
            <CheckRow label="Now Playing" checked={onlyNowPlaying} onChange={setOnlyNowPlaying} />
            <CheckRow label="Completed" checked={onlyCompleted} onChange={setOnlyCompleted} />
            <CheckRow label="Abandoned" checked={onlyAbandoned} onChange={setOnlyAbandoned} />
          </div>

          <SectionTitle>Sort</SectionTitle>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            style={{
              width: "100%",
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: "10px 12px",
              color: COLORS.text,
              fontWeight: 800,
              fontSize: 12,
              outline: "none",
            }}
          >
            <option value="releaseDate">Release Date (newest)</option>
            <option value="dateAdded">Date Added (newest)</option>
            <option value="title">Title (A–Z)</option>
            <option value="custom">Custom</option>
          </select>

          <SectionTitle>Cover Size</SectionTitle>
          <input
            type="range"
            min={70}
            max={160}
            value={coverSize}
            onChange={(e) => setCoverSize(Number(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ fontSize: 11, color: COLORS.faint, fontWeight: 800, marginTop: 4 }}>
            {coverSize}px
          </div>

          <SectionTitle>Platform</SectionTitle>
          <div>
            {uniqueSorted(platformCounts).map(([label, count]) => (
              <OptionLine
                key={`plat-${label}`}
                label={label}
                count={count}
                selected={selPlatforms.has(label)}
                onClick={() => toggleInSet(setSelPlatforms, label)}
              />
            ))}
          </div>

          <SectionTitle>Status</SectionTitle>
          <div>
            {uniqueSorted(statusCounts).map(([label, count]) => (
              <OptionLine
                key={`status-${label}`}
                label={label}
                count={count}
                selected={selStatus.has(label)}
                onClick={() => toggleInSet(setSelStatus, label)}
              />
            ))}
          </div>

          <SectionTitle>Ownership</SectionTitle>
          <div>
            {uniqueSorted(ownershipCounts).map(([label, count]) => (
              <OptionLine
                key={`own-${label}`}
                label={label}
                count={count}
                selected={selOwnership.has(label)}
                onClick={() => toggleInSet(setSelOwnership, label)}
              />
            ))}
          </div>

          <SectionTitle>Format</SectionTitle>
          <div>
            {uniqueSorted(formatCounts).map(([label, count]) => (
              <OptionLine
                key={`fmt-${label}`}
                label={label}
                count={count}
                selected={selFormat.has(label)}
                onClick={() => toggleInSet(setSelFormat, label)}
              />
            ))}
          </div>

          <SectionTitle>Year Played</SectionTitle>
          <div>
            {uniqueSorted(yearCounts).map(([label, count]) => (
              <OptionLine
                key={`yr-${label}`}
                label={label}
                count={count}
                selected={selYearPlayed.has(label)}
                onClick={() => toggleInSet(setSelYearPlayed, label)}
              />
            ))}
          </div>

          <SectionTitle>Genre</SectionTitle>
          <div>
            {uniqueSorted(genreCounts).map(([label, count]) => (
              <OptionLine
                key={`genre-${label}`}
                label={label}
                count={count}
                selected={selGenres.has(label)}
                onClick={() => toggleInSet(setSelGenres, label)}
              />
            ))}
          </div>
        </aside>

        {/* Main */}
        <main>
          {/* Top header row: tabs + stats */}
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              padding: 14,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 16,
              marginBottom: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
              <TopTab
                label="Games"
                active={tab === "games"}
                onClick={() => setTab("games")}
              />
              <TopTab
                label="Backlog Queue"
                active={tab === "queue"}
                onClick={() => setTab("queue")}
              />
              <TopTab
                label="Wishlist"
                active={tab === "wishlist"}
                onClick={() => setTab("wishlist")}
              />
            </div>

            <div style={{ display: "flex", gap: 14, alignItems: "flex-end" }}>
              <Stat value={stats.totalGames} label="Games" />
              <Stat value={stats.queued} label="Queued" />
              <Stat value={stats.wishlist} label="Wishlist" />
              <Stat value={stats.playedThisYear} label={`Played in ${stats.currentYear}`} />
            </div>
          </div>

          {/* Status line */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 800 }}>
              {loading ? "Loading…" : error ? `Error: ${error}` : `${filtered.length} shown`}
            </div>

            <button
              onClick={() => {
                // handy: if you mess up local custom order, reset it to current list
                const ids = games.map(idForGame);
                persistOrder(ids);
                setSortKey("custom");
              }}
              style={{
                background: "transparent",
                border: `1px solid ${COLORS.border}`,
                borderRadius: 12,
                padding: "8px 10px",
                fontSize: 12,
                fontWeight: 900,
                color: COLORS.muted,
                cursor: "pointer",
              }}
              title="Resets Custom sort order to current list order"
            >
              Reset Custom Order
            </button>
          </div>

          {/* Grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, ${coverSize}px))`,
              gap: 10,
              alignItems: "start",
            }}
          >
            {filtered.map((g, i) => {
              const id = idForGame(g);

              return (
                <div
                  key={`${id}-${i}`}
                  draggable
                  onDragStart={() => onDragStartCover(id)}
                  onDragEnd={onDragEndCover}
                  onDragOver={(e) => {
                    // allow drop
                    e.preventDefault();
                  }}
                  onDrop={() => {
                    const activeId = draggingIdRef.current;
                    if (!activeId) return;
                    reorderWithinCustomOrder(activeId, id);
                  }}
                  style={{
                    width: coverSize,
                    height: Math.round((coverSize * 3) / 2),
                    borderRadius: 14,
                    overflow: "hidden",
                    background: COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                    boxShadow: "0 16px 30px rgba(0,0,0,.55)",
                    cursor: "grab",
                    userSelect: "none",
                  }}
                  title={g.title}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      loading="lazy"
                      onError={(e) => {
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
                        fontSize: 11,
                        fontWeight: 800,
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

          {!loading && !error && filtered.length === 0 && (
            <div
              style={{
                marginTop: 18,
                padding: 14,
                borderRadius: 14,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.panel,
                color: COLORS.muted,
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              No games match your current filters.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

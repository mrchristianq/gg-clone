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

  releaseDate: string;
  dateAdded: string;

  backlog: boolean;
  completed: boolean;

  igdbRating: number | null;
  myRating: number | null;

  customOrder: number | null; // from sheet
};

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vSqSRFtUg55P7DGs-XZv01eeIzBar_9vbux8gYtQNJRbKFF4wnfnb5tRnRVStHGTAPzbhk_FHm87CdT/pub?gid=1501557654&single=true&output=csv";

const STORAGE_KEYS = {
  coverSize: "ggclone_coverSize_v1",
  sort: "ggclone_sort_v1",
  tab: "ggclone_tab_v1",
  customOrder: "ggclone_customOrder_v2", // array of IGDB_IDs in order
};

const COLORS = {
  bg: "#0b0e12",
  panel: "#0f141b",
  card: "#121a24",
  text: "#e8eef7",
  muted: "rgba(232,238,247,0.65)",
  border: "rgba(255,255,255,0.10)",
  green: "#22c55e",
};

function splitTags(v: string) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function norm(v: any) {
  return String(v ?? "").trim();
}

function parseDateMs(s: string) {
  // expects yyyy-mm-dd but can tolerate other Date.parse-able strings
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}

function toBool(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y";
}

function safeNum(v: any) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) ? n : null;
}

function getLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function setLS(key: string, value: any) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function titleKey(s: string) {
  return (s || "").trim().toLowerCase();
}

function rowToGame(r: Row): Game | null {
  const igdbId = norm(r["IGDB_ID"]);
  const title = norm(r["Title"]) || norm(r["Name"]);
  if (!igdbId || !title) return null;

  const coverUrl = norm(r["CoverURL"]) || norm(r["CoverUrl"]) || norm(r["Cover"]);

  const status = norm(r["Status"]);
  const ownership = norm(r["Ownership"]);
  const format = norm(r["Format"]);

  const releaseDate = norm(r["ReleaseDate"]) || norm(r["Release Date"]);
  const dateAdded = norm(r["DateAdded"]) || norm(r["Date Added"]);

  const platforms = splitTags(r["Platforms"] || r["Platform"]);
  const genres = splitTags(r["Genres"]);
  const yearPlayed = splitTags(r["YearPlayed"] || r["Year Played"]);

  const backlog = toBool(r["Backlog"]);
  const completed = toBool(r["Completed"]);

  const igdbRating =
    safeNum(r["IGDB Rating"]) ?? safeNum(r["IGDB_Rating"]) ?? safeNum(r["Rating"]);
  const myRating = safeNum(r["My Rating"]) ?? safeNum(r["MyRating"]);

  const customOrder = safeNum(r["CustomOrder"]);

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
    releaseDate,
    dateAdded,
    backlog,
    completed,
    igdbRating,
    myRating,
    customOrder,
  };
}

function dedupeByIgdbId(games: Game[]) {
  // Keep first occurrence; merge tag-ish fields
  const map = new Map<string, Game>();
  for (const g of games) {
    if (!map.has(g.igdbId)) {
      map.set(g.igdbId, g);
      continue;
    }
    const existing = map.get(g.igdbId)!;
    const mergeUniq = (a: string[], b: string[]) =>
      Array.from(new Set([...(a || []), ...(b || [])])).filter(Boolean);

    map.set(g.igdbId, {
      ...existing,
      // prefer filled values
      coverUrl: existing.coverUrl || g.coverUrl,
      releaseDate: existing.releaseDate || g.releaseDate,
      dateAdded: existing.dateAdded || g.dateAdded,
      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,
      igdbRating: existing.igdbRating ?? g.igdbRating,
      myRating: existing.myRating ?? g.myRating,
      customOrder: existing.customOrder ?? g.customOrder,
      backlog: existing.backlog || g.backlog,
      completed: existing.completed || g.completed,
      platforms: mergeUniq(existing.platforms, g.platforms),
      genres: mergeUniq(existing.genres, g.genres),
      yearPlayed: mergeUniq(existing.yearPlayed, g.yearPlayed),
    });
  }
  return Array.from(map.values());
}

type SortKey = "ReleaseDate" | "Title" | "DateAdded" | "IGDBRating" | "MyRating" | "Custom";
type TopTab = "Games" | "BacklogQueue" | "Wishlist";

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState<Game[]>([]);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [coverSize, setCoverSize] = useState<number>(100); // default requested
  const [sortKey, setSortKey] = useState<SortKey>("ReleaseDate");
  const [tab, setTab] = useState<TopTab>("Games");

  // Left filters (minimal; keep your existing ones if you had more)
  const [platformSel, setPlatformSel] = useState<Set<string>>(new Set());
  const [genreSel, setGenreSel] = useState<Set<string>>(new Set());
  const [yearSel, setYearSel] = useState<Set<string>>(new Set());

  const [statusSel, setStatusSel] = useState<Set<string>>(new Set());
  const [ownershipSel, setOwnershipSel] = useState<Set<string>>(new Set());
  const [formatSel, setFormatSel] = useState<Set<string>>(new Set());

  const [onlyBacklog, setOnlyBacklog] = useState(false);
  const [onlyCompleted, setOnlyCompleted] = useState(false);
  const [onlyNowPlaying, setOnlyNowPlaying] = useState(false);
  const [onlyAbandoned, setOnlyAbandoned] = useState(false);

  // Custom order (localStorage)
  const [customOrderIds, setCustomOrderIds] = useState<string[]>([]);

  // Drag state
  const dragFromIdRef = useRef<string | null>(null);

  // Load persisted UI settings
  useEffect(() => {
    const savedSize = getLS<number>(STORAGE_KEYS.coverSize, 100);
    setCoverSize(clamp(savedSize, 60, 200));

    const savedSort = getLS<SortKey>(STORAGE_KEYS.sort, "ReleaseDate");
    setSortKey(savedSort);

    const savedTab = getLS<TopTab>(STORAGE_KEYS.tab, "Games");
    setTab(savedTab);

    const savedCustom = getLS<string[]>(STORAGE_KEYS.customOrder, []);
    setCustomOrderIds(Array.isArray(savedCustom) ? savedCustom : []);
  }, []);

  useEffect(() => setLS(STORAGE_KEYS.coverSize, coverSize), [coverSize]);
  useEffect(() => setLS(STORAGE_KEYS.sort, sortKey), [sortKey]);
  useEffect(() => setLS(STORAGE_KEYS.tab, tab), [tab]);

  // Fetch CSV
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(CSV_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);

        const csvText = await res.text();

        const parsed = Papa.parse<Row>(csvText, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false,
        });

        const rows = (parsed.data || []) as Row[];
        const mapped = rows
          .map(rowToGame)
          .filter(Boolean) as Game[];

        // Deduplicate by IGDB_ID (you asked for this)
        const deduped = dedupeByIgdbId(mapped);

        if (!cancelled) {
          setGames(deduped);
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
  }, []);

  // Build “initial” custom order list if none exists yet:
  // Prefer sheet CustomOrder numeric, else fall back to current list order.
  useEffect(() => {
    if (!games.length) return;

    // If we already have a saved custom order, keep it.
    if (customOrderIds.length) return;

    // If sheet has CustomOrder values, seed from them.
    const withSheet = games
      .filter((g) => g.customOrder != null)
      .sort((a, b) => (a.customOrder! - b.customOrder!))
      .map((g) => g.igdbId);

    if (withSheet.length) {
      setCustomOrderIds(withSheet);
      setLS(STORAGE_KEYS.customOrder, withSheet);
    } else {
      // fallback: seed from title
      const seeded = [...games]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((g) => g.igdbId);
      setCustomOrderIds(seeded);
      setLS(STORAGE_KEYS.customOrder, seeded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games]);

  // Build filter option lists + counts
  const facets = useMemo(() => {
    const countMap = (items: string[]) => {
      const m = new Map<string, number>();
      for (const v of items) m.set(v, (m.get(v) || 0) + 1);
      return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    };

    const platforms: string[] = [];
    const genres: string[] = [];
    const years: string[] = [];
    const statuses: string[] = [];
    const ownerships: string[] = [];
    const formats: string[] = [];

    for (const g of games) {
      g.platforms.forEach((p) => platforms.push(p));
      g.genres.forEach((x) => genres.push(x));
      g.yearPlayed.forEach((y) => years.push(y));
      if (g.status) statuses.push(g.status);
      if (g.ownership) ownerships.push(g.ownership);
      if (g.format) formats.push(g.format);
    }

    return {
      platforms: countMap(platforms),
      genres: countMap(genres),
      years: countMap(years),
      statuses: countMap(statuses),
      ownerships: countMap(ownerships),
      formats: countMap(formats),
    };
  }, [games]);

  // Top-right stats
  const stats = useMemo(() => {
    const total = games.length;
    const queued = games.filter((g) => g.status.toLowerCase() === "queued").length;
    const wishlist = games.filter((g) => g.ownership.toLowerCase() === "wishlist").length;

    const currentYear = new Date().getFullYear();
    const playedThisYear = games.filter((g) => g.yearPlayed.includes(String(currentYear))).length;

    return { total, queued, wishlist, playedThisYear, currentYear };
  }, [games]);

  // Apply tab (Games / BacklogQueue / Wishlist)
  const tabFiltered = useMemo(() => {
    if (tab === "BacklogQueue") {
      return games.filter((g) => g.status.toLowerCase() === "queued");
    }
    if (tab === "Wishlist") {
      return games.filter((g) => g.ownership.toLowerCase() === "wishlist");
    }
    return games;
  }, [games, tab]);

  // Apply left filters
  const filtered = useMemo(() => {
    let list = tabFiltered;

    const hasSel = (s: Set<string>) => s && s.size > 0;
    const matchAny = (values: string[], sel: Set<string>) => values.some((v) => sel.has(v));

    if (hasSel(platformSel)) list = list.filter((g) => matchAny(g.platforms, platformSel));
    if (hasSel(genreSel)) list = list.filter((g) => matchAny(g.genres, genreSel));
    if (hasSel(yearSel)) list = list.filter((g) => matchAny(g.yearPlayed, yearSel));

    if (hasSel(statusSel)) list = list.filter((g) => statusSel.has(g.status));
    if (hasSel(ownershipSel)) list = list.filter((g) => ownershipSel.has(g.ownership));
    if (hasSel(formatSel)) list = list.filter((g) => formatSel.has(g.format));

    // checkbox filters
    if (onlyBacklog) list = list.filter((g) => g.backlog);
    if (onlyCompleted) list = list.filter((g) => g.completed);
    if (onlyNowPlaying) list = list.filter((g) => g.status.toLowerCase() === "now playing");
    if (onlyAbandoned) list = list.filter((g) => g.status.toLowerCase() === "abandoned");

    return list;
  }, [
    tabFiltered,
    platformSel,
    genreSel,
    yearSel,
    statusSel,
    ownershipSel,
    formatSel,
    onlyBacklog,
    onlyCompleted,
    onlyNowPlaying,
    onlyAbandoned,
  ]);

  // Sorting
  const sorted = useMemo(() => {
    const list = [...filtered];

    if (sortKey === "Custom") {
      // Use customOrderIds; anything missing goes to end (stable)
      const pos = new Map<string, number>();
      customOrderIds.forEach((id, i) => pos.set(id, i));
      list.sort((a, b) => {
        const pa = pos.has(a.igdbId) ? pos.get(a.igdbId)! : Number.MAX_SAFE_INTEGER;
        const pb = pos.has(b.igdbId) ? pos.get(b.igdbId)! : Number.MAX_SAFE_INTEGER;
        if (pa !== pb) return pa - pb;
        return a.title.localeCompare(b.title);
      });
      return list;
    }

    if (sortKey === "Title") {
      list.sort((a, b) => a.title.localeCompare(b.title));
      return list;
    }

    if (sortKey === "ReleaseDate") {
      list.sort((a, b) => {
        const da = parseDateMs(a.releaseDate);
        const db = parseDateMs(b.releaseDate);
        if (Number.isNaN(da) && Number.isNaN(db)) return a.title.localeCompare(b.title);
        if (Number.isNaN(da)) return 1;
        if (Number.isNaN(db)) return -1;
        return db - da;
      });
      return list;
    }

    if (sortKey === "DateAdded") {
      list.sort((a, b) => {
        const da = parseDateMs(a.dateAdded);
        const db = parseDateMs(b.dateAdded);
        if (Number.isNaN(da) && Number.isNaN(db)) return a.title.localeCompare(b.title);
        if (Number.isNaN(da)) return 1;
        if (Number.isNaN(db)) return -1;
        return db - da;
      });
      return list;
    }

    if (sortKey === "IGDBRating") {
      list.sort((a, b) => (b.igdbRating ?? -1) - (a.igdbRating ?? -1));
      return list;
    }

    if (sortKey === "MyRating") {
      list.sort((a, b) => (b.myRating ?? -1) - (a.myRating ?? -1));
      return list;
    }

    return list;
  }, [filtered, sortKey, customOrderIds]);

  // Drag-and-drop reorder
  function onDragStart(id: string) {
    dragFromIdRef.current = id;
    // If user starts dragging, automatically switch to Custom
    if (sortKey !== "Custom") setSortKey("Custom");
  }

  function onDropOn(targetId: string) {
    const fromId = dragFromIdRef.current;
    dragFromIdRef.current = null;
    if (!fromId || fromId === targetId) return;

    // Reorder within current visible "sorted" list
    const visibleIds = sorted.map((g) => g.igdbId);

    const fromIdx = visibleIds.indexOf(fromId);
    const toIdx = visibleIds.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    const newVisible = [...visibleIds];
    newVisible.splice(fromIdx, 1);
    newVisible.splice(toIdx, 0, fromId);

    // Merge into global customOrderIds:
    // Keep relative order for items not currently visible.
    const visibleSet = new Set(visibleIds);
    const existing = customOrderIds.length ? customOrderIds : games.map((g) => g.igdbId);

    const notVisible = existing.filter((id) => !visibleSet.has(id));
    const merged = [...newVisible, ...notVisible];

    setCustomOrderIds(merged);
    setLS(STORAGE_KEYS.customOrder, merged);
  }

  function toggleSet(setter: React.Dispatch<React.SetStateAction<Set<string>>>, value: string) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function clearAllFilters() {
    setPlatformSel(new Set());
    setGenreSel(new Set());
    setYearSel(new Set());
    setStatusSel(new Set());
    setOwnershipSel(new Set());
    setFormatSel(new Set());
    setOnlyBacklog(false);
    setOnlyCompleted(false);
    setOnlyNowPlaying(false);
    setOnlyAbandoned(false);
  }

  function resetCustomOrderToTitle() {
    const seeded = [...games].sort((a, b) => a.title.localeCompare(b.title)).map((g) => g.igdbId);
    setCustomOrderIds(seeded);
    setLS(STORAGE_KEYS.customOrder, seeded);
    setSortKey("Custom");
  }

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
      {/* Top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(11,14,18,0.92)",
          borderBottom: `1px solid ${COLORS.border}`,
          backdropFilter: "blur(10px)",
        }}
      >
        <div
          style={{
            maxWidth: 1400,
            margin: "0 auto",
            padding: "14px 16px",
            display: "flex",
            gap: 14,
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.2 }}>
              Chris&apos; Game Library
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted }}>
              {loading ? "Loading…" : error ? `Error: ${error}` : `${games.length} games`}
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <NavTab label="Games" active={tab === "Games"} onClick={() => setTab("Games")} />
            <NavTab
              label="Backlog Queue"
              active={tab === "BacklogQueue"}
              onClick={() => setTab("BacklogQueue")}
            />
            <NavTab label="Wishlist" active={tab === "Wishlist"} onClick={() => setTab("Wishlist")} />
          </div>

          {/* Stats */}
          <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
            <StatBox label="Games" value={stats.total} />
            <StatBox label="Queued" value={stats.queued} />
            <StatBox label="Wishlist" value={stats.wishlist} />
            <StatBox label={`Played in ${stats.currentYear}`} value={stats.playedThisYear} />
          </div>
        </div>
      </div>

      <div
        style={{
          maxWidth: 1400,
          margin: "0 auto",
          padding: "16px",
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
            borderRadius: 16,
            padding: 14,
            height: "fit-content",
            position: "sticky",
            top: 84,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <div style={{ fontWeight: 900, fontSize: 14 }}>Filters</div>
            <button
              onClick={clearAllFilters}
              style={{
                fontSize: 12,
                padding: "6px 10px",
                borderRadius: 10,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Clear
            </button>
          </div>

          {/* Checkbox row: Backlog / Now Playing */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <CheckboxLine label="Backlog" checked={onlyBacklog} onChange={setOnlyBacklog} />
            <CheckboxLine label="Now Playing" checked={onlyNowPlaying} onChange={setOnlyNowPlaying} />
          </div>

          {/* Checkbox row: Completed / Abandoned */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <CheckboxLine label="Completed" checked={onlyCompleted} onChange={setOnlyCompleted} />
            <CheckboxLine label="Abandoned" checked={onlyAbandoned} onChange={setOnlyAbandoned} />
          </div>

          <Section title="Platform" items={facets.platforms} selected={platformSel} onToggle={(v) => toggleSet(setPlatformSel, v)} />
          <Section title="Genre" items={facets.genres} selected={genreSel} onToggle={(v) => toggleSet(setGenreSel, v)} />
          <Section title="Year Played" items={facets.years} selected={yearSel} onToggle={(v) => toggleSet(setYearSel, v)} />

          <Section title="Status" items={facets.statuses} selected={statusSel} onToggle={(v) => toggleSet(setStatusSel, v)} />
          <Section title="Ownership" items={facets.ownerships} selected={ownershipSel} onToggle={(v) => toggleSet(setOwnershipSel, v)} />
          <Section title="Format" items={facets.formats} selected={formatSel} onToggle={(v) => toggleSet(setFormatSel, v)} />

          <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8 }}>Sort</div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{
                width: "100%",
                padding: "10px 10px",
                borderRadius: 12,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                fontWeight: 800,
              }}
            >
              <option value="ReleaseDate">Release Date</option>
              <option value="DateAdded">Date Added</option>
              <option value="Title">Title</option>
              <option value="IGDBRating">IGDB Rating</option>
              <option value="MyRating">My Rating</option>
              <option value="Custom">Custom</option>
            </select>

            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 900 }}>Cover Size</div>
                <div style={{ fontSize: 12, color: COLORS.muted, fontWeight: 800 }}>{coverSize}px</div>
              </div>
              <input
                type="range"
                min={60}
                max={200}
                value={coverSize}
                onChange={(e) => setCoverSize(Number(e.target.value))}
                style={{ width: "100%", marginTop: 6 }}
              />
            </div>

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={resetCustomOrderToTitle}
                style={{
                  fontSize: 12,
                  padding: "8px 10px",
                  borderRadius: 12,
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  color: COLORS.text,
                  cursor: "pointer",
                  fontWeight: 800,
                }}
                title="Reseed custom order from Title"
              >
                Reset Custom
              </button>
              <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.35 }}>
                Tip: drag a cover to reorder (switches to Custom automatically).
              </div>
            </div>
          </div>
        </aside>

        {/* Main grid */}
        <main>
          <div style={{ marginBottom: 10, fontSize: 12, color: COLORS.muted }}>
            Showing <b style={{ color: COLORS.text }}>{sorted.length}</b> items
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
              gap: 10,
              alignItems: "start",
            }}
          >
            {sorted.map((g) => (
              <CoverTile
                key={g.igdbId}
                game={g}
                size={coverSize}
                onDragStart={() => onDragStart(g.igdbId)}
                onDropOn={() => onDropOn(g.igdbId)}
              />
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}

function NavTab(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={props.onClick}
      style={{
        background: "transparent",
        border: "none",
        color: props.active ? COLORS.text : "rgba(232,238,247,0.72)",
        fontWeight: 950,
        fontSize: 16, // bigger per your request
        cursor: "pointer",
        padding: "6px 2px",
        borderBottom: props.active ? `3px solid ${COLORS.green}` : "3px solid transparent",
      }}
    >
      {props.label}
    </button>
  );
}

function StatBox(props: { label: string; value: number }) {
  return (
    <div style={{ textAlign: "right", minWidth: 90 }}>
      <div style={{ fontSize: 18, fontWeight: 950, lineHeight: 1 }}>{props.value}</div>
      <div style={{ fontSize: 11, color: COLORS.muted, fontWeight: 850, marginTop: 4 }}>{props.label}</div>
    </div>
  );
}

function CheckboxLine(props: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "8px 10px",
        borderRadius: 12,
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
        style={{ transform: "translateY(1px)" }}
      />
      <span style={{ fontSize: 12, fontWeight: 900 }}>{props.label}</span>
    </label>
  );
}

function Section(props: {
  title: string;
  items: Array<[string, number]>;
  selected: Set<string>;
  onToggle: (v: string) => void;
}) {
  const [open, setOpen] = useState(false); // start closed
  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={() => setOpen((s) => !s)}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          border: "none",
          background: "transparent",
          color: COLORS.text,
          padding: "6px 2px",
          cursor: "pointer",
          fontWeight: 950,
          fontSize: 12,
        }}
      >
        <span>{props.title}</span>
        <span style={{ color: COLORS.muted, fontWeight: 900 }}>{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div style={{ marginTop: 6 }}>
          {props.items.map(([label, count]) => {
            const active = props.selected.has(label);
            return (
              <button
                key={label}
                onClick={() => props.onToggle(label)}
                style={{
                  width: "100%",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 8px", // tighter spacing
                  borderRadius: 10,
                  background: active ? "rgba(34,197,94,0.12)" : "transparent",
                  border: "none", // no lines between
                  color: COLORS.text,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: active ? 950 : 850,
                }}
                title={label}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {label}
                </span>
                <span
                  style={{
                    minWidth: 28,
                    height: 18,
                    padding: "0 6px",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.10)",
                    border: `1px solid ${COLORS.border}`,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 900,
                    color: COLORS.text,
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CoverTile(props: {
  game: Game;
  size: number;
  onDragStart: () => void;
  onDropOn: () => void;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        props.onDragStart();
        // Required for Firefox
        e.dataTransfer.setData("text/plain", props.game.igdbId);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        props.onDropOn();
      }}
      style={{
        aspectRatio: "2 / 3",
        borderRadius: 14,
        overflow: "hidden",
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        boxShadow: "0 18px 35px rgba(0,0,0,.55)",
        cursor: "grab",
      }}
      title={props.game.title}
    >
      {props.game.coverUrl && !failed ? (
        <img
          src={props.game.coverUrl}
          alt={props.game.title}
          loading="lazy"
          onError={() => setFailed(true)}
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
            padding: 10,
            color: COLORS.muted,
            fontSize: 12,
            textAlign: "center",
            fontWeight: 900,
          }}
        >
          {failed ? "Cover failed" : "No cover"}
        </div>
      )}
    </div>
  );
}

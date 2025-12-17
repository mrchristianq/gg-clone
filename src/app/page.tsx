/**
 * Chris' Game Library — v1.0.5
 * Notes:
 * - Stats: align labels consistently (fixed-width number column) + keep labels single-line
 * - Default cover size: 130 on desktop, 100 on mobile (auto-detect + resize aware)
 */

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
  dateCompleted: string;
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
  accent: "#22c55e", // green underline
  statNumber: "#168584", // requested number color
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

function pickCover(row: Row) {
  const coverUrl = norm(row["CoverURL"]);
  if (coverUrl) return coverUrl;
  const cover = norm(row["Cover"]);
  if (cover.startsWith("http")) return cover;
  return "";
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
    dateAdded: norm(row["DateAdded"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
    dateCompleted: norm(row["DateCompleted"]),
  };
}

// Dedupe by Title (merge platforms/genres/years so filters still work)
function dedupeByTitle(rows: Game[]) {
  const map = new Map<string, Game>();

  for (const g of rows) {
    const k = titleKey(g.title);
    const existing = map.get(k);

    if (!existing) {
      map.set(k, g);
      continue;
    }

    const coverUrl = existing.coverUrl || g.coverUrl;
    const platforms = uniqueSorted([...existing.platforms, ...g.platforms]);
    const genres = uniqueSorted([...existing.genres, ...g.genres]);
    const yearPlayed = uniqueSorted([...existing.yearPlayed, ...g.yearPlayed]);

    const backlog = toBool(existing.backlog) || toBool(g.backlog) ? "true" : "";
    const completed = toBool(existing.completed) || toBool(g.completed) ? "true" : "";

    // releaseDate: earliest non-empty
    const aRel = toDateNum(existing.releaseDate);
    const bRel = toDateNum(g.releaseDate);
    let releaseDate = existing.releaseDate;
    if (!aRel && bRel) releaseDate = g.releaseDate;
    else if (aRel && bRel) releaseDate = aRel <= bRel ? existing.releaseDate : g.releaseDate;

    // dateAdded: earliest non-empty
    const aAdded = toDateNum(existing.dateAdded);
    const bAdded = toDateNum(g.dateAdded);
    let dateAdded = existing.dateAdded;
    if (!aAdded && bAdded) dateAdded = g.dateAdded;
    else if (aAdded && bAdded) dateAdded = aAdded <= bAdded ? existing.dateAdded : g.dateAdded;

    // dateCompleted: latest non-empty
    const aComp = toDateNum(existing.dateCompleted);
    const bComp = toDateNum(g.dateCompleted);
    let dateCompleted = existing.dateCompleted;
    if (!aComp && bComp) dateCompleted = g.dateCompleted;
    else if (aComp && bComp) dateCompleted = aComp >= bComp ? existing.dateCompleted : g.dateCompleted;

    const status = existing.status || g.status;
    const ownership = existing.ownership || g.ownership;
    const format = existing.format || g.format;

    map.set(k, {
      ...existing,
      coverUrl,
      platforms,
      genres,
      yearPlayed,
      backlog,
      completed,
      releaseDate,
      dateAdded,
      dateCompleted,
      status,
      ownership,
      format,
    });
  }

  return Array.from(map.values());
}

function buildBaseForFacet(args: {
  games: Game[];
  q: string;
  selectedPlatform: string;
  selectedStatus: string;
  selectedOwnership: string;
  selectedFormat: string;
  selectedGenres: string[];
  selectedYearsPlayed: string[];
  activeTab: "games" | "nowPlaying" | "queued" | "wishlist" | "completed";
  exclude: "platforms" | "status" | "ownership" | "format" | "genres" | "yearsPlayed";
}) {
  const {
    games,
    q,
    selectedPlatform,
    selectedStatus,
    selectedOwnership,
    selectedFormat,
    selectedGenres,
    selectedYearsPlayed,
    activeTab,
    exclude,
  } = args;

  const query = q.trim().toLowerCase();

  return games.filter((g) => {
    if (query && !g.title.toLowerCase().includes(query)) return false;

    // Top tabs
    if (activeTab === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
    if (activeTab === "queued" && norm(g.status) !== "Queued") return false;
    if (activeTab === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
    if (activeTab === "completed" && !toBool(g.completed)) return false;

    if (exclude !== "status" && selectedStatus && g.status !== selectedStatus) return false;
    if (exclude !== "ownership" && selectedOwnership && g.ownership !== selectedOwnership) return false;
    if (exclude !== "format" && selectedFormat && g.format !== selectedFormat) return false;

    if (exclude !== "platforms" && selectedPlatform) {
      const set = new Set(g.platforms.map((x) => x.toLowerCase()));
      if (!set.has(selectedPlatform.toLowerCase())) return false;
    }

    // Genres = AND
    if (exclude !== "genres" && selectedGenres.length) {
      const set = new Set(g.genres.map((x) => x.toLowerCase()));
      for (const sg of selectedGenres) {
        if (!set.has(sg.toLowerCase())) return false;
      }
    }

    // Years Played = OR
    if (exclude !== "yearsPlayed" && selectedYearsPlayed.length) {
      const set = new Set(g.yearPlayed.map((x) => x.toLowerCase()));
      const any = selectedYearsPlayed.some((y) => set.has(y.toLowerCase()));
      if (!any) return false;
    }

    return true;
  });
}

function countByKey<T>(base: T[], getKey: (g: T) => string) {
  const map = new Map<string, number>();
  for (const g of base) {
    const k = norm(getKey(g));
    if (!k) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function countByTagList(base: Game[], getTags: (g: Game) => string[]) {
  const map = new Map<string, number>();
  for (const g of base) {
    for (const tag of getTags(g)) {
      const k = norm(tag);
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
  }
  return map;
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
        background: COLORS.badgeBg,
        border: `1px solid ${COLORS.badgeBorder}`,
        color: COLORS.muted,
        fontSize: 11,
        lineHeight: "16px",
      }}
    >
      {n}
    </span>
  );
}

function ChevronPlus({ open }: { open: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.muted,
        userSelect: "none",
        fontSize: 14,
        transform: open ? "rotate(45deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
      }}
      aria-hidden
    >
      +
    </span>
  );
}

function CollapsibleSection({
  title,
  open,
  setOpen,
  children,
}: {
  title: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          border: "none",
          background: "transparent",
          padding: 0,
          cursor: "pointer",
          color: COLORS.text,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "4px 6px",
            borderRadius: 10,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              color: COLORS.muted,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {title}
          </div>
          <ChevronPlus open={open} />
        </div>
      </button>

      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </div>
  );
}

function FacetRowsSingle({
  options,
  counts,
  selected,
  onSelect,
}: {
  options: string[];
  counts: Map<string, number>;
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {options.map((opt) => {
        const active = selected === opt;
        const c = counts.get(opt) ?? 0;

        return (
          <button
            key={opt}
            onClick={() => onSelect(active ? "" : opt)}
            style={{
              width: "100%",
              border: "none",
              background: active ? COLORS.rowActive : "transparent",
              color: COLORS.text,
              padding: "3px 8px",
              cursor: "pointer",
              borderRadius: 8,
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = COLORS.rowHover;
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, opacity: c === 0 ? 0.55 : 1 }}>
                {opt}
              </span>
              <CountBadge n={c} />
            </div>
          </button>
        );
      })}
    </div>
  );
}

function FacetRowsMulti({
  options,
  counts,
  selected,
  onToggle,
}: {
  options: string[];
  counts: Map<string, number>;
  selected: string[];
  onToggle: (v: string) => void;
}) {
  const set = new Set(selected);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {options.map((opt) => {
        const active = set.has(opt);
        const c = counts.get(opt) ?? 0;

        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            style={{
              width: "100%",
              border: "none",
              background: active ? COLORS.rowActive : "transparent",
              color: COLORS.text,
              padding: "3px 8px",
              cursor: "pointer",
              borderRadius: 8,
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = COLORS.rowHover;
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, opacity: c === 0 ? 0.55 : 1 }}>
                {opt}
              </span>
              <CountBadge n={c} />
            </div>
          </button>
        );
      })}
    </div>
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
        border: "none",
        background: "transparent",
        color: COLORS.text,
        cursor: "pointer",
        fontSize: 16,
        fontWeight: 900,
        padding: "8px 6px",
        position: "relative",
        opacity: active ? 1 : 0.72,
        whiteSpace: "nowrap",
      }}
    >
      {label}
      <span
        style={{
          position: "absolute",
          left: 6,
          right: 6,
          bottom: 2,
          height: 2,
          borderRadius: 999,
          background: active ? COLORS.accent : "transparent",
        }}
      />
    </button>
  );
}

function StatRow({
  value,
  label,
  numberWidth = 44,
}: {
  value: number;
  label: string;
  numberWidth?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
      <div
        style={{
          width: numberWidth,
          textAlign: "right",
          fontSize: 18,
          fontWeight: 900,
          color: COLORS.statNumber,
          lineHeight: 1.05,
          flex: "0 0 auto",
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: COLORS.muted,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 1.2,
          flex: "1 1 auto",
        }}
        title={label}
      >
        {label}
      </div>
    </div>
  );
}

export default function HomePage() {
  const csvUrl = process.env.NEXT_PUBLIC_SHEET_CSV_URL;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  const [tileSize, setTileSize] = useState(130); // v1.0.5 default; will auto-adjust on mount
  const [q, setQ] = useState("");

  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYearsPlayed, setSelectedYearsPlayed] = useState<string[]>([]);

  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedOwnership, setSelectedOwnership] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("");

  const [activeTab, setActiveTab] = useState<"games" | "nowPlaying" | "queued" | "wishlist" | "completed">("games");

  const [sortBy, setSortBy] = useState<"title" | "releaseDate" | "dateCompleted" | "dateAdded">("releaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [openPlatform, setOpenPlatform] = useState(false);
  const [openStatus, setOpenStatus] = useState(false);
  const [openOwnership, setOpenOwnership] = useState(false);
  const [openFormat, setOpenFormat] = useState(false);
  const [openYearsPlayed, setOpenYearsPlayed] = useState(false);
  const [openGenres, setOpenGenres] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false); // mobile drawer

  // ✅ v1.0.5: default cover size is 130 desktop / 100 mobile, and updates on resize
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");

    const apply = () => {
      setTileSize(mq.matches ? 100 : 130);
    };

    apply();

    // Safari fallback: addListener/removeListener
    const onChange = () => apply();
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } else {
      // @ts-expect-error legacy
      mq.addListener(onChange);
      // @ts-expect-error legacy
      return () => mq.removeListener(onChange);
    }
  }, []);

  useEffect(() => {
    async function load() {
      if (!csvUrl) return;
      setLoading(true);

      const res = await fetch(csvUrl, { cache: "no-store" });
      const text = await res.text();

      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      const mapped = (parsed.data as Row[]).map(rowToGame).filter(Boolean) as Game[];

      setGames(dedupeByTitle(mapped));
      setLoading(false);
    }

    load();
  }, [csvUrl]);

  const platforms = useMemo(() => uniqueSorted(games.flatMap((g) => g.platforms)), [games]);
  const statuses = useMemo(() => uniqueSorted(games.map((g) => g.status)), [games]);
  const ownerships = useMemo(() => uniqueSorted(games.map((g) => g.ownership)), [games]);
  const formats = useMemo(() => uniqueSorted(games.map((g) => g.format)), [games]);
  const allGenres = useMemo(() => uniqueSorted(games.flatMap((g) => g.genres)), [games]);
  const allYearsPlayed = useMemo(() => uniqueSorted(games.flatMap((g) => g.yearPlayed)), [games]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    const base = games.filter((g) => {
      if (query && !g.title.toLowerCase().includes(query)) return false;

      if (activeTab === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
      if (activeTab === "queued" && norm(g.status) !== "Queued") return false;
      if (activeTab === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
      if (activeTab === "completed" && !toBool(g.completed)) return false;

      if (selectedStatus && g.status !== selectedStatus) return false;
      if (selectedOwnership && g.ownership !== selectedOwnership) return false;
      if (selectedFormat && g.format !== selectedFormat) return false;

      if (selectedPlatform) {
        const set = new Set(g.platforms.map((x) => x.toLowerCase()));
        if (!set.has(selectedPlatform.toLowerCase())) return false;
      }

      if (selectedGenres.length) {
        const set = new Set(g.genres.map((x) => x.toLowerCase()));
        for (const sg of selectedGenres) if (!set.has(sg.toLowerCase())) return false;
      }

      if (selectedYearsPlayed.length) {
        const set = new Set(g.yearPlayed.map((x) => x.toLowerCase()));
        const any = selectedYearsPlayed.some((y) => set.has(y.toLowerCase()));
        if (!any) return false;
      }

      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;

    return base.sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title) * dir;
      if (sortBy === "releaseDate") return (toDateNum(a.releaseDate) - toDateNum(b.releaseDate)) * dir;
      if (sortBy === "dateCompleted") return (toDateNum(a.dateCompleted) - toDateNum(b.dateCompleted)) * dir;
      if (sortBy === "dateAdded") return (toDateNum(a.dateAdded) - toDateNum(b.dateAdded)) * dir;
      return 0;
    });
  }, [
    games,
    q,
    activeTab,
    selectedPlatform,
    selectedStatus,
    selectedOwnership,
    selectedFormat,
    selectedGenres,
    selectedYearsPlayed,
    sortBy,
    sortDir,
  ]);

  const platformCounts = useMemo(() => {
    const base = buildBaseForFacet({
      games,
      q,
      selectedPlatform,
      selectedStatus,
      selectedOwnership,
      selectedFormat,
      selectedGenres,
      selectedYearsPlayed,
      activeTab,
      exclude: "platforms",
    });
    return countByTagList(base, (g) => g.platforms);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, activeTab]);

  const statusCounts = useMemo(() => {
    const base = buildBaseForFacet({
      games,
      q,
      selectedPlatform,
      selectedStatus,
      selectedOwnership,
      selectedFormat,
      selectedGenres,
      selectedYearsPlayed,
      activeTab,
      exclude: "status",
    });
    return countByKey(base, (g) => g.status);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, activeTab]);

  const ownershipCounts = useMemo(() => {
    const base = buildBaseForFacet({
      games,
      q,
      selectedPlatform,
      selectedStatus,
      selectedOwnership,
      selectedFormat,
      selectedGenres,
      selectedYearsPlayed,
      activeTab,
      exclude: "ownership",
    });
    return countByKey(base, (g) => g.ownership);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, activeTab]);

  const formatCounts = useMemo(() => {
    const base = buildBaseForFacet({
      games,
      q,
      selectedPlatform,
      selectedStatus,
      selectedOwnership,
      selectedFormat,
      selectedGenres,
      selectedYearsPlayed,
      activeTab,
      exclude: "format",
    });
    return countByKey(base, (g) => g.format);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, activeTab]);

  const yearsPlayedCounts = useMemo(() => {
    const base = buildBaseForFacet({
      games,
      q,
      selectedPlatform,
      selectedStatus,
      selectedOwnership,
      selectedFormat,
      selectedGenres,
      selectedYearsPlayed,
      activeTab,
      exclude: "yearsPlayed",
    });
    return countByTagList(base, (g) => g.yearPlayed);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, activeTab]);

  const genreCounts = useMemo(() => {
    const base = buildBaseForFacet({
      games,
      q,
      selectedPlatform,
      selectedStatus,
      selectedOwnership,
      selectedFormat,
      selectedGenres,
      selectedYearsPlayed,
      activeTab,
      exclude: "genres",
    });
    return countByTagList(base, (g) => g.genres);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, activeTab]);

  function toggleGenre(genre: string) {
    setSelectedGenres((prev) => (prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]));
  }

  function toggleYearPlayed(year: string) {
    setSelectedYearsPlayed((prev) => (prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]));
  }

  function clearFilters() {
    setQ("");
    setSelectedGenres([]);
    setSelectedYearsPlayed([]);
    setSelectedPlatform("");
    setSelectedStatus("");
    setSelectedOwnership("");
    setSelectedFormat("");
  }

  const headerAvatarUrl =
    "https://lh3.googleusercontent.com/a/ACg8ocJytvmuklInlqxJZOFW4Xi1sk40VGv_-UYAYNmYqAzSlBbno9AKeQ=s288-c-no";

  const year = new Date().getFullYear();

  const gamesTotal = games.length;
  const nowPlayingTotal = games.filter((g) => norm(g.status) === "Now Playing").length;
  const queuedTotal = games.filter((g) => norm(g.status) === "Queued").length;
  const wishlistTotal = games.filter((g) => norm(g.ownership) === "Wishlist").length;
  const completedTotal = games.filter((g) => toBool(g.completed)).length;
  const playedThisYear = games.filter((g) => g.yearPlayed.includes(String(year))).length;

  const sidebarStyle: React.CSSProperties = {
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
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <style>{`
        aside::-webkit-scrollbar { display: none; }

        @media (max-width: 900px) {
          .sidebar {
            position: fixed !important;
            left: 0;
            top: 0;
            height: 100vh !important;
            z-index: 50;
            transform: translateX(-110%);
            transition: transform 160ms ease;
            border-right: 1px solid ${COLORS.border};
          }
          .sidebar.open {
            transform: translateX(0);
          }
          .overlay {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 40;
          }
          .mobileTopbar {
            position: sticky;
            top: 0;
            z-index: 30;
            padding: 12px 18px;
            background: ${COLORS.bg};
            border-bottom: 1px solid ${COLORS.border};
            margin: -18px -18px 14px -18px;
          }
          .mobileOnly { display: block !important; }
          .desktopOnly { display: none !important; }
          .topTabsWrap { gap: 10px !important; }
          .topTabsWrap button { font-size: 13px !important; padding: 6px 4px !important; }
        }
        .mobileOnly { display: none; }
      `}</style>

      {filtersOpen && <div className="overlay" onClick={() => setFiltersOpen(false)} />}

      <aside className={`sidebar ${filtersOpen ? "open" : ""}`} style={sidebarStyle} aria-label="Filters">
        <div
          style={{
            padding: "12px 10px",
            borderRadius: 14,
            background: COLORS.panelTopFade,
            border: `1px solid ${COLORS.border}`,
            marginBottom: 12,
          }}
        >
          <button
            className="mobileOnly"
            onClick={() => setFiltersOpen(false)}
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 12,
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.text,
              cursor: "pointer",
              fontWeight: 800,
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            Close
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <img
              src={headerAvatarUrl}
              alt="Chris"
              referrerPolicy="no-referrer"
              style={{
                width: 60,
                height: 60,
                borderRadius: 999,
                objectFit: "cover",
                border: `1px solid ${COLORS.border}`,
              }}
            />
            <div style={{ fontSize: 18, fontWeight: 900 }}>Chris&apos; Game Library</div>
          </div>

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
              <SmallSelect
                value={sortBy}
                onChange={(v) => setSortBy(v as "title" | "releaseDate" | "dateCompleted" | "dateAdded")}
              >
                <option value="title">Title</option>
                <option value="releaseDate">Release Date</option>
                <option value="dateAdded">Date Added</option>
                <option value="dateCompleted">Date Completed</option>
              </SmallSelect>

              <SmallSelect value={sortDir} onChange={(v) => setSortDir(v as "asc" | "desc")}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </SmallSelect>
            </div>
          </div>

          {/* ✅ STATS (aligned labels, one-line) */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted, marginBottom: 8 }}>STATS</div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                columnGap: 14,
                rowGap: 10,
              }}
            >
              {/* left column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <StatRow value={gamesTotal} label="Games" numberWidth={46} />
                <StatRow value={queuedTotal} label="Queued" numberWidth={46} />
                <StatRow value={completedTotal} label="Completed" numberWidth={46} />
              </div>

              {/* right column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <StatRow value={nowPlayingTotal} label="Now Playing" numberWidth={46} />
                <StatRow value={wishlistTotal} label="Wishlist" numberWidth={46} />
                <StatRow value={playedThisYear} label={`Played in ${year}`} numberWidth={46} />
              </div>
            </div>
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
        </div>

        <CollapsibleSection title="Platform" open={openPlatform} setOpen={setOpenPlatform}>
          <FacetRowsSingle options={platforms} counts={platformCounts} selected={selectedPlatform} onSelect={setSelectedPlatform} />
        </CollapsibleSection>

        <CollapsibleSection title="Status" open={openStatus} setOpen={setOpenStatus}>
          <FacetRowsSingle options={statuses} counts={statusCounts} selected={selectedStatus} onSelect={setSelectedStatus} />
        </CollapsibleSection>

        <CollapsibleSection title="Ownership" open={openOwnership} setOpen={setOpenOwnership}>
          <FacetRowsSingle
            options={ownerships}
            counts={ownershipCounts}
            selected={selectedOwnership}
            onSelect={setSelectedOwnership}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Format" open={openFormat} setOpen={setOpenFormat}>
          <FacetRowsSingle options={formats} counts={formatCounts} selected={selectedFormat} onSelect={setSelectedFormat} />
        </CollapsibleSection>

        <CollapsibleSection title="Year Played" open={openYearsPlayed} setOpen={setOpenYearsPlayed}>
          <FacetRowsMulti
            options={allYearsPlayed}
            counts={yearsPlayedCounts}
            selected={selectedYearsPlayed}
            onToggle={toggleYearPlayed}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Genres" open={openGenres} setOpen={setOpenGenres}>
          <FacetRowsMulti options={allGenres} counts={genreCounts} selected={selectedGenres} onToggle={toggleGenre} />
        </CollapsibleSection>

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
          Showing {filtered.length} / {games.length}
        </div>
      </aside>

      <main style={{ flex: 1, padding: 18 }}>
        <div className="mobileTopbar mobileOnly">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <button
              onClick={() => setFiltersOpen(true)}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                cursor: "pointer",
                fontWeight: 800,
                fontSize: 12,
              }}
            >
              Filters
            </button>
            <div style={{ fontSize: 12, color: COLORS.muted }}>{filtered.length} games</div>
          </div>
        </div>

        {/* Top nav */}
        <div
          className="topTabsWrap"
          style={{
            display: "flex",
            alignItems: "flex-end",
            gap: 14,
            marginBottom: 14,
            flexWrap: "nowrap",
            overflowX: "auto",
            scrollbarWidth: "none",
          }}
        >
          <TabButton label="Games" active={activeTab === "games"} onClick={() => setActiveTab("games")} />
          <TabButton label="Now Playing" active={activeTab === "nowPlaying"} onClick={() => setActiveTab("nowPlaying")} />
          <TabButton label="Queued" active={activeTab === "queued"} onClick={() => setActiveTab("queued")} />
          <TabButton label="Wishlist" active={activeTab === "wishlist"} onClick={() => setActiveTab("wishlist")} />
          <TabButton label="Completed" active={activeTab === "completed"} onClick={() => setActiveTab("completed")} />
        </div>

        {loading ? (
          <div>Loading…</div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
              gap: 12,
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
                  boxShadow: "0 20px 40px rgba(0,0,0,.6)",
                }}
                title={g.title}
              >
                {g.coverUrl ? (
                  <img
                    src={g.coverUrl}
                    alt={g.title}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    onError={(e) => {
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
  );
}

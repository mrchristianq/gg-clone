/** 
 * Chris' Game Library
 * Version: 1.5.0
 * Notes:
 * - Adds click-to-open Game Details modal (cover + tags left, screenshot + details right)
 * - Modal: Completed shows ONLY via Completed=True tag (prevents Status=Completed duplication)
 * - Modal: details area uses 2-column grid; Screenshot + Description remain full-width
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

  // extra fields (from your sheet headers)
  igdbRating: string;
  myRating: string;
  hoursPlayed: string;
  developer: string;
  description: string;
  screenshotUrl: string;
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
  accent: "#22c55e",
  statNumber: "#168584",
  modalOverlay: "rgba(0,0,0,0.65)",
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
  return (
    s === "true" ||
    s === "yes" ||
    s === "y" ||
    s === "1" ||
    s === "checked" ||
    s === "x"
  );
}

function toDateNum(s: string) {
  const v = norm(s);
  if (!v) return 0;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function uniqueSorted(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
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

    igdbRating: norm(row["IGDB_Rating"]),
    myRating: norm(row["My_Rating"]),
    hoursPlayed: norm(row["HoursPlayed"]),
    developer: norm(row["Developer"]),
    description: norm(row["Description"]),
    screenshotUrl: norm(row["ScreenshotURL"]),
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
    const completed =
      toBool(existing.completed) || toBool(g.completed) ? "true" : "";

    const aRel = toDateNum(existing.releaseDate);
    const bRel = toDateNum(g.releaseDate);
    let releaseDate = existing.releaseDate;
    if (!aRel && bRel) releaseDate = g.releaseDate;
    else if (aRel && bRel)
      releaseDate = aRel <= bRel ? existing.releaseDate : g.releaseDate;

    const aAdded = toDateNum(existing.dateAdded);
    const bAdded = toDateNum(g.dateAdded);
    let dateAdded = existing.dateAdded;
    if (!aAdded && bAdded) dateAdded = g.dateAdded;
    else if (aAdded && bAdded)
      dateAdded = aAdded <= bAdded ? existing.dateAdded : g.dateAdded;

    const aComp = toDateNum(existing.dateCompleted);
    const bComp = toDateNum(g.dateCompleted);
    let dateCompleted = existing.dateCompleted;
    if (!aComp && bComp) dateCompleted = g.dateCompleted;
    else if (aComp && bComp)
      dateCompleted =
        aComp >= bComp ? existing.dateCompleted : g.dateCompleted;

    const status = existing.status || g.status;
    const ownership = existing.ownership || g.ownership;
    const format = existing.format || g.format;

    const igdbRating = existing.igdbRating || g.igdbRating;
    const myRating = existing.myRating || g.myRating;
    const hoursPlayed = existing.hoursPlayed || g.hoursPlayed;
    const developer = existing.developer || g.developer;
    const description = existing.description || g.description;
    const screenshotUrl = existing.screenshotUrl || g.screenshotUrl;

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
      igdbRating,
      myRating,
      hoursPlayed,
      developer,
      description,
      screenshotUrl,
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
  activeTop:
    | "games"
    | "nowPlaying"
    | "queued"
    | "wishlist"
    | "completed";
  exclude:
    | "platforms"
    | "status"
    | "ownership"
    | "format"
    | "genres"
    | "yearsPlayed";
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
    activeTop,
    exclude,
  } = args;

  const query = q.trim().toLowerCase();

  return games.filter((g) => {
    if (query && !g.title.toLowerCase().includes(query)) return false;

    // Top tabs
    if (activeTop === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
    if (activeTop === "queued" && norm(g.status) !== "Queued") return false;
    if (activeTop === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
    if (activeTop === "completed" && !toBool(g.completed)) return false;

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

function Plus({ open }: { open: boolean }) {
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
        fontWeight: 900,
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
          <Plus open={open} />
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

function StatCompact({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: COLORS.statNumber, lineHeight: 1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 800,
          color: COLORS.muted,
          letterSpacing: "0.02em",
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 999,
        background: COLORS.badgeBg,
        border: `1px solid ${COLORS.badgeBorder}`,
        color: COLORS.text,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function InfoItem({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 900,
          color: COLORS.muted,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 13, color: COLORS.text, fontWeight: 650, lineHeight: 1.35 }}>
        {value}
      </div>
    </div>
  );
}

export default function HomePage() {
  const csvUrl = process.env.NEXT_PUBLIC_SHEET_CSV_URL;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  const [isMobile, setIsMobile] = useState(false);
  const [tileSize, setTileSize] = useState(120); // desktop default
  const [q, setQ] = useState("");

  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYearsPlayed, setSelectedYearsPlayed] = useState<string[]>([]);

  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedOwnership, setSelectedOwnership] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("");

  const [activeTop, setActiveTop] = useState<
    "games" | "nowPlaying" | "queued" | "wishlist" | "completed"
  >("games");

  const [sortBy, setSortBy] = useState<
    "title" | "releaseDate" | "dateCompleted" | "dateAdded"
  >("releaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [openPlatform, setOpenPlatform] = useState(false);
  const [openStatus, setOpenStatus] = useState(false);
  const [openOwnership, setOpenOwnership] = useState(false);
  const [openFormat, setOpenFormat] = useState(false);
  const [openYearsPlayed, setOpenYearsPlayed] = useState(false);
  const [openGenres, setOpenGenres] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);

  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => setIsMobile(mq.matches);
    apply();

    const onChange = () => apply();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    setTileSize(isMobile ? 100 : 130);
  }, [isMobile]);

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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSelectedGame(null);
    }
    if (selectedGame) {
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }
  }, [selectedGame]);

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

      if (activeTop === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
      if (activeTop === "queued" && norm(g.status) !== "Queued") return false;
      if (activeTop === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
      if (activeTop === "completed" && !toBool(g.completed)) return false;

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
      if (sortBy === "releaseDate")
        return (toDateNum(a.releaseDate) - toDateNum(b.releaseDate)) * dir;
      if (sortBy === "dateCompleted")
        return (toDateNum(a.dateCompleted) - toDateNum(b.dateCompleted)) * dir;
      if (sortBy === "dateAdded")
        return (toDateNum(a.dateAdded) - toDateNum(b.dateAdded)) * dir;
      return 0;
    });
  }, [
    games,
    q,
    activeTop,
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
      activeTop,
      exclude: "platforms",
    });
    return countByTagList(base, (g) => g.platforms);
  }, [
    games, q,
    selectedPlatform, selectedStatus, selectedOwnership, selectedFormat,
    selectedGenres, selectedYearsPlayed,
    activeTop
  ]);

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
      activeTop,
      exclude: "status",
    });
    return countByKey(base, (g) => g.status);
  }, [
    games, q,
    selectedPlatform, selectedStatus, selectedOwnership, selectedFormat,
    selectedGenres, selectedYearsPlayed,
    activeTop
  ]);

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
      activeTop,
      exclude: "ownership",
    });
    return countByKey(base, (g) => g.ownership);
  }, [
    games, q,
    selectedPlatform, selectedStatus, selectedOwnership, selectedFormat,
    selectedGenres, selectedYearsPlayed,
    activeTop
  ]);

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
      activeTop,
      exclude: "format",
    });
    return countByKey(base, (g) => g.format);
  }, [
    games, q,
    selectedPlatform, selectedStatus, selectedOwnership, selectedFormat,
    selectedGenres, selectedYearsPlayed,
    activeTop
  ]);

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
      activeTop,
      exclude: "yearsPlayed",
    });
    return countByTagList(base, (g) => g.yearPlayed);
  }, [
    games, q,
    selectedPlatform, selectedStatus, selectedOwnership, selectedFormat,
    selectedGenres, selectedYearsPlayed,
    activeTop
  ]);

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
      activeTop,
      exclude: "genres",
    });
    return countByTagList(base, (g) => g.genres);
  }, [
    games, q,
    selectedPlatform, selectedStatus, selectedOwnership, selectedFormat,
    selectedGenres, selectedYearsPlayed,
    activeTop
  ]);

  function toggleGenre(genre: string) {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre]
    );
  }

  function toggleYearPlayed(year: string) {
    setSelectedYearsPlayed((prev) =>
      prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
    );
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

  const pageCount = filtered.length;

  const modal = selectedGame;
  const modalIsCompleted = modal ? toBool(modal.completed) : false;
  const modalStatusLower = modal ? norm(modal.status).toLowerCase() : "";
  const showStatusTag = !!modal && !!norm(modal.status) && modalStatusLower !== "completed";
  const showStatusField = !!modal && !!norm(modal.status) && !(modalIsCompleted && modalStatusLower === "completed");

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
          .sidebar.open { transform: translateX(0); }
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
          .topNavRow {
            gap: 8px !important;
          }
          .topNavRow button {
            font-size: 13px !important;
            padding: 8px 4px !important;
          }
        }
        .mobileOnly { display: none; }
        .modalScroll::-webkit-scrollbar { width: 10px; }
        .modalScroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 999px; }
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
                onChange={(v) =>
                  setSortBy(v as "title" | "releaseDate" | "dateCompleted" | "dateAdded")
                }
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

          {/* Stats (baseline layout locked in) */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted, marginBottom: 8 }}>
              STATS
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 18, rowGap: 10 }}>
              <StatCompact value={gamesTotal} label="Games" />
              <StatCompact value={playedThisYear} label={`in ${year}`} />
              <StatCompact value={nowPlayingTotal} label="Now Playing" />
              <StatCompact value={queuedTotal} label="Queued" />
              <StatCompact value={wishlistTotal} label="Wishlist" />
              <StatCompact value={completedTotal} label="Completed" />
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
          <FacetRowsSingle
            options={platforms}
            counts={platformCounts}
            selected={selectedPlatform}
            onSelect={setSelectedPlatform}
          />
        </CollapsibleSection>

        <CollapsibleSection title="Status" open={openStatus} setOpen={setOpenStatus}>
          <FacetRowsSingle
            options={statuses}
            counts={statusCounts}
            selected={selectedStatus}
            onSelect={setSelectedStatus}
          />
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
          <FacetRowsSingle
            options={formats}
            counts={formatCounts}
            selected={selectedFormat}
            onSelect={setSelectedFormat}
          />
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
          <FacetRowsMulti
            options={allGenres}
            counts={genreCounts}
            selected={selectedGenres}
            onToggle={toggleGenre}
          />
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
            <div style={{ fontSize: 12, color: COLORS.muted }}>{filtered.length}</div>
          </div>
        </div>

        {/* Top nav + page count */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 14,
          }}
        >
          <div className="topNavRow" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "nowrap" }}>
            <TabButton label="Games" active={activeTop === "games"} onClick={() => setActiveTop("games")} />
            <TabButton label="Now Playing" active={activeTop === "nowPlaying"} onClick={() => setActiveTop("nowPlaying")} />
            <TabButton label="Queued" active={activeTop === "queued"} onClick={() => setActiveTop("queued")} />
            <TabButton label="Wishlist" active={activeTop === "wishlist"} onClick={() => setActiveTop("wishlist")} />
            <TabButton label="Completed" active={activeTop === "completed"} onClick={() => setActiveTop("completed")} />
          </div>

          <div
            style={{
              fontSize: 14,
              fontWeight: 900,
              color: COLORS.text,
              opacity: 0.9,
              minWidth: 24,
              textAlign: "right",
            }}
            aria-label="Page count"
            title="Items on this page"
          >
            {pageCount}
          </div>
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
              <button
                key={`${titleKey(g.title)}-${i}`}
                onClick={() => setSelectedGame(g)}
                style={{
                  border: "none",
                  padding: 0,
                  background: "transparent",
                  cursor: "pointer",
                  borderRadius: 14,
                  outline: "none",
                }}
                title={g.title}
              >
                <div
                  style={{
                    aspectRatio: "2 / 3",
                    background: COLORS.card,
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: "0 20px 40px rgba(0,0,0,.6)",
                  }}
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
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Modal */}
      {modal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedGame(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: COLORS.modalOverlay,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="modalScroll"
            style={{
              width: "min(980px, 100%)",
              maxHeight: "min(86vh, 820px)",
              overflowY: "auto",
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              boxShadow: "0 30px 80px rgba(0,0,0,.7)",
            }}
          >
            <div style={{ padding: 16, borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 950, color: COLORS.text, lineHeight: 1.15 }}>
                    {modal.title}
                  </div>
                </div>

                <button
                  onClick={() => setSelectedGame(null)}
                  style={{
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.card,
                    color: COLORS.text,
                    borderRadius: 12,
                    width: 38,
                    height: 38,
                    cursor: "pointer",
                    fontWeight: 950,
                    fontSize: 16,
                  }}
                  aria-label="Close"
                  title="Close"
                >
                  ×
                </button>
              </div>
            </div>

            <div style={{ padding: 16 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "260px 1fr",
                  gap: 16,
                }}
              >
                {/* LEFT: cover + tags (keep like before) */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "2 / 3",
                      borderRadius: 16,
                      overflow: "hidden",
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    {modal.coverUrl ? (
                      <img
                        src={modal.coverUrl}
                        alt={modal.title}
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
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {showStatusTag && <Pill>{modal.status}</Pill>}

                    {/* ✅ Completed: only show if Completed=True (and do not also show Status=Completed) */}
                    {modalIsCompleted && <Pill>Completed</Pill>}

                    {norm(modal.ownership) && <Pill>{modal.ownership}</Pill>}
                    {norm(modal.format) && <Pill>{modal.format}</Pill>}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {modal.platforms.slice(0, 6).map((p) => (
                      <Pill key={`p-${p}`}>{p}</Pill>
                    ))}
                    {modal.platforms.length > 6 && <Pill>+{modal.platforms.length - 6} more</Pill>}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {modal.genres.slice(0, 6).map((g) => (
                      <Pill key={`g-${g}`}>{g}</Pill>
                    ))}
                    {modal.genres.length > 6 && <Pill>+{modal.genres.length - 6} more</Pill>}
                  </div>
                </div>

                {/* RIGHT: screenshot + details */}
                <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                  {/* Screenshot full width */}
                  {norm(modal.screenshotUrl) ? (
                    <div
                      style={{
                        width: "100%",
                        borderRadius: 16,
                        overflow: "hidden",
                        border: `1px solid ${COLORS.border}`,
                        background: COLORS.card,
                      }}
                    >
                      <img
                        src={modal.screenshotUrl}
                        alt={`${modal.title} screenshot`}
                        style={{ width: "100%", height: "auto", display: "block" }}
                        loading="lazy"
                      />
                    </div>
                  ) : null}

                  {/* ✅ Details in 2 columns */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 14,
                      alignItems: "start",
                    }}
                  >
                    {showStatusField && <InfoItem label="Status" value={modal.status} />}

                    {norm(modal.releaseDate) && <InfoItem label="Release Date" value={modal.releaseDate} />}

                    {norm(modal.igdbRating) && <InfoItem label="IGDB Rating" value={modal.igdbRating} />}

                    {norm(modal.myRating) && <InfoItem label="My Rating" value={modal.myRating} />}

                    {norm(modal.hoursPlayed) && <InfoItem label="Hours Played" value={modal.hoursPlayed} />}

                    {norm(modal.developer) && <InfoItem label="Developer" value={modal.developer} />}

                    {modal.yearPlayed.length > 0 && (
                      <InfoItem label="Year Played" value={modal.yearPlayed.join(", ")} />
                    )}

                    {norm(modal.dateAdded) && <InfoItem label="Date Added" value={modal.dateAdded} />}

                    {norm(modal.dateCompleted) && <InfoItem label="Date Completed" value={modal.dateCompleted} />}
                  </div>

                  {/* Description full width */}
                  {norm(modal.description) ? (
                    <div style={{ marginTop: 2 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 900,
                          color: COLORS.muted,
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          marginBottom: 6,
                        }}
                      >
                        Description
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: COLORS.text,
                          lineHeight: 1.55,
                          background: COLORS.card,
                          border: `1px solid ${COLORS.border}`,
                          borderRadius: 14,
                          padding: 12,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {modal.description}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* responsive tweak for modal columns */}
              <style>{`
                @media (max-width: 900px) {
                  .modalScroll { max-height: 88vh !important; }
                }
                @media (max-width: 780px) {
                  .modalScroll > div:nth-child(2) > div {
                    grid-template-columns: 1fr !important;
                  }
                }
              `}</style>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

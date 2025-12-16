"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";

type Row = Record<string, string>;

type Game = {
  idKey: string; // normalized title key
  title: string;
  coverUrl: string;

  platforms: string[];
  genres: string[];
  yearPlayed: string[];

  status: string;
  ownership: string;
  format: string;

  releaseDate: string;
  backlog: string;
  completed: string;
  dateCompleted: string;

  dateAdded: string; // optional if your CSV has it
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
};

function norm(v: unknown) {
  return (v ?? "").toString().trim();
}
function titleKey(title: string) {
  return norm(title).toLowerCase();
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
    idKey: titleKey(title),
    title,
    coverUrl: pickCover(row),

    platforms: splitTags(row["Platforms"] || row["Platform"]),
    genres: splitTags(row["Genres"]),
    yearPlayed: splitTags(row["YearPlayed"]),

    status: norm(row["Status"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    releaseDate: norm(row["ReleaseDate"]),
    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
    dateCompleted: norm(row["DateCompleted"]),

    dateAdded: norm(row["DateAdded"]), // optional column in your Web CSV
  };
}

// Merge duplicate rows (same Title) into one game
function dedupeByTitle(rows: Game[]) {
  const map = new Map<string, Game>();

  for (const g of rows) {
    const k = g.idKey;
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

    // dateCompleted: latest non-empty
    const aComp = toDateNum(existing.dateCompleted);
    const bComp = toDateNum(g.dateCompleted);
    let dateCompleted = existing.dateCompleted;
    if (!aComp && bComp) dateCompleted = g.dateCompleted;
    else if (aComp && bComp) dateCompleted = aComp >= bComp ? existing.dateCompleted : g.dateCompleted;

    // dateAdded: earliest non-empty (or keep existing)
    const aAdd = toDateNum(existing.dateAdded);
    const bAdd = toDateNum(g.dateAdded);
    let dateAdded = existing.dateAdded;
    if (!aAdd && bAdd) dateAdded = g.dateAdded;
    else if (aAdd && bAdd) dateAdded = aAdd <= bAdd ? existing.dateAdded : g.dateAdded;

    map.set(k, {
      ...existing,
      coverUrl,
      platforms,
      genres,
      yearPlayed,
      backlog,
      completed,
      releaseDate,
      dateCompleted,
      dateAdded,
      status: existing.status || g.status,
      ownership: existing.ownership || g.ownership,
      format: existing.format || g.format,
    });
  }

  return Array.from(map.values());
}

// Facet base (counts)
function buildBaseForFacet(args: {
  games: Game[];
  q: string;
  selectedPlatform: string;
  selectedStatus: string;
  selectedOwnership: string;
  selectedFormat: string;
  selectedGenres: string[];
  selectedYearsPlayed: string[];
  onlyBacklog: boolean;
  onlyCompleted: boolean;
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
    onlyBacklog,
    onlyCompleted,
    exclude,
  } = args;

  const query = q.trim().toLowerCase();

  return games.filter((g) => {
    if (query && !g.title.toLowerCase().includes(query)) return false;

    if (onlyBacklog && !toBool(g.backlog)) return false;
    if (onlyCompleted && !toBool(g.completed)) return false;

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

function Chevron({ open }: { open: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
        color: COLORS.muted,
        userSelect: "none",
        fontSize: 12,
      }}
      aria-hidden
    >
      ▶
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
        style={{ width: "100%", border: "none", background: "transparent", padding: 0, cursor: "pointer", color: COLORS.text }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 6px", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {title}
          </div>
          <Chevron open={open} />
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
            style={{ width: "100%", border: "none", background: active ? COLORS.rowActive : "transparent", color: COLORS.text, padding: "3px 8px", cursor: "pointer", borderRadius: 8 }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = COLORS.rowHover; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, opacity: c === 0 ? 0.55 : 1 }}>{opt}</span>
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
            style={{ width: "100%", border: "none", background: active ? COLORS.rowActive : "transparent", color: COLORS.text, padding: "3px 8px", cursor: "pointer", borderRadius: 8 }}
            onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = COLORS.rowHover; }}
            onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: active ? 700 : 500, opacity: c === 0 ? 0.55 : 1 }}>{opt}</span>
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
      style={{ width: "100%", padding: "8px 10px", borderRadius: 12, border: `1px solid ${COLORS.border}`, background: COLORS.input, color: COLORS.text, fontSize: 12 }}
    >
      {children}
    </select>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: COLORS.text, userSelect: "none", cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ transform: "translateY(0.5px)" }} />
      <span>{label}</span>
    </label>
  );
}

const LS_CUSTOM_ORDER_KEY = "ggclone_custom_order_v1";

export default function HomePage() {
  const csvUrl = process.env.NEXT_PUBLIC_SHEET_CSV_URL;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  // ✅ default cover size = 100
  const [tileSize, setTileSize] = useState(100);

  const [q, setQ] = useState("");

  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYearsPlayed, setSelectedYearsPlayed] = useState<string[]>([]);

  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedOwnership, setSelectedOwnership] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("");

  const [onlyBacklog, setOnlyBacklog] = useState(false);
  const [onlyCompleted, setOnlyCompleted] = useState(false);

  // Sort options (added custom + dateAdded)
  const [sortBy, setSortBy] = useState<
    "custom" | "title" | "releaseDate" | "dateCompleted" | "dateAdded"
  >("releaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Drag reorder (local)
  const [customOrder, setCustomOrder] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [openPlatform, setOpenPlatform] = useState(false);
  const [openStatus, setOpenStatus] = useState(false);
  const [openOwnership, setOpenOwnership] = useState(false);
  const [openFormat, setOpenFormat] = useState(false);
  const [openYearsPlayed, setOpenYearsPlayed] = useState(false);
  const [openGenres, setOpenGenres] = useState(false);

  // mobile sidebar
  const [filtersOpen, setFiltersOpen] = useState(false);

  // load custom order from localStorage (client only)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CUSTOM_ORDER_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCustomOrder(parsed.map(String));
      }
    } catch {
      // ignore
    }
  }, []);

  // persist custom order
  function saveCustomOrder(next: string[]) {
    setCustomOrder(next);
    try {
      localStorage.setItem(LS_CUSTOM_ORDER_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    async function load() {
      if (!csvUrl) return;
      setLoading(true);

      const res = await fetch(csvUrl, { cache: "no-store" });
      const text = await res.text();

      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      const mapped = (parsed.data as Row[]).map(rowToGame).filter(Boolean) as Game[];
      const deduped = dedupeByTitle(mapped);

      setGames(deduped);
      setLoading(false);

      // If we have no saved order yet, initialize it once from current data
      // (keeps your first custom sort stable).
      if (!customOrder.length) {
        const ids = deduped.map((g) => g.idKey);
        saveCustomOrder(ids);
      }
    }

    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvUrl]);

  const platforms = useMemo(() => uniqueSorted(games.flatMap((g) => g.platforms)), [games]);
  const statuses = useMemo(() => uniqueSorted(games.map((g) => g.status)), [games]);
  const ownerships = useMemo(() => uniqueSorted(games.map((g) => g.ownership)), [games]);
  const formats = useMemo(() => uniqueSorted(games.map((g) => g.format)), [games]);
  const allGenres = useMemo(() => uniqueSorted(games.flatMap((g) => g.genres)), [games]);
  const allYearsPlayed = useMemo(() => uniqueSorted(games.flatMap((g) => g.yearPlayed)), [games]);

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
      onlyBacklog,
      onlyCompleted,
      exclude: "platforms",
    });
    return countByTagList(base, (g) => g.platforms);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, onlyBacklog, onlyCompleted]);

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
      onlyBacklog,
      onlyCompleted,
      exclude: "status",
    });
    return countByKey(base, (g) => g.status);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, onlyBacklog, onlyCompleted]);

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
      onlyBacklog,
      onlyCompleted,
      exclude: "ownership",
    });
    return countByKey(base, (g) => g.ownership);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, onlyBacklog, onlyCompleted]);

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
      onlyBacklog,
      onlyCompleted,
      exclude: "format",
    });
    return countByKey(base, (g) => g.format);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, onlyBacklog, onlyCompleted]);

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
      onlyBacklog,
      onlyCompleted,
      exclude: "yearsPlayed",
    });
    return countByTagList(base, (g) => g.yearPlayed);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, onlyBacklog, onlyCompleted]);

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
      onlyBacklog,
      onlyCompleted,
      exclude: "genres",
    });
    return countByTagList(base, (g) => g.genres);
  }, [games, q, selectedPlatform, selectedStatus, selectedOwnership, selectedFormat, selectedGenres, selectedYearsPlayed, onlyBacklog, onlyCompleted]);

  function toggleGenre(v: string) {
    setSelectedGenres((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }
  function toggleYearPlayed(v: string) {
    setSelectedYearsPlayed((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  }

  function clearFilters() {
    setQ("");
    setSelectedGenres([]);
    setSelectedYearsPlayed([]);
    setSelectedPlatform("");
    setSelectedStatus("");
    setSelectedOwnership("");
    setSelectedFormat("");
    setOnlyBacklog(false);
    setOnlyCompleted(false);
  }

  // === filtered list (no sort yet)
  const filteredBase = useMemo(() => {
    const query = q.trim().toLowerCase();

    return games.filter((g) => {
      if (query && !g.title.toLowerCase().includes(query)) return false;

      if (onlyBacklog && !toBool(g.backlog)) return false;
      if (onlyCompleted && !toBool(g.completed)) return false;

      if (selectedStatus && g.status !== selectedStatus) return false;
      if (selectedOwnership && g.ownership !== selectedOwnership) return false;
      if (selectedFormat && g.format !== selectedFormat) return false;

      if (selectedPlatform) {
        const set = new Set(g.platforms.map((x) => x.toLowerCase()));
        if (!set.has(selectedPlatform.toLowerCase())) return false;
      }

      // Genres = AND
      if (selectedGenres.length) {
        const set = new Set(g.genres.map((x) => x.toLowerCase()));
        for (const sg of selectedGenres) if (!set.has(sg.toLowerCase())) return false;
      }

      // Years Played = OR
      if (selectedYearsPlayed.length) {
        const set = new Set(g.yearPlayed.map((x) => x.toLowerCase()));
        if (!selectedYearsPlayed.some((y) => set.has(y.toLowerCase()))) return false;
      }

      return true;
    });
  }, [games, q, onlyBacklog, onlyCompleted, selectedStatus, selectedOwnership, selectedFormat, selectedPlatform, selectedGenres, selectedYearsPlayed]);

  // === apply sorting
  const filtered = useMemo(() => {
    const base = [...filteredBase];

    if (sortBy === "custom") {
      const idx = new Map<string, number>();
      customOrder.forEach((id, i) => idx.set(id, i));

      // unknown items (new games) go to the end (then title)
      base.sort((a, b) => {
        const ia = idx.has(a.idKey) ? (idx.get(a.idKey) as number) : Number.MAX_SAFE_INTEGER;
        const ib = idx.has(b.idKey) ? (idx.get(b.idKey) as number) : Number.MAX_SAFE_INTEGER;
        if (ia !== ib) return ia - ib;
        return a.title.localeCompare(b.title);
      });

      return base;
    }

    const dir = sortDir === "asc" ? 1 : -1;
    base.sort((a, b) => {
      if (sortBy === "title") return a.title.localeCompare(b.title) * dir;
      if (sortBy === "releaseDate") return (toDateNum(a.releaseDate) - toDateNum(b.releaseDate)) * dir;
      if (sortBy === "dateCompleted") return (toDateNum(a.dateCompleted) - toDateNum(b.dateCompleted)) * dir;
      if (sortBy === "dateAdded") return (toDateNum(a.dateAdded) - toDateNum(b.dateAdded)) * dir;
      return 0;
    });
    return base;
  }, [filteredBase, sortBy, sortDir, customOrder]);

  // === Drag reorder handlers (only meaningful when sortBy === "custom")
  function onDragStart(id: string) {
    setDraggingId(id);
  }
  function onDropOn(targetId: string) {
    if (!draggingId || draggingId === targetId) return;

    // Only reorder inside the currently visible (filtered) list
    const visibleIds = filtered.map((g) => g.idKey);
    const setVisible = new Set(visibleIds);

    const current = customOrder.length ? [...customOrder] : [...visibleIds];

    // Ensure all visible ids exist in the order list
    for (const id of visibleIds) {
      if (!current.includes(id)) current.push(id);
    }

    // Only move among visible ids
    if (!setVisible.has(draggingId) || !setVisible.has(targetId)) return;

    const without = current.filter((x) => x !== draggingId);
    const targetIndex = without.indexOf(targetId);
    if (targetIndex === -1) return;

    without.splice(targetIndex, 0, draggingId);
    saveCustomOrder(without);
    setDraggingId(null);
  }

  const headerAvatarUrl =
    "https://lh3.googleusercontent.com/a/ACg8ocJytvmuklInlqxJZOFW4Xi1sk40VGv_-UYAYNmYqAzSlBbno9AKeQ=s288-c-no";

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <style>{`
        aside::-webkit-scrollbar { display: none; }
        @media (max-width: 900px) {
          .sidebar {
            position: fixed !important;
            left: 0; top: 0;
            height: 100vh !important;
            z-index: 50;
            transform: translateX(-110%);
            transition: transform 160ms ease;
            border-right: 1px solid ${COLORS.border};
          }
          .sidebar.open { transform: translateX(0); }
          .overlay {
            position: fixed; inset: 0;
            background: rgba(0,0,0,0.55);
            z-index: 40;
          }
          .mobileTopbar {
            position: sticky; top: 0; z-index: 30;
            padding: 12px 18px;
            background: ${COLORS.bg};
            border-bottom: 1px solid ${COLORS.border};
            margin: -18px -18px 14px -18px;
          }
          .mobileOnly { display: block !important; }
        }
        .mobileOnly { display: none; }
      `}</style>

      {filtersOpen && <div className="overlay" onClick={() => setFiltersOpen(false)} />}

      <aside
        className={`sidebar ${filtersOpen ? "open" : ""}`}
        style={{
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
        }}
      >
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
              <SmallSelect value={sortBy} onChange={(v) => setSortBy(v as any)}>
                <option value="releaseDate">Release Date</option>
                <option value="title">Title</option>
                <option value="dateAdded">Date Added</option>
                <option value="dateCompleted">Date Completed</option>
                <option value="custom">Custom (drag)</option>
              </SmallSelect>

              <SmallSelect value={sortDir} onChange={(v) => setSortDir(v as "asc" | "desc")}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </SmallSelect>
            </div>

            {sortBy === "custom" && (
              <div style={{ marginTop: 8, fontSize: 11, color: COLORS.muted }}>
                Drag covers to reorder (saved on this device).
              </div>
            )}
          </div>

          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>FILTERS</div>
            <CheckboxRow label="Backlog" checked={onlyBacklog} onChange={setOnlyBacklog} />
            <CheckboxRow label="Completed" checked={onlyCompleted} onChange={setOnlyCompleted} />
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>COVER SIZE</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginBottom: 6 }}>{tileSize}px</div>
            <input
              type="range"
              min={80}
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
          <FacetRowsSingle options={ownerships} counts={ownershipCounts} selected={selectedOwnership} onSelect={setSelectedOwnership} />
        </CollapsibleSection>

        <CollapsibleSection title="Format" open={openFormat} setOpen={setOpenFormat}>
          <FacetRowsSingle options={formats} counts={formatCounts} selected={selectedFormat} onSelect={setSelectedFormat} />
        </CollapsibleSection>

        <CollapsibleSection title="Year Played" open={openYearsPlayed} setOpen={setOpenYearsPlayed}>
          <FacetRowsMulti options={allYearsPlayed} counts={yearsPlayedCounts} selected={selectedYearsPlayed} onToggle={toggleYearPlayed} />
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
            {filtered.map((g) => {
              const draggableEnabled = sortBy === "custom";

              return (
                <button
                  key={g.idKey}
                  draggable={draggableEnabled}
                  onDragStart={() => draggableEnabled && onDragStart(g.idKey)}
                  onDragOver={(e) => {
                    if (!draggableEnabled) return;
                    e.preventDefault();
                  }}
                  onDrop={() => draggableEnabled && onDropOn(g.idKey)}
                  style={{
                    aspectRatio: "2 / 3",
                    background: COLORS.card,
                    borderRadius: 14,
                    overflow: "hidden",
                    boxShadow: draggingId === g.idKey ? "0 0 0 2px rgba(34,197,94,0.55)" : "0 20px 40px rgba(0,0,0,.6)",
                    border: "none",
                    padding: 0,
                    cursor: draggableEnabled ? "grab" : "pointer",
                    textAlign: "left",
                  }}
                  title={draggableEnabled ? "Drag to reorder" : g.title}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      loading="lazy"
                      onError={(e) => {
                        // fallback: remove broken image to avoid endless broken icon
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontSize: 12 }}>
                      No cover
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

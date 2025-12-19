/* =====================================================================================
   Chris' Game Library
   Version: 2.1.1
   Notes:
   - Move Sync bar into left menu under avatar/title (above Search)
   - Stats mode: add "Top Rated Games This Year" (by My_Rating, YearPlayed includes current year)
   - Facets/search affect stats; Re-sync re-fetches CSV
===================================================================================== */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type Row = Record<string, string>;

type Game = {
  title: string;
  coverUrl: string;

  platform: string[];
  status: string;
  genres: string[];
  ownership: string;
  format: string;

  releaseDate: string;
  dateAdded: string;

  completed: string;
  backlog: string;

  dateCompleted: string;
  yearPlayed: string[];

  igdbId: string;
  igdbRating: string;
  myRating: string;
  hoursPlayed: string;

  developer: string;
  description: string;
  screenshotUrl: string;

  queuedOrder: string;
  wishlistOrder: string;
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
  modalBg: "rgba(0,0,0,0.62)",
  good: "rgba(34,197,94,0.16)",
  warn: "rgba(250,204,21,0.16)",
  danger: "rgba(239,68,68,0.16)",
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

function toNum(v: unknown) {
  const n = Number(norm(v));
  return Number.isFinite(n) ? n : NaN;
}

function uniqueSorted(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((x) => norm(x))
        .filter((x) => x && x !== "#REF!" && x.toLowerCase() !== "n/a")
    )
  ).sort((a, b) => a.localeCompare(b));
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

function pickScreenshot(row: Row) {
  const s = norm(row["ScreenshotURL"]);
  if (s.startsWith("http")) return s;
  return "";
}

function rowToGame(row: Row): Game | null {
  const title = norm(row["Title"]);
  if (!title) return null;

  const platform = splitTags(row["Platforms"] || row["Platform"]);
  const genres = splitTags(row["Genres"]);
  const yearPlayed = splitTags(row["YearPlayed"]);

  return {
    title,
    coverUrl: pickCover(row),

    platform,
    status: norm(row["Status"]),
    genres,
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    releaseDate: norm(row["ReleaseDate"]),
    dateAdded: norm(row["DateAdded"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
    dateCompleted: norm(row["DateCompleted"]),
    yearPlayed,

    igdbId: norm(row["IGDB_ID"]),
    igdbRating: norm(row["IGDB_Rating"]),
    myRating: norm(row["My_Rating"]),
    hoursPlayed: norm(row["HoursPlayed"]),

    developer: norm(row["Developer"]),
    description: norm(row["Description"]),
    screenshotUrl: pickScreenshot(row),

    queuedOrder: norm(row["QueuedOrder"]),
    wishlistOrder: norm(row["WishlistOrder"]),
  };
}

// Dedupe by Title (merge tags so filters still work)
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
    const platform = uniqueSorted([...existing.platform, ...g.platform]);
    const genres = uniqueSorted([...existing.genres, ...g.genres]);
    const yearPlayed = uniqueSorted([...existing.yearPlayed, ...g.yearPlayed]);

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
      dateCompleted = aComp >= bComp ? existing.dateCompleted : g.dateCompleted;

    const status = existing.status || g.status;
    const ownership = existing.ownership || g.ownership;
    const format = existing.format || g.format;

    const igdbId = existing.igdbId || g.igdbId;
    const igdbRating = existing.igdbRating || g.igdbRating;
    const myRating = existing.myRating || g.myRating;
    const hoursPlayed = existing.hoursPlayed || g.hoursPlayed;

    const developer = existing.developer || g.developer;
    const description = existing.description || g.description;
    const screenshotUrl = existing.screenshotUrl || g.screenshotUrl;

    const queuedOrder = existing.queuedOrder || g.queuedOrder;
    const wishlistOrder = existing.wishlistOrder || g.wishlistOrder;

    map.set(k, {
      ...existing,
      coverUrl,
      platform,
      genres,
      yearPlayed,
      completed,
      releaseDate,
      dateAdded,
      dateCompleted,
      status,
      ownership,
      format,
      igdbId,
      igdbRating,
      myRating,
      hoursPlayed,
      developer,
      description,
      screenshotUrl,
      queuedOrder,
      wishlistOrder,
    });
  }

  return Array.from(map.values());
}

function countByKey<T>(base: T[], getKey: (g: T) => string) {
  const map = new Map<string, number>();
  for (const g of base) {
    const k = norm(getKey(g));
    if (!k || k === "#REF!" || k.toLowerCase() === "n/a") continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
}

function countByTagList(base: Game[], getTags: (g: Game) => string[]) {
  const map = new Map<string, number>();
  for (const g of base) {
    for (const tag of getTags(g)) {
      const k = norm(tag);
      if (!k || k === "#REF!" || k.toLowerCase() === "n/a") continue;
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

function PlusIcon({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        width: 18,
        height: 18,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: COLORS.muted,
        fontSize: 16,
        lineHeight: "18px",
        userSelect: "none",
        transform: open ? "rotate(45deg)" : "rotate(0deg)",
        transition: "transform 120ms ease",
      }}
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
            padding: "6px 6px",
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
          <PlusIcon open={open} />
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  opacity: c === 0 ? 0.55 : 1,
                }}
              >
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
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  opacity: c === 0 ? 0.55 : 1,
                }}
              >
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

/** Stats block – locked look */
function StatsBlock({
  left,
  right,
}: {
  left: { value: number; label: string }[];
  right: { value: number; label: string }[];
}) {
  const labelStyle: React.CSSProperties = {
    color: COLORS.muted,
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };

  const valueStyle: React.CSSProperties = {
    color: COLORS.statNumber,
    fontSize: 18,
    fontWeight: 900,
    lineHeight: 1,
    width: 54,
    textAlign: "right",
    flex: "0 0 auto",
  };

  const rowStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    minHeight: 22,
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          color: COLORS.muted,
          marginBottom: 8,
          letterSpacing: "0.04em",
        }}
      >
        STATS
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          columnGap: 18,
          rowGap: 10,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {left.map((s) => (
            <div key={s.label} style={rowStyle}>
              <div style={valueStyle}>{s.value}</div>
              <div style={labelStyle}>{s.label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {right.map((s) => (
            <div key={s.label} style={rowStyle}>
              <div style={valueStyle}>{s.value}</div>
              <div style={labelStyle}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Modal bits */
function TagPill({ text }: { text: string }) {
  return (
    <span
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.06)",
        border: `1px solid ${COLORS.border}`,
        color: COLORS.text,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${COLORS.border}`,
        borderRadius: 14,
        padding: 12,
        minHeight: 56,
      }}
    >
      <div
        style={{
          color: COLORS.muted,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.04em",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: COLORS.text,
          fontSize: 13,
          fontWeight: 700,
          lineHeight: 1.35,
        }}
      >
        {value || <span style={{ color: COLORS.muted }}>—</span>}
      </div>
    </div>
  );
}

/** Sortable cover tile */
function SortableCoverTile({
  id,
  game,
  onClick,
  tileSize,
}: {
  id: string;
  game: Game;
  onClick: () => void;
  tileSize: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    cursor: "grab",
    border: "none",
    padding: 0,
    background: "transparent",
    textAlign: "left",
  };

  return (
    <button
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      style={style}
      title={game.title}
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
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.title}
            loading="lazy"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
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
  );
}

export default function HomePage() {
  const csvUrl = process.env.NEXT_PUBLIC_SHEET_CSV_URL;

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);

  const [tileSize, setTileSize] = useState(120);
  const [isMobile, setIsMobile] = useState(false);

  const [q, setQ] = useState("");

  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYearsPlayed, setSelectedYearsPlayed] = useState<string[]>([]);

  const [selectedPlatform, setSelectedPlatform] = useState("");
  const [selectedStatus, setSelectedStatus] = useState("");
  const [selectedOwnership, setSelectedOwnership] = useState("");
  const [selectedFormat, setSelectedFormat] = useState("");

  const [activeTab, setActiveTab] = useState<
    "games" | "nowPlaying" | "queued" | "wishlist" | "completed" | "stats"
  >("games");

  const [sortBy, setSortBy] = useState<
    "title" | "releaseDate" | "dateCompleted" | "dateAdded" | "custom"
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

  // DnD / edit mode
  const [editMode, setEditMode] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  // Sync UI
  const [syncState, setSyncState] = useState<
    { status: "idle" | "syncing" | "synced" | "error"; message?: string } | undefined
  >({ status: "idle" });
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Keep a stable “view order” list for DnD
  const viewIdsRef = useRef<string[]>([]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");

    const apply = () => {
      const m = mq.matches;
      setIsMobile(m);
      setTileSize(m ? 100 : 120);
    };

    apply();

    const onChange = () => apply();

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    // legacy
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  async function loadCsv() {
    if (!csvUrl) return;
    setLoading(true);
    setSyncState({ status: "syncing" });

    try {
      const res = await fetch(csvUrl, { cache: "no-store" });
      const text = await res.text();

      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      const mapped = (parsed.data as Row[]).map(rowToGame).filter(Boolean) as Game[];

      setGames(dedupeByTitle(mapped));
      setLastSyncedAt(new Date());
      setSyncState({ status: "synced" });
    } catch (e: any) {
      setSyncState({ status: "error", message: e?.message || "Sync failed" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCsv();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvUrl]);

  const platforms = useMemo(() => uniqueSorted(games.flatMap((g) => g.platform)), [games]);
  const statuses = useMemo(() => uniqueSorted(games.map((g) => g.status)), [games]);
  const ownerships = useMemo(() => uniqueSorted(games.map((g) => g.ownership)), [games]);
  const formats = useMemo(() => uniqueSorted(games.map((g) => g.format)), [games]);
  const allGenres = useMemo(() => uniqueSorted(games.flatMap((g) => g.genres)), [games]);
  const allYearsPlayed = useMemo(() => uniqueSorted(games.flatMap((g) => g.yearPlayed)), [games]);

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

  // Facet filtering (used by Stats mode + tabs)
  const facetFiltered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return games.filter((g) => {
      if (query && !g.title.toLowerCase().includes(query)) return false;

      if (selectedStatus && g.status !== selectedStatus) return false;
      if (selectedOwnership && g.ownership !== selectedOwnership) return false;
      if (selectedFormat && g.format !== selectedFormat) return false;

      if (selectedPlatform) {
        const set = new Set(g.platform.map((x) => x.toLowerCase()));
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
  }, [
    games,
    q,
    selectedPlatform,
    selectedStatus,
    selectedOwnership,
    selectedFormat,
    selectedGenres,
    selectedYearsPlayed,
  ]);

  // Tab filtering (used by cover grid)
  const tabFiltered = useMemo(() => {
    const base = facetFiltered.filter((g) => {
      if (activeTab === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
      if (activeTab === "queued" && norm(g.status) !== "Queued") return false;
      if (activeTab === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
      if (activeTab === "completed" && !toBool(g.completed)) return false;
      if (activeTab === "stats") return true; // covers not shown anyway
      return true;
    });

    // Default sort overrides for Queued/Wishlist when not explicitly Custom
    let effectiveSortBy = sortBy;
    let effectiveSortDir = sortDir;

    if (activeTab === "queued" && sortBy !== "custom") {
      effectiveSortBy = "custom";
      effectiveSortDir = "asc";
    }
    if (activeTab === "wishlist" && sortBy !== "custom") {
      effectiveSortBy = "custom";
      effectiveSortDir = "asc";
    }

    const dir = effectiveSortDir === "asc" ? 1 : -1;

    const withSort = [...base].sort((a, b) => {
      if (effectiveSortBy === "title") return a.title.localeCompare(b.title) * dir;

      if (effectiveSortBy === "releaseDate") {
        return (toDateNum(a.releaseDate) - toDateNum(b.releaseDate)) * dir;
      }
      if (effectiveSortBy === "dateCompleted") {
        return (toDateNum(a.dateCompleted) - toDateNum(b.dateCompleted)) * dir;
      }
      if (effectiveSortBy === "dateAdded") {
        return (toDateNum(a.dateAdded) - toDateNum(b.dateAdded)) * dir;
      }

      // Custom (Queued/Wishlist): by order asc, then fallback to newest release first
      if (effectiveSortBy === "custom") {
        const aOrder =
          activeTab === "wishlist" ? toNum(a.wishlistOrder) : toNum(a.queuedOrder);
        const bOrder =
          activeTab === "wishlist" ? toNum(b.wishlistOrder) : toNum(b.queuedOrder);

        const aHas = Number.isFinite(aOrder);
        const bHas = Number.isFinite(bOrder);

        if (aHas && bHas) return (aOrder - bOrder) * dir;
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;

        // fallback: newest release first
        return (toDateNum(b.releaseDate) - toDateNum(a.releaseDate)) * 1;
      }

      return 0;
    });

    return withSort;
  }, [facetFiltered, activeTab, sortBy, sortDir]);

  // Facet counts based on facetFiltered (so counts match what Stats sees)
  const platformCounts = useMemo(
    () => countByTagList(facetFiltered, (g) => g.platform),
    [facetFiltered]
  );
  const statusCounts = useMemo(() => countByKey(facetFiltered, (g) => g.status), [facetFiltered]);
  const ownershipCounts = useMemo(
    () => countByKey(facetFiltered, (g) => g.ownership),
    [facetFiltered]
  );
  const formatCounts = useMemo(() => countByKey(facetFiltered, (g) => g.format), [facetFiltered]);
  const yearsPlayedCounts = useMemo(
    () => countByTagList(facetFiltered, (g) => g.yearPlayed),
    [facetFiltered]
  );
  const genreCounts = useMemo(() => countByTagList(facetFiltered, (g) => g.genres), [facetFiltered]);

  // Stats (locked left sidebar layout)
  const gamesTotal = games.length;
  const year = new Date().getFullYear();
  const inYear = games.filter((g) => g.yearPlayed.includes(String(year))).length;
  const nowPlayingTotal = games.filter((g) => norm(g.status) === "Now Playing").length;
  const queuedTotal = games.filter((g) => norm(g.status) === "Queued").length;
  const wishlistTotal = games.filter((g) => norm(g.ownership) === "Wishlist").length;
  const completedTotal = games.filter((g) => toBool(g.completed)).length;

  // Top-right count: for covers view, show tabFiltered length; for stats show facetFiltered length
  const topRightCount = activeTab === "stats" ? facetFiltered.length : tabFiltered.length;

  // Edit mode should only make sense on Queued/Wishlist grids
  const canEditThisTab = activeTab === "queued" || activeTab === "wishlist";

  // DnD ids for current view
  const viewIds = useMemo(() => {
    const ids = tabFiltered
      .map((g) => norm(g.igdbId))
      .filter(Boolean);

    // keep ref updated for drag end reorder
    viewIdsRef.current = ids;
    return ids;
  }, [tabFiltered]);

  const draggingGame = useMemo(() => {
    if (!draggingId) return null;
    return tabFiltered.find((g) => norm(g.igdbId) === draggingId) || null;
  }, [draggingId, tabFiltered]);

  async function saveOrderToSheet(orderType: "queued" | "wishlist", orderedIgdbIds: string[]) {
    const res = await fetch("/sheets/update-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderType,
        orderedIgdbIds,
        tabName: "Web",
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      throw new Error(json?.error || `HTTP ${res.status}`);
    }
    return json;
  }

  async function handleDragEnd(e: DragEndEvent) {
    setDraggingId(null);

    const { active, over } = e;
    if (!active?.id || !over?.id) return;
    const a = String(active.id);
    const b = String(over.id);
    if (a === b) return;

    // reorder current view list
    const oldIndex = viewIdsRef.current.indexOf(a);
    const newIndex = viewIdsRef.current.indexOf(b);
    if (oldIndex === -1 || newIndex === -1) return;

    const nextIds = arrayMove(viewIdsRef.current, oldIndex, newIndex);

    // Optimistically reorder UI by rebuilding tabFiltered order via local override:
    // easiest: mutate by setting synthetic orders in-memory
    const orderMap = new Map<string, number>();
    nextIds.forEach((id, idx) => orderMap.set(id, idx + 1));

    setGames((prev) => {
      const updated = prev.map((g) => {
        const id = norm(g.igdbId);
        if (!id || !orderMap.has(id)) return g;
        const n = orderMap.get(id)!;
        if (activeTab === "queued") return { ...g, queuedOrder: String(n) };
        if (activeTab === "wishlist") return { ...g, wishlistOrder: String(n) };
        return g;
      });
      return updated;
    });

    // Persist to sheet
    try {
      setSyncState({ status: "syncing" });
      const orderType = activeTab === "queued" ? "queued" : "wishlist";
      await saveOrderToSheet(orderType, nextIds);
      setLastSyncedAt(new Date());
      setSyncState({ status: "synced" });
    } catch (err: any) {
      setSyncState({ status: "error", message: err?.message || "Save failed" });
    }
  }

  const headerAvatarUrl =
    "https://lh3.googleusercontent.com/a/ACg8ocJytvmuklInlqxJZOFW4Xi1sk40VGv_-UYAYNmYqAzSlBbno9AKeQ=s288-c-no";

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

  // --- Stats Mode (right panel) ---
  const statsBase = facetFiltered; // facets/search affect stats
  const statsCountInView = statsBase.length;

  const wishlistInView = statsBase.filter((g) => norm(g.ownership) === "Wishlist").length;

  const avgIgdbInView = useMemo(() => {
    const nums = statsBase
      .map((g) => Number(norm(g.igdbRating)))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!nums.length) return null;
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return avg;
  }, [statsBase]);

  const newestReleaseInView = useMemo(() => {
    const sorted = [...statsBase]
      .filter((g) => toDateNum(g.releaseDate) > 0)
      .sort((a, b) => toDateNum(b.releaseDate) - toDateNum(a.releaseDate));
    return sorted[0] || null;
  }, [statsBase]);

  const topRatedThisYear = useMemo(() => {
    const y = String(year);
    const list = statsBase
      .filter((g) => g.yearPlayed.includes(y))
      .map((g) => ({ g, r: Number(norm(g.myRating)) }))
      .filter((x) => Number.isFinite(x.r))
      .sort((a, b) => b.r - a.r)
      .map((x) => x.g)
      .filter((g) => !!g.coverUrl)
      .slice(0, 10);
    return list;
  }, [statsBase, year]);

  function formatTime(d: Date) {
    return d.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function SyncBar() {
    const status = syncState?.status ?? "idle";
    const pillBg =
      status === "synced"
        ? COLORS.good
        : status === "syncing"
        ? COLORS.warn
        : status === "error"
        ? COLORS.danger
        : "rgba(255,255,255,0.06)";

    const pillText =
      status === "synced"
        ? "Synced"
        : status === "syncing"
        ? "Syncing…"
        : status === "error"
        ? "Error"
        : "Idle";

    return (
      <div
        style={{
          marginTop: 10,
          padding: "10px 10px",
          borderRadius: 14,
          border: `1px solid ${COLORS.border}`,
          background: "rgba(255,255,255,0.03)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                background: pillBg,
                border: `1px solid ${COLORS.border}`,
                fontSize: 12,
                fontWeight: 900,
                color: COLORS.text,
                whiteSpace: "nowrap",
              }}
            >
              {pillText}
            </span>
            <div style={{ fontSize: 12, color: COLORS.muted, whiteSpace: "nowrap" }}>
              {lastSyncedAt ? `Last: ${formatTime(lastSyncedAt)}` : "—"}
            </div>
          </div>

          {status === "error" && syncState?.message ? (
            <div style={{ marginTop: 6, fontSize: 12, color: COLORS.muted, overflow: "hidden", textOverflow: "ellipsis" }}>
              {syncState.message}
            </div>
          ) : null}
        </div>

        <button
          onClick={loadCsv}
          style={{
            padding: "8px 10px",
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
          Re-sync
        </button>
      </div>
    );
  }

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
        }
        .mobileOnly { display: none; }
      `}</style>

      {filtersOpen && <div className="overlay" onClick={() => setFiltersOpen(false)} />}

      {/* Sidebar */}
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

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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

          {/* ✅ Sync bar moved here */}
          <SyncBar />

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
              marginTop: 12,
            }}
          />

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>SORT</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <SmallSelect
                value={sortBy}
                onChange={(v) =>
                  setSortBy(v as "title" | "releaseDate" | "dateCompleted" | "dateAdded" | "custom")
                }
              >
                <option value="title">Title</option>
                <option value="releaseDate">Release Date</option>
                <option value="dateAdded">Date Added</option>
                <option value="dateCompleted">Date Completed</option>
                <option value="custom">Custom Order</option>
              </SmallSelect>

              <SmallSelect value={sortDir} onChange={(v) => setSortDir(v as "asc" | "desc")}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </SmallSelect>
            </div>

            {canEditThisTab ? (
              <div style={{ marginTop: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>EDIT MODE</div>
                <button
                  onClick={() => setEditMode((p) => !p)}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    background: editMode ? "rgba(34,197,94,0.15)" : COLORS.card,
                    border: `1px solid ${COLORS.border}`,
                    color: COLORS.text,
                    cursor: "pointer",
                    fontWeight: 900,
                    fontSize: 12,
                  }}
                >
                  {editMode ? "On" : "Off"}
                </button>
              </div>
            ) : null}
          </div>

          {/* Stats block (locked) */}
          <StatsBlock
            left={[
              { value: gamesTotal, label: "Games" },
              { value: nowPlayingTotal, label: "Now Playing" },
              { value: wishlistTotal, label: "Wishlist" },
            ]}
            right={[
              { value: inYear, label: `in ${year}` },
              { value: queuedTotal, label: "Queued" },
              { value: completedTotal, label: "Completed" },
            ]}
          />

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
          Showing {tabFiltered.length} / {games.length}
        </div>
      </aside>

      {/* Main */}
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
            <div style={{ fontSize: 12, color: COLORS.muted }}>{topRightCount}</div>
          </div>
        </div>

        {/* Top nav + count */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            marginBottom: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <TabButton label="Games" active={activeTab === "games"} onClick={() => setActiveTab("games")} />
            <TabButton label="Now Playing" active={activeTab === "nowPlaying"} onClick={() => setActiveTab("nowPlaying")} />
            <TabButton label="Queued" active={activeTab === "queued"} onClick={() => setActiveTab("queued")} />
            <TabButton label="Wishlist" active={activeTab === "wishlist"} onClick={() => setActiveTab("wishlist")} />
            <TabButton label="Completed" active={activeTab === "completed"} onClick={() => setActiveTab("completed")} />
            <TabButton label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} />
          </div>

          <div style={{ fontSize: 16, fontWeight: 900, color: COLORS.text, opacity: 0.95 }}>
            {topRightCount}
          </div>
        </div>

        {loading ? (
          <div>Loading…</div>
        ) : activeTab === "stats" ? (
          /* ===================== Stats Mode ===================== */
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(320px, 1fr) minmax(320px, 1fr)",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 18,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted, letterSpacing: "0.04em" }}>
                IN VIEW
              </div>
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Items" value={statsCountInView} />
                <Field label="Wishlist" value={wishlistInView} />
                <Field
                  label="Avg IGDB rating"
                  value={avgIgdbInView == null ? "" : avgIgdbInView.toFixed(1)}
                />
                <Field
                  label="Newest release in view"
                  value={newestReleaseInView ? newestReleaseInView.title : ""}
                />
              </div>

              {/* ✅ Top Rated Games This Year */}
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted, letterSpacing: "0.04em" }}>
                  TOP RATED GAMES THIS YEAR
                </div>

                {topRatedThisYear.length ? (
                  <div
                    style={{
                      marginTop: 10,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
                      gap: 10,
                    }}
                  >
                    {topRatedThisYear.map((g) => (
                      <button
                        key={`top-${g.igdbId || g.title}`}
                        onClick={() => setSelectedGame(g)}
                        style={{
                          border: "none",
                          padding: 0,
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                        title={`${g.title} (My rating: ${g.myRating})`}
                      >
                        <div
                          style={{
                            aspectRatio: "2 / 3",
                            borderRadius: 12,
                            overflow: "hidden",
                            border: `1px solid ${COLORS.border}`,
                            background: COLORS.card,
                            boxShadow: "0 14px 34px rgba(0,0,0,.5)",
                          }}
                        >
                          <img
                            src={g.coverUrl}
                            alt={g.title}
                            loading="lazy"
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 12, color: COLORS.muted }}>
                    No games found with My_Rating tagged in {year}.
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 18,
                padding: 14,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted, letterSpacing: "0.04em" }}>
                BREAKDOWN
              </div>

              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field
                  label="Now Playing"
                  value={statsBase.filter((g) => norm(g.status) === "Now Playing").length}
                />
                <Field label="Queued" value={statsBase.filter((g) => norm(g.status) === "Queued").length} />
                <Field label="Completed" value={statsBase.filter((g) => toBool(g.completed)).length} />
                <Field label={`in ${year}`} value={statsBase.filter((g) => g.yearPlayed.includes(String(year))).length} />
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.muted, letterSpacing: "0.04em" }}>
                  TOP PLATFORMS (IN VIEW)
                </div>

                {(() => {
                  const byPlat = countByTagList(statsBase, (g) => g.platform);
                  const top = Array.from(byPlat.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10);
                  return top.length ? (
                    <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {top.map(([k, v]) => (
                        <Field key={`plat-${k}`} label={k} value={v} />
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 10, fontSize: 12, color: COLORS.muted }}>—</div>
                  );
                })()}
              </div>
            </div>
          </div>
        ) : (
          /* ===================== Covers Mode ===================== */
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => setDraggingId(String(e.active.id))}
            onDragEnd={async (e) => {
              if (!editMode || !canEditThisTab) {
                setDraggingId(null);
                return;
              }
              await handleDragEnd(e);
            }}
          >
            <SortableContext items={viewIds} strategy={rectSortingStrategy}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
                  gap: 12,
                }}
              >
                {tabFiltered.map((g, i) => {
                  const id = norm(g.igdbId) || `${titleKey(g.title)}-${i}`;

                  // If edit mode is off, just render simple buttons
                  if (!editMode || !canEditThisTab) {
                    return (
                      <button
                        key={id}
                        onClick={() => setSelectedGame(g)}
                        style={{
                          border: "none",
                          padding: 0,
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
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
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                                display: "block",
                              }}
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
                    );
                  }

                  // Edit mode sortable
                  if (!norm(g.igdbId)) {
                    // Not sortable without IGDB_ID; still clickable
                    return (
                      <button
                        key={id}
                        onClick={() => setSelectedGame(g)}
                        style={{
                          border: "none",
                          padding: 0,
                          background: "transparent",
                          cursor: "pointer",
                          textAlign: "left",
                          opacity: 0.75,
                        }}
                        title={`${g.title} (missing IGDB_ID)`}
                      >
                        <div
                          style={{
                            aspectRatio: "2 / 3",
                            background: COLORS.card,
                            borderRadius: 14,
                            overflow: "hidden",
                            boxShadow: "0 20px 40px rgba(0,0,0,.6)",
                            border: `1px dashed ${COLORS.border}`,
                          }}
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
                    );
                  }

                  return (
                    <SortableCoverTile
                      key={id}
                      id={norm(g.igdbId)}
                      game={g}
                      onClick={() => setSelectedGame(g)}
                      tileSize={tileSize}
                    />
                  );
                })}
              </div>
            </SortableContext>

            <DragOverlay>
              {draggingGame ? (
                <div style={{ width: 160 }}>
                  <div
                    style={{
                      aspectRatio: "2 / 3",
                      background: COLORS.card,
                      borderRadius: 14,
                      overflow: "hidden",
                      boxShadow: "0 30px 90px rgba(0,0,0,.75)",
                      border: `1px solid ${COLORS.border}`,
                    }}
                  >
                    {draggingGame.coverUrl ? (
                      <img
                        src={draggingGame.coverUrl}
                        alt={draggingGame.title}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                      />
                    ) : null}
                  </div>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {/* Modal */}
      {selectedGame && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setSelectedGame(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: COLORS.modalBg,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(1100px, 100%)",
              maxHeight: "92vh",
              overflow: "auto",
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              boxShadow: "0 30px 80px rgba(0,0,0,.7)",
              padding: 16,
              position: "relative",
            }}
          >
            <button
              onClick={() => setSelectedGame(null)}
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                width: 38,
                height: 38,
                borderRadius: 12,
                border: `1px solid ${COLORS.border}`,
                background: COLORS.card,
                color: COLORS.text,
                cursor: "pointer",
                fontSize: 18,
                fontWeight: 900,
              }}
              aria-label="Close"
            >
              ×
            </button>

            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              {/* Left: cover + tags */}
              <div style={{ width: 260, flex: "0 0 auto" }}>
                <div
                  style={{
                    borderRadius: 16,
                    overflow: "hidden",
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.card,
                    aspectRatio: "2 / 3",
                    boxShadow: "0 18px 50px rgba(0,0,0,.55)",
                  }}
                >
                  {selectedGame.coverUrl ? (
                    <img
                      src={selectedGame.coverUrl}
                      alt={selectedGame.title}
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
                      }}
                    >
                      No cover
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8 }}>
                    {selectedGame.title}
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {selectedGame.platform.slice(0, 6).map((p) => (
                      <TagPill key={`p-${p}`} text={p} />
                    ))}
                    {selectedGame.genres.slice(0, 6).map((g) => (
                      <TagPill key={`g-${g}`} text={g} />
                    ))}
                    {selectedGame.ownership ? <TagPill text={selectedGame.ownership} /> : null}
                    {selectedGame.format ? <TagPill text={selectedGame.format} /> : null}
                    {selectedGame.status ? <TagPill text={selectedGame.status} /> : null}
                    {toBool(selectedGame.completed) ? <TagPill text="Completed" /> : null}
                  </div>
                </div>
              </div>

              {/* Right: screenshot + info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {selectedGame.screenshotUrl ? (
                  <div
                    style={{
                      borderRadius: 16,
                      overflow: "hidden",
                      border: `1px solid ${COLORS.border}`,
                      background: COLORS.card,
                      aspectRatio: "16 / 9",
                      boxShadow: "0 18px 50px rgba(0,0,0,.45)",
                    }}
                  >
                    <img
                      src={selectedGame.screenshotUrl}
                      alt={`${selectedGame.title} screenshot`}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  </div>
                ) : null}

                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Field label="Release Date" value={selectedGame.releaseDate} />
                  <Field label="Year Played" value={selectedGame.yearPlayed.join(", ")} />

                  <Field label="IGDB Rating" value={selectedGame.igdbRating} />
                  <Field label="My Rating" value={selectedGame.myRating} />

                  <Field label="Hours Played" value={selectedGame.hoursPlayed} />
                  <Field label="Developer" value={selectedGame.developer} />

                  <Field label="Date Added" value={selectedGame.dateAdded} />
                  <Field label="Date Completed" value={selectedGame.dateCompleted} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <Field
                    label="Description"
                    value={
                      selectedGame.description ? (
                        <div style={{ whiteSpace: "pre-wrap" }}>{selectedGame.description}</div>
                      ) : (
                        ""
                      )
                    }
                  />
                </div>
              </div>
            </div>

            <style>{`
              @media (max-width: 900px) {
                .modalStack { flex-direction: column !important; }
              }
            `}</style>
          </div>
        </div>
      )}
    </div>
  );
}

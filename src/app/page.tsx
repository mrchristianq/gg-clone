/* =====================================================================================
   Chris' Game Library
   Version: 2.1.1
   Notes:
   - Move: Sync status bar (with Re-sync + last sync time) into left sidebar under header
   - Add: Stats tab (top tabs) + Stats mode view (facets affect stats; Re-sync re-fetches CSV)
   - Add: "Top Rated Games This Year" section (uses My_Rating + YearPlayed contains current year)
   - Keep: Drag/drop ordering + saving to Google Sheet via /sheets/update-order (queued/wishlist)
   - Keep: Game detail modal (cover/tags left; screenshot + info right; 2-col info; description full width)
===================================================================================== */

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";

import {
  DndContext,
  DragEndEvent,
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

  return {
    title,
    coverUrl: pickCover(row),

    platform: splitTags(row["Platforms"] || row["Platform"]),
    status: norm(row["Status"]),
    genres: splitTags(row["Genres"]),
    ownership: norm(row["Ownership"]),
    format: norm(row["Format"]),

    releaseDate: norm(row["ReleaseDate"]),
    dateAdded: norm(row["DateAdded"]),

    backlog: norm(row["Backlog"]),
    completed: norm(row["Completed"]),
    dateCompleted: norm(row["DateCompleted"]),
    yearPlayed: splitTags(row["YearPlayed"]),

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

    const completed = toBool(existing.completed) || toBool(g.completed) ? "true" : "";
    const backlog = toBool(existing.backlog) || toBool(g.backlog) ? "true" : "";

    const aRel = toDateNum(existing.releaseDate);
    const bRel = toDateNum(g.releaseDate);
    let releaseDate = existing.releaseDate;
    if (!aRel && bRel) releaseDate = g.releaseDate;
    else if (aRel && bRel) releaseDate = aRel <= bRel ? existing.releaseDate : g.releaseDate;

    const aAdded = toDateNum(existing.dateAdded);
    const bAdded = toDateNum(g.dateAdded);
    let dateAdded = existing.dateAdded;
    if (!aAdded && bAdded) dateAdded = g.dateAdded;
    else if (aAdded && bAdded) dateAdded = aAdded <= bAdded ? existing.dateAdded : g.dateAdded;

    const aComp = toDateNum(existing.dateCompleted);
    const bComp = toDateNum(g.dateCompleted);
    let dateCompleted = existing.dateCompleted;
    if (!aComp && bComp) dateCompleted = g.dateCompleted;
    else if (aComp && bComp) dateCompleted = aComp >= bComp ? existing.dateCompleted : g.dateCompleted;

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

    // Prefer explicit orders if they exist
    const queuedOrder = existing.queuedOrder || g.queuedOrder;
    const wishlistOrder = existing.wishlistOrder || g.wishlistOrder;

    map.set(k, {
      ...existing,
      coverUrl,
      platform,
      genres,
      yearPlayed,
      completed,
      backlog,
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
      <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted, marginBottom: 8, letterSpacing: "0.04em" }}>
        STATS
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 18, rowGap: 10 }}>
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

/** Sync bar */
function SyncBar({
  syncing,
  lastSyncAt,
  onResync,
  error,
}: {
  syncing: boolean;
  lastSyncAt: number | null;
  onResync: () => void;
  error: string;
}) {
  const timeText = lastSyncAt
    ? new Date(lastSyncAt).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div
      style={{
        padding: 10,
        borderRadius: 14,
        border: `1px solid ${COLORS.border}`,
        background: "rgba(255,255,255,0.03)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginBottom: 10,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: syncing ? "#f59e0b" : "#22c55e",
              boxShadow: "0 0 0 3px rgba(34,197,94,0.12)",
              flex: "0 0 auto",
            }}
          />
          <div style={{ fontSize: 12, fontWeight: 900, color: COLORS.text }}>
            {syncing ? "Syncing…" : "Synced"}
          </div>
        </div>

        <div style={{ marginTop: 2, fontSize: 11, color: COLORS.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Last: {timeText}
        </div>

        {error ? (
          <div style={{ marginTop: 4, fontSize: 11, color: "#fca5a5", fontWeight: 700 }}>
            {error}
          </div>
        ) : null}
      </div>

      <button
        onClick={onResync}
        disabled={syncing}
        style={{
          padding: "8px 10px",
          borderRadius: 12,
          background: COLORS.card,
          border: `1px solid ${COLORS.border}`,
          color: COLORS.text,
          cursor: syncing ? "not-allowed" : "pointer",
          fontWeight: 900,
          fontSize: 12,
          opacity: syncing ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        Re-sync
      </button>
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
      <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: COLORS.text, fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>
        {value || <span style={{ color: COLORS.muted }}>—</span>}
      </div>
    </div>
  );
}

/** Sortable tile */
function SortableTile({
  id,
  title,
  coverUrl,
  tileSize,
  onClick,
  disabled,
}: {
  id: string;
  title: string;
  coverUrl: string;
  tileSize: number;
  onClick: () => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        onClick={onClick}
        disabled={false}
        style={{
          border: "none",
          padding: 0,
          background: "transparent",
          cursor: "pointer",
          textAlign: "left",
          width: "100%",
        }}
        title={title}
        {...(disabled ? {} : { ...attributes, ...listeners })}
      >
        <div
          style={{
            aspectRatio: "2 / 3",
            background: COLORS.card,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 20px 40px rgba(0,0,0,.6)",
            outline: disabled ? "none" : "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
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
    </div>
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

  const [sortBy, setSortBy] = useState<"title" | "releaseDate" | "dateCompleted" | "dateAdded">("releaseDate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [openPlatform, setOpenPlatform] = useState(false);
  const [openStatus, setOpenStatus] = useState(false);
  const [openOwnership, setOpenOwnership] = useState(false);
  const [openFormat, setOpenFormat] = useState(false);
  const [openYearsPlayed, setOpenYearsPlayed] = useState(false);
  const [openGenres, setOpenGenres] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  // Edit mode (drag/drop)
  const [editMode, setEditMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState("");
  const lastSaveRef = useRef<number | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const apply = () => {
      const m = mq.matches;
      setIsMobile(m);
      setTileSize(m ? 100 : 120);
    };
    apply();

    const onChange = () => apply();
    const anyMq = mq as any;

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    if (typeof anyMq.addListener === "function") {
      anyMq.addListener(onChange);
      return () => anyMq.removeListener(onChange);
    }
  }, []);

  async function fetchCsvAndSet() {
    if (!csvUrl) return;

    setSyncError("");
    setLoading(true);
    try {
      const res = await fetch(csvUrl, { cache: "no-store" });
      const text = await res.text();

      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      const mapped = (parsed.data as Row[]).map(rowToGame).filter(Boolean) as Game[];

      setGames(dedupeByTitle(mapped));
      setLastSyncAt(Date.now());
    } catch (e: any) {
      setSyncError(e?.message || "Failed to sync.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCsvAndSet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvUrl]);

  async function handleResync() {
    setSyncing(true);
    await fetchCsvAndSet();
    setSyncing(false);
  }

  const platforms = useMemo(() => uniqueSorted(games.flatMap((g) => g.platform)), [games]);
  const statuses = useMemo(() => uniqueSorted(games.map((g) => g.status)), [games]);
  const ownerships = useMemo(() => uniqueSorted(games.map((g) => g.ownership)), [games]);
  const formats = useMemo(() => uniqueSorted(games.map((g) => g.format)), [games]);
  const allGenres = useMemo(() => uniqueSorted(games.flatMap((g) => g.genres)), [games]);
  const allYearsPlayed = useMemo(() => uniqueSorted(games.flatMap((g) => g.yearPlayed)), [games]);

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

  // Main filter base (facets apply to everything incl stats view)
  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    const base = games.filter((g) => {
      if (query && !g.title.toLowerCase().includes(query)) return false;

      // Top tabs (Stats tab should still use current "view" filters, but not hide anything by itself)
      if (activeTab === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
      if (activeTab === "queued" && norm(g.status) !== "Queued") return false;
      if (activeTab === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
      if (activeTab === "completed" && !toBool(g.completed)) return false;

      // Facets
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

    // Sorting:
    // - queued tab: queuedOrder asc (numbers first), then releaseDate newest first
    // - wishlist tab: wishlistOrder asc (numbers first), then releaseDate newest first
    // - otherwise: current sortBy/sortDir
    const releaseDesc = (a: Game, b: Game) => (toDateNum(b.releaseDate) - toDateNum(a.releaseDate));

    const byOrderThenRelease = (getOrder: (g: Game) => number) => {
      return base.slice().sort((a, b) => {
        const ao = getOrder(a);
        const bo = getOrder(b);

        const aHas = Number.isFinite(ao);
        const bHas = Number.isFinite(bo);

        if (aHas && bHas) {
          if (ao !== bo) return ao - bo;
          return releaseDesc(a, b);
        }
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        return releaseDesc(a, b);
      });
    };

    if (activeTab === "queued") return byOrderThenRelease((g) => toNum(g.queuedOrder));
    if (activeTab === "wishlist") return byOrderThenRelease((g) => toNum(g.wishlistOrder));

    const dir = sortDir === "asc" ? 1 : -1;

    return base.slice().sort((a, b) => {
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

  // Facet counts respect current view
  const platformCounts = useMemo(() => countByTagList(filtered, (g) => g.platform), [filtered]);
  const statusCounts = useMemo(() => countByKey(filtered, (g) => g.status), [filtered]);
  const ownershipCounts = useMemo(() => countByKey(filtered, (g) => g.ownership), [filtered]);
  const formatCounts = useMemo(() => countByKey(filtered, (g) => g.format), [filtered]);
  const yearsPlayedCounts = useMemo(() => countByTagList(filtered, (g) => g.yearPlayed), [filtered]);
  const genreCounts = useMemo(() => countByTagList(filtered, (g) => g.genres), [filtered]);

  // Stats (locked sidebar layout)
  const gamesTotal = games.length;
  const year = new Date().getFullYear();
  const inYear = games.filter((g) => g.yearPlayed.includes(String(year))).length;
  const nowPlayingTotal = games.filter((g) => norm(g.status) === "Now Playing").length;
  const queuedTotal = games.filter((g) => norm(g.status) === "Queued").length;
  const wishlistTotal = games.filter((g) => norm(g.ownership) === "Wishlist").length;
  const completedTotal = games.filter((g) => toBool(g.completed)).length;

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

  const topRightCount = filtered.length;

  // ---- Drag/drop ----
  const canDrag = editMode && (activeTab === "queued" || activeTab === "wishlist");
  const orderType = activeTab === "queued" ? "queued" : activeTab === "wishlist" ? "wishlist" : null;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  // Sortable ids for current view (must be stable & unique)
  const sortableIds = useMemo(() => {
    // Prefer IGDB_ID; fallback to title key to avoid crashes (but Sheet updates need igdbId)
    return filtered.map((g) => g.igdbId || `t:${titleKey(g.title)}`);
  }, [filtered]);

  async function saveOrderToSheet(nextOrderedIds: string[]) {
    if (!orderType) return;

    const clean = nextOrderedIds
      .map((id) => norm(id))
      .filter((id) => id && !id.startsWith("t:")); // only real IGDB_IDs

    if (!clean.length) {
      setOrderError("No IGDB_IDs to save.");
      return;
    }

    setSavingOrder(true);
    setOrderError("");

    try {
      const res = await fetch("/sheets/update-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tabName: "Web",
          orderType,
          orderedIgdbIds: clean,
        }),
      });

      const json = await res.json().catch(() => ({} as any));
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Order save failed.");
      }

      lastSaveRef.current = Date.now();
    } catch (e: any) {
      setOrderError(e?.message || "Order save failed.");
    } finally {
      setSavingOrder(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    if (active.id === over.id) return;

    const oldIndex = sortableIds.indexOf(String(active.id));
    const newIndex = sortableIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const nextIds = arrayMove(sortableIds, oldIndex, newIndex);

    // Rebuild filtered order locally (only affects UI; server is the source of truth after save)
    const idToGame = new Map<string, Game>();
    filtered.forEach((g) => idToGame.set(g.igdbId || `t:${titleKey(g.title)}`, g));
    const nextGames = nextIds.map((id) => idToGame.get(id)).filter(Boolean) as Game[];

    // We also need to reflect the new order inside the full `games` array for immediate UX.
    const nextFilteredKeySet = new Set(nextGames.map((g) => g.igdbId || `t:${titleKey(g.title)}`));
    const untouched = games.filter((g) => !nextFilteredKeySet.has(g.igdbId || `t:${titleKey(g.title)}`));

    // Put reordered ones first (within view) — this is mainly to keep the grid stable until next sync.
    setGames([...untouched, ...nextGames]);

    // Save to Sheet
    void saveOrderToSheet(nextIds);
  }

  // ---- Stats mode content (facets affect these calculations) ----
  const statsView = useMemo(() => {
    const view = filtered;

    const wishlistInView = view.filter((g) => norm(g.ownership) === "Wishlist").length;

    const igdbNums = view
      .map((g) => Number(norm(g.igdbRating)))
      .filter((n) => Number.isFinite(n)) as number[];

    const avgIgdb = igdbNums.length ? igdbNums.reduce((a, b) => a + b, 0) / igdbNums.length : 0;

    const newest = view
      .map((g) => ({ g, t: toDateNum(g.releaseDate) }))
      .filter((x) => x.t > 0)
      .sort((a, b) => b.t - a.t)[0]?.g;

    // Top Rated Games This Year (My_Rating desc, YearPlayed includes current year)
    const topRatedThisYear = view
      .filter((g) => g.yearPlayed.includes(String(year)))
      .map((g) => ({ g, r: Number(norm(g.myRating)) }))
      .filter((x) => Number.isFinite(x.r))
      .sort((a, b) => b.r - a.r)
      .slice(0, 10)
      .map((x) => x.g);

    return { wishlistInView, avgIgdb, newest, topRatedThisYear };
  }, [filtered, year]);

  // ---- UI ----
  const tiles = (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`,
        gap: 12,
      }}
    >
      {filtered.map((g, i) => {
        const id = g.igdbId || `t:${titleKey(g.title)}`;
        return canDrag ? (
          <SortableTile
            key={id}
            id={id}
            title={g.title}
            coverUrl={g.coverUrl}
            tileSize={tileSize}
            onClick={() => setSelectedGame(g)}
            disabled={false}
          />
        ) : (
          <button
            key={`${id}-${i}`}
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
        );
      })}
    </div>
  );

  const statsMode = (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          gap: 12,
        }}
      >
        <Field label="Wishlist (in view)" value={statsView.wishlistInView} />
        <Field label="Avg IGDB Rating (in view)" value={statsView.avgIgdb ? statsView.avgIgdb.toFixed(1) : "—"} />
        <Field
          label="Newest Release (in view)"
          value={
            statsView.newest ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {statsView.newest.coverUrl ? (
                  <img
                    src={statsView.newest.coverUrl}
                    alt={statsView.newest.title}
                    style={{ width: 44, height: 66, borderRadius: 10, objectFit: "cover", border: `1px solid ${COLORS.border}` }}
                  />
                ) : null}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {statsView.newest.title}
                  </div>
                  <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 700 }}>
                    {statsView.newest.releaseDate || "—"}
                  </div>
                </div>
              </div>
            ) : (
              "—"
            )
          }
        />
      </div>

      {/* Top Rated Games This Year */}
      <div
        style={{
          background: "rgba(255,255,255,0.03)",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 18,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: COLORS.text }}>
            Top Rated Games This Year
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, color: COLORS.muted, whiteSpace: "nowrap" }}>
            {year}
          </div>
        </div>

        {statsView.topRatedThisYear.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
              gap: 10,
            }}
          >
            {statsView.topRatedThisYear.map((g) => (
              <button
                key={`top-${g.igdbId || titleKey(g.title)}`}
                onClick={() => setSelectedGame(g)}
                style={{
                  border: "none",
                  padding: 0,
                  background: "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                title={`${g.title} • My Rating: ${g.myRating || "—"}`}
              >
                <div
                  style={{
                    aspectRatio: "2 / 3",
                    borderRadius: 14,
                    overflow: "hidden",
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.card,
                    boxShadow: "0 14px 40px rgba(0,0,0,.45)",
                  }}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted }}>
                      No cover
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 6, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      color: COLORS.muted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      flex: 1,
                    }}
                  >
                    {g.title}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 900, color: COLORS.statNumber, flex: "0 0 auto" }}>
                    {g.myRating || "—"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 700 }}>
            No games in view tagged with <b>{year}</b> in YearPlayed and a My_Rating.
          </div>
        )}
      </div>
    </div>
  );

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

          {/* ✅ Sync bar moved here */}
          <SyncBar syncing={syncing} lastSyncAt={lastSyncAt} onResync={handleResync} error={syncError} />

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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: COLORS.muted }}>SORT</div>

              {/* Edit mode toggle */}
              <button
                onClick={() => setEditMode((v) => !v)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 12,
                  background: editMode ? "rgba(34,197,94,0.15)" : COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                  color: COLORS.text,
                  cursor: "pointer",
                  fontWeight: 900,
                  fontSize: 12,
                  whiteSpace: "nowrap",
                }}
                title="Toggle edit mode (drag & drop for Queued/Wishlist)"
              >
                {editMode ? "Edit: ON" : "Edit: OFF"}
              </button>
            </div>

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

            {savingOrder || orderError ? (
              <div style={{ marginTop: 8, fontSize: 11, color: orderError ? "#fca5a5" : COLORS.muted, fontWeight: 700 }}>
                {savingOrder ? "Saving order…" : orderError}
              </div>
            ) : null}
          </div>

          {/* Stats (locked) */}
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

          <div style={{ fontSize: 16, fontWeight: 900, color: COLORS.text, opacity: 0.95 }}>{topRightCount}</div>
        </div>

        {loading ? (
          <div>Loading…</div>
        ) : activeTab === "stats" ? (
          statsMode
        ) : canDrag ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortableIds} strategy={rectSortingStrategy}>
              {tiles}
            </SortableContext>
          </DndContext>
        ) : (
          tiles
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
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted }}>
                      No cover
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8 }}>{selectedGame.title}</div>

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

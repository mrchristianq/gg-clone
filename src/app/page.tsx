/* =====================================================================================
   Chris' Game Library
   Version: 2.2.8
   Notes:
   - Rating bubble ONLY shows on:
       1) Completed tab tiles
       2) “Top Rated Games” row in Stats
     (and only if My Rating exists and is NOT 0.0)
   - Rating formatting:
       - show 1 decimal (9.5, 8.0, etc)
       - BUT if rating is exactly 10, show "10" (no decimal)
   - Modal ratings:
       - Stars FIRST, then number to the right
       - Stars use sidebar teal (#168584) and are a bit larger
       - Stars round to nearest half-star (rating/2)
   - Modal tags:
       - Removed “Completed” pill (Completed should NOT show as a tag)
   - Stats layout:
       - Top row has 5 cards: Total, Completed, Now Playing, Queued, Wishlist
       - Second row has 3 cards:
           Newest Release in View (<= today) + cover
           Average IGDB Rating (this year games) WITH stars
           My Average Rating (this year games) WITH stars
         (exclude missing/0.0 ratings from averages)
   - NEW (2.2.6):
       - Top Rated Games: year dropdown inside same module; defaults current year
       - Top Platforms & Top Genres: interactive donut charts
       - Year Played: vertical bar chart, last 5 years, grid + labels
   - FIX (2.2.8):
       - Donut chart center total now shows TOTAL GAMES IN VIEW (not inflated by multi-tags)
       - Year Played chart now renders bars (restored positioned container)
       - My Average Rating card now uses avgMyThisYear (not selectedGame)
===================================================================================== */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { SortableContext, useSortable, rectSortingStrategy } from "@dnd-kit/sortable";
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

const VERSION = "2.2.8";

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
  statNumber: "#168584", // sidebar teal
  modalBg: "rgba(0,0,0,0.62)",
  warn: "#f59e0b",
  danger: "#ef4444",
};

const DONUT_COLORS = [
  "#60a5fa", // blue
  "#34d399", // green
  "#fbbf24", // amber
  "#f472b6", // pink
  "#a78bfa", // purple
  "#fb7185", // rose
  "#22c55e", // emerald
  "#38bdf8", // sky
  "#f97316", // orange
  "#e879f9", // fuchsia
];

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

function formatDateShort(s: string) {
  const t = toDateNum(s);
  if (!t) return "TBA";
  try {
    return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return s;
  }
}

function formatCountdown(s: string) {
  const t = toDateNum(s);
  if (!t) return "TBA";
  const now = Date.now();
  const diffDays = Math.max(0, Math.ceil((t - now) / (1000 * 60 * 60 * 24)));
  if (diffDays <= 7) return `in ${diffDays} day${diffDays === 1 ? "" : "s"}`;
  if (diffDays <= 30) {
    const weeks = Math.ceil(diffDays / 7);
    return `in ${weeks} week${weeks === 1 ? "" : "s"}`;
  }
  if (diffDays < 365) {
    const months = Math.ceil(diffDays / 30);
    return `in ${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.ceil(diffDays / 365);
  return `in ${years} year${years === 1 ? "" : "s"}`;
}

function formatDaysAgo(s: string) {
  const t = toDateNum(s);
  if (!t) return "TBA";
  const now = Date.now();
  const diffDays = Math.max(0, Math.floor((now - t) / (1000 * 60 * 60 * 24)));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "1 day ago";
  if (diffDays < 30) return `${diffDays} days ago`;
  const months = Math.floor(diffDays / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
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

/** ===== Rating helpers (bubble + modal + stats cards) ===== */
function parseMyRating10(v: string) {
  const n = Number(norm(v));
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.max(0, Math.min(10, n));
}

function formatRatingLabel(n10: number) {
  if (Math.abs(n10 - 10) < 1e-9) return "10";
  return n10.toFixed(1);
}

function ratingToStars5(n10: number) {
  const raw5 = n10 / 2;
  const rounded = Math.round(raw5 * 2) / 2;
  return Math.max(0, Math.min(5, rounded));
}

function StarIcon({
  fillPct,
  size,
  color,
}: {
  fillPct: number;
  size: number;
  color: string;
}) {
  const id = useMemo(() => `clip-${Math.random().toString(36).slice(2)}`, []);
  const w = Math.max(0, Math.min(1, fillPct));

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden style={{ display: "block" }}>
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width={24 * w} height="24" />
        </clipPath>
      </defs>

      <path
        d="M12 2.5l2.9 6.1 6.7.6-5.1 4.3 1.6 6.6-6.1-3.5-6.1 3.5 1.6-6.6-5.1-4.3 6.7-.6L12 2.5z"
        fill="none"
        stroke={color}
        strokeOpacity={0.55}
        strokeWidth="1.4"
      />

      <g clipPath={`url(#${id})`}>
        <path
          d="M12 2.5l2.9 6.1 6.7.6-5.1 4.3 1.6 6.6-6.1-3.5-6.1 3.5 1.6-6.6-5.1-4.3 6.7-.6L12 2.5z"
          fill={color}
          opacity={0.95}
        />
      </g>
    </svg>
  );
}

function StarsAndNumber({
  rating10,
  size = 18,
  numberColor = COLORS.text,
}: {
  rating10: number | null;
  size?: number;
  numberColor?: string;
}) {
  if (!rating10) return <span style={{ color: COLORS.muted }}>—</span>;

  const s5 = ratingToStars5(rating10);
  const full = Math.floor(s5);
  const half = s5 - full >= 0.5 ? 1 : 0;

  const stars: number[] = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) stars.push(1);
    else if (i === full && half) stars.push(0.5);
    else stars.push(0);
  }

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {stars.map((v, idx) => (
          <StarIcon key={idx} fillPct={v} size={size} color={COLORS.statNumber} />
        ))}
      </div>
      <div style={{ fontWeight: 950, color: numberColor }}>{formatRatingLabel(rating10)}</div>
    </div>
  );
}

/** ===== Small UI components ===== */
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
  compact = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        background: "transparent",
        color: COLORS.text,
        cursor: "pointer",
        fontSize: compact ? 12 : 16,
        fontWeight: 900,
        padding: compact ? "4px 4px" : "8px 6px",
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

/** ===== Orders ===== */
function toNumOrNaN(v: unknown) {
  const n = Number(norm(v));
  return Number.isFinite(n) ? n : NaN;
}

function compareOrderThenReleaseDesc(aOrderRaw: string, bOrderRaw: string, aRel: string, bRel: string) {
  const a = toNumOrNaN(aOrderRaw);
  const b = toNumOrNaN(bOrderRaw);

  const aHas = Number.isFinite(a);
  const bHas = Number.isFinite(b);

  if (aHas && bHas) {
    if (a !== b) return a - b;
    return toDateNum(bRel) - toDateNum(aRel);
  }
  if (aHas && !bHas) return -1;
  if (!aHas && bHas) return 1;

  return toDateNum(bRel) - toDateNum(aRel);
}

/** ===== Tiles ===== */
function SortableTile({
  id,
  title,
  coverUrl,
  disabled,
  onClick,
  overlayRating,
}: {
  id: string;
  title: string;
  coverUrl: string;
  tileSize: number;
  disabled: boolean;
  onClick: () => void;
  overlayRating?: number | null;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <button
        onClick={onClick}
        style={{
          border: "none",
          padding: 0,
          background: "transparent",
          cursor: disabled ? "pointer" : "grab",
          textAlign: "left",
          width: "100%",
        }}
        title={title}
        {...attributes}
        {...listeners}
      >
        <div
          style={{
            position: "relative",
            aspectRatio: "2 / 3",
            background: COLORS.card,
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 20px 40px rgba(0,0,0,.6)",
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

          {overlayRating != null ? (
            <div
              style={{
                position: "absolute",
                top: 6,
                right: 6,
                padding: "3px 6px",
                borderRadius: 10,
                background: "rgba(5,10,18,0.55)",
                border: "1px solid rgba(255,255,255,0.12)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
                color: "rgba(255,255,255,0.92)",
                fontSize: 11,
                fontWeight: 950,
                letterSpacing: "0.02em",
                lineHeight: 1,
                boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
                pointerEvents: "none",
              }}
              aria-label={`My rating ${formatRatingLabel(overlayRating)}`}
              title={`My rating ${formatRatingLabel(overlayRating)}`}
            >
              {formatRatingLabel(overlayRating)}
            </div>
          ) : null}
        </div>
      </button>
    </div>
  );
}

function HomeTile({
  title,
  coverUrl,
  meta,
  size = 150,
  onClick,
}: {
  title: string;
  coverUrl: string;
  meta?: string;
  size?: number | string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        border: "none",
        padding: 0,
        background: "transparent",
        cursor: "pointer",
        textAlign: "left",
        width: size,
      }}
      title={title}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "2 / 3",
          background: COLORS.card,
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 18px 40px rgba(0,0,0,.55)",
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

        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            padding: "10px 10px 8px",
            background: "linear-gradient(180deg, rgba(3,6,10,0) 0%, rgba(3,6,10,0.8) 70%)",
          }}
        >
          <div style={{ color: "white", fontSize: 12, fontWeight: 800, textShadow: "0 2px 10px rgba(0,0,0,.6)" }}>
            {title}
          </div>
          {meta ? <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 11, marginTop: 2 }}>{meta}</div> : null}
        </div>
      </div>
    </button>
  );
}

function HomeSection({
  title,
  subtitle,
  count,
  children,
}: {
  title: string;
  subtitle?: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{title}</div>
          {subtitle ? <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>{subtitle}</div> : null}
        </div>
        {typeof count === "number" ? <CountBadge n={count} /> : null}
      </div>
      {children}
    </section>
  );
}

/** ===== Stats UI ===== */
function StatCard({
  title,
  value,
  subtitle,
  rightSlot,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {title}
        </div>
        {rightSlot ? <div style={{ flex: "0 0 auto" }}>{rightSlot}</div> : null}
      </div>

      <div style={{ marginTop: 8, fontSize: 26, fontWeight: 950, color: COLORS.statNumber, lineHeight: 1 }}>
        {value}
      </div>

      {subtitle ? <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 12, fontWeight: 650 }}>{subtitle}</div> : null}
    </div>
  );
}

function TopRatedRow({
  title,
  items,
  year,
  yearOptions,
  onYearChange,
}: {
  title: string;
  items: Array<{ title: string; coverUrl: string; onClick: () => void; overlayRating?: number | null }>;
  year: string;
  yearOptions: string[];
  onYearChange: (y: string) => void;
}) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
          {title}
        </div>

        <select
          value={year}
          onChange={(e) => onYearChange(e.target.value)}
          style={{
            borderRadius: 999,
            padding: "6px 10px",
            border: `1px solid ${COLORS.border}`,
            background: "rgba(255,255,255,0.04)",
            color: COLORS.text,
            fontSize: 12,
            fontWeight: 900,
            cursor: "pointer",
          }}
          aria-label="Select year for Top Rated"
          title="Select year"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>

      {items.length ? (
        <>
          <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "nowrap", alignItems: "stretch" }}>
            {items.slice(0, 5).map((g, i) => (
              <button
                key={`${g.title}-${i}`}
                onClick={g.onClick}
                title={g.title}
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  border: `1px solid ${COLORS.border}`,
                  background: COLORS.card,
                  borderRadius: 14,
                  overflow: "hidden",
                  padding: 0,
                  cursor: "pointer",
                  boxShadow: "0 18px 45px rgba(0,0,0,.45)",
                  aspectRatio: "2 / 3",
                  position: "relative",
                }}
              >
                {g.coverUrl ? (
                  <img
                    src={g.coverUrl}
                    alt={g.title}
                    loading="lazy"
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontSize: 12 }}>
                    No cover
                  </div>
                )}

                {g.overlayRating != null ? (
                  <div
                    style={{
                      position: "absolute",
                      top: 6,
                      right: 6,
                      padding: "3px 6px",
                      borderRadius: 10,
                      background: "rgba(5,10,18,0.55)",
                      border: "1px solid rgba(255,255,255,0.12)",
                      backdropFilter: "blur(8px)",
                      WebkitBackdropFilter: "blur(8px)",
                      color: "rgba(255,255,255,0.92)",
                      fontSize: 11,
                      fontWeight: 950,
                      letterSpacing: "0.02em",
                      lineHeight: 1,
                      boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
                      pointerEvents: "none",
                    }}
                  >
                    {formatRatingLabel(g.overlayRating)}
                  </div>
                ) : null}
              </button>
            ))}
          </div>

          {items.length > 5 ? (
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "nowrap", alignItems: "stretch" }}>
              {items.slice(5, 10).map((g, i) => (
                <button
                  key={`${g.title}-row2-${i}`}
                  onClick={g.onClick}
                  title={g.title}
                  style={{
                    flex: "1 1 0",
                    minWidth: 0,
                    border: `1px solid ${COLORS.border}`,
                    background: COLORS.card,
                    borderRadius: 14,
                    overflow: "hidden",
                    padding: 0,
                    cursor: "pointer",
                    boxShadow: "0 18px 45px rgba(0,0,0,.45)",
                    aspectRatio: "2 / 3",
                    position: "relative",
                  }}
                >
                  {g.coverUrl ? (
                    <img
                      src={g.coverUrl}
                      alt={g.title}
                      loading="lazy"
                      style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                    />
                  ) : (
                    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontSize: 12 }}>
                      No cover
                    </div>
                  )}

                  {g.overlayRating != null ? (
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        padding: "3px 6px",
                        borderRadius: 10,
                        background: "rgba(5,10,18,0.55)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        backdropFilter: "blur(8px)",
                        WebkitBackdropFilter: "blur(8px)",
                        color: "rgba(255,255,255,0.92)",
                        fontSize: 11,
                        fontWeight: 950,
                        letterSpacing: "0.02em",
                        lineHeight: 1,
                        boxShadow: "0 10px 22px rgba(0,0,0,0.35)",
                        pointerEvents: "none",
                      }}
                    >
                      {formatRatingLabel(g.overlayRating)}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ marginTop: 12, color: COLORS.muted, fontSize: 12 }}>
          No rated games for this year in the current view.
        </div>
      )}
    </div>
  );
}

/** ===== Donut Chart (interactive hover updates center text) ===== */
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180.0;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${start.x} ${
     start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

function DonutChart({
  title,
  items,
  totalGames,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
  totalGames: number;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const total = items.reduce((s, x) => s + x.count, 0);
  const top = items[0];

  const size = 320;
  const cx = size / 2;
  const cy = size / 2;
  const r = 118;
  const stroke = 26;

  let currentAngle = 0;
  const slices = items.map((it, idx) => {
    const pct = total ? it.count / total : 0;
    const angle = pct * 360;
    const start = currentAngle;
    const end = currentAngle + angle;
    currentAngle += angle;

    return {
      ...it,
      idx,
      start,
      end,
      color: DONUT_COLORS[idx % DONUT_COLORS.length],
    };
  });

  const active = hoverIdx != null ? slices[hoverIdx] : null;

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div
        style={{
          color: COLORS.muted,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>

      <div
        style={{
          marginTop: 12,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          alignItems: "center",
        }}
      >
        <div style={{ position: "relative", width: "100%", maxWidth: 340, justifySelf: "center" }}>
          <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            style={{ display: "block", margin: "0 auto" }}
          >
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth={stroke}
            />

            {slices.map((s) => {
              if (s.count <= 0) return null;

              const path = describeArc(cx, cy, r, s.start, s.end);
              const isActive = hoverIdx === s.idx;

              return (
                <path
                  key={s.label}
                  d={path}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={stroke}
                  strokeLinecap="butt"
                  opacity={isActive ? 1 : 0.9}
                  onMouseEnter={() => setHoverIdx(s.idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  style={{
                    cursor: "pointer",
                    filter: isActive
                      ? "drop-shadow(0 10px 18px rgba(0,0,0,0.55))"
                      : "none",
                  }}
                />
              );
            })}

            <circle
              cx={cx}
              cy={cy}
              r={r - stroke / 2 - 10}
              fill={COLORS.panel}
            />
          </svg>

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  marginTop: 2,
                  color: COLORS.text,
                  fontSize: 28,
                  fontWeight: 950,
                }}
              >
                {active ? active.count : totalGames}
              </div>
              <div style={{ marginTop: 6, color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>
                {active ? active.label : "Total Games"}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          {items.length ? (
            items.slice(0, 10).map((it, idx) => {
              const color = DONUT_COLORS[idx % DONUT_COLORS.length];
              const isActive = hoverIdx === idx;

              return (
                <div
                  key={it.label}
                  onMouseEnter={() => setHoverIdx(idx)}
                  onMouseLeave={() => setHoverIdx(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "4px 8px",
                    borderRadius: 12,
                    border: `1px solid ${COLORS.border}`,
                    background: isActive
                      ? "rgba(255,255,255,0.04)"
                      : "rgba(255,255,255,0.02)",
                    cursor: "pointer",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: 999,
                      background: color,
                      flex: "0 0 auto",
                    }}
                  />
                  <div
                    style={{
                      color: COLORS.text,
                      fontSize: 12,
                      fontWeight: 800,
                      whiteSpace: "normal",
                      overflow: "visible",
                      textOverflow: "clip",
                      flex: "1 1 auto",
                      minWidth: 0,
                    }}
                    title={it.label}
                  >
                    {it.label}
                  </div>
                  <div
                    style={{
                      color: COLORS.muted,
                      fontSize: 12,
                      fontWeight: 900,
                      flex: "0 0 auto",
                    }}
                  >
                    {it.count}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ color: COLORS.muted, fontSize: 12 }}>No data.</div>
          )}

          {top ? (
            <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 12, fontWeight: 650 }}>
              Most common:{" "}
              <span style={{ color: COLORS.text, fontWeight: 900 }}>
                {top.label}
              </span>{" "}
              ({top.count})
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** ===== Years Played vertical bar chart (last 5 years) ===== */
function YearsPlayedChart({ items }: { items: Array<{ label: string; count: number }> }) {
  const numeric = items
    .map((x) => ({ ...x, y: Number(x.label) }))
    .filter((x) => Number.isFinite(x.y))
    .sort((a, b) => b.y - a.y);

  const last5 = numeric.slice(0, 5).reverse();

  const max = Math.max(1, ...last5.map((x) => x.count));
  const gridStep = max <= 10 ? 2 : max <= 25 ? 5 : 10;
  const gridLines: number[] = [];
  for (let v = 0; v <= max; v += gridStep) gridLines.push(v);

  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div
        style={{
          color: COLORS.muted,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Games Played Per Year (Last 5 Years)
      </div>

      <div
        style={{
          marginTop: 12,
          position: "relative",
          height: 220,
          borderRadius: 14,
          background: "rgba(255,255,255,0.02)",
          border: `1px solid ${COLORS.border}`,
          overflow: "hidden",
        }}
      >
        {gridLines.map((v) => {
          const pct = (v / max) * 100;
          return (
            <div
              key={v}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${pct}%`,
                height: 1,
                background: "rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 10,
                  bottom: 4,
                  color: "rgba(255,255,255,0.28)",
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {v}
              </div>
            </div>
          );
        })}

        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            gridTemplateColumns: `repeat(${Math.max(1, last5.length)}, 1fr)`,
            gap: 14,
            padding: "14px 16px",
            alignItems: "end",
          }}
        >
          {last5.length ? (
            last5.map((x) => {
              const hPct = (x.count / max) * 100;
              return (
                <div
                  key={x.label}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    height: "100%",
                    justifyContent: "flex-end",
                    gap: 8,
                  }}
                >
                  <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 900 }}>
                    {x.count}
                  </div>

                  <div
                    style={{
                      width: "100%",
                      maxWidth: 72,
                      height: `${Math.max(6, hPct)}%`,
                      borderRadius: 6,
                      background: COLORS.statNumber,
                      opacity: 0.8,
                      boxShadow: "0 18px 40px rgba(0,0,0,.35)",
                    }}
                    title={`${x.label}: ${x.count}`}
                  />

                  <div style={{ color: COLORS.text, fontSize: 12, fontWeight: 900 }}>
                    {x.label}
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ color: COLORS.muted, fontSize: 12 }}>No year data.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** ===== Newest release card with cover (<= today) ===== */
function NewestReleaseCard({
  title,
  game,
}: {
  title: string;
  game: { title: string; coverUrl: string; releaseDate: string } | null;
}) {
  return (
    <div
      style={{
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: 14,
        minWidth: 0,
      }}
    >
      <div
        style={{
          color: COLORS.muted,
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>

      {game ? (
        <div style={{ marginTop: 12, display: "flex", gap: 12, alignItems: "center" }}>
          <div
            style={{
              width: 56,
              height: 84,
              borderRadius: 12,
              overflow: "hidden",
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
              flex: "0 0 auto",
              boxShadow: "0 18px 45px rgba(0,0,0,.45)",
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
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: COLORS.muted,
                  fontSize: 11,
                }}
              >
                —
              </div>
            )}
          </div>

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: COLORS.text,
                fontSize: 14,
                fontWeight: 950,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {game.title}
            </div>
            <div style={{ marginTop: 6, color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>
              {game.releaseDate || "—"}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, color: COLORS.muted, fontSize: 12 }}>
          No releases in view.
        </div>
      )}
    </div>
  );
}

// ---- paste the next chunk you have after this line (it should be: `export default function HomePage() {`)
// and I’ll continue from there cleanly.
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
    "home" | "games" | "nowPlaying" | "queued" | "wishlist" | "completed" | "stats"
  >("home");

  const [sortBy, setSortBy] = useState<"title" | "releaseDate" | "dateCompleted" | "dateAdded" | "queuedOrder" | "wishlistOrder">(
    "releaseDate"
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [openPlatform, setOpenPlatform] = useState(false);
  const [openStatus, setOpenStatus] = useState(false);
  const [openOwnership, setOpenOwnership] = useState(false);
  const [openFormat, setOpenFormat] = useState(false);
  const [openYearsPlayed, setOpenYearsPlayed] = useState(false);
  const [openGenres, setOpenGenres] = useState(false);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState<Game | null>(null);

  const [editMode, setEditMode] = useState(false);
  const [syncState, setSyncState] = useState<"idle" | "saving" | "ok" | "error">("idle");
  const [syncMsg, setSyncMsg] = useState<string>("");
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const currentYear = String(new Date().getFullYear());
  const [topRatedYear, setTopRatedYear] = useState<string>(currentYear);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");

    const apply = () => {
      const m = mq.matches;
      setIsMobile(m);
      setTileSize(m ? 80 : 120);
    };

    apply();

    const onChange = () => apply();

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }

    (mq as any).addListener?.(onChange);
    return () => (mq as any).removeListener?.(onChange);
  }, []);

  async function fetchCsvNow() {
    if (!csvUrl) return;

    setLoading(true);
    setSyncState("saving");
    setSyncMsg("Syncing…");

    try {
      const res = await fetch(csvUrl, { cache: "no-store" });
      const text = await res.text();
      const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
      const mapped = (parsed.data as Row[]).map(rowToGame).filter(Boolean) as Game[];

      setGames(dedupeByTitle(mapped));
      setLastSyncAt(Date.now());
      setSyncState("ok");
      setSyncMsg("Synced");
    } catch (e: any) {
      setSyncState("error");
      setSyncMsg(e?.message || "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCsvNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [csvUrl, refreshNonce]);

  useEffect(() => {
    if (activeTab === "queued") {
      setSortBy("queuedOrder");
      setSortDir("asc");
    } else if (activeTab === "wishlist") {
      setSortBy("wishlistOrder");
      setSortDir("asc");
    } else if (activeTab === "completed") {
      setSortBy("dateCompleted");
      setSortDir("desc");
    }

    if (activeTab !== "queued" && activeTab !== "wishlist") setEditMode(false);
  }, [activeTab]);

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

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    const base = games.filter((g) => {
      if (query && !g.title.toLowerCase().includes(query)) return false;

      if (activeTab === "games" && norm(g.ownership) === "Wishlist") return false;

      if (activeTab === "nowPlaying" && norm(g.status) !== "Now Playing") return false;
      if (activeTab === "queued" && norm(g.status) !== "Queued") return false;
      if (activeTab === "wishlist" && norm(g.ownership) !== "Wishlist") return false;
      if (activeTab === "completed" && !toBool(g.completed)) return false;

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

    const dir = sortDir === "asc" ? 1 : -1;

    return base.sort((a, b) => {
      if (sortBy === "queuedOrder") return compareOrderThenReleaseDesc(a.queuedOrder, b.queuedOrder, a.releaseDate, b.releaseDate);
      if (sortBy === "wishlistOrder") return compareOrderThenReleaseDesc(a.wishlistOrder, b.wishlistOrder, a.releaseDate, b.releaseDate);

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

  const platformCounts = useMemo(() => countByTagList(filtered, (g) => g.platform), [filtered]);
  const statusCounts = useMemo(() => countByKey(filtered, (g) => g.status), [filtered]);
  const ownershipCounts = useMemo(() => countByKey(filtered, (g) => g.ownership), [filtered]);
  const formatCounts = useMemo(() => countByKey(filtered, (g) => g.format), [filtered]);
  const yearsPlayedCounts = useMemo(() => countByTagList(filtered, (g) => g.yearPlayed), [filtered]);
  const genreCounts = useMemo(() => countByTagList(filtered, (g) => g.genres), [filtered]);

  const gamesTotal = games.filter((g) => norm(g.ownership) !== "Wishlist").length;
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
    minWidth: 340,
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

  const dragIds = useMemo(() => filtered.map((g) => (g.igdbId ? `igdb:${g.igdbId}` : `t:${titleKey(g.title)}`)), [filtered]);

  const idToGame = useMemo(() => {
    const m = new Map<string, Game>();
    filtered.forEach((g) => {
      const id = g.igdbId ? `igdb:${g.igdbId}` : `t:${titleKey(g.title)}`;
      m.set(id, g);
    });
    return m;
  }, [filtered]);

  const reorderAllowed = editMode && (activeTab === "queued" || activeTab === "wishlist");

  const homeData = useMemo(() => {
    const base = filtered;
    const today = Date.now();
    const days90 = 1000 * 60 * 60 * 24 * 90;

    const nowPlaying = base
      .filter((g) => norm(g.status) === "Now Playing")
      .sort((a, b) => a.title.localeCompare(b.title));

    const recentlyCompleted = base
      .filter((g) => toBool(g.completed))
      .filter((g) => toDateNum(g.dateCompleted))
      .sort((a, b) => toDateNum(b.dateCompleted) - toDateNum(a.dateCompleted));

    const upcomingWishlist = base
      .filter((g) => norm(g.ownership) === "Wishlist")
      .filter((g) => {
        const t = toDateNum(g.releaseDate);
        return t && t > today;
      })
      .sort((a, b) => toDateNum(a.releaseDate) - toDateNum(b.releaseDate));

    const recentlyReleased = base
      .filter((g) => {
        const t = toDateNum(g.releaseDate);
        return t && t <= today && t >= today - days90;
      })
      .sort((a, b) => toDateNum(b.releaseDate) - toDateNum(a.releaseDate));

    return {
      nowPlaying,
      recentlyCompleted,
      upcomingWishlist,
      recentlyReleased,
    };
  }, [filtered]);

  function formatLastSync(ts: number | null) {
    if (!ts) return "—";
    try {
      return new Date(ts).toLocaleString();
    } catch {
      return "—";
    }
  }

  async function saveOrderToSheet(nextIds: string[]) {
    const orderType = activeTab === "queued" ? "queued" : activeTab === "wishlist" ? "wishlist" : "";
    if (!orderType) return;

    const orderedIgdbIds = nextIds
      .map((id) => (id.startsWith("igdb:") ? id.slice("igdb:".length) : ""))
      .filter(Boolean);

    if (!orderedIgdbIds.length) throw new Error("No IGDB_ID values found to save order.");

    const res = await fetch("/sheets/update-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tabName: "Web",
        orderType,
        orderedIgdbIds,
      }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Order save failed.");
  }

  async function handleDragEnd(e: DragEndEvent) {
    if (!reorderAllowed) return;

    const { active, over } = e;
    if (!over || active.id === over.id) return;

    const oldIndex = dragIds.indexOf(String(active.id));
    const newIndex = dragIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const next = arrayMove(dragIds, oldIndex, newIndex);

    const orderType = activeTab === "queued" ? "queued" : "wishlist";
    const nextIgdbIds = next
      .map((id) => (id.startsWith("igdb:") ? id.slice("igdb:".length) : ""))
      .filter(Boolean);

    setGames((prev) => {
      const rank = new Map<string, number>();
      nextIgdbIds.forEach((igdbId, idx) => rank.set(igdbId, idx + 1));

      return prev.map((g) => {
        const r = g.igdbId ? rank.get(g.igdbId) : undefined;
        if (!r) return g;
        if (orderType === "queued") return { ...g, queuedOrder: String(r) };
        return { ...g, wishlistOrder: String(r) };
      });
    });

    setSyncState("saving");
    setSyncMsg("Saving…");
    try {
      await saveOrderToSheet(next);
      setSyncState("ok");
      setSyncMsg("Saved");
      setLastSyncAt(Date.now());
    } catch (err: any) {
      setSyncState("error");
      setSyncMsg(err?.message || "Save failed");
    }
  }

  const statsData = useMemo(() => {
    const total = filtered.length;

    const completedInView = filtered.filter((g) => toBool(g.completed)).length;
    const nowPlayingInView = filtered.filter((g) => norm(g.status) === "Now Playing").length;
    const queuedInView = filtered.filter((g) => norm(g.status) === "Queued").length;
    const wishlistInView = filtered.filter((g) => norm(g.ownership) === "Wishlist").length;

    const byPlatform = Array.from(countByTagList(filtered, (g) => g.platform).entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const byGenre = Array.from(countByTagList(filtered, (g) => g.genres).entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    const byYearPlayed = Array.from(countByTagList(filtered, (g) => g.yearPlayed).entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        const an = Number(a.label);
        const bn = Number(b.label);
        if (Number.isFinite(an) && Number.isFinite(bn)) return bn - an;
        return b.count - a.count || a.label.localeCompare(b.label);
      });

    const today = Date.now();

    const newestUpToToday = filtered
      .slice()
      .filter((g) => {
        const t = toDateNum(g.releaseDate);
        if (!t) return false;
        return t <= today;
      })
      .sort((a, b) => toDateNum(b.releaseDate) - toDateNum(a.releaseDate))[0];

    const thisYear = String(new Date().getFullYear());

    const thisYearGames = filtered.filter((g) => g.yearPlayed.includes(thisYear));

    const igdbRatings = thisYearGames
      .map((g) => Number(norm(g.igdbRating)))
      .filter((n) => Number.isFinite(n) && n > 0);

    const myRatings10 = thisYearGames
      .map((g) => Number(norm(g.myRating)))
      .filter((n) => Number.isFinite(n) && n > 0);

    const avgIgdbThisYear = igdbRatings.length
      ? Math.round((igdbRatings.reduce((s, n) => s + n, 0) / igdbRatings.length) * 10) / 10
      : null;

    const avgMyThisYear = myRatings10.length
      ? Math.round((myRatings10.reduce((s, n) => s + n, 0) / myRatings10.length) * 10) / 10
      : null;

    const yearOptions = uniqueSorted(filtered.flatMap((g) => g.yearPlayed))
      .filter((y) => /^\d{4}$/.test(y))
      .sort((a, b) => Number(b) - Number(a));

    const effectiveYear = yearOptions.includes(topRatedYear) ? topRatedYear : thisYear;

    const yearGames = filtered.filter((g) => g.yearPlayed.includes(effectiveYear));

    const topRatedForYear = yearGames
      .map((g) => ({ g, r: parseMyRating10(g.myRating) }))
      .filter((x) => x.r != null)
      .sort(
        (a, b) =>
          (b.r as number) - (a.r as number) ||
          toDateNum(b.g.releaseDate) - toDateNum(a.g.releaseDate) ||
          a.g.title.localeCompare(b.g.title)
      )
      .slice(0, 10)
      .map((x) => x.g);

    return {
      total,
      completedInView,
      nowPlayingInView,
      queuedInView,
      wishlistInView,
      byPlatform,
      byGenre,
      byYearPlayed,
      newestGame: newestUpToToday
        ? { title: newestUpToToday.title, coverUrl: newestUpToToday.coverUrl, releaseDate: newestUpToToday.releaseDate }
        : null,
      avgIgdbThisYear,
      avgMyThisYear,
      igdbRatedCountThisYear: igdbRatings.length,
      myRatedCountThisYear: myRatings10.length,
      yearOptions,
      effectiveYear,
      topRatedForYear,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, topRatedYear]);

  function SyncBar() {
    return (
      <div
        style={{
          marginTop: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 14,
          background: COLORS.card,
          border: `1px solid ${COLORS.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              background:
                syncState === "saving"
                  ? COLORS.warn
                  : syncState === "ok"
                  ? COLORS.accent
                  : syncState === "error"
                  ? COLORS.danger
                  : COLORS.muted,
              opacity: 0.9,
              flex: "0 0 auto",
            }}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ color: COLORS.text, fontSize: 12, fontWeight: 900 }}>
                {syncState === "saving" ? "Syncing" : syncState === "ok" ? "Synced" : syncState === "error" ? "Error" : "Idle"}
              </div>
              <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>
                {lastSyncAt ? formatLastSync(lastSyncAt) : "—"}
              </div>
            </div>
            {syncState === "error" && syncMsg ? (
              <div style={{ color: COLORS.danger, fontSize: 11, fontWeight: 800, marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {syncMsg}
              </div>
            ) : null}
          </div>
        </div>

        <button
          onClick={() => setRefreshNonce((n) => n + 1)}
          style={{
            border: `1px solid ${COLORS.border}`,
            background: "rgba(255,255,255,0.04)",
            color: COLORS.text,
            borderRadius: 999,
            padding: "7px 10px",
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 900,
            flex: "0 0 auto",
            whiteSpace: "nowrap",
          }}
          title="Re-sync (re-fetch CSV)"
        >
          Re-sync
        </button>
      </div>
    );
  }

  const topRightCountBubble = (
    <div
      title={`${topRightCount} items in view`}
      style={{
        height: 34,
        padding: "0 12px",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: COLORS.card,
        border: `1px solid ${COLORS.border}`,
        color: COLORS.text,
        fontSize: 13,
        fontWeight: 950,
      }}
    >
      {topRightCount}
    </div>
  );

  const homeRowStyle: React.CSSProperties = isMobile
    ? { display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))`, gap: 10 }
    : { display: "flex", gap: 14, overflowX: "auto", paddingBottom: 4 };

  const mobileTabs = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <TabButton label="Home" active={activeTab === "home"} onClick={() => setActiveTab("home")} compact />
      <TabButton label="All Games" active={activeTab === "games"} onClick={() => setActiveTab("games")} compact />
      <TabButton label="Now Playing" active={activeTab === "nowPlaying"} onClick={() => setActiveTab("nowPlaying")} compact />
      <TabButton label="Queued" active={activeTab === "queued"} onClick={() => setActiveTab("queued")} compact />
      <TabButton label="Wishlist" active={activeTab === "wishlist"} onClick={() => setActiveTab("wishlist")} compact />
      <TabButton label="Completed" active={activeTab === "completed"} onClick={() => setActiveTab("completed")} compact />
      <TabButton label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} compact />
    </div>
  );
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: COLORS.bg, color: COLORS.text }}>
      <style>{`
        aside::-webkit-scrollbar { display: none; }
        body::-webkit-scrollbar { display: none; }
        body { scrollbar-width: none; }

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
          .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.55); z-index: 40; }
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
          .statsGrid5 { grid-template-columns: 1fr !important; }
          .statsGrid3 { grid-template-columns: 1fr !important; }
          .statsGrid2 { grid-template-columns: 1fr !important; }
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

          <SyncBar />

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            style={{
              width: "100%",
              marginTop: 12,
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
                <option value="title">Title</option>
                <option value="releaseDate">Release Date</option>
                <option value="dateAdded">Date Added</option>
                <option value="dateCompleted">Date Completed</option>
                <option value="queuedOrder">Queued Order</option>
                <option value="wishlistOrder">Wishlist Order</option>
              </SmallSelect>

              <SmallSelect value={sortDir} onChange={(v) => setSortDir(v as "asc" | "desc")}>
                <option value="asc">Asc</option>
                <option value="desc">Desc</option>
              </SmallSelect>
            </div>
          </div>

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
              min={75}
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

        <div style={{ marginTop: 18, fontSize: 11, color: COLORS.muted, opacity: 0.8 }}>Version {VERSION}</div>
      </aside>

      <main style={{ flex: 1, padding: 18 }}>
        {/* Mobile topbar */}
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

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>Items</div>
              <div style={{ color: COLORS.text, fontSize: 12, fontWeight: 950 }}>{topRightCount}</div>
            </div>
          </div>
        </div>

        {/* Desktop tabs + bubble; Mobile uses 2-line tabs */}
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
          <div className="desktopOnly" style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <TabButton label="Home" active={activeTab === "home"} onClick={() => setActiveTab("home")} />
            <TabButton label="All Games" active={activeTab === "games"} onClick={() => setActiveTab("games")} />
            <TabButton label="Now Playing" active={activeTab === "nowPlaying"} onClick={() => setActiveTab("nowPlaying")} />
            <TabButton label="Queued" active={activeTab === "queued"} onClick={() => setActiveTab("queued")} />
            <TabButton label="Wishlist" active={activeTab === "wishlist"} onClick={() => setActiveTab("wishlist")} />
            <TabButton label="Completed" active={activeTab === "completed"} onClick={() => setActiveTab("completed")} />
            <TabButton label="Stats" active={activeTab === "stats"} onClick={() => setActiveTab("stats")} />
          </div>

          <div className="mobileOnly" style={{ width: "100%" }}>
            {mobileTabs}
          </div>

          <div className="desktopOnly" style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {(activeTab === "queued" || activeTab === "wishlist") && (
              <button
                onClick={() => setEditMode((v) => !v)}
                style={{
                  border: `1px solid ${COLORS.border}`,
                  background: editMode ? "rgba(34,197,94,0.16)" : COLORS.card,
                  color: COLORS.text,
                  borderRadius: 12,
                  padding: "10px 12px",
                  cursor: "pointer",
                  fontWeight: 900,
                  fontSize: 12,
                }}
                title="Toggle drag+drop ordering"
              >
                {editMode ? "Edit Mode: ON" : "Edit Mode: OFF"}
              </button>
            )}

            {topRightCountBubble}
          </div>
        </div>

        {loading ? (
          <div>Loading…</div>
        ) : activeTab === "home" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <HomeSection title="Now Playing">
              <div style={homeRowStyle}>
                {homeData.nowPlaying.length ? (
                  homeData.nowPlaying.slice(0, 5).map((g, i) => (
                    <HomeTile
                      key={`${g.title}-${i}`}
                      title={g.title}
                      coverUrl={g.coverUrl}
                      size={isMobile ? "100%" : 130}
                      onClick={() => setSelectedGame(g)}
                    />
                  ))
                ) : (
                  <div style={{ color: COLORS.muted, fontSize: 12 }}>No games in progress.</div>
                )}
              </div>
            </HomeSection>

            <HomeSection title="Recently Completed">
              <div style={homeRowStyle}>
                {homeData.recentlyCompleted.length ? (
                  homeData.recentlyCompleted.slice(0, 5).map((g, i) => (
                    <HomeTile
                      key={`${g.title}-${i}`}
                      title={g.title}
                      coverUrl={g.coverUrl}
                      size={isMobile ? "100%" : 120}
                      onClick={() => setSelectedGame(g)}
                    />
                  ))
                ) : (
                  <div style={{ color: COLORS.muted, fontSize: 12 }}>No recent completions.</div>
                )}
              </div>
            </HomeSection>

            <HomeSection title="Upcoming">
              <div style={homeRowStyle}>
                {homeData.upcomingWishlist.length ? (
                  homeData.upcomingWishlist.slice(0, 5).map((g, i) => (
                    <HomeTile
                      key={`${g.title}-${i}`}
                      title={g.title}
                      coverUrl={g.coverUrl}
                      meta={g.releaseDate ? formatCountdown(g.releaseDate) : undefined}
                      size={isMobile ? "100%" : 120}
                      onClick={() => setSelectedGame(g)}
                    />
                  ))
                ) : (
                  <div style={{ color: COLORS.muted, fontSize: 12 }}>No upcoming wishlist games.</div>
                )}
              </div>
            </HomeSection>

            <HomeSection title="New Releases">
              <div style={homeRowStyle}>
                {homeData.recentlyReleased.length ? (
                  homeData.recentlyReleased.slice(0, 5).map((g, i) => (
                    <HomeTile
                      key={`${g.title}-${i}`}
                      title={g.title}
                      coverUrl={g.coverUrl}
                      size={isMobile ? "100%" : 120}
                      onClick={() => setSelectedGame(g)}
                    />
                  ))
                ) : (
                  <div style={{ color: COLORS.muted, fontSize: 12 }}>No recent releases.</div>
                )}
              </div>
            </HomeSection>
          </div>
        ) : activeTab === "stats" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="statsGrid5" style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 12 }}>
              <StatCard title="Total games" value={statsData.total} subtitle="Respects facets + search" />
              <StatCard title="Completed" value={statsData.completedInView} />
              <StatCard title="Now Playing" value={statsData.nowPlayingInView} />
              <StatCard title="Queued" value={statsData.queuedInView} />
              <StatCard title="Wishlist" value={statsData.wishlistInView} />
            </div>

            <div className="statsGrid3" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
              <NewestReleaseCard title="Newest release in view" game={statsData.newestGame} />

              <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, minWidth: 0 }}>
                <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  Average IGDB Rating (this year)
                </div>
                <div style={{ marginTop: 12 }}>
                  <StarsAndNumber
                    rating10={statsData.avgIgdbThisYear != null ? Math.max(0, Math.min(10, statsData.avgIgdbThisYear)) : null}
                    size={19}
                  />
                </div>
                <div style={{ marginTop: 10, color: COLORS.muted, fontSize: 12, fontWeight: 650 }}>
                  {statsData.avgIgdbThisYear ? `${statsData.igdbRatedCountThisYear} rated this year` : "No rated this year"}
                </div>
              </div>

              <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, minWidth: 0 }}>
                <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                  My Average Rating (this year)
                </div>
                <div style={{ marginTop: 12 }}>
                  <StarsAndNumber rating10={statsData.avgMyThisYear != null ? statsData.avgMyThisYear : null} size={19} />
                </div>
                <div style={{ marginTop: 10, color: COLORS.muted, fontSize: 12, fontWeight: 650 }}>
                  {statsData.avgMyThisYear ? `${statsData.myRatedCountThisYear} rated this year` : "No rated this year"}
                </div>
              </div>
            </div>

            <TopRatedRow
              title="Top Rated Games"
              year={statsData.effectiveYear}
              yearOptions={statsData.yearOptions.length ? statsData.yearOptions : [currentYear]}
              onYearChange={(y) => setTopRatedYear(y)}
              items={statsData.topRatedForYear.map((g) => ({
                title: g.title,
                coverUrl: g.coverUrl,
                onClick: () => setSelectedGame(g),
                overlayRating: parseMyRating10(g.myRating),
              }))}
            />

            <div className="statsGrid2" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>
              <DonutChart title="Top Platforms" items={statsData.byPlatform} totalGames={statsData.total} />
              <DonutChart title="Top Genres" items={statsData.byGenre} totalGames={statsData.total} />
            </div>

            <YearsPlayedChart items={statsData.byYearPlayed} />
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={dragIds} strategy={rectSortingStrategy}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 75 : tileSize}px, 1fr))`,
                  gap: isMobile ? 10 : 12,
                }}
              >
                {dragIds.map((id) => {
                  const g = idToGame.get(id);
                  if (!g) return null;

                  const overlayRating = activeTab === "completed" ? parseMyRating10(g.myRating) : null;

                  return (
                    <SortableTile
                      key={id}
                      id={id}
                      title={g.title}
                      coverUrl={g.coverUrl}
                      tileSize={tileSize}
                      disabled={!reorderAllowed}
                      onClick={() => setSelectedGame(g)}
                      overlayRating={overlayRating ?? undefined}
                    />
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </main>

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

            <div className="modalStack" style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
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
                  </div>
                </div>
              </div>

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

                  <Field
                    label="IGDB Rating"
                    value={(() => {
                      const n = Number(norm(selectedGame.igdbRating));
                      const n10 = Number.isFinite(n) && n > 0 ? Math.max(0, Math.min(10, n)) : null;
                      return <StarsAndNumber rating10={n10} size={19} />;
                    })()}
                  />
                  <Field label="My Rating" value={<StarsAndNumber rating10={parseMyRating10(selectedGame.myRating)} size={19} />} />

                  <Field label="Hours Played" value={selectedGame.hoursPlayed} />
                  <Field label="Developer" value={selectedGame.developer} />

                  <Field label="Date Added" value={selectedGame.dateAdded} />
                  <Field label="Date Completed" value={selectedGame.dateCompleted} />
                </div>

                <div style={{ marginTop: 10 }}>
                  <Field
                    label="Description"
                    value={selectedGame.description ? <div style={{ whiteSpace: "pre-wrap" }}>{selectedGame.description}</div> : ""}
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

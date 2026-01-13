/* =====================================================================================
   Chris' Game Library
   Version: 2.2.6
   Notes:
   - Rating bubble ONLY shows on:
       1) Completed tab tiles
       2) “Top Rated Games This Year” row in Stats
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
   - Mobile:
       - Tabs: row1 Games / Now Playing / Queued ; row2 Wishlist / Completed / Stats
       - No count bubble near tabs; total count stays top-right in the mobile topbar
       - Stats cards stack 1 per line
   - Stats:
       - “Newest release in view” only considers releases up to TODAY (no future)
       - Shows newest cover + title + date
       - Top Platforms & Top Genres are interactive donut charts (hover/click changes center stat)
       - Year Played is a vertical bar chart showing ONLY last 5 years, with labels + gridlines
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

const VERSION = "2.2.6";

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

function toNumOrNaN(v: unknown) {
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

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

/** ===== Rating helpers (bubble + modal) ===== */
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
  fillPct: number; // 0..1
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
}: {
  rating10: number | null;
  size?: number;
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
      <div style={{ fontWeight: 900, color: COLORS.text }}>{formatRatingLabel(rating10)}</div>
    </div>
  );
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

          {/* Rating bubble (smaller, darker glass, closer to corner) */}
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

/** ===== Stats mode components ===== */
function StatCard({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, minWidth: 0 }}>
      <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
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
}: {
  title: string;
  items: Array<{ title: string; coverUrl: string; onClick: () => void; overlayRating?: number | null }>;
}) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14 }}>
      <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "nowrap", alignItems: "stretch" }}>
        {items.length ? (
          items.map((g, i) => (
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
          ))
        ) : (
          <div style={{ color: COLORS.muted, fontSize: 12 }}>No rated games for this year in the current view.</div>
        )}
      </div>
    </div>
  );
}

/** ===== Newest release card (with cover) ===== */
function NewestReleaseCard({
  title,
  date,
  coverUrl,
}: {
  title: string;
  date: string;
  coverUrl: string;
}) {
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 14, minWidth: 0 }}>
      <div style={{ color: COLORS.muted, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        Newest release in view
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
        <div
          style={{
            width: 56,
            height: 84,
            borderRadius: 12,
            overflow: "hidden",
            border: `1px solid ${COLORS.border}`,
            background: COLORS.card,
            flex: "0 0 auto",
            boxShadow: "0 14px 35px rgba(0,0,0,.45)",
          }}
        >
          {coverUrl ? (
            <img src={coverUrl} alt={title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: COLORS.muted, fontSize: 11 }}>
              —
            </div>
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{ color: COLORS.text, fontWeight: 950, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {title || "

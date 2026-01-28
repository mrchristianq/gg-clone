"use client";

import React, { useEffect, useRef, useState } from "react";
import styles from "./TiltCover.module.css";

type TiltCoverProps = {
  children: React.ReactNode;
  className?: string;
};

const MAX_TILT_Y = 20;
const MAX_TILT_X = 10;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function TiltCover({ children, className }: TiltCoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;

    const findContentEl = () => {
      const children = Array.from(el.children);
      return children.find((child) => !child.classList.contains(styles.tiltReflection)) as HTMLElement | undefined;
    };

    const updateRadius = () => {
      const contentEl = findContentEl();
      if (!contentEl) return;
      const radius = window.getComputedStyle(contentEl).borderRadius || "0px";
      el.style.setProperty("--tiltRadius", radius);
    };

    updateRadius();

    if (typeof ResizeObserver !== "undefined") {
      const contentEl = findContentEl();
      if (!contentEl) return;
      const ro = new ResizeObserver(() => updateRadius());
      ro.observe(contentEl);
      return () => ro.disconnect();
    }

    const onResize = () => updateRadius();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouch) return;
    const el = ref.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const relX = (e.clientX - rect.left) / rect.width - 0.5;
    const relY = (e.clientY - rect.top) / rect.height - 0.5;

    const nx = clamp(relX, -0.5, 0.5);
    const ny = clamp(relY, -0.5, 0.5);

    const tiltY = nx * 2 * MAX_TILT_Y;
    const tiltX = -ny * 2 * MAX_TILT_X;

    el.style.setProperty("--tiltY", `${tiltY.toFixed(2)}deg`);
    el.style.setProperty("--tiltX", `${tiltX.toFixed(2)}deg`);
  };

  const resetTilt = () => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty("--tiltY", "0deg");
    el.style.setProperty("--tiltX", "0deg");
  };

  return (
    <div
      ref={ref}
      className={`${styles.tiltCard}${className ? ` ${className}` : ""}`}
      onMouseMove={isTouch ? undefined : handleMouseMove}
      onMouseLeave={isTouch ? undefined : resetTilt}
    >
      <div className={styles.tiltReflection} aria-hidden />
      {children}
    </div>
  );
}

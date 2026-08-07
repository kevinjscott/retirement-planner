"use client";

import { ThinkingOrb } from "thinking-orbs";

/**
 * Subtle ambient accent from thinking-orbs (MIT, Jakub Antalik).
 * Small canvas only — not a full-page backdrop — so the dense calculator stays usable.
 */
export function OrbsBackdrop() {
  return (
    <div className="orbs-backdrop" aria-hidden="true">
      <ThinkingOrb state="breathing" size={20} theme="light" speed={0.55} />
    </div>
  );
}

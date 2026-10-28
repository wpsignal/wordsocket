/*
 * A short two-note chime, once per visit and only after a gesture, since browsers refuse audio
 * before one and an uninvited sound closes the tab.
 */

import { stored } from "../utils/storage";

/** Whether the chime played in this visit (`sessionStorage`). */
const played = stored<boolean>(
  "session",
  "wordsocket-sound",
  () => false,
  (value): value is boolean => typeof value === "boolean",
);
let gestured = false;

for (const type of ["pointerdown", "keydown"]) {
  window.addEventListener(
    type,
    () => {
      gestured = true;
    },
    { capture: true, once: true },
  );
}

/**
 * Play the chime; false when there was no gesture yet, it already played this visit, or there is no
 * audio.
 */
export function playSound(): boolean {
  if (!gestured || played.read()) return false;
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Context) return false;
  try {
    const ctx = new Context();
    const at = ctx.currentTime;
    for (const [offset, frequency] of [
      [0, 659.25],
      [0.14, 880],
    ]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, at + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + offset + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + offset);
      osc.stop(at + offset + 0.32);
    }
    void ctx.resume();
    setTimeout(() => void ctx.close(), 800);
    played.write(true);
    return true;
  } catch {
    return false;
  }
}

/** For tests and the engine: whether a gesture has been seen on this page. */
export function hasGesture(): boolean {
  return gestured;
}

// The view a dropped window lands in: the picture Rust drew, the window's title,
// and the one thing worth doing with them.
//
// The picture goes into a canvas rather than an <img> because Rust hands over raw
// RGBA, and encoding that to PNG only to decode it again would be a pointless trip
// through the encoder. It is drawn once per shot — the pixels do not change while
// the card is up, so there is nothing to do on the frames after the first.

import { h } from "./dom";
import { State, type WindowShot } from "../core/state";

/** Largest box the picture gets. The window is drawn whole, scaled to fit. */
const MAX_W = 380;
const MAX_H = 246;

/**
 * Puts the shot on the canvas at the size it will be shown.
 *
 * `putImageData` ignores the context transform, so the pixels are painted one for
 * one and the browser's own downscale does the resizing — which is both cheaper
 * than resampling here and smoother on a 2x display.
 */
function paint(canvas: HTMLCanvasElement, shot: WindowShot) {
  const scale = Math.min(1, MAX_W / shot.width, MAX_H / shot.height);
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  canvas.width = Math.round(shot.width * scale * dpr);
  canvas.height = Math.round(shot.height * scale * dpr);
  canvas.style.width = `${Math.round(shot.width * scale)}px`;
  canvas.style.height = `${Math.round(shot.height * scale)}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  // Copied into an ImageData of the right shape rather than handed to the
  // constructor directly: that overload demands a buffer this code never owns.
  const image = ctx.createImageData(shot.width, shot.height);
  image.data.set(shot.pixels);
  ctx.putImageData(image, 0, 0);
}

/** `Chrome_WidgetWin_1` reads as noise — the part before it is the useful half. */
function appOf(className: string): string {
  return className.replace(/_WidgetWin_\d+$/, "").replace(/_+$/, "");
}

export interface WindowViewActions {
  ask(): void;
  close(): void;
}

export function buildWindow(actions: WindowViewActions): { el: HTMLElement; sync(): void } {
  const canvas = h("canvas", { class: "shot" }) as HTMLCanvasElement;
  const frame = h("div", { class: "shot-frame" }, canvas);

  const title = h("div", { class: "title" });
  const sub = h("div", { class: "sub" });
  const side = h(
    "div",
    { class: "shot-side" },
    title,
    sub,
    h("div", { class: "grow" }),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "btn primary", onclick: () => actions.ask() },
        h("span", { text: "Ask about this" })),
      h("button", { class: "btn secondary", onclick: () => actions.close() },
        h("span", { text: "Close" })),
    ),
  );

  const el = h("div", { class: "view window-view" },
    h("div", { class: "card window-card" }, frame, side));

  // Redrawn only when the shot itself changes: sync runs every frame and
  // putImageData is the single expensive thing this view does.
  let painted: WindowShot | null = null;
  let lastTitle = "";
  let lastKind = "";

  return {
    el,
    sync() {
      const shot = State.windowShot;
      if (!shot) return;
      if (shot !== painted) {
        painted = shot;
        paint(canvas, shot);
      }
      if (shot.title !== lastTitle) {
        lastTitle = shot.title;
        title.textContent = shot.title;
      }
      const kind = appOf(shot.className);
      if (kind !== lastKind) {
        lastKind = kind;
        sub.textContent = kind;
      }
    },
  };
}
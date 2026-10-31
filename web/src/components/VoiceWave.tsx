import { useEffect, useRef } from "react";
import type { Speaker } from "@/lib/voice-activity";

type RGBA = [number, number, number, number];

type Palette = Record<Speaker | "idle", RGBA[]>;

const SPEAKERS = ["idle", "agent", "caller"] as const;

// Colors come from --wave-<speaker>-<layer> on the page, each
// written as "r g b alpha", so the light or the dark theme
// can repaint the wave without editing the canvas code.
function readPalette(element: Element): Palette {
  const style = getComputedStyle(element);
  const layer = (speaker: string, index: number): RGBA => {
    const values = style
      .getPropertyValue(`--wave-${speaker}-${index}`)
      .trim()
      .split(/[\s,/]+/)
      .map(Number);
    return values.length === 4 && values.every(Number.isFinite) ? (values as RGBA) : [0, 0, 0, 0];
  };
  return Object.fromEntries(
    SPEAKERS.map((speaker) => [speaker, [1, 2, 3].map((index) => layer(speaker, index))]),
  ) as Palette;
}

// At rest the wave holds a low, still profile instead of going
// flat, so the banner keeps its shape between turns, and it
// only starts to move once a speaker is heard on a call.
const REST = 0.35;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// The canvas reads the speaker through a ref on every frame, so the
// animation loop starts once and never restarts when a dashboard
// switches between calls or the speaker callback is replaced.
export function VoiceWave({ getSpeaker }: { getSpeaker: () => Speaker | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speakerRef = useRef(getSpeaker);
  speakerRef.current = getSpeaker;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let time = 0;
    let energy = REST;
    let frame = 0;
    let palette = readPalette(canvas);
    const colors = palette.idle.map((c) => [...c] as RGBA);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const repaint = () => (palette = readPalette(canvas));
    scheme.addEventListener("change", repaint);

    // The backing store follows element size and pixel ratio, and the
    // transform is reset, never stacked a second time, which would
    // make the drawing grow larger and larger with each resize.
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    // Energy and color ease toward the active speaker each frame, so
    // a new turn rises up out of the resting shape and a finished
    // turn sinks back down into it, never snapping in between.
    const draw = () => {
      const speaker = speakerRef.current();
      energy = lerp(energy, speaker ? 1 : REST, 0.08);
      const voiced = Math.max(0, (energy - REST) / (1 - REST));
      const target = palette[speaker ?? "idle"];
      colors.forEach((c, j) => c.forEach((v, k) => (c[k] = lerp(v, target[j][k], 0.06))));

      ctx.clearRect(0, 0, width, height);
      for (let j = 0; j < colors.length; j++) {
        const [r, g, b, a] = colors[j];
        const baseline = height * 0.6 + j * 10 - 24 * voiced;
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i <= width + 10; i += 10) {
          const jitter = reduced ? 0 : Math.random() * 5 * (j === 0 ? 1 : 0.5) * voiced;
          let y = Math.sin(i * (0.005 + j * 0.001) + time + j) * 40;
          y += Math.sin(i * (0.01 + j * 0.002) - time * 1.5) * 20;
          ctx.lineTo(i, baseline + y * energy + jitter);
        }
        ctx.lineTo(width, height);
        ctx.lineTo(0, height);
        ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, ${a})`;
        ctx.fill();
      }
      // Time advances only while someone is speaking, so during silences
      // the wave holds whatever shape it had when the last turn ended
      // instead of drifting on its own until someone speaks again.
      time += (reduced ? 0.01 : 0.03) * voiced;
      frame = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scheme.removeEventListener("change", repaint);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="voice-wave" />;
}

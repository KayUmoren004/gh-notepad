import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/*
 * The link-preview image for every page, rendered once at build time. Image
 * rendering can't read CSS variables, so the colors repeat the tokens in
 * app/globals.css.
 */

export const alt =
  "Notepad: your notes, in your own GitHub. Markdown files in a private repository you own, with rich text, version history and sharing, online or offline.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const color = {
  background: "#191817",
  foreground: "#e7e4df",
  card: "#1f1e1c",
  muted: "#2a2826",
  mutedForeground: "#9d9890",
  border: "#2f2d2a",
  input: "#3a3733",
};

export default async function OpenGraphImage() {
  const fonts = join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans");
  const [regular, semibold] = await Promise.all([
    readFile(join(fonts, "Geist-Regular.ttf")),
    readFile(join(fonts, "Geist-SemiBold.ttf")),
  ]);

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        backgroundColor: color.background,
        color: color.foreground,
        fontFamily: "Geist",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 0 72px 80px", width: 740 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 32, fontWeight: 600 }}>
          <div
            style={{
              display: "flex",
              width: 48,
              height: 48,
              borderRadius: 12,
              backgroundColor: color.foreground,
              color: color.background,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* lucide's NotebookPen, the wordmark's icon on the landing page. */}
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={color.background} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4" />
              <path d="M2 6h4M2 10h4M2 14h4M2 18h4" />
              <path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
            </svg>
          </div>
          Notepad
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: 64, fontWeight: 600, letterSpacing: -2, lineHeight: 1.1 }}>
            <span>Your notes,</span>
            <span>in your own GitHub</span>
          </div>
          <div style={{ display: "flex", width: 600, fontSize: 28, lineHeight: 1.45, color: color.mutedForeground }}>
            Markdown files in a private repository you own. Rich text, version history and sharing, online or offline.
          </div>
        </div>

        <div style={{ display: "flex" }}>
          <div
            style={{
              display: "flex",
              fontSize: 22,
              color: color.mutedForeground,
              border: `1px solid ${color.input}`,
              borderRadius: 999,
              padding: "8px 20px",
            }}
          >
            Invite-only
          </div>
        </div>
      </div>

      <NoteCard />
    </div>,
    {
      ...size,
      fonts: [
        { name: "Geist", data: regular, weight: 400, style: "normal" },
        { name: "Geist", data: semibold, weight: 600, style: "normal" },
      ],
    },
  );
}

/** The landing page's sample note, bleeding off the right edge. */
function NoteCard() {
  const tasks = [
    { text: "Measure the fence line", done: true },
    { text: "Pick up cedar boards", done: true },
    { text: "Build the first bed", done: false },
    { text: "Plant garlic", done: false },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        left: 790,
        top: 96,
        width: 520,
        height: 600,
        backgroundColor: color.card,
        border: `1px solid ${color.border}`,
        borderRadius: 20,
        padding: "40px 44px",
        gap: 22,
        fontSize: 24,
      }}
    >
      <div style={{ display: "flex", fontSize: 18, color: color.mutedForeground, gap: 10 }}>
        <span>my-notes</span>
        <span>/</span>
        <span>Projects</span>
      </div>
      <div style={{ display: "flex", fontSize: 44, fontWeight: 600, letterSpacing: -1 }}>Garden plan</div>
      <div style={{ display: "flex", gap: 10, fontSize: 18, color: color.mutedForeground }}>
        {["home", "outside"].map((tag) => (
          <div key={tag} style={{ display: "flex", backgroundColor: color.muted, borderRadius: 8, padding: "2px 10px" }}>
            {tag}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", fontSize: 26, fontWeight: 600, marginTop: 8 }}>This weekend</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {tasks.map((task) => (
          <div key={task.text} style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                display: "flex",
                width: 24,
                height: 24,
                borderRadius: 6,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: task.done ? color.foreground : "transparent",
                border: task.done ? "none" : `2px solid ${color.input}`,
              }}
            >
              {task.done && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color.background} strokeWidth="3.5">
                  <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>
            <span
              style={{
                color: task.done ? color.mutedForeground : color.foreground,
                textDecoration: task.done ? "line-through" : "none",
              }}
            >
              {task.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

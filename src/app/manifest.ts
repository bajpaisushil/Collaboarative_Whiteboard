import type { MetadataRoute } from "next";

/**
 * Web app manifest (served at /manifest.webmanifest; Next adds the <link> tag). Colours are
 * the light "paper" token from globals.css, matching the viewport themeColor in layout.tsx.
 * Icons live in public/icons; the maskable ones keep the mark inside the 80% safe zone.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Weave",
    short_name: "Weave",
    description: "Offline-first collaborative whiteboard that explains its merges. No server, no database.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f3ea",
    theme_color: "#f7f3ea",
    lang: "en",
    categories: ["productivity", "education"],
    icons: [
      { src: "/icons/weave.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/weave-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icons/weave-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/weave-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/weave-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Split view",
        short_name: "Split",
        description: "Two tabs side by side with the director’s desk",
        url: "/split",
        icons: [{ src: "/icons/weave-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}

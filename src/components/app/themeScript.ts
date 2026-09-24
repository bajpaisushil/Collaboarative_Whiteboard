/**
 * Inline boot script (rendered by the server page before the board loads) that applies the
 * stored theme choice to <html data-theme> before first paint. Kept in a plain module so a
 * Server Component can import the string (exports of "use client" modules are references).
 */
export const THEME_STORAGE_KEY = "weave:theme";

export const THEME_BOOT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}`;

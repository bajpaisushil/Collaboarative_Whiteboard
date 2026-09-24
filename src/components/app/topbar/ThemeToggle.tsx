"use client";
/** Cycles theme: system → light (paper) → dark (navy loom). */
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { IconButton } from "@/components/ui/IconButton";
import { setTheme, THEME_ORDER, useTheme, type ThemeChoice } from "../theme";

const META: Record<ThemeChoice, { icon: LucideIcon; name: string }> = {
  system: { icon: Monitor, name: "System" },
  light: { icon: Sun, name: "Light paper" },
  dark: { icon: Moon, name: "Dark loom" },
};

export function ThemeToggle() {
  const theme = useTheme();
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length];
  return (
    <IconButton
      icon={META[theme].icon}
      label={`Theme: ${META[theme].name} — switch to ${META[next].name}`}
      onClick={() => setTheme(next)}
    />
  );
}

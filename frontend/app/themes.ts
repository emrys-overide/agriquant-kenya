export type ThemeId = "golden-hour" | "modern-minimalist" | "ocean-depths" | "midnight-galaxy";

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  tagline: string;
  mode: "light" | "dark";
  swatches: [string, string, string, string];
  chart: {
    primary: string;
    secondary: string;
    tertiary: string;
    grid: string;
    axis: string;
    tooltipBg: string;
    tooltipBorder: string;
    tooltipText: string;
  };
}

export const THEME_FACTORY_PRESETS: ThemeDefinition[] = [
  {
    id: "golden-hour",
    name: "Golden Hour",
    tagline: "Warm Kenyan highlands editorial — terracotta, sage & sunlit alabaster",
    mode: "light",
    swatches: ["#FBF8F3", "#C85A32", "#2E6F52", "#D98A2B"],
    chart: {
      primary: "#2E6F52",
      secondary: "#C85A32",
      tertiary: "#D98A2B",
      grid: "#E7DFD3",
      axis: "#6B5E53",
      tooltipBg: "#1F1A17",
      tooltipBorder: "#3D332C",
      tooltipText: "#FBF8F3",
    },
  },
  {
    id: "modern-minimalist",
    name: "Modern Minimalist",
    tagline: "Crisp Swiss editorial light — pure chalk, obsidian ink & cobalt",
    mode: "light",
    swatches: ["#F8FAFC", "#0F172A", "#2563EB", "#0D9488"],
    chart: {
      primary: "#2563EB",
      secondary: "#0D9488",
      tertiary: "#F59E0B",
      grid: "#E2E8F0",
      axis: "#64748B",
      tooltipBg: "#0F172A",
      tooltipBorder: "#334155",
      tooltipText: "#F8FAFC",
    },
  },
  {
    id: "ocean-depths",
    name: "Ocean Depths",
    tagline: "Deep coastal slate — abyssal navy, seafoam teal & coral highlights",
    mode: "dark",
    swatches: ["#091526", "#112240", "#2DD4BF", "#FB7185"],
    chart: {
      primary: "#2DD4BF",
      secondary: "#38BDF8",
      tertiary: "#FB7185",
      grid: "#1E3A5F",
      axis: "#94A3B8",
      tooltipBg: "#0D1E36",
      tooltipBorder: "#1E3A5F",
      tooltipText: "#F1F5F9",
    },
  },
  {
    id: "midnight-galaxy",
    name: "Midnight Galaxy",
    tagline: "High-contrast obsidian & amethyst — luminous violet and solar gold",
    mode: "dark",
    swatches: ["#0C0A1D", "#181436", "#A78BFA", "#FBBF24"],
    chart: {
      primary: "#A78BFA",
      secondary: "#34D399",
      tertiary: "#FBBF24",
      grid: "#2B2554",
      axis: "#A5A1C2",
      tooltipBg: "#161230",
      tooltipBorder: "#3B3170",
      tooltipText: "#F8FAFC",
    },
  },
];

export const DEFAULT_THEME_ID: ThemeId = "golden-hour";

export function getThemeById(id: ThemeId): ThemeDefinition {
  return THEME_FACTORY_PRESETS.find((t) => t.id === id) ?? THEME_FACTORY_PRESETS[0];
}

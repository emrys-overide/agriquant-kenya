"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import axios from "axios";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BarChart3,
  Calculator,
  Check,
  CheckCircle2,
  CloudRain,
  Compass,
  Crosshair,
  Database,
  Droplets,
  Globe,
  LayoutDashboard,
  Leaf,
  Loader2,
  MapPin,
  MessageSquare,
  Palette,
  RefreshCw,
  Send,
  Sparkles,
  Sprout,
  Star,
  Sun,
  Thermometer,
  TrendingUp,
  Truck,
  Wind,
  X,
  Search,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DEFAULT_THEME_ID,
  THEME_FACTORY_PRESETS,
  getThemeById,
  type ThemeDefinition,
  type ThemeId,
} from "./themes";

/* ------------------------------------------------------------------ */
/*  Constants & Types                                                 */
/* ------------------------------------------------------------------ */

const API_URL =
  process.env.NODE_ENV === "development"
    ? "/api"
    : "https://agriquant-api.emryspaul7.workers.dev/api";

type Crop =
  | "maize"
  | "tomatoes"
  | "cabbages"
  | "onions"
  | "french_beans"
  | "potatoes"
  | "wheat";

type ActiveView = "overview" | "markets" | "arbitrage" | "calculator" | "feedback";
type SortField = "market" | "wholesale_price" | "retail_price";

type ForecastDay = {
  date: string;
  max: number;
  min: number;
  rain_mm: number;
  rain_chance: number;
};

type WeatherData = {
  location: string;
  county?: string;
  current_temp: number;
  condition: string;
  humidity: number;
  wind_kph: number;
  soil_moisture_estimate: number;
  soil_moisture_raw?: number;
  soil_temperature_c?: number;
  soil_moisture_status?: string;
  soil_data_source?: string;
  forecast: ForecastDay[];
  agri_risk_alerts: string[];
};

type PriceData = {
  crop: string;
  unit: string;
  farm_gate_price_ksh: number;
  wholesale_price_ksh: number;
  retail_price_ksh: number;
  profit_margin_estimate: number;
  data_status: string;
  has_data?: boolean;
  status_note?: string;
  snapshot_date?: string;
};

type MarketEntry = {
  market: string;
  county: string;
  wholesale_price: number | null;
  retail_price: number | null;
  date: string;
  is_key_market: boolean;
  sources?: string[];
};

type MarketComparisonData = {
  crop: string;
  unit: string;
  kg_per_unit: number;
  has_data?: boolean;
  status_note?: string;
  snapshot_date?: string;
  cached?: boolean;
  markets: MarketEntry[];
  data_source: string;
  data_sources?: string[];
  data_status: string;
};

type Prediction = {
  market: string;
  current_price: number;
  predicted_price: number;
  predicted_change_pct: number;
  trend: "rising" | "falling" | "stable";
  trend_emoji: string;
  confidence: "high" | "medium" | "low";
  market_type?: string;
  spread_ksh?: number;
};

type AnalysisData = {
  crop: string;
  unit: string;
  kg_per_unit: number;
  has_data?: boolean;
  status_note?: string;
  statistics: {
    avg_retail: number;
    avg_wholesale: number;
    price_spread: number;
    min_retail: number;
    max_retail: number;
    volatility_cv_pct: number;
  };
  predictions: Prediction[];
  recommendation: {
    best_sell_market: string | null;
    best_sell_price: number | null;
    cheapest_buy_market: string | null;
    cheapest_buy_price: number | null;
  };
  nearest_market: string | null;
  distance_km: number | null;
  advisory: string;
  data_source: string;
  data_sources?: string[];
};

type AdviceData = {
  advisory_report: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

/* ------------------------------------------------------------------ */
/*  Bilingual Copy & Crop Catalog                                     */
/* ------------------------------------------------------------------ */

const translations: Record<string, { en: string; sw: string }> = {
  brandSub: { en: "Kenya Agri-Intelligence", sw: "Uchambuzi wa Kilimo Kenya" },
  overview: { en: "Overview", sw: "Muhtasari" },
  markets: { en: "Markets", sw: "Masoko" },
  arbitrage: { en: "Arbitrage", sw: "Tofauti za Bei" },
  calculator: { en: "Dispatch Lab", sw: "Kikokotoo" },
  feedback: { en: "Field Notes", sw: "Maoni" },
  farmGate: { en: "Farm Gate", sw: "Bei Shambani" },
  wholesale: { en: "Wholesale", sw: "Jumla" },
  retail: { en: "Retail", sw: "Rejareja" },
  sync: { en: "Sync", sw: "Sasisha" },
  copilot: { en: "Mkulima Copilot", sw: "Msaidizi AI" },
  soilTitle: { en: "Topsoil Moisture", sw: "Unyevu wa Udongo" },
  forecastTitle: { en: "14-Day Weather & Rainfall Outlook", sw: "Utabiri wa Hali ya Hewa (Siku 14)" },
  priceTierTitle: { en: "National Price Ladder", sw: "Ngazi za Bei Kitaifa" },
  advisoryTitle: { en: "Mkulima Agronomic Brief", sw: "Ushauri wa Kilimo na Masoko" },
  chatPlaceholder: {
    en: "Ask about planting windows, market spreads, or soil moisture...",
    sw: "Uliza kuhusu msimu wa kupanda, bei za masoko, au unyevu wa udongo...",
  },
  locationPlaceholder: { en: "Search town or county...", sw: "Tafuta mji au kaunti..." },
};

function t(key: string, lang: "en" | "sw"): string {
  return translations[key]?.[lang] ?? key;
}

const cropOptions: { value: Crop; label: string; swLabel: string; unit: string; tag: string }[] = [
  { value: "maize", label: "Dry Maize", swLabel: "Mahindi Makavu", unit: "90kg Bag", tag: "Grain" },
  { value: "tomatoes", label: "Tomatoes", swLabel: "Nyanya", unit: "30kg Crate", tag: "Fresh" },
  { value: "potatoes", label: "Irish Potatoes", swLabel: "Viazi", unit: "50kg Bag", tag: "Tuber" },
  { value: "onions", label: "Red Onions", swLabel: "Vitunguu", unit: "1kg Net", tag: "Bulb" },
  { value: "cabbages", label: "Cabbages", swLabel: "Kabichi", unit: "Medium Head", tag: "Leafy" },
  { value: "french_beans", label: "French Beans", swLabel: "Mishiri", unit: "1kg Export", tag: "Export" },
  { value: "wheat", label: "Clean Wheat", swLabel: "Ngano", unit: "90kg Bag", tag: "Grain" },
];

const popularTowns = ["Nairobi", "Eldoret", "Nakuru", "Kitale", "Meru", "Nanyuki", "Kisumu"];

/* ------------------------------------------------------------------ */
/*  Theme-Aware Chart Tooltip                                         */
/* ------------------------------------------------------------------ */

function ThemedTooltip({
  active,
  payload,
  label,
  theme,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
  theme: ThemeDefinition;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3.5 py-2.5 shadow-xl text-xs"
      style={{
        backgroundColor: theme.chart.tooltipBg,
        border: `1px solid ${theme.chart.tooltipBorder}`,
        color: theme.chart.tooltipText,
      }}
    >
      {label && (
        <p className="mb-1.5 font-tabular text-[11px] uppercase tracking-wider opacity-75">
          {label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 opacity-85">
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </span>
            <span className="font-tabular font-semibold">
              {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Dashboard Application                                        */
/* ------------------------------------------------------------------ */

const THEME_STORAGE_KEY = "agriquant-theme";
const THEME_CHANGE_EVENT = "agriquant-theme-change";
let memoryThemeId: ThemeId = DEFAULT_THEME_ID;

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (!e.key || e.key === THEME_STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
  };
}

function getThemeSnapshot(): ThemeId {
  if (typeof window === "undefined") return DEFAULT_THEME_ID;
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeId | null;
    if (saved && THEME_FACTORY_PRESETS.some((p) => p.id === saved)) {
      return saved;
    }
  } catch {
    return memoryThemeId;
  }
  return memoryThemeId;
}

function getServerThemeSnapshot(): ThemeId {
  return DEFAULT_THEME_ID;
}

function writeThemePreference(id: ThemeId) {
  memoryThemeId = id;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", id);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, id);
  } catch {
    // ignore storage access issues
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }
}

export default function Dashboard() {
  /* Theme Factory State */
  const themeId = useSyncExternalStore(
    subscribeTheme,
    getThemeSnapshot,
    getServerThemeSnapshot
  );
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const activeTheme = useMemo(() => getThemeById(themeId), [themeId]);

  /* Core Workspace State */
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [location, setLocation] = useState("Nanyuki");
  const [locationInput, setLocationInput] = useState("Nanyuki");
  const [crop, setCrop] = useState<Crop>("maize");
  const [activeView, setActiveView] = useState<ActiveView>("overview");

  /* Telemetry Data */
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [prices, setPrices] = useState<PriceData | null>(null);
  const [marketData, setMarketData] = useState<MarketComparisonData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>("");

  /* Geolocation */
  const [geoLoading, setGeoLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);

  /* Market Ledger Controls */
  const [marketSearch, setMarketSearch] = useState("");
  const [selectedCounty, setSelectedCounty] = useState<string>("ALL");
  const [sortField, setSortField] = useState<SortField>("retail_price");
  const [sortDesc, setSortDesc] = useState(true);

  /* Dispatch & Profit Lab */
  const [calcQuantity, setCalcQuantity] = useState<number>(50);
  const [calcTransportCost, setCalcTransportCost] = useState<number>(8500);
  const [customBuyOverride, setCustomBuyOverride] = useState<string>("");
  const [customSellOverride, setCustomSellOverride] = useState<string>("");

  /* Mkulima Copilot Drawer */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInitialized = useRef(false);

  /* Feedback Form */
  const [fbName, setFbName] = useState("");
  const [fbEmail, setFbEmail] = useState("");
  const [fbMessage, setFbMessage] = useState("");
  const [fbRating, setFbRating] = useState(5);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbSent, setFbSent] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);

  /* Sync Theme Factory attribute to document root */
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeId);
  }, [themeId]);

  const applyTheme = (id: ThemeId) => {
    writeThemePreference(id);
    setThemeMenuOpen(false);
  };

  const handleSelectCrop = (nextCrop: Crop) => {
    setCrop(nextCrop);
    setCustomBuyOverride("");
    setCustomSellOverride("");
    setSelectedCounty("ALL");
  };

  /* Fetch live telemetry */
  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const analysisUrl = userCoords
          ? `${API_URL}/analysis/${crop}?user_lat=${userCoords.lat}&user_lon=${userCoords.lon}`
          : `${API_URL}/analysis/${crop}`;

        const [weatherRes, pricesRes, marketsRes, analysisRes] = await Promise.all([
          axios.get<WeatherData>(`${API_URL}/weather/${encodeURIComponent(location)}`, { timeout: 15000 }),
          axios.get<PriceData>(`${API_URL}/prices/${crop}`, { timeout: 15000 }),
          axios
            .get<MarketComparisonData>(`${API_URL}/prices/${crop}/markets`, { timeout: 15000 })
            .catch(() => null),
          axios.get<AnalysisData>(analysisUrl, { timeout: 15000 }).catch(() => null),
        ]);

        const adviceRes = await axios
          .post<AdviceData>(
            `${API_URL}/advice`,
            {
              weather: weatherRes.data,
              prices: pricesRes.data,
              lang,
            },
            { timeout: 15000 }
          )
          .catch(() => null);

        if (ignore) return;
        setWeather(weatherRes.data);
        setPrices(pricesRes.data);
        setMarketData(marketsRes?.data ?? null);
        setAnalysisData(analysisRes?.data ?? null);
        setAdvice(adviceRes?.data?.advisory_report ?? "");
        setError(null);
        setLastSyncedAt(
          new Date().toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })
        );
      } catch (err: unknown) {
        if (!ignore) {
          const detail =
            axios.isAxiosError(err) && err.response?.data?.detail
              ? String(err.response.data.detail)
              : lang === "sw"
                ? "Imeshindwa kupata data hai kutoka kwa seva. Jaribu tena."
                : "Could not retrieve live telemetry from the API. Check connection or retry.";
          setError(detail);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchData();
    return () => {
      ignore = true;
    };
  }, [fetchTrigger, crop, location, lang, userCoords]);

  /* Auto-scroll Copilot drawer */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  /* Geolocation handler */
  const handleGeoLocate = () => {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lon: longitude });
        try {
          const geoRes = await axios.get(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en`,
            { timeout: 8000 }
          );
          const addr = geoRes.data?.address;
          const town =
            addr?.town || addr?.city || addr?.village || addr?.county || "My Farm";
          setLocation(town);
          setLocationInput(town);
          setFetchTrigger((p) => p + 1);
        } catch {
          const fallback = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
          setLocation(fallback);
          setLocationInput(fallback);
          setFetchTrigger((p) => p + 1);
        } finally {
          setGeoLoading(false);
        }
      },
      () => setGeoLoading(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /* Copilot Chat Helpers */
  const ensureChatGreeting = () => {
    if (!chatInitialized.current) {
      setChatMessages([
        {
          role: "assistant",
          content:
            lang === "sw"
              ? "Habari! Mimi ni Mkulima Copilot. Niulize kuhusu bei za KAMIS, unyevu wa udongo, au fursa bora za kuuza mazao yako."
              : "Hello! I am Mkulima Copilot. Ask me about live KAMIS price spreads, soil moisture windows, or the best county hubs to sell your harvest.",
        },
      ]);
      chatInitialized.current = true;
    }
  };

  const openChat = (prefillPrompt?: string) => {
    ensureChatGreeting();
    setChatOpen(true);
    if (prefillPrompt) {
      setChatInput(prefillPrompt);
    }
  };

  const sendChat = async (overrideText?: string) => {
    const trimmed = (overrideText ?? chatInput).trim();
    if (!trimmed || chatLoading) return;
    ensureChatGreeting();
    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const updated = [...chatMessages, userMsg];
    setChatMessages(updated);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await axios.post(`${API_URL}/chat`, {
        messages: updated,
        context: { weather, prices },
        lang,
      });
      const reply =
        res.data?.reply ||
        res.data?.message ||
        res.data?.content ||
        "No reply returned from Mkulima AI.";
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            lang === "sw"
              ? "Samahani, huduma ya Mkulima Copilot haipatikani kwa sasa."
              : "Sorry, Mkulima Copilot is temporarily unreachable. Please retry shortly.",
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  /* Derived Market Data */
  const availableCounties = useMemo(() => {
    const set = new Set<string>();
    (marketData?.markets ?? []).forEach((m) => {
      if (m.county) set.add(m.county);
    });
    return Array.from(set).sort();
  }, [marketData]);

  const filteredMarkets = useMemo(() => {
    let rows = [...(marketData?.markets ?? [])];
    if (selectedCounty !== "ALL") {
      rows = rows.filter((m) => m.county === selectedCounty);
    }
    if (marketSearch.trim()) {
      const term = marketSearch.toLowerCase();
      rows = rows.filter(
        (m) =>
          m.market.toLowerCase().includes(term) ||
          (m.county && m.county.toLowerCase().includes(term))
      );
    }
    rows.sort((a, b) => {
      if (sortField === "market") {
        return sortDesc
          ? b.market.localeCompare(a.market)
          : a.market.localeCompare(b.market);
      }
      const va = a[sortField] ?? -1;
      const vb = b[sortField] ?? -1;
      return sortDesc ? vb - va : va - vb;
    });
    return rows;
  }, [marketData, marketSearch, selectedCounty, sortField, sortDesc]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDesc((prev) => !prev);
    } else {
      setSortField(field);
      setSortDesc(true);
    }
  };

  /* Dispatch & Profit Lab Calculations */
  const calcResults = useMemo(() => {
    const defaultBuy =
      analysisData?.recommendation?.cheapest_buy_price ||
      prices?.wholesale_price_ksh ||
      3500;
    const defaultSell =
      analysisData?.recommendation?.best_sell_price ||
      prices?.retail_price_ksh ||
      4800;

    const buyPrice =
      customBuyOverride.trim() !== "" && !Number.isNaN(Number(customBuyOverride))
        ? Math.max(0, Number(customBuyOverride))
        : defaultBuy;
    const sellPrice =
      customSellOverride.trim() !== "" && !Number.isNaN(Number(customSellOverride))
        ? Math.max(0, Number(customSellOverride))
        : defaultSell;

    const totalPurchaseCost = buyPrice * calcQuantity;
    const grossRevenue = sellPrice * calcQuantity;
    const totalOutlay = totalPurchaseCost + calcTransportCost;
    const netProfit = grossRevenue - totalOutlay;
    const roi = totalOutlay > 0 ? (netProfit / totalOutlay) * 100 : 0;
    const breakEvenPerUnit = calcQuantity > 0 ? totalOutlay / calcQuantity : 0;

    return {
      buyPrice,
      sellPrice,
      totalPurchaseCost,
      grossRevenue,
      totalOutlay,
      netProfit,
      roi,
      breakEvenPerUnit,
    };
  }, [
    analysisData,
    prices,
    calcQuantity,
    calcTransportCost,
    customBuyOverride,
    customSellOverride,
  ]);

  /* Active Crop Metadata */
  const activeCropMeta = useMemo(
    () => cropOptions.find((c) => c.value === crop) ?? cropOptions[0],
    [crop]
  );

  /* Chart Data */
  const priceBarData = useMemo(
    () => [
      {
        name: t("farmGate", lang),
        price: prices?.farm_gate_price_ksh || 0,
        color: activeTheme.chart.primary,
      },
      {
        name: t("wholesale", lang),
        price: prices?.wholesale_price_ksh || 0,
        color: activeTheme.chart.secondary,
      },
      {
        name: t("retail", lang),
        price: prices?.retail_price_ksh || 0,
        color: activeTheme.chart.tertiary,
      },
    ],
    [prices, lang, activeTheme]
  );

  const navItems: { id: ActiveView; label: string; icon: typeof LayoutDashboard }[] = [
    { id: "overview", label: t("overview", lang), icon: LayoutDashboard },
    { id: "markets", label: t("markets", lang), icon: Database },
    { id: "arbitrage", label: t("arbitrage", lang), icon: Compass },
    { id: "calculator", label: t("calculator", lang), icon: Calculator },
    { id: "feedback", label: t("feedback", lang), icon: MessageSquare },
  ];

  const quickPrompts =
    lang === "sw"
      ? [
          `Je, ni wakati mzuri wa kuuza ${activeCropMeta.swLabel} hapa ${location}?`,
          `Chambua unyevu wa udongo wa ${location} kwa kupanda wiki hii.`,
          `Ni soko lipi lina faida zaidi kwa ${activeCropMeta.swLabel} leo?`,
        ]
      : [
          `Should I hold or sell ${activeCropMeta.label} from ${location} this week?`,
          `Interpret ${location}'s soil moisture & 14-day rain forecast for planting.`,
          `Where is the best arbitrage spread for ${activeCropMeta.label} today?`,
        ];

  const commitLocationSearch = () => {
    const clean = locationInput.trim();
    if (!clean) return;
    setLocation(clean);
    setFetchTrigger((p) => p + 1);
  };

  return (
    <div className="tf-canvas min-h-screen flex flex-col lg:flex-row pb-20 lg:pb-0">
      {/* ============================================================== */}
      {/*  Desktop Navigation Sidebar Rail                               */}
      {/* ============================================================== */}
      <aside
        className="hidden lg:flex lg:flex-col lg:w-64 xl:w-72 shrink-0 sticky top-0 h-screen border-r px-5 py-6 justify-between"
        style={{
          backgroundColor: "var(--tf-bg-elevated)",
          borderColor: "var(--tf-border)",
        }}
      >
        <div className="space-y-7">
          {/* Brand Identity */}
          <div className="flex items-center gap-3">
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm"
              style={{
                backgroundColor: "var(--tf-primary)",
                color: "var(--tf-ink-on-primary)",
              }}
            >
              <Leaf className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-display text-lg font-bold tracking-tight">
                  Agriquant
                </span>
                <span
                  className="font-tabular text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                  style={{
                    backgroundColor: "var(--tf-bg-accent-soft)",
                    color: "var(--tf-primary)",
                  }}
                >
                  KE
                </span>
              </div>
              <p className="text-[11px]" style={{ color: "var(--tf-ink-muted)" }}>
                {t("brandSub", lang)}
              </p>
            </div>
          </div>

          {/* Primary Navigation */}
          <nav className="space-y-1.5" aria-label="Main navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer"
                  style={
                    isActive
                      ? {
                          backgroundColor: "var(--tf-bg-accent-soft)",
                          color: "var(--tf-primary)",
                          border: "1px solid var(--tf-border)",
                        }
                      : {
                          color: "var(--tf-ink-secondary)",
                          border: "1px solid transparent",
                        }
                  }
                >
                  <span className="flex items-center gap-3">
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </span>
                  {item.id === "markets" && marketData?.markets?.length ? (
                    <span
                      className="font-tabular text-[11px] px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: "var(--tf-bg-subtle)",
                        color: "var(--tf-ink-muted)",
                      }}
                    >
                      {marketData.markets.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          {/* Theme Factory Studio Selector inside Sidebar */}
          <div className="tf-subtle-box p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <span
                className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5"
                style={{ color: "var(--tf-ink-muted)" }}
              >
                <Palette className="h-3.5 w-3.5" style={{ color: "var(--tf-primary)" }} />
                Theme Factory
              </span>
              <span className="font-tabular text-[10px]" style={{ color: "var(--tf-ink-muted)" }}>
                {activeTheme.mode}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {THEME_FACTORY_PRESETS.map((preset) => {
                const selected = preset.id === themeId;
                return (
                  <button
                    key={preset.id}
                    onClick={() => applyTheme(preset.id)}
                    className="flex flex-col items-start gap-1.5 p-2 rounded-lg text-left transition cursor-pointer"
                    style={{
                      backgroundColor: selected
                        ? "var(--tf-bg-elevated)"
                        : "transparent",
                      border: `1px solid ${
                        selected ? "var(--tf-primary)" : "var(--tf-border)"
                      }`,
                    }}
                  >
                    <div className="flex items-center gap-1">
                      {preset.swatches.map((hex, i) => (
                        <span
                          key={i}
                          className="h-2.5 w-2.5 rounded-full border border-black/15"
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                    <span
                      className="text-[11px] font-semibold leading-tight"
                      style={{ color: "var(--tf-ink)" }}
                    >
                      {preset.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Bottom Copilot Launch Card */}
        <div
          className="rounded-2xl p-4 space-y-3 border"
          style={{
            backgroundColor: "var(--tf-bg-secondary-soft)",
            borderColor: "var(--tf-border)",
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" style={{ color: "var(--tf-secondary)" }} />
            <span className="text-xs font-bold">{t("copilot", lang)}</span>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--tf-ink-secondary)" }}>
            {lang === "sw"
              ? "Pata ushauri wa papo hapo kuhusu soko, bei za KAMIS, na hali ya udongo."
              : "Ask Gemini-powered agronomy & market intelligence grounded in live data."}
          </p>
          <button
            onClick={() => openChat()}
            className="tf-btn-primary w-full rounded-xl py-2 text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            {lang === "sw" ? "Fungua Msaidizi" : "Launch Copilot"}
          </button>
        </div>
      </aside>

      {/* ============================================================== */}
      {/*  Main Workspace Column                                         */}
      {/* ============================================================== */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Utility & Context Header */}
        <header
          className="sticky top-0 z-30 border-b backdrop-blur-md"
          style={{
            backgroundColor:
              activeTheme.mode === "light"
                ? "color-mix(in srgb, var(--tf-bg) 88%, transparent)"
                : "color-mix(in srgb, var(--tf-bg) 88%, transparent)",
            borderColor: "var(--tf-border)",
          }}
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
            {/* Mobile Brand + Active Context */}
            <div className="flex items-center gap-3">
              <div
                className="lg:hidden h-9 w-9 rounded-xl flex items-center justify-center"
                style={{
                  backgroundColor: "var(--tf-primary)",
                  color: "var(--tf-ink-on-primary)",
                }}
              >
                <Leaf className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight">
                    {navItems.find((n) => n.id === activeView)?.label}
                  </h1>
                  <span
                    className="hidden sm:inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium"
                    style={{
                      backgroundColor: "var(--tf-bg-secondary-soft)",
                      color: "var(--tf-secondary)",
                    }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full animate-pulse"
                      style={{ backgroundColor: "var(--tf-secondary)" }}
                    />
                    {lastSyncedAt ? `Synced ${lastSyncedAt} EAT` : "Live Feed"}
                  </span>
                </div>
                <p className="text-xs" style={{ color: "var(--tf-ink-muted)" }}>
                  {location} · {lang === "sw" ? activeCropMeta.swLabel : activeCropMeta.label} ({activeCropMeta.unit})
                </p>
              </div>
            </div>

            {/* Right Utility Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Location Search Input */}
              <div className="relative flex items-center">
                <MapPin
                  className="h-3.5 w-3.5 absolute left-3 pointer-events-none"
                  style={{ color: "var(--tf-primary)" }}
                />
                <input
                  type="text"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && commitLocationSearch()}
                  placeholder={t("locationPlaceholder", lang)}
                  className="tf-input rounded-xl pl-8 pr-3 py-1.5 text-xs w-40 sm:w-48"
                />
              </div>

              <button
                onClick={handleGeoLocate}
                disabled={geoLoading}
                title="Use GPS location"
                className="tf-btn-ghost h-8 w-8 rounded-xl flex items-center justify-center cursor-pointer"
              >
                {geoLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Crosshair className="h-3.5 w-3.5" />
                )}
              </button>

              <button
                onClick={() => setFetchTrigger((p) => p + 1)}
                className="tf-btn-ghost h-8 px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">{t("sync", lang)}</span>
              </button>

              {/* Language Toggle */}
              <button
                onClick={() => setLang(lang === "en" ? "sw" : "en")}
                className="tf-btn-ghost h-8 px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-tabular font-semibold cursor-pointer"
              >
                <Globe className="h-3.5 w-3.5" style={{ color: "var(--tf-primary)" }} />
                {lang.toUpperCase()}
              </button>

              {/* Mobile / Compact Theme Factory Popover */}
              <div className="relative">
                <button
                  onClick={() => setThemeMenuOpen((v) => !v)}
                  className="tf-btn-ghost h-8 px-2.5 rounded-xl flex items-center gap-1.5 text-xs font-medium cursor-pointer"
                  aria-label="Switch theme"
                >
                  <Palette className="h-3.5 w-3.5" style={{ color: "var(--tf-primary)" }} />
                  <span className="hidden md:inline">{activeTheme.name}</span>
                </button>
                {themeMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-72 rounded-2xl p-3 shadow-xl z-50 border space-y-2"
                    style={{
                      backgroundColor: "var(--tf-bg-elevated)",
                      borderColor: "var(--tf-border-strong)",
                    }}
                  >
                    <div className="flex items-center justify-between px-1 pb-1 border-b" style={{ borderColor: "var(--tf-border)" }}>
                      <span className="text-xs font-bold">Theme Factory Presets</span>
                      <button
                        onClick={() => setThemeMenuOpen(false)}
                        className="p-0.5 rounded cursor-pointer"
                        style={{ color: "var(--tf-ink-muted)" }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {THEME_FACTORY_PRESETS.map((preset) => {
                      const isSelected = preset.id === themeId;
                      return (
                        <button
                          key={preset.id}
                          onClick={() => applyTheme(preset.id)}
                          className="w-full text-left p-2.5 rounded-xl transition flex items-start justify-between gap-2 cursor-pointer"
                          style={{
                            backgroundColor: isSelected
                              ? "var(--tf-bg-accent-soft)"
                              : "transparent",
                            border: `1px solid ${
                              isSelected ? "var(--tf-primary)" : "transparent"
                            }`,
                          }}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold">{preset.name}</span>
                              <div className="flex gap-1">
                                {preset.swatches.map((hex, i) => (
                                  <span
                                    key={i}
                                    className="h-2.5 w-2.5 rounded-full border border-black/20"
                                    style={{ backgroundColor: hex }}
                                  />
                                ))}
                              </div>
                            </div>
                            <p
                              className="text-[11px] mt-0.5 leading-snug"
                              style={{ color: "var(--tf-ink-muted)" }}
                            >
                              {preset.tagline}
                            </p>
                          </div>
                          {isSelected && (
                            <Check
                              className="h-4 w-4 shrink-0 mt-0.5"
                              style={{ color: "var(--tf-primary)" }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Mobile Copilot Button */}
              <button
                onClick={() => openChat()}
                className="lg:hidden tf-btn-primary h-8 px-3 rounded-xl flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
              >
                <Sparkles className="h-3.5 w-3.5" />
                AI
              </button>
            </div>
          </div>

          {/* County Quick-Jump Bar */}
          <div
            className="border-t px-4 sm:px-6 lg:px-8 py-2 overflow-x-auto"
            style={{ borderColor: "var(--tf-border)" }}
          >
            <div className="max-w-7xl mx-auto flex items-center gap-2">
              <span
                className="text-[11px] font-semibold uppercase tracking-wider shrink-0"
                style={{ color: "var(--tf-ink-muted)" }}
              >
                Hubs:
              </span>
              {popularTowns.map((town) => {
                const isSelected = location.toLowerCase() === town.toLowerCase();
                return (
                  <button
                    key={town}
                    onClick={() => {
                      setLocation(town);
                      setLocationInput(town);
                      setFetchTrigger((p) => p + 1);
                    }}
                    className="px-3 py-1 rounded-full text-xs font-medium shrink-0 transition cursor-pointer"
                    style={
                      isSelected
                        ? {
                            backgroundColor: "var(--tf-primary)",
                            color: "var(--tf-ink-on-primary)",
                          }
                        : {
                            backgroundColor: "var(--tf-bg-subtle)",
                            color: "var(--tf-ink-secondary)",
                          }
                    }
                  >
                    {town}
                  </button>
                );
              })}
            </div>
          </div>
        </header>

        {/* Main Content Container */}
        <main className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 flex-1">
          {/* Error Banner */}
          {error && (
            <div
              className="rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3 border"
              style={{
                backgroundColor: "var(--tf-bg-warning-soft)",
                borderColor: "var(--tf-danger)",
                color: "var(--tf-ink)",
              }}
            >
              <div className="flex items-center gap-2.5 text-sm">
                <AlertTriangle className="h-4 w-4 shrink-0" style={{ color: "var(--tf-danger)" }} />
                <span>{error}</span>
              </div>
              <button
                onClick={() => setFetchTrigger((p) => p + 1)}
                className="tf-btn-primary px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
              >
                Retry Sync
              </button>
            </div>
          )}

          {/* Commodity Selector Strip (Shown on Overview, Markets, Arbitrage, Calculator) */}
          {activeView !== "feedback" && (
            <section aria-label="Commodity selector">
              <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2.5">
                {cropOptions.map((item) => {
                  const selected = crop === item.value;
                  return (
                    <button
                      key={item.value}
                      onClick={() => handleSelectCrop(item.value)}
                      className="tf-card tf-card-interactive p-3.5 text-left flex flex-col justify-between gap-2 cursor-pointer"
                      style={
                        selected
                          ? {
                              borderColor: "var(--tf-primary)",
                              backgroundColor: "var(--tf-bg-accent-soft)",
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-between w-full">
                        <span
                          className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                          style={{
                            backgroundColor: selected
                              ? "var(--tf-primary)"
                              : "var(--tf-bg-subtle)",
                            color: selected
                              ? "var(--tf-ink-on-primary)"
                              : "var(--tf-ink-muted)",
                          }}
                        >
                          {item.tag}
                        </span>
                        {selected && (
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: "var(--tf-primary)" }}
                          />
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-bold leading-snug">
                          {lang === "sw" ? item.swLabel : item.label}
                        </p>
                        <p
                          className="font-tabular text-[11px] mt-0.5"
                          style={{ color: "var(--tf-ink-muted)" }}
                        >
                          {item.unit}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* ============================================================ */}
          {/*  VIEW 1: COMMAND OVERVIEW (BENTO GRID)                       */}
          {/* ============================================================ */}
          {activeView === "overview" && (
            <div className="space-y-6">
              {/* Agronomic Risk Alerts Banner (when active) */}
              {weather?.agri_risk_alerts && weather.agri_risk_alerts.length > 0 && (
                <div
                  className="rounded-2xl px-4 py-3.5 border flex flex-col sm:flex-row sm:items-center gap-3"
                  style={{
                    backgroundColor: "var(--tf-bg-warning-soft)",
                    borderColor: "var(--tf-tertiary)",
                  }}
                >
                  <div className="flex items-center gap-2 shrink-0">
                    <AlertTriangle
                      className="h-4 w-4"
                      style={{ color: "var(--tf-tertiary)" }}
                    />
                    <span className="text-xs font-bold uppercase tracking-wider">
                      {lang === "sw" ? "Tahadhari za Kilimo" : "Field Risk Alerts"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {weather.agri_risk_alerts.slice(0, 3).map((alert, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2.5 py-1 rounded-lg"
                        style={{
                          backgroundColor: "var(--tf-bg-elevated)",
                          color: "var(--tf-ink-secondary)",
                          border: "1px solid var(--tf-border)",
                        }}
                      >
                        {alert}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Bento Row 1: Hero Commodity Ladder + Weather & Soil Telemetry */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Hero Commodity Pricing Card (7 cols) */}
                <div className="tf-card p-6 lg:col-span-7 flex flex-col justify-between gap-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <span
                        className="text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "var(--tf-primary)" }}
                      >
                        KAMIS & Mkulima National Benchmark
                      </span>
                      <h2 className="font-display text-2xl sm:text-3xl font-bold mt-1">
                        {lang === "sw" ? activeCropMeta.swLabel : activeCropMeta.label}
                        <span
                          className="text-base font-sans font-normal ml-2"
                          style={{ color: "var(--tf-ink-muted)" }}
                        >
                          / {prices?.unit || activeCropMeta.unit}
                        </span>
                      </h2>
                    </div>

                    {prices?.profit_margin_estimate !== undefined && (
                      <div
                        className="rounded-xl px-3 py-1.5 text-right"
                        style={{
                          backgroundColor: "var(--tf-bg-secondary-soft)",
                          color: "var(--tf-secondary)",
                        }}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wider">
                          Est. Gross Margin
                        </p>
                        <p className="font-tabular text-lg font-bold">
                          +{prices.profit_margin_estimate}%
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Three-Tier Editorial Price Progression */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div className="tf-subtle-box p-4">
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--tf-ink-muted)" }}
                      >
                        {t("farmGate", lang)}
                      </span>
                      <p className="font-tabular text-2xl font-bold mt-1.5">
                        {loading && !prices
                          ? "···"
                          : `KES ${prices?.farm_gate_price_ksh?.toLocaleString() ?? "N/A"}`}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: "var(--tf-secondary)" }}>
                        Producer baseline
                      </p>
                    </div>

                    <div
                      className="rounded-2xl p-4 border"
                      style={{
                        backgroundColor: "var(--tf-bg-accent-soft)",
                        borderColor: "var(--tf-primary)",
                      }}
                    >
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--tf-primary)" }}
                      >
                        {t("wholesale", lang)}
                      </span>
                      <p className="font-tabular text-2xl font-bold mt-1.5">
                        {loading && !prices
                          ? "···"
                          : `KES ${prices?.wholesale_price_ksh?.toLocaleString() ?? "N/A"}`}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: "var(--tf-ink-secondary)" }}>
                        National median hub
                      </p>
                    </div>

                    <div className="tf-subtle-box p-4">
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider"
                        style={{ color: "var(--tf-ink-muted)" }}
                      >
                        {t("retail", lang)}
                      </span>
                      <p className="font-tabular text-2xl font-bold mt-1.5">
                        {loading && !prices
                          ? "···"
                          : `KES ${prices?.retail_price_ksh?.toLocaleString() ?? "N/A"}`}
                      </p>
                      <p className="text-[11px] mt-1" style={{ color: "var(--tf-tertiary)" }}>
                        Consumer destination
                      </p>
                    </div>
                  </div>

                  {/* Status Footnote + Action Link */}
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t text-xs"
                    style={{ borderColor: "var(--tf-border)", color: "var(--tf-ink-muted)" }}
                  >
                    <span className="truncate max-w-md">
                      {prices?.data_status || "Live government & wholesale market bulletin"}
                    </span>
                    <button
                      onClick={() => setActiveView("markets")}
                      className="font-semibold flex items-center gap-1 cursor-pointer"
                      style={{ color: "var(--tf-primary)" }}
                    >
                      Compare {marketData?.markets?.length || ""} county markets
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Weather & Soil Telemetry Bento Card (5 cols) */}
                <div className="tf-card p-6 lg:col-span-5 flex flex-col justify-between gap-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <span
                        className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                        style={{ color: "var(--tf-secondary)" }}
                      >
                        <Sun className="h-3.5 w-3.5" /> Local Climate & Soil
                      </span>
                      <h3 className="font-display text-2xl font-bold mt-1">
                        {weather?.location || location}
                      </h3>
                      <p
                        className="text-xs capitalize mt-0.5"
                        style={{ color: "var(--tf-ink-muted)" }}
                      >
                        {weather?.condition || "Acquiring live weather..."}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="font-tabular text-4xl font-bold tracking-tight">
                        {weather?.current_temp !== undefined
                          ? `${Math.round(weather.current_temp)}°`
                          : "--°"}
                      </span>
                      <span className="text-xs block" style={{ color: "var(--tf-ink-muted)" }}>
                        Celsius
                      </span>
                    </div>
                  </div>

                  {/* Mini Telemetry Metrics */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div className="tf-subtle-box p-3">
                      <Droplets className="h-3.5 w-3.5 mb-1" style={{ color: "var(--tf-secondary)" }} />
                      <p className="font-tabular text-sm font-bold">
                        {weather?.humidity ?? "--"}%
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--tf-ink-muted)" }}>
                        Humidity
                      </p>
                    </div>
                    <div className="tf-subtle-box p-3">
                      <Wind className="h-3.5 w-3.5 mb-1" style={{ color: "var(--tf-primary)" }} />
                      <p className="font-tabular text-sm font-bold">
                        {weather?.wind_kph ?? "--"} <span className="text-[10px] font-normal">kph</span>
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--tf-ink-muted)" }}>
                        Wind
                      </p>
                    </div>
                    <div className="tf-subtle-box p-3">
                      <Thermometer className="h-3.5 w-3.5 mb-1" style={{ color: "var(--tf-tertiary)" }} />
                      <p className="font-tabular text-sm font-bold">
                        {weather?.soil_temperature_c !== undefined
                          ? `${weather.soil_temperature_c.toFixed(1)}°C`
                          : "--"}
                      </p>
                      <p className="text-[10px]" style={{ color: "var(--tf-ink-muted)" }}>
                        Soil (0cm)
                      </p>
                    </div>
                  </div>

                  {/* Soil Moisture Meter */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold flex items-center gap-1.5">
                        <Sprout className="h-3.5 w-3.5" style={{ color: "var(--tf-secondary)" }} />
                        {t("soilTitle", lang)}
                      </span>
                      <span className="font-tabular font-bold">
                        {weather?.soil_moisture_estimate !== undefined
                          ? `${weather.soil_moisture_estimate.toFixed(1)}%`
                          : "--"}
                      </span>
                    </div>
                    <div
                      className="h-2.5 w-full rounded-full overflow-hidden"
                      style={{ backgroundColor: "var(--tf-bg-subtle)" }}
                    >
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, Math.max(4, weather?.soil_moisture_estimate ?? 45))}%`,
                          backgroundColor: "var(--tf-secondary)",
                        }}
                      />
                    </div>
                    <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--tf-secondary)" }}>
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{weather?.soil_moisture_status || "Open-Meteo volumetric telemetry"}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* Bento Row 2: 14-Day Weather Chart + Price Tier Ladder Chart */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* 14-Day Weather Outlook (7 cols) */}
                <div className="tf-card p-6 lg:col-span-7">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
                    <div>
                      <h3 className="font-display text-lg font-bold flex items-center gap-2">
                        <CloudRain className="h-4 w-4" style={{ color: "var(--tf-secondary)" }} />
                        {t("forecastTitle", lang)}
                      </h3>
                      <p className="text-xs mt-0.5" style={{ color: "var(--tf-ink-muted)" }}>
                        Daily Max/Min temperature (°C) overlaid with expected rainfall (mm)
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]" style={{ color: "var(--tf-ink-muted)" }}>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: activeTheme.chart.secondary }}
                        />
                        Max °C
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: activeTheme.chart.primary }}
                        />
                        Rain mm
                      </span>
                    </div>
                  </div>
                  <div className="h-64 w-full min-w-0">
                    <ResponsiveContainer width="100%" height={256} minWidth={0}>
                      <ComposedChart data={weather?.forecast ?? []}>
                        <CartesianGrid strokeDasharray="3 3" stroke={activeTheme.chart.grid} />
                        <XAxis
                          dataKey="date"
                          fontSize={11}
                          stroke={activeTheme.chart.axis}
                          tickFormatter={(v) => String(v).slice(5)}
                        />
                        <YAxis yAxisId="left" fontSize={11} stroke={activeTheme.chart.axis} />
                        <YAxis
                          yAxisId="right"
                          orientation="right"
                          fontSize={11}
                          stroke={activeTheme.chart.axis}
                        />
                        <Tooltip content={<ThemedTooltip theme={activeTheme} />} />
                        <Area
                          yAxisId="right"
                          type="monotone"
                          dataKey="rain_mm"
                          fill={activeTheme.chart.primary}
                          fillOpacity={0.18}
                          stroke={activeTheme.chart.primary}
                          strokeWidth={2}
                          name="Rainfall (mm)"
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="max"
                          stroke={activeTheme.chart.secondary}
                          strokeWidth={2.5}
                          dot={false}
                          name="Max Temp (°C)"
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="min"
                          stroke={activeTheme.chart.tertiary}
                          strokeWidth={1.75}
                          strokeDasharray="4 4"
                          dot={false}
                          name="Min Temp (°C)"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Price Ladder Chart (5 cols) */}
                <div className="tf-card p-6 lg:col-span-5">
                  <div className="mb-5">
                    <h3 className="font-display text-lg font-bold flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" style={{ color: "var(--tf-primary)" }} />
                      {t("priceTierTitle", lang)}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: "var(--tf-ink-muted)" }}>
                      KES per {prices?.unit || activeCropMeta.unit} across value-chain stages
                    </p>
                  </div>
                  <div className="h-64 w-full min-w-0">
                    <ResponsiveContainer width="100%" height={256} minWidth={0}>
                      <BarChart data={priceBarData} barSize={44}>
                        <CartesianGrid strokeDasharray="3 3" stroke={activeTheme.chart.grid} vertical={false} />
                        <XAxis dataKey="name" stroke={activeTheme.chart.axis} fontSize={12} />
                        <YAxis stroke={activeTheme.chart.axis} fontSize={11} />
                        <Tooltip content={<ThemedTooltip theme={activeTheme} />} />
                        <Bar dataKey="price" radius={[10, 10, 0, 0]} name="Price (KES)">
                          {priceBarData.map((entry, index) => (
                            <Cell key={index} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Bento Row 3: Editorial Agronomic Intelligence Brief */}
              <div className="tf-card p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-8 w-8 rounded-lg flex items-center justify-center"
                      style={{
                        backgroundColor: "var(--tf-bg-accent-soft)",
                        color: "var(--tf-primary)",
                      }}
                    >
                      <Sparkles className="h-4 w-4" />
                    </div>
                    <div>
                      <h3 className="font-display text-lg font-bold">
                        {t("advisoryTitle", lang)}
                      </h3>
                      <p className="text-[11px]" style={{ color: "var(--tf-ink-muted)" }}>
                        Synthesized from Open-Meteo soil saturation & KAMIS price telemetry
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => openChat()}
                    className="tf-btn-primary px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Ask Follow-Up
                  </button>
                </div>

                <div
                  className="tf-subtle-box p-4 sm:p-5 text-sm leading-relaxed whitespace-pre-line"
                  style={{ color: "var(--tf-ink-secondary)" }}
                >
                  {advice ||
                    (loading
                      ? "Synthesizing weather, topsoil moisture, and market spreads..."
                      : "Advisory will appear once live market and weather telemetry sync completes.")}
                </div>

                {/* Clickable Quick Prompts */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wider"
                    style={{ color: "var(--tf-ink-muted)" }}
                  >
                    Quick ask:
                  </span>
                  {quickPrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => openChat(prompt)}
                      className="tf-btn-ghost px-3 py-1.5 rounded-full text-xs cursor-pointer"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/*  VIEW 2: LIVE MARKET LEDGER                                  */}
          {/* ============================================================ */}
          {activeView === "markets" && (
            <div className="tf-card p-5 sm:p-6 space-y-5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-bold">
                    County Market Ledger · {activeCropMeta.label}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: "var(--tf-ink-muted)" }}>
                    {marketData?.data_status || "Verified Ministry of Agriculture & wholesale surveys"} · Unit:{" "}
                    {prices?.unit || activeCropMeta.unit}
                  </p>
                </div>

                <div className="relative w-full md:w-72">
                  <Search
                    className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{ color: "var(--tf-ink-muted)" }}
                  />
                  <input
                    type="text"
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                    placeholder="Filter by market or county..."
                    className="tf-input w-full rounded-xl pl-9 pr-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* County Filter Chips */}
              {availableCounties.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                  <button
                    onClick={() => setSelectedCounty("ALL")}
                    className="px-3 py-1 rounded-full text-xs font-medium shrink-0 cursor-pointer"
                    style={
                      selectedCounty === "ALL"
                        ? {
                            backgroundColor: "var(--tf-primary)",
                            color: "var(--tf-ink-on-primary)",
                          }
                        : {
                            backgroundColor: "var(--tf-bg-subtle)",
                            color: "var(--tf-ink-secondary)",
                          }
                    }
                  >
                    All Counties ({marketData?.markets?.length ?? 0})
                  </button>
                  {availableCounties.map((cty) => (
                    <button
                      key={cty}
                      onClick={() => setSelectedCounty(cty)}
                      className="px-3 py-1 rounded-full text-xs font-medium shrink-0 cursor-pointer"
                      style={
                        selectedCounty === cty
                          ? {
                              backgroundColor: "var(--tf-primary)",
                              color: "var(--tf-ink-on-primary)",
                            }
                          : {
                              backgroundColor: "var(--tf-bg-subtle)",
                              color: "var(--tf-ink-secondary)",
                            }
                      }
                    >
                      {cty}
                    </button>
                  ))}
                </div>
              )}

              {/* Sortable Data Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr
                      className="border-b uppercase tracking-wider font-semibold"
                      style={{ borderColor: "var(--tf-border)", color: "var(--tf-ink-muted)" }}
                    >
                      <th className="py-3 px-3">
                        <button
                          onClick={() => toggleSort("market")}
                          className="inline-flex items-center gap-1 cursor-pointer"
                        >
                          Market Hub <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="py-3 px-3">County</th>
                      <th className="py-3 px-3 text-right">
                        <button
                          onClick={() => toggleSort("wholesale_price")}
                          className="inline-flex items-center gap-1 cursor-pointer"
                        >
                          Wholesale <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="py-3 px-3 text-right">
                        <button
                          onClick={() => toggleSort("retail_price")}
                          className="inline-flex items-center gap-1 cursor-pointer"
                        >
                          Retail <ArrowUpDown className="h-3 w-3" />
                        </button>
                      </th>
                      <th className="py-3 px-3 text-right">Spread</th>
                      <th className="py-3 px-3 text-right">Survey Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: "var(--tf-border)" }}>
                    {filteredMarkets.length > 0 ? (
                      filteredMarkets.map((m, idx) => {
                        const spreadPct =
                          m.wholesale_price && m.retail_price && m.wholesale_price > 0
                            ? (((m.retail_price - m.wholesale_price) / m.wholesale_price) * 100).toFixed(1)
                            : null;
                        return (
                          <tr
                            key={`${m.market}-${idx}`}
                            className="transition"
                            style={{ borderColor: "var(--tf-border)" }}
                          >
                            <td className="py-3 px-3 font-semibold flex items-center gap-2">
                              {m.is_key_market && (
                                <span
                                  className="h-2 w-2 rounded-full shrink-0"
                                  style={{ backgroundColor: "var(--tf-tertiary)" }}
                                  title="Primary Regional Hub"
                                />
                              )}
                              <span>{m.market}</span>
                            </td>
                            <td className="py-3 px-3" style={{ color: "var(--tf-ink-secondary)" }}>
                              {m.county || "Kenya"}
                            </td>
                            <td className="py-3 px-3 text-right font-tabular font-medium">
                              {m.wholesale_price ? `KES ${m.wholesale_price.toLocaleString()}` : "—"}
                            </td>
                            <td
                              className="py-3 px-3 text-right font-tabular font-bold"
                              style={{ color: "var(--tf-secondary)" }}
                            >
                              {m.retail_price ? `KES ${m.retail_price.toLocaleString()}` : "—"}
                            </td>
                            <td className="py-3 px-3 text-right font-tabular">
                              {spreadPct ? (
                                <span
                                  className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                                  style={{
                                    backgroundColor: "var(--tf-bg-accent-soft)",
                                    color: "var(--tf-primary)",
                                  }}
                                >
                                  +{spreadPct}%
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                            <td
                              className="py-3 px-3 text-right font-tabular text-[11px]"
                              style={{ color: "var(--tf-ink-muted)" }}
                            >
                              {m.date || "Recent"}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-10 text-center text-sm"
                          style={{ color: "var(--tf-ink-muted)" }}
                        >
                          {loading
                            ? "Loading live county surveys..."
                            : "No market surveys match your active filter for today."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/*  VIEW 3: SPATIAL ARBITRAGE RADAR                             */}
          {/* ============================================================ */}
          {activeView === "arbitrage" && (
            <div className="space-y-6">
              {/* Visual Corridor Banner */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="tf-card p-5 space-y-2">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: "var(--tf-secondary)" }}
                  >
                    <ArrowDownRight className="h-4 w-4" /> Cheapest Sourcing Hub
                  </span>
                  <p className="font-display text-2xl font-bold">
                    {analysisData?.recommendation?.cheapest_buy_market || "Kitale Wholesale"}
                  </p>
                  <p className="font-tabular text-lg font-bold" style={{ color: "var(--tf-secondary)" }}>
                    KES{" "}
                    {(
                      analysisData?.recommendation?.cheapest_buy_price ??
                      prices?.wholesale_price_ksh ??
                      3200
                    ).toLocaleString()}
                    <span className="text-xs font-sans font-normal ml-1" style={{ color: "var(--tf-ink-muted)" }}>
                      / {prices?.unit || activeCropMeta.unit}
                    </span>
                  </p>
                </div>

                <div className="tf-card p-5 space-y-2">
                  <span
                    className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: "var(--tf-primary)" }}
                  >
                    <ArrowUpRight className="h-4 w-4" /> Highest Destination Hub
                  </span>
                  <p className="font-display text-2xl font-bold">
                    {analysisData?.recommendation?.best_sell_market || "Nairobi Marikiti"}
                  </p>
                  <p className="font-tabular text-lg font-bold" style={{ color: "var(--tf-primary)" }}>
                    KES{" "}
                    {(
                      analysisData?.recommendation?.best_sell_price ??
                      prices?.retail_price_ksh ??
                      4800
                    ).toLocaleString()}
                    <span className="text-xs font-sans font-normal ml-1" style={{ color: "var(--tf-ink-muted)" }}>
                      / {prices?.unit || activeCropMeta.unit}
                    </span>
                  </p>
                </div>

                <div
                  className="tf-card p-5 space-y-2"
                  style={{ backgroundColor: "var(--tf-bg-accent-soft)", borderColor: "var(--tf-primary)" }}
                >
                  <span
                    className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                    style={{ color: "var(--tf-primary)" }}
                  >
                    <TrendingUp className="h-4 w-4" /> Gross Corridor Spread
                  </span>
                  <p className="font-tabular text-3xl font-bold">
                    KES{" "}
                    {Math.max(
                      0,
                      (analysisData?.recommendation?.best_sell_price ??
                        prices?.retail_price_ksh ??
                        4800) -
                        (analysisData?.recommendation?.cheapest_buy_price ??
                          prices?.wholesale_price_ksh ??
                          3200)
                    ).toLocaleString()}
                  </p>
                  <p className="text-xs" style={{ color: "var(--tf-ink-secondary)" }}>
                    Market volatility (CV):{" "}
                    <span className="font-tabular font-semibold">
                      {analysisData?.statistics?.volatility_cv_pct !== undefined
                        ? `${analysisData.statistics.volatility_cv_pct.toFixed(1)}%`
                        : "—"}
                    </span>
                    {analysisData?.nearest_market && analysisData?.distance_km !== null && (
                      <> · Nearest: {analysisData.nearest_market} ({analysisData.distance_km} km)</>
                    )}
                  </p>
                </div>
              </div>

              {/* Regional Spread Bar Chart */}
              <div className="tf-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-5">
                  <div>
                    <h3 className="font-display text-lg font-bold">
                      Regional Price vs. National Benchmark Median
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: "var(--tf-ink-muted)" }}>
                      Spot over-supplied producer belts and high-premium urban markets
                    </p>
                  </div>
                  <button
                    onClick={() => setActiveView("calculator")}
                    className="tf-btn-primary px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    Model Route Profit
                  </button>
                </div>

                {analysisData?.predictions && analysisData.predictions.length > 0 ? (
                  <div className="h-72 w-full min-w-0">
                    <ResponsiveContainer width="100%" height={288} minWidth={0}>
                      <BarChart
                        data={analysisData.predictions.map((p) => ({
                          market: p.market,
                          Local: p.current_price,
                          Benchmark: p.predicted_price,
                        }))}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke={activeTheme.chart.grid} />
                        <XAxis
                          dataKey="market"
                          stroke={activeTheme.chart.axis}
                          fontSize={11}
                          angle={-22}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis stroke={activeTheme.chart.axis} fontSize={11} />
                        <Tooltip content={<ThemedTooltip theme={activeTheme} />} />
                        <Bar
                          dataKey="Local"
                          fill={activeTheme.chart.primary}
                          radius={[6, 6, 0, 0]}
                          name="Local Price (KES)"
                        />
                        <Bar
                          dataKey="Benchmark"
                          fill={activeTheme.chart.tertiary}
                          radius={[6, 6, 0, 0]}
                          name="Benchmark Median (KES)"
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div
                    className="tf-subtle-box py-12 text-center text-sm"
                    style={{ color: "var(--tf-ink-muted)" }}
                  >
                    {loading
                      ? "Computing spatial arbitrage matrix..."
                      : "Waiting for multiple regional market reports to plot spatial spreads."}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/*  VIEW 4: DISPATCH & PROFIT LAB                               */}
          {/* ============================================================ */}
          {activeView === "calculator" && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Interactive Inputs Column (5 cols) */}
              <div className="tf-card p-6 lg:col-span-5 space-y-5">
                <div>
                  <h2 className="font-display text-xl font-bold flex items-center gap-2">
                    <Calculator className="h-5 w-5" style={{ color: "var(--tf-primary)" }} />
                    Dispatch & Margin Simulator
                  </h2>
                  <p className="text-xs mt-1" style={{ color: "var(--tf-ink-muted)" }}>
                    Stress-test load volume, freight, cess, and custom county prices before dispatching a lorry.
                  </p>
                </div>

                {/* Quantity Slider + Input */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <label className="font-semibold">
                      Load Quantity ({prices?.unit || activeCropMeta.unit})
                    </label>
                    <span className="font-tabular font-bold" style={{ color: "var(--tf-primary)" }}>
                      {calcQuantity} units
                    </span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={300}
                    step={5}
                    value={Math.min(300, calcQuantity)}
                    onChange={(e) => setCalcQuantity(Number(e.target.value))}
                    className="tf-slider w-full cursor-pointer"
                  />
                  <input
                    type="number"
                    min={1}
                    max={5000}
                    value={calcQuantity}
                    onChange={(e) => setCalcQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className="tf-input w-full rounded-xl px-3 py-2 text-sm font-tabular"
                  />
                </div>

                {/* Transport & Cess Cost */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <label className="font-semibold">Logistics, Loading & Cess (KES)</label>
                    <span className="font-tabular font-bold">
                      KES {calcTransportCost.toLocaleString()}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={80000}
                    step={500}
                    value={Math.min(80000, calcTransportCost)}
                    onChange={(e) => setCalcTransportCost(Number(e.target.value))}
                    className="tf-slider w-full cursor-pointer"
                  />
                  <input
                    type="number"
                    min={0}
                    step={500}
                    value={calcTransportCost}
                    onChange={(e) => setCalcTransportCost(Math.max(0, Number(e.target.value) || 0))}
                    className="tf-input w-full rounded-xl px-3 py-2 text-sm font-tabular"
                  />
                </div>

                {/* Custom Unit Price Overrides */}
                <div className="grid grid-cols-2 gap-3 pt-2 border-t" style={{ borderColor: "var(--tf-border)" }}>
                  <div>
                    <label className="text-[11px] font-semibold block mb-1" style={{ color: "var(--tf-ink-muted)" }}>
                      Buy Price Override (KES)
                    </label>
                    <input
                      type="number"
                      placeholder={String(calcResults.buyPrice)}
                      value={customBuyOverride}
                      onChange={(e) => setCustomBuyOverride(e.target.value)}
                      className="tf-input w-full rounded-xl px-3 py-2 text-xs font-tabular"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold block mb-1" style={{ color: "var(--tf-ink-muted)" }}>
                      Sell Price Override (KES)
                    </label>
                    <input
                      type="number"
                      placeholder={String(calcResults.sellPrice)}
                      value={customSellOverride}
                      onChange={(e) => setCustomSellOverride(e.target.value)}
                      className="tf-input w-full rounded-xl px-3 py-2 text-xs font-tabular"
                    />
                  </div>
                </div>
              </div>

              {/* Ledger Output Column (7 cols) */}
              <div className="tf-card p-6 lg:col-span-7 flex flex-col justify-between gap-6">
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-xl font-bold">Projected Dispatch Ledger</h3>
                    <span
                      className="font-tabular text-xs font-bold px-3 py-1 rounded-full"
                      style={{
                        backgroundColor:
                          calcResults.netProfit >= 0
                            ? "var(--tf-bg-secondary-soft)"
                            : "var(--tf-bg-warning-soft)",
                        color:
                          calcResults.netProfit >= 0
                            ? "var(--tf-secondary)"
                            : "var(--tf-danger)",
                      }}
                    >
                      ROI: {calcResults.roi.toFixed(1)}%
                    </span>
                  </div>

                  {/* Key Financial Tiles */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                    <div className="tf-subtle-box p-4">
                      <span className="text-[11px] uppercase font-semibold" style={{ color: "var(--tf-ink-muted)" }}>
                        Procurement
                      </span>
                      <p className="font-tabular text-xl font-bold mt-1">
                        KES {calcResults.totalPurchaseCost.toLocaleString()}
                      </p>
                      <span className="text-[11px] font-tabular" style={{ color: "var(--tf-ink-muted)" }}>
                        @ KES {calcResults.buyPrice.toLocaleString()} / unit
                      </span>
                    </div>

                    <div className="tf-subtle-box p-4">
                      <span className="text-[11px] uppercase font-semibold" style={{ color: "var(--tf-ink-muted)" }}>
                        Gross Revenue
                      </span>
                      <p className="font-tabular text-xl font-bold mt-1">
                        KES {calcResults.grossRevenue.toLocaleString()}
                      </p>
                      <span className="text-[11px] font-tabular" style={{ color: "var(--tf-ink-muted)" }}>
                        @ KES {calcResults.sellPrice.toLocaleString()} / unit
                      </span>
                    </div>

                    <div
                      className="rounded-2xl p-4 border"
                      style={{
                        backgroundColor:
                          calcResults.netProfit >= 0
                            ? "var(--tf-bg-secondary-soft)"
                            : "var(--tf-bg-warning-soft)",
                        borderColor:
                          calcResults.netProfit >= 0
                            ? "var(--tf-secondary)"
                            : "var(--tf-danger)",
                      }}
                    >
                      <span className="text-[11px] uppercase font-semibold" style={{ color: "var(--tf-ink-secondary)" }}>
                        Net Profit
                      </span>
                      <p
                        className="font-tabular text-xl font-bold mt-1"
                        style={{
                          color:
                            calcResults.netProfit >= 0
                              ? "var(--tf-secondary)"
                              : "var(--tf-danger)",
                        }}
                      >
                        KES {calcResults.netProfit.toLocaleString()}
                      </p>
                      <span className="text-[11px] font-tabular" style={{ color: "var(--tf-ink-muted)" }}>
                        Break-even: KES {Math.ceil(calcResults.breakEvenPerUnit).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  {/* Visual Allocation Bar */}
                  {calcResults.grossRevenue > 0 && (
                    <div className="space-y-2">
                      <div className="flex justify-between text-[11px]" style={{ color: "var(--tf-ink-muted)" }}>
                        <span>Revenue Allocation</span>
                        <span className="font-tabular">
                          Logistics share:{" "}
                          {((calcTransportCost / calcResults.grossRevenue) * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div
                        className="h-3.5 w-full rounded-full overflow-hidden flex"
                        style={{ backgroundColor: "var(--tf-bg-subtle)" }}
                      >
                        <div
                          style={{
                            width: `${Math.min(100, (calcResults.totalPurchaseCost / calcResults.grossRevenue) * 100)}%`,
                            backgroundColor: "var(--tf-ink-muted)",
                          }}
                          title="Procurement Cost"
                        />
                        <div
                          style={{
                            width: `${Math.min(100, (calcTransportCost / calcResults.grossRevenue) * 100)}%`,
                            backgroundColor: "var(--tf-tertiary)",
                          }}
                          title="Logistics & Cess"
                        />
                        {calcResults.netProfit > 0 && (
                          <div
                            style={{
                              width: `${Math.min(100, (calcResults.netProfit / calcResults.grossRevenue) * 100)}%`,
                              backgroundColor: "var(--tf-secondary)",
                            }}
                            title="Net Profit"
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap gap-4 text-[11px]" style={{ color: "var(--tf-ink-muted)" }}>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--tf-ink-muted)" }} />
                          Stock Cost
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--tf-tertiary)" }} />
                          Logistics & Cess
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: "var(--tf-secondary)" }} />
                          Net Margin
                        </span>
                      </div>
                    </div>
                  )}

                  <div
                    className="tf-subtle-box p-4 text-xs leading-relaxed"
                    style={{ color: "var(--tf-ink-secondary)" }}
                  >
                    Moving <strong className="font-tabular">{calcQuantity}</strong> units of{" "}
                    <strong>{activeCropMeta.label}</strong> from{" "}
                    <strong>
                      {analysisData?.recommendation?.cheapest_buy_market || "Production Hub"}
                    </strong>{" "}
                    to{" "}
                    <strong>
                      {analysisData?.recommendation?.best_sell_market || "Destination Hub"}
                    </strong>{" "}
                    requires <strong className="font-tabular">KES {calcResults.totalOutlay.toLocaleString()}</strong>{" "}
                    working capital (including logistics). Any selling price above{" "}
                    <strong className="font-tabular">
                      KES {Math.ceil(calcResults.breakEvenPerUnit).toLocaleString()}
                    </strong>{" "}
                    per unit is net profitable.
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() =>
                      openChat(
                        `Review my dispatch plan: ${calcQuantity} units of ${activeCropMeta.label}, buying at KES ${calcResults.buyPrice}, selling at KES ${calcResults.sellPrice}, logistics KES ${calcTransportCost}. What risks should I watch?`
                      )
                    }
                    className="tf-btn-primary px-4 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 cursor-pointer"
                  >
                    <Sparkles className="h-4 w-4" />
                    Stress-Test Route with Copilot AI
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================ */}
          {/*  VIEW 5: FIELD NOTES & FARMER FEEDBACK                       */}
          {/* ============================================================ */}
          {activeView === "feedback" && (
            <div className="max-w-2xl mx-auto tf-card p-6 sm:p-8 space-y-6">
              <div>
                <span
                  className="text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "var(--tf-primary)" }}
                >
                  Ground-Truth Reporting
                </span>
                <h2 className="font-display text-2xl font-bold mt-1">
                  Kenyan Farmer & Trader Field Notes
                </h2>
                <p className="text-xs mt-1" style={{ color: "var(--tf-ink-muted)" }}>
                  Report live county price shifts, transport bottlenecks, or feature requests directly to the Agriquant team.
                </p>
              </div>

              {fbSent ? (
                <div
                  className="rounded-2xl p-5 flex items-center gap-3 border text-sm font-semibold"
                  style={{
                    backgroundColor: "var(--tf-bg-secondary-soft)",
                    borderColor: "var(--tf-secondary)",
                    color: "var(--tf-secondary)",
                  }}
                >
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>Asante sana! Your field report has been logged.</span>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="text-xs font-semibold block mb-1">
                        Name or Cooperative *
                      </label>
                      <input
                        type="text"
                        value={fbName}
                        onChange={(e) => setFbName(e.target.value)}
                        placeholder="e.g. Mary Wanjiku / Kitale Traders"
                        className="tf-input w-full rounded-xl px-3.5 py-2.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-1">
                        Phone or Email (Optional)
                      </label>
                      <input
                        type="text"
                        value={fbEmail}
                        onChange={(e) => setFbEmail(e.target.value)}
                        placeholder="Optional contact"
                        className="tf-input w-full rounded-xl px-3.5 py-2.5 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-semibold block mb-1">
                      Market Report or Suggestion *
                    </label>
                    <textarea
                      rows={4}
                      value={fbMessage}
                      onChange={(e) => setFbMessage(e.target.value)}
                      placeholder="Share actual wholesale/retail rates in your local market or what data would help you most..."
                      className="tf-input w-full rounded-xl px-3.5 py-2.5 text-xs"
                    />
                  </div>

                  {fbError && (
                    <p className="text-xs font-medium" style={{ color: "var(--tf-danger)" }}>
                      {fbError}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs mr-2" style={{ color: "var(--tf-ink-muted)" }}>
                        Rating:
                      </span>
                      {[1, 2, 3, 4, 5].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setFbRating(s)}
                          className="p-1 cursor-pointer"
                          style={{
                            color:
                              s <= fbRating ? "var(--tf-tertiary)" : "var(--tf-border-strong)",
                          }}
                        >
                          <Star className="h-4 w-4 fill-current" />
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={async () => {
                        if (!fbName.trim() || !fbMessage.trim()) return;
                        setFbLoading(true);
                        setFbError(null);
                        try {
                          await axios.post(`${API_URL}/comments`, {
                            name: fbName.trim(),
                            email: fbEmail.trim(),
                            message: fbMessage.trim(),
                            rating: fbRating,
                          });
                          setFbSent(true);
                          setFbName("");
                          setFbEmail("");
                          setFbMessage("");
                          setTimeout(() => setFbSent(false), 6000);
                        } catch {
                          setFbError("Could not submit report right now. Please retry.");
                        } finally {
                          setFbLoading(false);
                        }
                      }}
                      disabled={fbLoading || !fbName.trim() || !fbMessage.trim()}
                      className="tf-btn-primary px-5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    >
                      {fbLoading ? "Submitting..." : "Submit Field Note"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>

        {/* Footer */}
        <footer
          className="border-t py-5 px-4 sm:px-6 lg:px-8 text-xs"
          style={{ borderColor: "var(--tf-border)", color: "var(--tf-ink-muted)" }}
        >
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <p>
              <strong style={{ color: "var(--tf-ink)" }}>Agriquant Kenya</strong> · KAMIS, Mkulima Online, WeatherAPI & Open-Meteo
            </p>
            <p className="font-tabular text-[11px]">
              Theme Factory: {activeTheme.name}
            </p>
          </div>
        </footer>
      </div>

      {/* ============================================================== */}
      {/*  Mobile Bottom Navigation Dock                                 */}
      {/* ============================================================== */}
      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t px-2 py-1.5 flex items-center justify-around backdrop-blur-md"
        style={{
          backgroundColor: "var(--tf-bg-elevated)",
          borderColor: "var(--tf-border)",
        }}
        aria-label="Mobile navigation"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveView(item.id)}
              className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl text-[10px] font-semibold cursor-pointer"
              style={{
                color: isActive ? "var(--tf-primary)" : "var(--tf-ink-muted)",
                backgroundColor: isActive ? "var(--tf-bg-accent-soft)" : "transparent",
              }}
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ============================================================== */}
      {/*  Mkulima Copilot Slide-Over Drawer                             */}
      {/* ============================================================== */}
      {chatOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-xs"
          onClick={() => setChatOpen(false)}
        >
          <div
            className="w-full max-w-md h-full flex flex-col shadow-2xl border-l"
            style={{
              backgroundColor: "var(--tf-bg-elevated)",
              borderColor: "var(--tf-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div
              className="p-4 border-b flex items-center justify-between"
              style={{ borderColor: "var(--tf-border)" }}
            >
              <div className="flex items-center gap-2.5">
                <div
                  className="h-8 w-8 rounded-lg flex items-center justify-center"
                  style={{
                    backgroundColor: "var(--tf-primary)",
                    color: "var(--tf-ink-on-primary)",
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold leading-tight">
                    {t("copilot", lang)}
                  </h3>
                  <p className="text-[11px]" style={{ color: "var(--tf-ink-muted)" }}>
                    Grounded in {location} · {activeCropMeta.label}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="tf-btn-ghost h-8 w-8 rounded-lg flex items-center justify-center cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages Thread */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs leading-relaxed">
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className="max-w-[85%] rounded-2xl px-4 py-2.5 whitespace-pre-line"
                    style={
                      msg.role === "user"
                        ? {
                            backgroundColor: "var(--tf-primary)",
                            color: "var(--tf-ink-on-primary)",
                            borderBottomRightRadius: "4px",
                          }
                        : {
                            backgroundColor: "var(--tf-bg-subtle)",
                            color: "var(--tf-ink)",
                            border: "1px solid var(--tf-border)",
                            borderBottomLeftRadius: "4px",
                          }
                    }
                  >
                    {msg.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div
                    className="tf-subtle-box px-3.5 py-2.5 flex items-center gap-2 text-xs"
                    style={{ color: "var(--tf-ink-muted)" }}
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--tf-primary)" }} />
                    <span>Consulting live market & weather feeds...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Bar */}
            <div className="p-3.5 border-t space-y-2" style={{ borderColor: "var(--tf-border)" }}>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder={t("chatPlaceholder", lang)}
                  className="tf-input flex-1 rounded-xl px-3.5 py-2.5 text-xs"
                />
                <button
                  onClick={() => sendChat()}
                  disabled={chatLoading || !chatInput.trim()}
                  className="tf-btn-primary px-3.5 rounded-xl flex items-center justify-center disabled:opacity-50 cursor-pointer"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

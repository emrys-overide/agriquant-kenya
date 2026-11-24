"use client";

import { useEffect, useRef, useState, useMemo, type ChangeEvent, type FormEvent } from "react";
import axios from "axios";
import {
  AlertTriangle,
  BarChart3,
  Cloud,
  Leaf,
  Loader2,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Send,
  Star,
  TrendingUp,
  X,
  Globe,
  Wind,
  Droplets,
  Thermometer,
  Sprout,
  MapPin,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Crosshair,
  Database,
  ShoppingCart,
  Lock,
  CheckCircle,
  User,
  Calculator,
  Search,
  ChevronRight,
  TrendingDown,
  Layers,
  Sparkles,
  Info,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/* ------------------------------------------------------------------ */
/*  Constants & Types                                                  */
/* ------------------------------------------------------------------ */

const API_URL =
  process.env.NODE_ENV === "development"
    ? "/api"
    : "https://agriquant-api.emryspaul7.workers.dev/api";

type Crop = "maize" | "tomatoes" | "cabbages" | "onions" | "french_beans" | "potatoes" | "wheat";

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

type MarketAnalysisEntry = {
  market: string;
  county: string;
  wholesale_price: number;
  retail_price: number;
  margin_pct: number;
  is_key_market: boolean;
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
  market_analysis: MarketAnalysisEntry[];
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
/*  Translations                                                       */
/* ------------------------------------------------------------------ */

const translations: Record<string, { en: string; sw: string }> = {
  liveData: { en: "Live Data Feed", sw: "Mtandao wa Data Hai" },
  liveWeather: { en: "Satellite & Weather Telemetry", sw: "Hali ya Anga na Satellite" },
  humidity: { en: "Humidity", sw: "Unyevu wa Hewa" },
  soilMoistureEst: { en: "Soil Saturation (Open-Meteo)", sw: "Unyevu wa Udongo (Open-Meteo)" },
  agriculturalRisks: { en: "Agronomic Risk Alerts", sw: "Tahadhari za Hatari za Kilimo" },
  marketIntelligence: { en: "National Benchmark Prices", sw: "Bei za Kitaifa" },
  farmGate: { en: "Farm Gate", sw: "Bei Shambani" },
  wholesale: { en: "Wholesale", sw: "Jumla" },
  retail: { en: "Retail", sw: "Rejareja" },
  forecast14: { en: "14-Day Weather & Rain Outlook", sw: "Utabiri wa Siku 14" },
  maxTemp: { en: "Max Temp", sw: "Joto la Juu" },
  minTemp: { en: "Min Temp", sw: "Joto la Chini" },
  rain: { en: "Precipitation", sw: "Kiwango cha Mvua" },
  smartAdvisory: { en: "Agronomic AI Intelligence", sw: "Ripoti ya Ushauri wa AI" },
  analyzingData: { en: "Synthesizing market telemetry...", sw: "Inachambua data ya masoko..." },
  chatTitle: { en: "Mkulima Copilot", sw: "Msaidizi wa Mkulima" },
  chatPlaceholder: { en: "Ask about crop diseases, market prices, or soil...", sw: "Uliza kuhusu masoko, magonjwa, au udongo..." },
  send: { en: "Send", sw: "Tuma" },
  ok: { en: "Apply", sw: "Sasisha" },
  fetching: { en: "Updating...", sw: "Inapakia..." },
  locationPlaceholder: { en: "County or town (e.g. Kitale, Nakuru)...", sw: "Kaunti au mji (mfano Kitale, Nakuru)..." },
  wind: { en: "Wind Speed", sw: "Kasi ya Upepo" },
  waitingWeather: { en: "Acquiring telemetry...", sw: "Inasubiri data ya hali ya hewa" },
  unavailable: { en: "Unavailable", sw: "Haipatikani" },
  soilTemp: { en: "Soil Temp (0cm)", sw: "Joto la Udongo" },
  arbitrageTitle: { en: "Spatial Arbitrage Matrix", sw: "Fursa za Arbitrage na Tofauti za Masoko" },
  calculatorTitle: { en: "Profit & Logistics Simulator", sw: "Kikokotoo cha Faida na Usafiri" },
};

function t(key: string, lang: "en" | "sw"): string {
  return translations[key]?.[lang] ?? key;
}

const cropOptions: { value: Crop; label: string; unit: string; icon: string }[] = [
  { value: "maize", label: "Dry Maize", unit: "90kg Bag", icon: "🌽" },
  { value: "tomatoes", label: "Fresh Tomatoes", unit: "30kg Crate", icon: "🍅" },
  { value: "potatoes", label: "Irish Potatoes", unit: "50kg Bag", icon: "🥔" },
  { value: "onions", label: "Red Dry Onions", unit: "1kg Net", icon: "🧅" },
  { value: "cabbages", label: "Green Cabbages", unit: "Medium Head", icon: "🥬" },
  { value: "french_beans", label: "French Beans", unit: "1kg Export", icon: "🌱" },
  { value: "wheat", label: "Clean Wheat", unit: "90kg Bag", icon: "🌾" },
];

/* ------------------------------------------------------------------ */
/*  Custom Tooltip Component                                           */
/* ------------------------------------------------------------------ */

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-emerald-500/30 bg-[#0f1914] px-4 py-3 shadow-2xl backdrop-blur-md">
      {label && <p className="mb-1 text-xs font-mono uppercase tracking-wider text-emerald-400">{label}</p>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs font-semibold py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-300">{entry.name}:</span>
          <span className="text-white font-mono">{typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Dashboard Component                                           */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [location, setLocation] = useState("Nanyuki");
  const [crop, setCrop] = useState<Crop>("maize");
  const [activeTab, setActiveTab] = useState<"overview" | "markets" | "arbitrage" | "calculator">("overview");

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [prices, setPrices] = useState<PriceData | null>(null);
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  /* Interactive Calculator State */
  const [calcQuantity, setCalcQuantity] = useState<number>(50);
  const [calcTransportCost, setCalcTransportCost] = useState<number>(8500);

  /* Chat State */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInitialized = useRef(false);

  /* Geolocation & Market Comparison */
  const [geoLoading, setGeoLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [marketData, setMarketData] = useState<MarketComparisonData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [marketSearch, setMarketSearch] = useState("");

  /* Feedback State */
  const [fbName, setFbName] = useState("");
  const [fbEmail, setFbEmail] = useState("");
  const [fbMessage, setFbMessage] = useState("");
  const [fbRating, setFbRating] = useState(5);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbSent, setFbSent] = useState(false);

  /* Admin State */
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPass, setAdminPass] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminComments, setAdminComments] = useState<any[]>([]);
  const [adminLoading, setAdminLoading] = useState(false);

  /* Quick Location Switcher */
  const popularTowns = ["Nairobi", "Eldoret", "Nakuru", "Kitale", "Meru", "Nanyuki", "Kisumu"];

  /* Data Fetching */
  useEffect(() => {
    let ignore = false;
    const fetchData = async () => {
      setLoading(true);
      try {
        const analysisUrl = userCoords
          ? `${API_URL}/analysis/${crop}?user_lat=${userCoords.lat}&user_lon=${userCoords.lon}`
          : `${API_URL}/analysis/${crop}`;

        const [weatherRes, pricesRes, marketsRes, analysisRes] = await Promise.all([
          axios.get<WeatherData>(`${API_URL}/weather/${location}`),
          axios.get<PriceData>(`${API_URL}/prices/${crop}`),
          axios.get<MarketComparisonData>(`${API_URL}/prices/${crop}/markets`, { timeout: 15000 }).catch(() => null),
          axios.get<AnalysisData>(analysisUrl, { timeout: 15000 }).catch(() => null),
        ]);

        const adviceRes = await axios
          .post<AdviceData>(`${API_URL}/advice`, {
            weather: weatherRes.data,
            prices: pricesRes.data,
            lang,
          })
          .catch(() => null);

        if (ignore) return;
        setWeather(weatherRes.data);
        setPrices(pricesRes.data);
        setMarketData(marketsRes?.data ?? null);
        setAnalysisData(analysisRes?.data ?? null);
        setAdvice(adviceRes?.data?.advisory_report ?? "");
        setError(null);
      } catch (err: any) {
        if (!ignore) {
          setError(err?.response?.data?.detail || "Could not retrieve live telemetry.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchData();
    return () => {
      ignore = true;
    };
  }, [fetchTrigger, crop, location, lang]);

  /* Geolocation Handler */
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
          const town = addr?.town || addr?.city || addr?.village || addr?.county || "My Farm";
          setLocation(town);
          setFetchTrigger((p) => p + 1);
        } catch {
          setLocation(`${latitude.toFixed(2)}, ${longitude.toFixed(2)}`);
          setFetchTrigger((p) => p + 1);
        } finally {
          setGeoLoading(false);
        }
      },
      () => setGeoLoading(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /* Chat logic */
  const openChat = () => {
    if (!chatInitialized.current) {
      setChatMessages([
        {
          role: "assistant",
          content: lang === "sw"
            ? "Jambo! Mimi ni Mkulima Copilot. Niulize kuhusu mabadiliko ya bei, hali ya udongo, au masoko ya karibu."
            : "Hello! I am Mkulima Copilot. Ask me about real-time market spreads, soil saturation, or arbitrage opportunities.",
        },
      ]);
      chatInitialized.current = true;
    }
    setChatOpen(true);
  };

  const sendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading) return;
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
      const reply = res.data?.reply || res.data?.message || res.data?.content || "No reply available.";
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: "Chat service currently unavailable." }]);
    } finally {
      setChatLoading(false);
    }
  };

  /* Filtered Markets */
  const filteredMarkets = useMemo(() => {
    if (!marketData?.markets) return [];
    if (!marketSearch.trim()) return marketData.markets;
    const term = marketSearch.toLowerCase();
    return marketData.markets.filter(
      (m) => m.market.toLowerCase().includes(term) || (m.county && m.county.toLowerCase().includes(term))
    );
  }, [marketData, marketSearch]);

  /* Calculator Calculations */
  const calcResults = useMemo(() => {
    const buyPrice = analysisData?.recommendation?.cheapest_buy_price || prices?.wholesale_price_ksh || 3500;
    const sellPrice = analysisData?.recommendation?.best_sell_price || prices?.retail_price_ksh || 4800;
    const grossRevenue = sellPrice * calcQuantity;
    const totalPurchaseCost = buyPrice * calcQuantity;
    const netProfit = grossRevenue - totalPurchaseCost - calcTransportCost;
    const roi = totalPurchaseCost + calcTransportCost > 0 ? (netProfit / (totalPurchaseCost + calcTransportCost)) * 100 : 0;
    return {
      buyPrice,
      sellPrice,
      grossRevenue,
      totalPurchaseCost,
      netProfit,
      roi: roi.toFixed(1),
    };
  }, [analysisData, prices, calcQuantity, calcTransportCost]);

  /* Price Bar Chart Data */
  const priceBarData = [
    { name: t("farmGate", lang), price: prices?.farm_gate_price_ksh || 0, fill: "#10b981" },
    { name: t("wholesale", lang), price: prices?.wholesale_price_ksh || 0, fill: "#06b6d4" },
    { name: t("retail", lang), price: prices?.retail_price_ksh || 0, fill: "#f59e0b" },
  ];

  return (
    <div className="min-h-screen bg-[#070b09] text-gray-100 bg-grid-pattern relative selection:bg-emerald-500 selection:text-black">
      {/* Ambient Top Glow */}
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[360px] bg-gradient-to-b from-emerald-500/10 via-teal-500/5 to-transparent blur-3xl" />

      {/* Navigation Header */}
      <header className="sticky top-0 z-40 border-b border-emerald-950/60 bg-[#070b09]/80 backdrop-blur-xl">
        <div className="kenya-gradient-line" />
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          {/* Logo & Status */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 shadow-lg shadow-emerald-900/40 text-black">
              <Leaf className="h-6 w-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-bold tracking-tight text-white">AGRIQUANT</span>
                <span className="rounded bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400">KENYA v2.0</span>
              </div>
              <p className="text-[11px] text-gray-400 font-sans">Full-Stack Agricultural Intelligence & Arbitrage</p>
            </div>
          </div>

          {/* Interactive Navigation Tabs */}
          <div className="flex items-center rounded-xl bg-emerald-950/40 border border-emerald-800/40 p-1">
            <button
              onClick={() => setActiveTab("overview")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "overview" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab("markets")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "markets" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              Live Markets
            </button>
            <button
              onClick={() => setActiveTab("arbitrage")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "arbitrage" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              Spatial Spreads
            </button>
            <button
              onClick={() => setActiveTab("calculator")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                activeTab === "calculator" ? "bg-emerald-600 text-white shadow" : "text-gray-400 hover:text-white"
              }`}
            >
              Profit Simulator
            </button>
          </div>

          {/* Controls: Language, Copilot & Refresh */}
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setLang(lang === "en" ? "sw" : "en")}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-800/40 bg-emerald-950/30 px-3 py-1.5 text-xs font-mono text-emerald-300 hover:bg-emerald-900/40 transition"
            >
              <Globe className="h-3.5 w-3.5 text-emerald-400" />
              <span>{lang.toUpperCase()}</span>
            </button>

            <button
              onClick={openChat}
              className="flex items-center gap-2 rounded-lg bg-emerald-600/90 hover:bg-emerald-500 text-white px-3.5 py-1.5 text-xs font-semibold shadow-md shadow-emerald-900/30 transition cursor-pointer"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-300" />
              <span>Copilot AI</span>
            </button>
          </div>
        </div>

        {/* Dynamic Location & Quick Filter Sub-bar */}
        <div className="border-t border-emerald-950/40 bg-[#09110d]/90 px-4 sm:px-6 py-2.5">
          <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-3">
            {/* Quick Towns */}
            <div className="flex items-center gap-1.5 overflow-x-auto text-xs py-1">
              <span className="text-gray-500 flex items-center gap-1 text-[11px] font-mono mr-1">
                <MapPin className="h-3.5 w-3.5 text-emerald-500" /> HUB:
              </span>
              {popularTowns.map((town) => (
                <button
                  key={town}
                  onClick={() => {
                    setLocation(town);
                    setFetchTrigger((p) => p + 1);
                  }}
                  className={`rounded-full px-2.5 py-0.5 text-xs transition ${
                    location.toLowerCase() === town.toLowerCase()
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold"
                      : "text-gray-400 hover:text-gray-200 bg-white/5"
                  }`}
                >
                  {town}
                </button>
              ))}
            </div>

            {/* Custom Location Search */}
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && setFetchTrigger((p) => p + 1)}
                  placeholder="Type any Kenyan town..."
                  className="w-48 rounded-lg glass-input px-3 py-1 text-xs placeholder-gray-500"
                />
              </div>
              <button
                onClick={handleGeoLocate}
                disabled={geoLoading}
                title="Locate with GPS"
                className="flex items-center justify-center h-7 w-7 rounded-lg border border-emerald-800/40 bg-emerald-950/30 text-emerald-400 hover:bg-emerald-900/40 transition"
              >
                {geoLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => setFetchTrigger((p) => p + 1)}
                className="flex items-center gap-1 rounded-lg bg-emerald-700/60 hover:bg-emerald-600 text-white px-2.5 py-1 text-xs font-medium transition"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                <span>Sync</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="mx-auto max-w-7xl px-4 sm:px-6 py-6 space-y-6">
        {/* Interactive Crop Selector Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
          {cropOptions.map((c) => {
            const isSelected = crop === c.value;
            return (
              <button
                key={c.value}
                onClick={() => setCrop(c.value)}
                className={`flex flex-col items-start p-3 rounded-xl border transition-all text-left ${
                  isSelected
                    ? "border-emerald-500 bg-gradient-to-b from-emerald-950/60 to-emerald-950/20 shadow-lg shadow-emerald-950/50"
                    : "border-emerald-950/60 bg-[#0d1612]/60 hover:border-emerald-800/50 hover:bg-[#121f19]/80"
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xl">{c.icon}</span>
                  {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-ping" />}
                </div>
                <span className={`text-xs font-semibold ${isSelected ? "text-emerald-300" : "text-gray-200"}`}>
                  {c.label}
                </span>
                <span className="text-[10px] text-gray-500 font-mono mt-0.5">{c.unit}</span>
              </button>
            );
          })}
        </div>

        {/* Tab 1: Overview Dashboard */}
        {activeTab === "overview" && (
          <div className="space-y-6">
            {/* Top Stat Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Soil Moisture & Saturation */}
              <div className="glass-panel p-5 relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                    <Sprout className="h-4 w-4" /> Topsoil Telemetry
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">0–1cm depth</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono text-white">
                    {weather?.soil_moisture_estimate !== undefined ? `${weather.soil_moisture_estimate.toFixed(1)}%` : "--"}
                  </span>
                  <span className="text-xs text-gray-400 font-mono">volumetric</span>
                </div>
                <div className="mt-3 w-full bg-gray-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-emerald-500 h-full rounded-full transition-all duration-700"
                    style={{ width: `${Math.min(100, Math.max(0, weather?.soil_moisture_estimate ?? 50))}%` }}
                  />
                </div>
                <p className="mt-2.5 text-xs text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                  <span>{weather?.soil_moisture_status || "Optimal Field Capacity"}</span>
                </p>
              </div>

              {/* Card 2: Wholesale Benchmark */}
              <div className="glass-panel p-5 relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-1.5">
                    <Database className="h-4 w-4" /> Wholesale Benchmark
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">KAMIS Median</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono text-cyan-300">
                    KES {prices?.wholesale_price_ksh?.toLocaleString() ?? "N/A"}
                  </span>
                </div>
                <p className="mt-4 text-xs text-gray-400">
                  Unit: <span className="text-gray-200 font-medium">{prices?.unit || "90kg Bag"}</span>
                </p>
                <div className="mt-1 text-[11px] text-cyan-400/80 truncate">
                  {prices?.data_status || "Live government market bulletin"}
                </div>
              </div>

              {/* Card 3: Retail Spread & Margin */}
              <div className="glass-panel p-5 relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <TrendingUp className="h-4 w-4" /> Retail Arbitrage Spread
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">Market Premium</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold font-mono text-amber-300">
                    KES {prices?.retail_price_ksh?.toLocaleString() ?? "N/A"}
                  </span>
                  {prices?.profit_margin_estimate !== undefined && (
                    <span className="text-xs font-mono font-semibold text-emerald-400">
                      +{prices.profit_margin_estimate}%
                    </span>
                  )}
                </div>
                <p className="mt-4 text-xs text-gray-400">
                  Farm gate estimate: <span className="text-gray-200 font-mono font-medium">KES {prices?.farm_gate_price_ksh?.toLocaleString() ?? "N/A"}</span>
                </p>
                <div className="mt-1 text-[11px] text-amber-400/80">
                  Estimated trader gross margin
                </div>
              </div>

              {/* Card 4: Local Weather & Rain Risk */}
              <div className="glass-panel p-5 relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono uppercase tracking-wider text-blue-400 flex items-center gap-1.5">
                    <Cloud className="h-4 w-4" /> Weather: {weather?.location || location}
                  </span>
                  <span className="text-[10px] text-gray-500 font-mono">{weather?.current_temp ?? "--"}°C</span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-white capitalize">{weather?.condition || "Sunny / Clear"}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400 font-mono">
                  <div className="flex items-center gap-1">
                    <Droplets className="h-3.5 w-3.5 text-blue-400" />
                    <span>{weather?.humidity ?? "--"}% Hum</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Wind className="h-3.5 w-3.5 text-gray-400" />
                    <span>{weather?.wind_kph ?? "--"} kph</span>
                  </div>
                </div>
                {weather?.soil_temperature_c !== undefined && (
                  <p className="mt-2 text-[11px] text-gray-400">
                    Soil Temp: <span className="text-white font-mono">{weather.soil_temperature_c.toFixed(1)}°C</span>
                  </p>
                )}
              </div>
            </div>

            {/* Split Charts: 14-Day Outlook & National Benchmark Comparison */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 14-Day Forecast Chart */}
              <div className="glass-panel p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Cloud className="h-4 w-4 text-cyan-400" /> 14-Day Precipitation & Temperature
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">High / Low Temperature (°C) vs Expected Rainfall (mm)</p>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weather?.forecast ?? []}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#16291e" />
                      <XAxis dataKey="date" fontSize={11} stroke="#64748b" tickFormatter={(v) => v.slice(5)} />
                      <YAxis yAxisId="left" stroke="#10b981" fontSize={11} />
                      <YAxis yAxisId="right" orientation="right" stroke="#06b6d4" fontSize={11} />
                      <Tooltip content={<CustomTooltip />} />
                      <Line yAxisId="left" type="monotone" dataKey="max" stroke="#10b981" strokeWidth={2} name="Max Temp (°C)" dot={false} />
                      <Line yAxisId="left" type="monotone" dataKey="min" stroke="#34d399" strokeWidth={1.5} name="Min Temp (°C)" dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="rain_mm" stroke="#06b6d4" strokeWidth={2} name="Rainfall (mm)" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Price Breakdown Bar Chart */}
              <div className="glass-panel p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <BarChart3 className="h-4 w-4 text-emerald-400" /> Price Structure Breakdown
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">Comparison across Farm Gate, Wholesale & Retail Tiers (KES)</p>
                  </div>
                </div>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={priceBarData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#16291e" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(16,185,129,0.05)" }} />
                      <Bar dataKey="price" radius={[8, 8, 0, 0]} name="Price (KES)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Agronomic AI Advisory Card */}
            <div className="glass-panel p-6 border-l-4 border-l-emerald-500">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm uppercase tracking-wider">
                  <Sparkles className="h-4 w-4 text-amber-400" /> Mkulima Intelligence Advisory
                </div>
                <span className="text-[11px] font-mono text-gray-500">Grounded in Open-Meteo & KAMIS Data</span>
              </div>
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line bg-emerald-950/20 p-4 rounded-xl border border-emerald-900/30">
                {advice || "Synthesizing soil moisture dynamics and market pricing advisory..."}
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Live Markets Table */}
        {activeTab === "markets" && (
          <div className="space-y-4">
            <div className="glass-panel p-5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Database className="h-4 w-4 text-emerald-400" /> Verified Market Comparison
                  </h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Live county-level price surveys for <span className="text-emerald-400 font-semibold">{crop}</span> ({prices?.unit})
                  </p>
                </div>
                {/* Search Bar */}
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-gray-400" />
                  <input
                    type="text"
                    value={marketSearch}
                    onChange={(e) => setMarketSearch(e.target.value)}
                    placeholder="Search market or county..."
                    className="w-full pl-9 pr-3 py-1.5 rounded-lg glass-input text-xs"
                  />
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-emerald-950/60 text-gray-400 font-mono uppercase">
                      <th className="py-2.5 px-3">Market Hub</th>
                      <th className="py-2.5 px-3">County</th>
                      <th className="py-2.5 px-3 text-right">Wholesale Price</th>
                      <th className="py-2.5 px-3 text-right">Retail Price</th>
                      <th className="py-2.5 px-3">Sources</th>
                      <th className="py-2.5 px-3 text-right">Survey Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-950/40">
                    {filteredMarkets.length > 0 ? (
                      filteredMarkets.map((m, idx) => (
                        <tr key={idx} className="hover:bg-emerald-950/30 transition">
                          <td className="py-2.5 px-3 font-semibold text-white flex items-center gap-1.5">
                            {m.is_key_market && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Key Hub" />}
                            <span>{m.market}</span>
                          </td>
                          <td className="py-2.5 px-3 text-gray-400">{m.county || "Kenya"}</td>
                          <td className="py-2.5 px-3 text-right font-mono text-cyan-300">
                            {m.wholesale_price ? `KES ${m.wholesale_price.toLocaleString()}` : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-emerald-400 font-semibold">
                            {m.retail_price ? `KES ${m.retail_price.toLocaleString()}` : "—"}
                          </td>
                          <td className="py-2.5 px-3 text-gray-500 font-mono text-[10px]">
                            {m.sources?.join(", ") || "KAMIS / Mkulima"}
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-500 font-mono text-[10px]">
                            {m.date || "Recent"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-500">
                          No market surveys match your filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Spatial Arbitrage Matrix */}
        {activeTab === "arbitrage" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Best Market to Sell */}
              <div className="glass-panel p-5 border-l-4 border-l-emerald-500">
                <span className="text-xs font-mono uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-1">
                  <ArrowUpRight className="h-4 w-4" /> Recommended Destination Hub (Top Price)
                </span>
                <p className="text-2xl font-bold font-mono text-white">
                  {analysisData?.recommendation?.best_sell_market || "Nairobi Marikiti"}
                </p>
                <p className="text-lg font-mono text-emerald-400 mt-1">
                  KES {analysisData?.recommendation?.best_sell_price?.toLocaleString() || "4,800"} / {prices?.unit}
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Highest wholesale margin recorded across Kenya today.
                </p>
              </div>

              {/* Cheapest Sourcing Hub */}
              <div className="glass-panel p-5 border-l-4 border-l-cyan-500">
                <span className="text-xs font-mono uppercase tracking-wider text-cyan-400 flex items-center gap-1.5 mb-1">
                  <ArrowDownRight className="h-4 w-4" /> Production & Farm Hub (Lowest Buy Price)
                </span>
                <p className="text-2xl font-bold font-mono text-white">
                  {analysisData?.recommendation?.cheapest_buy_market || "Kitale Wholesale"}
                </p>
                <p className="text-lg font-mono text-cyan-400 mt-1">
                  KES {analysisData?.recommendation?.cheapest_buy_price?.toLocaleString() || "3,200"} / {prices?.unit}
                </p>
                <p className="text-xs text-gray-400 mt-2">
                  Source harvest directly from agricultural production belt to maximize spread.
                </p>
              </div>
            </div>

            {/* Spatial Spread Bar Chart */}
            {analysisData?.predictions && analysisData.predictions.length > 0 && (
              <div className="glass-panel p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-violet-400" /> Regional Price Arbitrage Comparison
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">Local Market Price vs National Benchmark Median</p>
                  </div>
                </div>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={analysisData.predictions.map((p) => ({
                        market: p.market,
                        Local: p.current_price,
                        Benchmark: p.predicted_price,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#16291e" />
                      <XAxis dataKey="market" stroke="#64748b" fontSize={11} angle={-25} textAnchor="end" height={50} />
                      <YAxis stroke="#64748b" fontSize={11} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="Local" fill="#8b5cf6" radius={[6, 6, 0, 0]} name="Local Price (KES)" />
                      <Bar dataKey="Benchmark" fill="#06b6d4" radius={[6, 6, 0, 0]} name="Benchmark Median (KES)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: Interactive Profit & Logistics Simulator */}
        {activeTab === "calculator" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Input Controls */}
            <div className="glass-panel p-6 space-y-5 lg:col-span-1">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Calculator className="h-4 w-4 text-emerald-400" /> Dispatch Simulator
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                Estimate net profits for consolidating and transporting crops between production hubs and urban centers.
              </p>

              <div>
                <label className="text-xs text-gray-300 font-medium block mb-1">
                  Quantity ({prices?.unit || "Units"})
                </label>
                <input
                  type="number"
                  min="1"
                  max="1000"
                  value={calcQuantity}
                  onChange={(e) => setCalcQuantity(Number(e.target.value) || 1)}
                  className="w-full rounded-lg glass-input px-3 py-2 text-sm font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-gray-300 font-medium block mb-1">
                  Freight & Logistics Cost (KES)
                </label>
                <input
                  type="number"
                  min="0"
                  step="500"
                  value={calcTransportCost}
                  onChange={(e) => setCalcTransportCost(Number(e.target.value) || 0)}
                  className="w-full rounded-lg glass-input px-3 py-2 text-sm font-mono"
                />
                <span className="text-[10px] text-gray-500 mt-1 block">Trucking, loading & county cess fees</span>
              </div>

              <div className="pt-2 border-t border-emerald-950/60">
                <div className="flex justify-between text-xs py-1">
                  <span className="text-gray-400">Sourcing Hub:</span>
                  <span className="text-cyan-400 font-mono font-medium">{analysisData?.recommendation?.cheapest_buy_market || "Kitale"}</span>
                </div>
                <div className="flex justify-between text-xs py-1">
                  <span className="text-gray-400">Target Hub:</span>
                  <span className="text-emerald-400 font-mono font-medium">{analysisData?.recommendation?.best_sell_market || "Nairobi"}</span>
                </div>
              </div>
            </div>

            {/* Simulated Ledger & Returns */}
            <div className="glass-panel p-6 lg:col-span-2 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-amber-400" /> Projected Yield Ledger
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-[#0b1410] p-4 rounded-xl border border-emerald-900/40">
                    <span className="text-[11px] text-gray-400 uppercase font-mono block">Procurement Cost</span>
                    <span className="text-xl font-bold font-mono text-cyan-300 mt-1 block">
                      KES {calcResults.totalPurchaseCost.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-gray-500">@ KES {calcResults.buyPrice.toLocaleString()} / unit</span>
                  </div>

                  <div className="bg-[#0b1410] p-4 rounded-xl border border-emerald-900/40">
                    <span className="text-[11px] text-gray-400 uppercase font-mono block">Gross Dispatch Revenue</span>
                    <span className="text-xl font-bold font-mono text-white mt-1 block">
                      KES {calcResults.grossRevenue.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-gray-500">@ KES {calcResults.sellPrice.toLocaleString()} / unit</span>
                  </div>

                  <div className={`p-4 rounded-xl border ${calcResults.netProfit >= 0 ? "bg-emerald-950/30 border-emerald-500/40" : "bg-red-950/30 border-red-500/40"}`}>
                    <span className="text-[11px] text-gray-400 uppercase font-mono block">Estimated Net Profit</span>
                    <span className={`text-xl font-bold font-mono mt-1 block ${calcResults.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      KES {calcResults.netProfit.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">ROI: {calcResults.roi}%</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/30 text-xs text-gray-300 leading-relaxed">
                  <p className="font-semibold text-emerald-400 mb-1 flex items-center gap-1.5">
                    <Info className="h-4 w-4" /> Strategy Brief:
                  </p>
                  Transporting {calcQuantity} units of {crop} from {analysisData?.recommendation?.cheapest_buy_market || "Production Hub"} to {analysisData?.recommendation?.best_sell_market || "Nairobi"} yields a gross margin of KES {(calcResults.grossRevenue - calcResults.totalPurchaseCost).toLocaleString()}. After factoring in KES {calcTransportCost.toLocaleString()} logistics, your estimated net return is KES {calcResults.netProfit.toLocaleString()}.
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={openChat}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold shadow transition"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>Discuss route with Copilot AI</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Community Feedback Section */}
        <section className="glass-panel p-6 sm:p-8 mt-12 border-t border-emerald-900/40">
          <div className="max-w-2xl mx-auto text-center">
            <h3 className="text-lg font-bold text-white mb-1">Kenyan Farmer & Trader Feedback</h3>
            <p className="text-xs text-gray-400 mb-6">
              Share localized market ground truth, price corrections, or feature requests.
            </p>

            {fbSent ? (
              <div className="bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 p-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-2">
                <CheckCircle className="h-4 w-4" /> Feedback received. Asante sana!
              </div>
            ) : (
              <div className="space-y-3 text-left">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    value={fbName}
                    onChange={(e) => setFbName(e.target.value)}
                    placeholder="Your Name / Organization"
                    className="glass-input rounded-lg px-3 py-2 text-xs"
                  />
                  <input
                    type="email"
                    value={fbEmail}
                    onChange={(e) => setFbEmail(e.target.value)}
                    placeholder="Phone or Email (Optional)"
                    className="glass-input rounded-lg px-3 py-2 text-xs"
                  />
                </div>
                <textarea
                  value={fbMessage}
                  onChange={(e) => setFbMessage(e.target.value)}
                  placeholder="Tell us about price shifts in your local market or report discrepancies..."
                  rows={3}
                  className="glass-input w-full rounded-lg px-3 py-2 text-xs"
                />
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFbRating(s)}
                        className={`p-1 ${s <= fbRating ? "text-amber-400" : "text-gray-600"}`}
                      >
                        <Star className="h-4 w-4 fill-current" />
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={async () => {
                      if (!fbName.trim() || !fbMessage.trim()) return;
                      setFbLoading(true);
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
                        setTimeout(() => setFbSent(false), 5000);
                      } catch {
                        // ignore error
                      } finally {
                        setFbLoading(false);
                      }
                    }}
                    disabled={fbLoading || !fbName.trim() || !fbMessage.trim()}
                    className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-semibold transition disabled:opacity-50"
                  >
                    {fbLoading ? "Sending..." : "Submit Report"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>

      {/* Floating Copilot AI Modal */}
      {chatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-lg flex flex-col h-[560px] border border-emerald-500/40 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-emerald-950/60 bg-emerald-950/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-amber-400" />
                <span className="font-bold text-sm text-white">Mkulima Copilot AI</span>
              </div>
              <button onClick={() => setChatOpen(false)} className="text-gray-400 hover:text-white p-1">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs leading-relaxed">
              {chatMessages.map((m, idx) => (
                <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      m.role === "user"
                        ? "bg-emerald-600 text-white rounded-br-none"
                        : "bg-emerald-950/60 border border-emerald-900/40 text-gray-200 rounded-bl-none"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-emerald-950/40 border border-emerald-900/30 px-3 py-2 rounded-xl text-gray-400 flex items-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin text-emerald-400" />
                    <span>Consulting agricultural telemetry...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input bar */}
            <div className="p-3 border-t border-emerald-950/60 bg-[#0a120e]">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder="Ask a question..."
                  className="flex-1 rounded-lg glass-input px-3 py-2 text-xs"
                />
                <button
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50 transition"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="mt-12 border-t border-emerald-950/60 py-6 text-center text-xs text-gray-500 font-mono">
        <p>AGRIQUANT KENYA • Real-time KAMIS, Mkulima Online, WeatherAPI & Open-Meteo Integration</p>
        <p className="mt-1 text-[11px] text-gray-600">Built for Kenyan Agribusinesses, Farmers & Freight Operators</p>
      </footer>
    </div>
  );
}

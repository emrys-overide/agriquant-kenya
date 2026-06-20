"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import axios from "axios";
import {
  AlertTriangle,
  BarChart as BarChartIcon,
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
  Navigation,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Crosshair,
  BarChart3,
  Database,
  ShoppingCart,
  Wheat,
  Lock,
  CheckCircle,
  User,
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
  current_temp: number;
  condition: string;
  humidity: number;
  wind_kph: number;
  soil_moisture_estimate: number;
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
};

type AnalysisData = {
  crop: string;
  unit: string;
  kg_per_unit: number;
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
  liveData: { en: "Live Data", sw: "Data Hai" },
  liveWeather: { en: "Live Weather", sw: "Hali ya Hewa" },
  humidity: { en: "Humidity", sw: "Unyevu" },
  soilMoistureEst: { en: "Soil Moisture Est.", sw: "Makadirio ya Unyevu wa Udongo" },
  agriculturalRisks: { en: "Agricultural Risks", sw: "Hatari za Kilimo" },
  marketIntelligence: { en: "Market Intelligence", sw: "Taarifa za Soko" },
  farmGate: { en: "Farm Gate", sw: "Bei Shambani" },
  wholesale: { en: "Wholesale", sw: "Jumla" },
  retail: { en: "Retail", sw: "Rejareja" },
  forecast14: { en: "14-Day Forecast", sw: "Utabiri wa Siku 14" },
  maxTemp: { en: "Max Temp", sw: "Joto la Juu" },
  minTemp: { en: "Min Temp", sw: "Joto la Chini" },
  rain: { en: "Rain", sw: "Mvua" },
  smartAdvisory: { en: "Smart Advisory Report", sw: "Taarifa ya Ushauri" },
  analyzingData: { en: "Analyzing data...", sw: "Inachambua data..." },
  chatTitle: { en: "Ask Mkulima AI", sw: "Uliza Mkulima AI" },
  chatPlaceholder: { en: "Type your question...", sw: "Andika swali lako..." },
  send: { en: "Send", sw: "Tuma" },
  footerCredits: {
    en: "Data Sources: KAMIS (kamis.kilimo.go.ke), WeatherAPI. Built for Kenyan Farmers.",
    sw: "Vyanzo vya Data: KAMIS (kamis.kilimo.go.ke), WeatherAPI. Imetengenezwa kwa Wakulima wa Kenya.",
  },
  ok: { en: "OK", sw: "Sawa" },
  fetching: { en: "Fetching...", sw: "Inapakia..." },
  locationPlaceholder: { en: "Enter Location...", sw: "Weka eneo..." },
  wind: { en: "Wind", sw: "Upepo" },
  waitingWeather: { en: "Waiting for weather data", sw: "Inasubiri data ya hali ya hewa" },
  unavailable: { en: "Unavailable", sw: "Haipatikani" },
  liveFromKamis: { en: "Live from KAMIS", sw: "Data hai kutoka KAMIS" },
  estimated: { en: "Estimated", sw: "Makadirio" },
  errorBackend: {
    en: "Could not reach the API server. Please check your internet connection and try again.",
    sw: "Haikuweza kufikia seva ya API. Tafadhali angalia muunganisho wako wa intaneti na jaribu tena.",
  },
  chatGreeting: {
    en: "Hello! I'm Mkulima AI. Ask me anything about farming, weather, or market prices.",
    sw: "Habari! Mimi ni Mkulima AI. Niulize chochote kuhusu kilimo, hali ya hewa, au bei za soko.",
  },
  chatError: {
    en: "Sorry, I couldn't process that. Please try again.",
    sw: "Samahani, sikuweza kuchakata hilo. Tafadhali jaribu tena.",
  },
  tempRain: { en: "Temp & Rain", sw: "Joto na Mvua" },
  marketComparison: { en: "Market Price Comparison", sw: "Ulinganisho wa Bei Masokoni" },
  perKg: { en: "per kg", sw: "kwa kg" },
  perUnit: { en: "per unit", sw: "kwa kipimo" },
  analysisPrediction: { en: "Price Analysis & Prediction", sw: "Uchambuzi na Utabiri wa Bei" },
  bestSellMarket: { en: "Best Market to Sell", sw: "Soko Bora la Kuuza" },
  cheapestBuy: { en: "Cheapest to Buy", sw: "Rahisi Zaidi Kununua" },
  priceSpread: { en: "Price Spread", sw: "Tofauti ya Bei" },
  volatility: { en: "Volatility (CV)", sw: "Kutokuwa Thabiti (CV)" },
  avgRetail: { en: "Avg Retail", sw: "Wastani Rejareja" },
  avgWholesale: { en: "Avg Wholesale", sw: "Wastani Jumla" },
  trend: { en: "Trend", sw: "Mwenendo" },
  predicted: { en: "Predicted", sw: "Utabiri" },
  current: { en: "Current", sw: "Sasa" },
  confidence: { en: "Confidence", sw: "Uhakika" },
  rising: { en: "Rising", sw: "Inapanda" },
  falling: { en: "Falling", sw: "Inashuka" },
  stable: { en: "Stable", sw: "Thabiti" },
  nearestMarket: { en: "Nearest Market", sw: "Soko la Karibu" },
  kmAway: { en: "km away", sw: "km mbali" },
  useMyLocation: { en: "Use My Location", sw: "Tumia Eneo Langu" },
  detecting: { en: "Detecting...", sw: "Inatafuta..." },
  market: { en: "Market", sw: "Soko" },
  keyMarkets: { en: "Key Markets", sw: "Masoko Makuu" },
  allMarkets: { en: "All Markets", sw: "Masoko Yote" },
  recommendation: { en: "Recommendation", sw: "Mapendekezo" },
};

function t(key: string, lang: "en" | "sw"): string {
  return translations[key]?.[lang] ?? key;
}

/* ------------------------------------------------------------------ */
/*  Crop options                                                       */
/* ------------------------------------------------------------------ */

const cropOptions: { value: Crop; label: string }[] = [
  { value: "maize", label: "Maize (90kg Bag)" },
  { value: "tomatoes", label: "Tomatoes (Crate)" },
  { value: "cabbages", label: "Cabbages (Head)" },
  { value: "onions", label: "Onions (Kg)" },
  { value: "french_beans", label: "French Beans (Kg)" },
  { value: "potatoes", label: "Potatoes (50kg Bag - Laikipia)" },
  { value: "wheat", label: "Wheat (90kg Bag - Laikipia)" },
];

/* ------------------------------------------------------------------ */
/*  Custom Tooltip Component                                           */
/* ------------------------------------------------------------------ */

function DarkTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 shadow-xl">
      {label && <p className="mb-1 text-xs font-medium text-gray-400">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} className="text-sm font-semibold" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Dashboard                                                     */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  /* --- state --- */
  const [lang, setLang] = useState<"en" | "sw">("en");
  const [location, setLocation] = useState("Nanyuki");
  const [crop, setCrop] = useState<Crop>("maize");
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [prices, setPrices] = useState<PriceData | null>(null);
  const [advice, setAdvice] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  /* chat state */
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInitialized = useRef(false);

  /* geolocation & market comparison & analysis state */
  const [geoLoading, setGeoLoading] = useState(false);
  const [userCoords, setUserCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [marketData, setMarketData] = useState<MarketComparisonData | null>(null);
  const [analysisData, setAnalysisData] = useState<AnalysisData | null>(null);
  const [showAllMarkets, setShowAllMarkets] = useState(false);

  /* feedback form state */
  const [fbName, setFbName] = useState("");
  const [fbEmail, setFbEmail] = useState("");
  const [fbMessage, setFbMessage] = useState("");
  const [fbRating, setFbRating] = useState(0);
  const [fbHoverRating, setFbHoverRating] = useState(0);
  const [fbLoading, setFbLoading] = useState(false);
  const [fbSent, setFbSent] = useState(false);
  const [fbError, setFbError] = useState("");

  /* admin panel state */
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminPass, setAdminPass] = useState("");
  const [adminAuthed, setAdminAuthed] = useState(false);
  const [adminComments, setAdminComments] = useState<Array<{id: string; name: string; email: string; message: string; rating: number; timestamp: string}>>([]);
  const [adminLoading, setAdminLoading] = useState(false);
  const logoClickCount = useRef(0);
  const logoClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Check URL for admin mode */
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("admin=true")) {
      setAdminOpen(true);
    }
  }, []);

  /* Logo click handler for admin access (5 rapid clicks) */
  const handleLogoClick = () => {
    logoClickCount.current += 1;
    if (logoClickTimer.current) clearTimeout(logoClickTimer.current);
    logoClickTimer.current = setTimeout(() => { logoClickCount.current = 0; }, 2000);
    if (logoClickCount.current >= 5) {
      logoClickCount.current = 0;
      setAdminOpen(true);
    }
  };

  /* Submit feedback */
  const submitFeedback = async () => {
    if (!fbMessage.trim() || !fbName.trim()) return;
    setFbLoading(true);
    setFbError("");
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
      setFbRating(0);
      setTimeout(() => setFbSent(false), 5000);
    } catch {
      setFbError("Could not submit feedback. Please try again.");
    } finally {
      setFbLoading(false);
    }
  };

  /* Fetch admin comments */
  const fetchComments = async () => {
    if (!adminPass) return;
    setAdminLoading(true);
    try {
      const res = await axios.get(`${API_URL}/comments`, {
        params: { password: adminPass },
      });
      if (res.data?.authorized) {
        setAdminAuthed(true);
        setAdminComments(res.data.comments || []);
      } else {
        setAdminAuthed(false);
        setAdminComments([]);
      }
    } catch {
      setAdminAuthed(false);
    } finally {
      setAdminLoading(false);
    }
  };

  /* --- derived data --- */
  const priceChartData = [
    { name: t("farmGate", lang), price: prices?.farm_gate_price_ksh ?? 0 },
    { name: t("wholesale", lang), price: prices?.wholesale_price_ksh ?? 0 },
    { name: t("retail", lang), price: prices?.retail_price_ksh ?? 0 },
  ];

  /* --- handlers --- */
  const handleLocationChange = (e: ChangeEvent<HTMLInputElement>) => setLocation(e.target.value);
  const handleCropChange = (e: ChangeEvent<HTMLSelectElement>) => setCrop(e.target.value as Crop);

  const handleRefresh = (e: FormEvent) => {
    e.preventDefault();
    setFetchTrigger((prev) => prev + 1);
  };

  /* --- language toggle: also re-fetch advisory --- */
  const toggleLang = () => {
    setLang((prev) => (prev === "en" ? "sw" : "en"));
    setFetchTrigger((prev) => prev + 1);
  };

  /* --- geolocation handler --- */
  const handleGeoLocate = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setUserCoords({ lat: latitude, lon: longitude });
        // Reverse-geocode via OpenStreetMap Nominatim
        try {
          const geoRes = await axios.get(
            `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=json&accept-language=en`,
            { timeout: 8000 }
          );
          const addr = geoRes.data?.address;
          const town =
            addr?.town || addr?.city || addr?.village || addr?.county || addr?.state || "My Location";
          setLocation(town);
          setFetchTrigger((prev) => prev + 1);
        } catch {
          // If geocoding fails, use coordinates-based label
          setLocation(`${latitude.toFixed(2)}, ${longitude.toFixed(2)}`);
          setFetchTrigger((prev) => prev + 1);
        }
        setGeoLoading(false);
      },
      (err) => {
        console.warn("Geolocation error:", err.message);
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  /* --- data fetching --- */
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

        const adviceRes = await axios.post<AdviceData>(`${API_URL}/advice`, {
          weather: weatherRes.data,
          prices: pricesRes.data,
          lang,
        });

        if (ignore) return;

        setWeather(weatherRes.data);
        setPrices(pricesRes.data);
        setMarketData(marketsRes?.data ?? null);
        setAnalysisData(analysisRes?.data ?? null);
        setAdvice(adviceRes.data.advisory_report);
        setError(null);
      } catch (caughtError) {
        console.error("Error fetching data", caughtError);
        if (!ignore) {
          setError(t("errorBackend", lang));
          setAdvice("");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void fetchData();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchTrigger]);

  /* --- chat --- */
  const openChat = () => {
    if (!chatInitialized.current) {
      setChatMessages([{ role: "assistant", content: t("chatGreeting", lang) }]);
      chatInitialized.current = true;
    }
    setChatOpen(true);
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const sendChat = async () => {
    const trimmed = chatInput.trim();
    if (!trimmed || chatLoading) return;

    const userMsg: ChatMessage = { role: "user", content: trimmed };
    const updatedMessages = [...chatMessages, userMsg];
    setChatMessages(updatedMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await axios.post(`${API_URL}/chat`, {
        messages: updatedMessages,
        context: { weather, prices },
        lang,
      });
      const reply: string = res.data?.reply ?? res.data?.message ?? res.data?.content ?? "";
      setChatMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", content: t("chatError", lang) }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleChatKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendChat();
    }
  };

  /* --- weather icon helper --- */
  const weatherIcon = (condition: string | undefined) => {
    if (!condition) return <Cloud className="h-5 w-5" />;
    const c = condition.toLowerCase();
    if (c.includes("sun") || c.includes("clear")) return <Thermometer className="h-5 w-5 text-amber-400" />;
    if (c.includes("rain") || c.includes("drizzle")) return <Droplets className="h-5 w-5 text-blue-400" />;
    if (c.includes("cloud") || c.includes("overcast")) return <Cloud className="h-5 w-5 text-gray-400" />;
    return <Cloud className="h-5 w-5" />;
  };

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="relative min-h-screen overflow-hidden overflow-x-hidden bg-gray-950 font-sans text-gray-100">
      {/* Layered background */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src="https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1920&q=60"
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-[0.07] animate-slow-drift"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-gray-950 via-emerald-950/25 to-gray-950" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-900/15 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 h-96 bg-gradient-to-t from-emerald-950/15 to-transparent" />
      </div>

      {/* Content wrapper */}
      <div className="relative z-10">
        {/* ============================================================== */}
        {/*  HEADER                                                         */}
        {/* ============================================================== */}
        <header className="sticky top-0 z-30 border-b border-white/5 bg-gray-950/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:px-6 py-4 md:flex-row">
            {/* Logo + Live badge */}
            <div className="flex items-center gap-3">
              <button onClick={handleLogoClick} className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 transition hover:bg-emerald-500/20 cursor-pointer">
                <Leaf className="h-6 w-6 text-emerald-400" />
              </button>
              <h1 className="text-xl font-bold tracking-tight text-white">
                kilimo.hub<span className="text-emerald-400">@ke</span>
              </h1>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                {t("liveData", lang)}
              </span>
            </div>

            {/* Controls row */}
            <div className="flex w-full flex-col items-center gap-3 sm:flex-row md:w-auto">
              {/* Language toggle */}
              <button
                onClick={toggleLang}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-white/10"
              >
                <Globe className="h-3.5 w-3.5" />
                <span className={lang === "en" ? "text-emerald-400" : ""}>EN</span>
                <span className="text-gray-600">/</span>
                <span className={lang === "sw" ? "text-emerald-400" : ""}>SW</span>
              </button>

              {/* Form */}
              <form onSubmit={handleRefresh} className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={location}
                    onChange={handleLocationChange}
                    placeholder={t("locationPlaceholder", lang)}
                    className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-gray-500 outline-none backdrop-blur-sm transition focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                  />
                  <button
                    type="button"
                    onClick={handleGeoLocate}
                    disabled={geoLoading}
                    title={t("useMyLocation", lang)}
                    className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 text-gray-400 transition hover:bg-white/10 hover:text-emerald-400 disabled:opacity-50"
                  >
                    {geoLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Crosshair className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <select
                  value={crop}
                  onChange={handleCropChange}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none backdrop-blur-sm transition focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                >
                  {cropOptions.map((option) => (
                    <option key={option.value} value={option.value} className="bg-gray-900">
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {loading ? t("fetching", lang) : t("ok", lang)}
                </button>
              </form>

              {/* Chat button */}
              <button
                onClick={openChat}
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-gray-300 transition hover:bg-white/10 hover:text-emerald-400"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="hidden sm:inline">{t("chatTitle", lang)}</span>
              </button>
            </div>
          </div>
        </header>

        {/* Hero Banner */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img
              src="https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1920&q=80"
              alt=""
              className="h-full w-full object-cover opacity-40 animate-slow-drift"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-gray-950/20 via-gray-950/40 to-gray-950" />
            <div className="absolute inset-0 bg-gradient-to-r from-amber-900/10 via-transparent to-emerald-900/10" />
          </div>
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 py-16 sm:py-24 md:py-32 text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-1.5 mb-5 backdrop-blur-sm">
              <Sprout className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-300">
                {lang === "sw" ? "Dashibodi ya Kilimo cha Kisasa" : "Agricultural Intelligence Platform"}
              </span>
            </div>
            <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4 sm:mb-5 tracking-tight leading-tight">
              Smart Farming,{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
                Smarter Decisions
              </span>
            </h2>
            <p className="text-base sm:text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
              {lang === "sw"
                ? "Pata bei za soko, hali ya hewa, na ushauri wa kilimo — yote katika sehemu moja."
                : "Get live market prices, weather forecasts, and farming advisory — all in one dashboard."}
            </p>
          </div>
          {/* Bottom glow line */}
          <div className="relative z-10 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
        </div>

        {/* ============================================================== */}
        {/*  MAIN CONTENT                                                   */}
        {/* ============================================================== */}
        <main className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
          {/* Error */}
          {error && (
            <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-300 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-400" />
                {error}
              </div>
            </div>
          )}

          {/* Initial loading */}
          {loading && !weather && !prices ? (
            <div className="flex h-64 items-center justify-center">
              <div className="flex flex-col items-center gap-4">
                <div className="relative">
                  <div className="h-16 w-16 rounded-full border-2 border-emerald-500/20" />
                  <Loader2 className="absolute inset-0 m-auto h-10 w-10 animate-spin text-emerald-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-400">{t("analyzingData", lang)}</p>
                  <p className="text-xs text-gray-600 mt-1">KAMIS + Mkulima Online</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3 transition-all duration-500">
              {/* ======================================================== */}
              {/*  LEFT COLUMN                                              */}
              {/* ======================================================== */}
              <div className="space-y-6 lg:col-span-1">
                {/* Weather Card */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 shadow-2xl shadow-black/20 shadow-emerald-500/5 ring-1 ring-white/[0.05] inset backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.09] hover:shadow-emerald-500/10">
                  <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-gray-200">
                    <Cloud className="h-5 w-5 text-blue-400" />
                    {t("liveWeather", lang)}: {weather?.location ?? t("unavailable", lang)}
                  </h2>

                  {/* Temperature */}
                  <div className="mb-1 flex items-start gap-1">
                    <span className="text-6xl font-bold tracking-tighter text-white">
                      {weather?.current_temp ?? "--"}
                    </span>
                    <span className="mt-2 text-2xl font-light text-gray-400">&deg;C</span>
                  </div>

                  {/* Condition */}
                  <div className="mb-6 flex items-center gap-2 text-sm text-gray-400">
                    {weatherIcon(weather?.condition)}
                    {weather?.condition ?? t("waitingWeather", lang)}
                  </div>

                  {/* Sub-cards */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/8 bg-gradient-to-br from-blue-500/8 to-transparent p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <Droplets className="h-3.5 w-3.5 text-blue-400" />
                        {t("humidity", lang)}
                      </div>
                      <p className="text-lg font-bold text-white">{weather?.humidity ?? "--"}%</p>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-700/50">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-700"
                          style={{ width: `${weather?.humidity ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-gradient-to-br from-emerald-500/8 to-transparent p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <Sprout className="h-3.5 w-3.5 text-emerald-400" />
                        {t("soilMoistureEst", lang)}
                      </div>
                      <p className="text-lg font-bold text-white">{weather?.soil_moisture_estimate?.toFixed(1) ?? "--"}%</p>
                      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-gray-700/50">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
                          style={{ width: `${weather?.soil_moisture_estimate ?? 0}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Wind */}
                  <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/5 bg-white/5 p-3 text-sm">
                    <Wind className="h-4 w-4 text-gray-400" />
                    <span className="text-gray-500">{t("wind", lang)}:</span>
                    <span className="font-semibold text-white">{weather?.wind_kph ?? "--"} kph</span>
                  </div>
                </div>

                {/* Agricultural Risks */}
                {weather && weather.agri_risk_alerts.length > 0 && (
                  <div className="rounded-2xl border border-red-500/25 bg-red-500/8 p-6 shadow-2xl shadow-red-500/8 ring-1 ring-red-500/[0.08] inset backdrop-blur-xl">
                    <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-red-400">
                      <AlertTriangle className="h-5 w-5" />
                      {t("agriculturalRisks", lang)}
                    </h2>
                    <ul className="space-y-3 text-sm text-red-300">
                      {weather.agri_risk_alerts.map((alert) => (
                        <li key={alert} className="flex items-start gap-2.5">
                          <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" />
                          {alert}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* ======================================================== */}
              {/*  RIGHT COLUMN                                             */}
              {/* ======================================================== */}
              <div className="space-y-6 lg:col-span-2">
                {/* Market Intelligence */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 shadow-2xl shadow-black/20 shadow-amber-500/5 ring-1 ring-white/[0.05] inset backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.09] hover:shadow-amber-500/10">
                  <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-gray-200">
                      <TrendingUp className="h-5 w-5 text-emerald-400" />
                      {t("marketIntelligence", lang)}: {prices?.crop ?? crop} ({prices?.unit ?? "unit"})
                    </h2>
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
                        prices?.data_status?.toLowerCase().includes("live")
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-amber-500/10 text-amber-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          prices?.data_status?.toLowerCase().includes("live") ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      {prices?.data_status?.toLowerCase().includes("live")
                        ? t("liveFromKamis", lang)
                        : t("estimated", lang)}
                    </span>
                  </div>

                  {/* Price metric cards */}
                  <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="relative overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/8 p-4 text-center ring-1 ring-amber-500/[0.06] inset transition hover:bg-amber-500/12">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-400" />
                      <div className="mb-2 flex items-center justify-center gap-1.5">
                        <Wheat className="h-4 w-4 text-amber-500/60" />
                        <p className="text-xs font-medium uppercase tracking-wider text-amber-500/70">
                          {t("farmGate", lang)}
                        </p>
                      </div>
                      <p className="text-3xl font-bold text-amber-400">
                        KES {prices?.farm_gate_price_ksh?.toLocaleString() ?? "N/A"}
                      </p>
                    </div>
                    <div className="relative overflow-hidden rounded-xl border border-blue-500/25 bg-blue-500/8 p-4 text-center ring-1 ring-blue-500/[0.06] inset transition hover:bg-blue-500/12">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-400 to-cyan-400" />
                      <div className="mb-2 flex items-center justify-center gap-1.5">
                        <BarChart3 className="h-4 w-4 text-blue-500/60" />
                        <p className="text-xs font-medium uppercase tracking-wider text-blue-500/70">
                          {t("wholesale", lang)}
                        </p>
                      </div>
                      <p className="text-3xl font-bold text-blue-400">
                        KES {prices?.wholesale_price_ksh?.toLocaleString() ?? "N/A"}
                      </p>
                    </div>
                    <div className="relative overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4 text-center ring-1 ring-emerald-500/[0.06] inset transition hover:bg-emerald-500/12">
                      <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-400 to-teal-400" />
                      <div className="mb-2 flex items-center justify-center gap-1.5">
                        <ShoppingCart className="h-4 w-4 text-emerald-500/60" />
                        <p className="text-xs font-medium uppercase tracking-wider text-emerald-500/70">
                          {t("retail", lang)}
                        </p>
                      </div>
                      <p className="text-3xl font-bold text-emerald-400">
                        KES {prices?.retail_price_ksh?.toLocaleString() ?? "N/A"}
                      </p>
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div className="h-48 sm:h-56 md:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={priceChartData}>
                        <defs>
                          <linearGradient id="priceBarGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#F97316" stopOpacity={1} />
                            <stop offset="100%" stopColor="#EA580C" stopOpacity={0.85} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={12} />
                        <YAxis stroke="#64748b" fontSize={12} />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="price" fill="url(#priceBarGrad)" radius={[8, 8, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 14-Day Forecast */}
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 shadow-2xl shadow-black/20 shadow-cyan-500/5 ring-1 ring-white/[0.05] inset backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.09] hover:shadow-cyan-500/10">
                  <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-gray-200">
                    <BarChartIcon className="h-5 w-5 text-cyan-400" />
                    {t("forecast14", lang)} ({t("tempRain", lang)})
                  </h2>
                  <div className="h-48 sm:h-56 md:h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weather?.forecast ?? []}>
                        <defs>
                          <linearGradient id="maxGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#FB923C" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#FB923C" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="minGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#60A5FA" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#60A5FA" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="rainGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#22D3EE" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" fontSize={11} stroke="#64748b" />
                        <YAxis yAxisId="left" stroke="#64748b" fontSize={11} />
                        <YAxis yAxisId="right" orientation="right" stroke="#64748b" fontSize={11} />
                        <Tooltip content={<DarkTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="max" stroke="transparent" fill="url(#maxGrad)" />
                        <Area yAxisId="left" type="monotone" dataKey="min" stroke="transparent" fill="url(#minGrad)" />
                        <Area yAxisId="right" type="monotone" dataKey="rain_mm" stroke="transparent" fill="url(#rainGrad)" />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="max"
                          stroke="#FB923C"
                          strokeWidth={2.5}
                          dot={false}
                          name={t("maxTemp", lang) + " (\u00B0C)"}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="min"
                          stroke="#60A5FA"
                          strokeWidth={2.5}
                          dot={false}
                          name={t("minTemp", lang) + " (\u00B0C)"}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="rain_mm"
                          stroke="#22D3EE"
                          strokeWidth={2.5}
                          dot={false}
                          name={t("rain", lang) + " (mm)"}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-orange-400" /> {t("maxTemp", lang)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-blue-400" /> {t("minTemp", lang)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-cyan-400" /> {t("rain", lang)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Section Divider */}
              <div className="lg:col-span-3 relative my-4 overflow-hidden rounded-2xl">
                <div className="absolute inset-0">
                  <img
                    src="https://images.unsplash.com/photo-1592982537447-6f2a6a0c1b36?w=1200&q=80"
                    alt=""
                    className="h-full w-full object-cover opacity-35 animate-slow-drift"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-950/80 via-gray-950/40 to-gray-950/80" />
                  <div className="absolute inset-0 bg-gradient-to-r from-orange-500/5 via-transparent to-rose-500/5" />
                </div>
                <div className="relative z-10 px-6 py-6 flex items-center gap-4">
                  <div className="h-10 w-1.5 rounded-full bg-gradient-to-b from-orange-400 to-rose-500" />
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      {lang === "sw" ? "Ulinganisho wa Masoko" : "Market Intelligence"}
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {lang === "sw" ? "Bei kutoka vyanzo mbalimbali" : "Multi-source price comparison across Kenya"}
                    </p>
                  </div>
                </div>
              </div>

              {/* ======================================================== */}
              {/*  MARKET COMPARISON (full width)                           */}
              {/* ======================================================== */}
              {marketData && marketData.markets.length > 0 && (
                <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 shadow-2xl shadow-black/20 shadow-orange-500/5 ring-1 ring-white/[0.05] inset backdrop-blur-xl lg:col-span-3 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.09] hover:shadow-orange-500/10">
                  <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-gray-200">
                      <MapPin className="h-5 w-5 text-orange-400" />
                      {t("marketComparison", lang)}: {marketData.crop} ({marketData.unit})
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Data source badges */}
                      {marketData.data_sources && marketData.data_sources.length > 0 && (
                        <span className="flex items-center gap-1.5 rounded-full bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-400">
                          <Database className="h-3 w-3" />
                          {marketData.data_sources.join(" + ")}
                        </span>
                      )}
                      {/* Nearest market badge */}
                      {analysisData?.nearest_market && (
                        <span className="flex items-center gap-1.5 rounded-full bg-cyan-500/10 px-2.5 py-1 text-xs font-medium text-cyan-400">
                          <Navigation className="h-3 w-3" />
                          {t("nearestMarket", lang)}: {analysisData.nearest_market}
                          {analysisData.distance_km && ` (${analysisData.distance_km} ${t("kmAway", lang)})`}
                        </span>
                      )}
                      <button
                        onClick={() => setShowAllMarkets(!showAllMarkets)}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-400 transition hover:bg-white/10"
                      >
                        {showAllMarkets ? t("keyMarkets", lang) : t("allMarkets", lang)}
                      </button>
                    </div>
                  </div>

                  {/* Market comparison bar chart */}
                  {(() => {
                    const hasKeyMarkets = marketData.markets.some((m) => m.is_key_market);
                    const displayMarkets = (showAllMarkets || !hasKeyMarkets)
                      ? marketData.markets
                      : marketData.markets.filter((m) => m.is_key_market);
                    const chartData = displayMarkets
                      .filter((m) => m.retail_price !== null || m.wholesale_price !== null)
                      .slice(0, 12)
                      .map((m) => ({
                        name: m.market,
                        Wholesale: m.wholesale_price ?? 0,
                        Retail: m.retail_price ?? 0,
                      }));

                    return (
                  <>
                  {chartData.length > 0 && (
                  <div className="h-52 sm:h-60 md:h-72 mb-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <defs>
                          <linearGradient id="wholesaleGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#38BDF8" stopOpacity={1} />
                            <stop offset="100%" stopColor="#0EA5E9" stopOpacity={0.85} />
                          </linearGradient>
                          <linearGradient id="retailGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#A3E635" stopOpacity={1} />
                            <stop offset="100%" stopColor="#84CC16" stopOpacity={0.85} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-20} textAnchor="end" height={50} />
                        <YAxis stroke="#64748b" fontSize={11} />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="Wholesale" fill="url(#wholesaleGrad)" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="Retail" fill="url(#retailGrad)" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  )}

                  {/* Legend for market comparison */}
                  <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-5 rounded-sm bg-sky-400" /> {t("wholesale", lang)} (KES)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-5 rounded-sm bg-lime-400" /> {t("retail", lang)} (KES)
                    </span>
                  </div>

                  {/* Market table */}
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-xs sm:text-sm">
                      <thead>
                        <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-gray-500">
                          <th className="pb-3 pr-4">{t("market", lang)}</th>
                          <th className="pb-3 pr-4 text-right">{t("wholesale", lang)}</th>
                          <th className="pb-3 pr-4 text-right">{t("retail", lang)}</th>
                          <th className="pb-3 text-right">{t("trend", lang)}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {displayMarkets
                          .filter((m) => m.retail_price !== null || m.wholesale_price !== null)
                          .slice(0, 10)
                          .map((m, idx) => {
                            const prediction = analysisData?.predictions?.find(
                              (p) => p.market.toLowerCase() === m.market.toLowerCase()
                            );
                            const isBestMarket = analysisData?.recommendation?.best_sell_market?.toLowerCase() === m.market.toLowerCase();
                            return (
                              <tr key={m.market} className={`text-gray-300 transition-colors hover:bg-white/[0.04] ${idx % 2 === 1 ? "bg-white/[0.02]" : ""} ${isBestMarket ? "border-l-2 border-l-emerald-500/50" : ""}`}>
                                <td className="py-2.5 pr-4 font-medium">
                                  <div className="flex items-center gap-2">
                                    {m.is_key_market && (
                                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />
                                    )}
                                    {isBestMarket && (
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-glow-pulse" />
                                    )}
                                    {m.market}
                                  </div>
                                </td>
                                <td className="py-2 pr-4 text-right text-sky-400">
                                  KES {m.wholesale_price?.toLocaleString() ?? "—"}
                                </td>
                                <td className="py-2 pr-4 text-right text-lime-400">
                                  KES {m.retail_price?.toLocaleString() ?? "—"}
                                </td>
                                <td className="py-2 text-right">
                                  {prediction ? (
                                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                                      prediction.trend === "rising"
                                        ? "bg-emerald-500/10 text-emerald-400"
                                        : prediction.trend === "falling"
                                        ? "bg-red-500/10 text-red-400"
                                        : "bg-gray-500/10 text-gray-400"
                                    }`}>
                                      {prediction.trend === "rising" && <ArrowUpRight className="h-3 w-3" />}
                                      {prediction.trend === "falling" && <ArrowDownRight className="h-3 w-3" />}
                                      {prediction.trend === "stable" && <Minus className="h-3 w-3" />}
                                      {prediction.predicted_change_pct > 0 ? "+" : ""}
                                      {prediction.predicted_change_pct}%
                                    </span>
                                  ) : (
                                    <span className="text-gray-600">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  </>
                  );
                  })()}
                </div>
              )}

              {/* Section Divider */}
              <div className="lg:col-span-3 relative my-4 overflow-hidden rounded-2xl">
                <div className="absolute inset-0">
                  <img
                    src="https://images.unsplash.com/photo-1574943320219-5532a69ef5d8?w=1200&q=80"
                    alt=""
                    className="h-full w-full object-cover opacity-35 animate-slow-drift"
                  />
                  <div className="absolute inset-0 bg-gradient-to-r from-gray-950/80 via-gray-950/40 to-gray-950/80" />
                  <div className="absolute inset-0 bg-gradient-to-r from-violet-500/5 via-transparent to-fuchsia-500/5" />
                </div>
                <div className="relative z-10 px-6 py-6 flex items-center gap-4">
                  <div className="h-10 w-1.5 rounded-full bg-gradient-to-b from-violet-400 to-fuchsia-500" />
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      {lang === "sw" ? "Uchambuzi na Utabiri" : "Analysis & Prediction"}
                    </h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {lang === "sw" ? "Utabiri wa bei na mapendekezo" : "Price trends, predictions & recommendations"}
                    </p>
                  </div>
                </div>
              </div>

              {/* ======================================================== */}
              {/*  PRICE ANALYSIS & PREDICTION (full width)                */}
              {/* ======================================================== */}
              {analysisData && (
                <div className="rounded-2xl border border-violet-500/25 bg-violet-500/8 p-6 shadow-2xl shadow-violet-500/8 ring-1 ring-violet-500/[0.06] inset backdrop-blur-xl lg:col-span-3 transition-all duration-300 hover:border-violet-500/35 hover:bg-violet-500/10 hover:shadow-violet-500/15">
                  <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="flex items-center gap-2 text-base font-semibold text-violet-300">
                      <BarChart3 className="h-5 w-5 text-violet-400" />
                      {t("analysisPrediction", lang)}: {analysisData.crop}
                    </h2>
                    {analysisData.data_sources && analysisData.data_sources.length > 0 && (
                      <span className="flex items-center gap-1.5 rounded-full bg-violet-500/10 px-2.5 py-1 text-xs font-medium text-violet-300">
                        <Database className="h-3 w-3" />
                        {analysisData.data_sources.join(" + ")}
                      </span>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-white/8 bg-gradient-to-br from-emerald-500/10 to-transparent p-3 text-center">
                      <p className="mb-1 text-xs text-gray-500">{t("avgRetail", lang)}</p>
                      <p className="text-lg font-bold text-emerald-400">
                        KES {analysisData.statistics.avg_retail.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-gradient-to-br from-blue-500/10 to-transparent p-3 text-center">
                      <p className="mb-1 text-xs text-gray-500">{t("avgWholesale", lang)}</p>
                      <p className="text-lg font-bold text-blue-400">
                        KES {analysisData.statistics.avg_wholesale.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-gradient-to-br from-amber-500/10 to-transparent p-3 text-center">
                      <p className="mb-1 text-xs text-gray-500">{t("priceSpread", lang)}</p>
                      <p className="text-lg font-bold text-amber-400">
                        KES {analysisData.statistics.price_spread.toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-gradient-to-br from-violet-500/10 to-transparent p-3 text-center">
                      <p className="mb-1 text-xs text-gray-500">{t("volatility", lang)}</p>
                      <p className={`text-lg font-bold ${
                        analysisData.statistics.volatility_cv_pct > 30
                          ? "text-red-400"
                          : analysisData.statistics.volatility_cv_pct > 15
                          ? "text-amber-400"
                          : "text-emerald-400"
                      }`}>
                        {analysisData.statistics.volatility_cv_pct}%
                      </p>
                    </div>
                  </div>

                  {/* Recommendation cards */}
                  <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {analysisData.recommendation.best_sell_market && (
                      <div className="relative overflow-hidden rounded-xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/12 to-emerald-500/3 p-4 ring-1 ring-emerald-500/[0.06] inset">
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-emerald-400 to-teal-400" />
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-emerald-500">
                          <TrendingUp className="h-3.5 w-3.5" />
                          {t("bestSellMarket", lang)}
                        </div>
                        <p className="text-lg font-bold text-white">
                          {analysisData.recommendation.best_sell_market}
                        </p>
                        <p className="text-sm text-emerald-400">
                          KES {analysisData.recommendation.best_sell_price?.toLocaleString()}/{analysisData.unit}
                        </p>
                      </div>
                    )}
                    {analysisData.recommendation.cheapest_buy_market && (
                      <div className="relative overflow-hidden rounded-xl border border-blue-500/25 bg-gradient-to-br from-blue-500/12 to-blue-500/3 p-4 ring-1 ring-blue-500/[0.06] inset">
                        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-400 to-cyan-400" />
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-blue-500">
                          <ArrowDownRight className="h-3.5 w-3.5" />
                          {t("cheapestBuy", lang)}
                        </div>
                        <p className="text-lg font-bold text-white">
                          {analysisData.recommendation.cheapest_buy_market}
                        </p>
                        <p className="text-sm text-blue-400">
                          KES {analysisData.recommendation.cheapest_buy_price?.toLocaleString()}/{analysisData.unit}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Predictions chart */}
                  {analysisData.predictions.length > 0 && (
                    <div className="h-48 sm:h-56 md:h-72 mb-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={analysisData.predictions.map((p) => ({
                            name: p.market,
                            [t("current", lang)]: p.current_price,
                            [t("predicted", lang)]: p.predicted_price,
                          }))}
                        >
                          <defs>
                            <linearGradient id="currentGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#A78BFA" stopOpacity={1} />
                              <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.85} />
                            </linearGradient>
                            <linearGradient id="predictedGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#F472B6" stopOpacity={1} />
                              <stop offset="100%" stopColor="#EC4899" stopOpacity={0.85} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                          <XAxis dataKey="name" stroke="#64748b" fontSize={11} angle={-20} textAnchor="end" height={50} />
                          <YAxis stroke="#64748b" fontSize={11} />
                          <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                          <Bar dataKey={t("current", lang)} fill="url(#currentGrad)" radius={[6, 6, 0, 0]} />
                          <Bar dataKey={t("predicted", lang)} fill="url(#predictedGrad)" radius={[6, 6, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  {/* Prediction legend */}
                  <div className="mb-4 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-violet-400" /> {t("current", lang)} (KES)
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-pink-400" /> {t("predicted", lang)} (KES)
                    </span>
                  </div>

                  {/* Analysis advisory text */}
                  {analysisData.advisory && (
                    <div className="whitespace-pre-line rounded-xl border border-white/5 bg-white/[0.03] p-4 text-sm leading-relaxed text-gray-300">
                      {analysisData.advisory}
                    </div>
                  )}
                </div>
              )}

              {/* ======================================================== */}
              {/*  ADVISORY (full width)                                    */}
              {/* ======================================================== */}
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-6 shadow-2xl shadow-emerald-500/8 ring-1 ring-emerald-500/[0.06] inset backdrop-blur-xl lg:col-span-3">
                <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-emerald-400">
                  <Sprout className="h-5 w-5" />
                  {t("smartAdvisory", lang)}
                </h2>
                <div className="whitespace-pre-line rounded-xl border border-white/5 bg-white/[0.03] p-5 text-sm leading-relaxed text-gray-300">
                  {advice || t("analyzingData", lang)}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* ================================================================ */}
        {/*  FEEDBACK SECTION                                                 */}
        {/* ================================================================ */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img
              src="https://images.unsplash.com/photo-1625246333195-78d9c38ad449?w=1920&q=60"
              alt=""
              className="h-full w-full object-cover opacity-15"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/85 to-gray-950/95" />
          </div>
          <div className="relative z-10 mx-auto max-w-3xl px-4 sm:px-6 py-12">
            <div className="text-center mb-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-4 py-1.5 mb-4">
                <MessageSquare className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-xs font-medium text-amber-300">
                  {lang === "sw" ? "Maoni Yako" : "Your Feedback"}
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                {lang === "sw" ? "Tusaidie Kuboresha" : "Help Us Improve"}
              </h2>
              <p className="text-sm text-gray-400 max-w-lg mx-auto">
                {lang === "sw"
                  ? "Tuma maoni, mapendekezo, au ripoti hitilafu. Sauti yako ni muhimu kwetu."
                  : "Share your feedback, suggestions, or report issues. Your voice helps us build a better tool for Kenyan farmers."}
              </p>
            </div>

            {fbSent ? (
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/8 p-8 text-center backdrop-blur-xl">
                <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                <h3 className="text-lg font-bold text-white mb-1">
                  {lang === "sw" ? "Asante!" : "Thank You!"}
                </h3>
                <p className="text-sm text-gray-400">
                  {lang === "sw" ? "Maoni yako yamepokelewa." : "Your feedback has been received."}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-white/[0.12] bg-white/[0.06] p-6 sm:p-8 shadow-2xl shadow-black/20 backdrop-blur-xl">
                {/* Star rating */}
                <div className="mb-5 text-center">
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">
                    {lang === "sw" ? "Kiwango" : "Rating"}
                  </p>
                  <div className="flex items-center justify-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setFbRating(star)}
                        onMouseEnter={() => setFbHoverRating(star)}
                        onMouseLeave={() => setFbHoverRating(0)}
                        className="p-1 transition-transform hover:scale-110"
                      >
                        <Star
                          className={`h-7 w-7 transition-colors ${
                            star <= (fbHoverRating || fbRating)
                              ? "text-amber-400 fill-amber-400"
                              : "text-gray-600"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <input
                    type="text"
                    value={fbName}
                    onChange={(e) => setFbName(e.target.value)}
                    placeholder={lang === "sw" ? "Jina lako *" : "Your Name *"}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                  />
                  <input
                    type="email"
                    value={fbEmail}
                    onChange={(e) => setFbEmail(e.target.value)}
                    placeholder={lang === "sw" ? "Barua pepe (hiari)" : "Email (optional)"}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                  />
                </div>
                <textarea
                  value={fbMessage}
                  onChange={(e) => setFbMessage(e.target.value)}
                  placeholder={lang === "sw" ? "Andika maoni yako hapa... *" : "Write your feedback here... *"}
                  rows={4}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 outline-none transition focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 resize-none"
                />
                {fbError && <p className="mt-2 text-xs text-red-400">{fbError}</p>}
                <div className="mt-4 flex justify-end">
                  <button
                    onClick={submitFeedback}
                    disabled={fbLoading || !fbMessage.trim() || !fbName.trim()}
                    className="flex items-center gap-2 rounded-xl bg-amber-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-amber-500/20 transition hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {fbLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {lang === "sw" ? "Tuma Maoni" : "Send Feedback"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Footer */}
        <footer className="relative mt-0 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <img
              src="https://images.unsplash.com/photo-1464226184884-fa280b87c399?w=1200&q=60"
              alt=""
              className="h-full w-full object-cover opacity-20"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/90 to-gray-950/70" />
          </div>
          <div className="relative z-10 border-t border-white/5">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
              <div className="flex flex-col items-center gap-6">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                    <Leaf className="h-4 w-4 text-emerald-400" />
                  </div>
                  <span className="text-sm font-bold text-gray-300">kilimo.hub@ke</span>
                </div>
                <p className="text-center text-xs text-gray-500">
                  {t("footerCredits", lang)}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-gray-500">
                  <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 border border-white/5">
                    <Database className="h-3 w-3" />
                    KAMIS + Mkulima Bora + Mkulima Online
                  </span>
                  <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-3 py-1 border border-white/5">
                    <User className="h-3 w-3" />
                    Created by Paul N Magima
                  </span>
                </div>
                <p className="text-center text-[10px] text-gray-600">
                  &copy; {new Date().getFullYear()} kilimo.hub@ke. All rights reserved.
                </p>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* ================================================================ */}
      {/*  CHAT PANEL                                                       */}
      {/* ================================================================ */}
      {chatOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setChatOpen(false)} />

          {/* Panel */}
          <div className="relative flex h-full w-full max-w-full sm:max-w-[400px] flex-col border-l border-white/10 bg-gray-950/95 shadow-2xl backdrop-blur-xl">
            {/* Chat Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10">
                  <MessageCircle className="h-4 w-4 text-emerald-400" />
                </div>
                <h3 className="text-sm font-semibold text-white">{t("chatTitle", lang)}</h3>
              </div>
              <button
                onClick={() => setChatOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "rounded-br-md bg-emerald-600 text-white"
                        : "rounded-bl-md border border-white/10 bg-white/5 text-gray-200"
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))}

              {/* Loading indicator */}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-white/10 bg-white/5 px-4 py-3">
                    <div className="flex items-center gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div className="border-t border-white/10 p-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleChatKeyDown}
                  placeholder={t("chatPlaceholder", lang)}
                  className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                />
                <button
                  onClick={sendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {chatLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  ADMIN PANEL                                                      */}
      {/* ================================================================ */}
      {adminOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setAdminOpen(false)} />
          <div className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-gray-950/95 shadow-2xl backdrop-blur-xl mx-4">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
              <div className="flex items-center gap-2">
                <Lock className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">Admin Panel — Feedback</h3>
              </div>
              <button
                onClick={() => { setAdminOpen(false); setAdminAuthed(false); setAdminPass(""); }}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Auth gate */}
            {!adminAuthed ? (
              <div className="p-6">
                <p className="text-xs text-gray-500 mb-3">Enter the admin password to view feedback.</p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={adminPass}
                    onChange={(e) => setAdminPass(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") fetchComments(); }}
                    placeholder="Admin password"
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-gray-500 outline-none transition focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50"
                  />
                  <button
                    onClick={fetchComments}
                    disabled={adminLoading || !adminPass}
                    className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-500 disabled:opacity-50"
                  >
                    {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Login"}
                  </button>
                </div>
              </div>
            ) : (
              /* Comments list */
              <div className="flex-1 overflow-y-auto p-6">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs text-gray-500">
                    {adminComments.length} feedback {adminComments.length === 1 ? "entry" : "entries"} received
                  </p>
                  <button
                    onClick={fetchComments}
                    disabled={adminLoading}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition hover:bg-white/10"
                  >
                    <RefreshCw className={`h-3 w-3 ${adminLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
                {adminComments.length === 0 ? (
                  <div className="text-center py-12">
                    <MessageSquare className="h-10 w-10 text-gray-700 mx-auto mb-3" />
                    <p className="text-sm text-gray-500">No feedback submitted yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {adminComments.map((c) => (
                      <div key={c.id} className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10">
                              <User className="h-3.5 w-3.5 text-emerald-400" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-white">{c.name}</p>
                              {c.email && <p className="text-[10px] text-gray-500">{c.email}</p>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {c.rating > 0 && (
                              <div className="flex items-center gap-0.5">
                                {[1, 2, 3, 4, 5].map((s) => (
                                  <Star key={s} className={`h-3 w-3 ${s <= c.rating ? "text-amber-400 fill-amber-400" : "text-gray-700"}`} />
                                ))}
                              </div>
                            )}
                            <span className="text-[10px] text-gray-600">
                              {new Date(c.timestamp).toLocaleDateString("en-KE", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{c.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

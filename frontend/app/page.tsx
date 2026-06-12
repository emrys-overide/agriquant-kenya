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
  RefreshCw,
  Send,
  TrendingUp,
  X,
  Globe,
  Wind,
  Droplets,
  Thermometer,
  Sprout,
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

const API_URL = "/api";

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
    en: "Could not reach the backend. Please ensure the FastAPI server is running on port 8000.",
    sw: "Haikuweza kufikia seva. Tafadhali hakikisha seva ya FastAPI inafanya kazi.",
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

  /* --- data fetching --- */
  useEffect(() => {
    let ignore = false;

    const fetchData = async () => {
      setLoading(true);
      try {
        const [weatherRes, pricesRes] = await Promise.all([
          axios.get<WeatherData>(`${API_URL}/weather/${location}`),
          axios.get<PriceData>(`${API_URL}/prices/${crop}`),
        ]);

        const adviceRes = await axios.post<AdviceData>(`${API_URL}/advice`, {
          weather: weatherRes.data,
          prices: pricesRes.data,
          lang,
        });

        if (ignore) return;

        setWeather(weatherRes.data);
        setPrices(pricesRes.data);
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
    <div className="relative min-h-screen overflow-hidden bg-gray-950 font-sans text-gray-100">
      {/* Animated gradient background */}
      <div className="pointer-events-none fixed inset-0 z-0 animate-gradient-shift bg-[length:400%_400%] bg-gradient-to-br from-gray-950 via-emerald-950/30 to-gray-950" />

      {/* Content wrapper */}
      <div className="relative z-10">
        {/* ============================================================== */}
        {/*  HEADER                                                         */}
        {/* ============================================================== */}
        <header className="sticky top-0 z-30 border-b border-white/5 bg-gray-950/70 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 py-4 md:flex-row">
            {/* Logo + Live badge */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
                <Leaf className="h-6 w-6 text-emerald-400" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-white">
                AgriQuant <span className="text-emerald-400">Kenya</span>
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
                <input
                  type="text"
                  value={location}
                  onChange={handleLocationChange}
                  placeholder={t("locationPlaceholder", lang)}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white placeholder-gray-500 outline-none backdrop-blur-sm transition focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/50"
                />
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

        {/* ============================================================== */}
        {/*  MAIN CONTENT                                                   */}
        {/* ============================================================== */}
        <main className="mx-auto max-w-7xl px-6 py-8">
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
                <Loader2 className="h-10 w-10 animate-spin text-emerald-500" />
                <p className="text-sm text-gray-500">{t("analyzingData", lang)}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* ======================================================== */}
              {/*  LEFT COLUMN                                              */}
              {/* ======================================================== */}
              <div className="space-y-6 lg:col-span-1">
                {/* Weather Card */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.07]">
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
                    <div className="rounded-xl border border-white/5 bg-white/5 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <Droplets className="h-3.5 w-3.5 text-blue-400" />
                        {t("humidity", lang)}
                      </div>
                      <p className="text-lg font-bold text-white">{weather?.humidity ?? "--"}%</p>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all duration-700"
                          style={{ width: `${weather?.humidity ?? 0}%` }}
                        />
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/5 bg-white/5 p-3">
                      <div className="mb-1 flex items-center gap-1.5 text-xs text-gray-500">
                        <Sprout className="h-3.5 w-3.5 text-emerald-400" />
                        {t("soilMoistureEst", lang)}
                      </div>
                      <p className="text-lg font-bold text-white">{weather?.soil_moisture_estimate?.toFixed(1) ?? "--"}%</p>
                      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                        <div
                          className="h-full rounded-full bg-emerald-500 transition-all duration-700"
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
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 shadow-2xl shadow-red-500/5 backdrop-blur-xl">
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
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.07]">
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
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center transition hover:bg-amber-500/10">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-amber-500/70">
                        {t("farmGate", lang)}
                      </p>
                      <p className="text-2xl font-bold text-amber-400">
                        KES {prices?.farm_gate_price_ksh?.toLocaleString() ?? "N/A"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 text-center transition hover:bg-blue-500/10">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-blue-500/70">
                        {t("wholesale", lang)}
                      </p>
                      <p className="text-2xl font-bold text-blue-400">
                        KES {prices?.wholesale_price_ksh?.toLocaleString() ?? "N/A"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center transition hover:bg-emerald-500/10">
                      <p className="mb-1 text-xs font-medium uppercase tracking-wider text-emerald-500/70">
                        {t("retail", lang)}
                      </p>
                      <p className="text-2xl font-bold text-emerald-400">
                        KES {prices?.retail_price_ksh?.toLocaleString() ?? "N/A"}
                      </p>
                    </div>
                  </div>

                  {/* Bar chart */}
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={priceChartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="name" stroke="#9CA3AF" fontSize={12} />
                        <YAxis stroke="#9CA3AF" fontSize={12} />
                        <Tooltip content={<DarkTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
                        <Bar dataKey="price" fill="#10B981" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 14-Day Forecast */}
                <div className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl transition-all duration-300 hover:border-white/20 hover:bg-white/[0.07]">
                  <h2 className="mb-5 flex items-center gap-2 text-base font-semibold text-gray-200">
                    <BarChartIcon className="h-5 w-5 text-cyan-400" />
                    {t("forecast14", lang)} ({t("tempRain", lang)})
                  </h2>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={weather?.forecast ?? []}>
                        <defs>
                          <linearGradient id="maxGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="minGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="rainGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="date" fontSize={11} stroke="#9CA3AF" />
                        <YAxis yAxisId="left" stroke="#9CA3AF" fontSize={11} />
                        <YAxis yAxisId="right" orientation="right" stroke="#9CA3AF" fontSize={11} />
                        <Tooltip content={<DarkTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="max" stroke="transparent" fill="url(#maxGrad)" />
                        <Area yAxisId="left" type="monotone" dataKey="min" stroke="transparent" fill="url(#minGrad)" />
                        <Area yAxisId="right" type="monotone" dataKey="rain_mm" stroke="transparent" fill="url(#rainGrad)" />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="max"
                          stroke="#F59E0B"
                          strokeWidth={2}
                          dot={false}
                          name={t("maxTemp", lang) + " (\u00B0C)"}
                        />
                        <Line
                          yAxisId="left"
                          type="monotone"
                          dataKey="min"
                          stroke="#3B82F6"
                          strokeWidth={2}
                          dot={false}
                          name={t("minTemp", lang) + " (\u00B0C)"}
                        />
                        <Line
                          yAxisId="right"
                          type="monotone"
                          dataKey="rain_mm"
                          stroke="#06B6D4"
                          strokeWidth={2}
                          dot={false}
                          name={t("rain", lang) + " (mm)"}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-amber-500" /> {t("maxTemp", lang)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-blue-500" /> {t("minTemp", lang)}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-4 rounded-sm bg-cyan-500" /> {t("rain", lang)}
                    </span>
                  </div>
                </div>
              </div>

              {/* ======================================================== */}
              {/*  ADVISORY (full width)                                    */}
              {/* ======================================================== */}
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-2xl shadow-emerald-500/5 backdrop-blur-xl lg:col-span-3">
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

        {/* ============================================================== */}
        {/*  FOOTER                                                         */}
        {/* ============================================================== */}
        <footer className="border-t border-white/5 py-6 text-center text-xs text-gray-600">
          {t("footerCredits", lang)}
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
          <div className="relative flex h-full w-full max-w-[400px] flex-col border-l border-white/10 bg-gray-950/95 shadow-2xl backdrop-blur-xl">
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
    </div>
  );
}

# Agriquant Kenya (kilimo.hub@ke)

A high-performance, full-stack agricultural intelligence dashboard for Kenyan farmers, agribusinesses, and consumers. It delivers live satellite agro-telemetry, multi-source national market prices, spatial arbitrage analytics, and Gemini-powered bilingual advisory.

## Key Features

- **Real Agro-Telemetry (Open-Meteo)** — Volumetric soil moisture ($m^3/m^3$, 0–1cm depth), soil temperature, and agronomic saturation classification (Dry / Optimal / Saturated) via Open-Meteo API.
- **Multi-Source Market Prices** — Direct scraping from **KAMIS** (Kenya Agricultural Market Information System - Ministry of Agriculture) and **Mkulima Online** JSON marketplace feeds.
- **Zero Fake Fallbacks** — Strictly genuine data. No synthetic hardcoded price tables. When markets have not yet reported daily surveys, the platform cleanly displays verified snapshots with timestamps or transparent survey pending notices.
- **Spatial Arbitrage Engine** — Real-time price spread calculations comparing local wholesale and retail prices against national median benchmarks. Automatically categorizes markets into *Premium Destination Hubs*, *Producer / Farm Hubs*, and *Balanced Trading Hubs* with distance-based freight logistics.
- **AI Advisory Engine** — Bilingual (English / Swahili) smart farming recommendations based on actual weather conditions, soil moisture, and market price dynamics.
- **Mkulima AI Chatbot** — Context-aware farming assistant powered by Google Gemini, grounded in current dashboard telemetry.
- **Language Toggle** — Seamless Swahili/English i18n across the entire application.

## Tech Stack & Architecture

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind CSS 4, Recharts, Lucide React, Axios. Hosted on **Cloudflare Pages**.
- **Backend (Local / Server):** FastAPI (Python 3.11+), httpx, BeautifulSoup4, uvicorn.
- **Serverless Worker (Edge):** Cloudflare Python Workers with Workers KV caching.
- **Live Data Feeds:**
  - KAMIS (`kamis.kilimo.go.ke`)
  - Mkulima Online (`soko.mkulimaonline.org`)
  - Open-Meteo Agro Telemetry (`api.open-meteo.com`)
  - WeatherAPI (`api.weatherapi.com`)
  - Google Gemini AI (`google-genai` / REST API)

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+ (tested on Node 24)
- A [WeatherAPI](https://www.weatherapi.com/) key (free tier)
- A [Google Gemini API key](https://aistudio.google.com/) (optional, for AI advisory & chat)

### Backend (FastAPI Local Development)

```bash
pip install fastapi uvicorn httpx beautifulsoup4

# Optional: set environment variables in your terminal or .env
export WEATHER_API_KEY="your-weatherapi-key"
export GEMINI_API_KEY="your-gemini-key"

python main.py
# Runs on http://localhost:8000
```

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3000
```

### Production Deployment

1. **Cloudflare Pages (Frontend):** Connected to GitHub repo branch `main`. Automatically builds and deploys Next.js export to `https://agriquant-kenya.pages.dev`.
2. **Cloudflare Python Worker (Backend API):**
   ```bash
   cd api-worker
   npx wrangler deploy
   # Deploys serverless Python worker to https://agriquant-api.emryspaul7.workers.dev
   ```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/weather/{location}` | GET | Live weather + Open-Meteo soil moisture & soil temp + 14-day forecast |
| `/api/prices/{crop}` | GET | National market summary (farm gate, wholesale, retail) with live status |
| `/api/prices/{crop}/markets` | GET | Granular county-level market comparison across KAMIS & Mkulima Online |
| `/api/analysis/{crop}` | GET | Spatial arbitrage engine, national median spreads, volatility, best buy/sell hubs |
| `/api/advice` | POST | AI-generated farming advisory (English / Swahili) |
| `/api/chat` | POST | Conversational AI chatbot grounded in live dashboard data |
| `/api/comments` | POST / GET | User feedback submission and authenticated admin retrieval |

## Supported Crops

Maize (90kg Bag), Tomatoes (64kg Crate), Cabbages (126kg Bag / Head), Dry Onions (Kg), French Beans (Kg), Potatoes (50kg Bag), Wheat (90kg Bag).

## License

MIT


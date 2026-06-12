# AgriQuant Kenya

A full-stack agricultural intelligence dashboard for Kenyan farmers, providing live weather data, real-time market prices, AI-powered farming advice, and an interactive chatbot.

## Features

- **Live Weather** — Real-time conditions and 14-day forecasts from WeatherAPI with agricultural risk alerts (frost, heat stress, heavy rain)
- **Market Intelligence** — Live crop prices scraped from KAMIS (Kenya Agricultural Market Information System), the official government portal from the Ministry of Agriculture
- **AI Advisory Engine** — Bilingual (English/Swahili) smart farming recommendations based on current weather and market conditions
- **Mkulima AI Chatbot** — Context-aware farming assistant powered by Google Gemini, aware of the farmer's current dashboard data
- **Language Toggle** — Full Swahili/English i18n across the entire interface

## Tech Stack

- **Backend:** FastAPI (Python), httpx, BeautifulSoup4, uvicorn
- **Frontend:** Next.js 16, React 19, Tailwind CSS 4, Recharts, Axios, Lucide React
- **Data Sources:** KAMIS (kamis.kilimo.go.ke), WeatherAPI

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+
- A [WeatherAPI](https://www.weatherapi.com/) key (free tier)
- A [Google Gemini API key](https://aistudio.google.com/) (free tier, optional — for chatbot)

### Backend

```bash
pip install fastapi uvicorn httpx beautifulsoup4

# Set environment variables
export WEATHER_API_KEY="your-weatherapi-key"      # Required
export GEMINI_API_KEY="your-gemini-key"            # Optional, for chatbot
export LLM_PROVIDER="gemini"                       # Configurable for other providers

python main.py
# Runs on http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Runs on http://localhost:3000
```

Open http://localhost:3000 in your browser.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/weather/{location}` | GET | Live weather + 14-day forecast + risk alerts |
| `/api/prices/{crop}` | GET | Market prices from KAMIS (farm gate, wholesale, retail) |
| `/api/advice` | POST | AI-generated farming advisory (bilingual) |
| `/api/chat` | POST | Conversational AI chatbot (Gemini-powered) |

## Supported Crops

Maize, Tomatoes, Cabbages, Onions, French Beans, Potatoes, Wheat

## License

MIT

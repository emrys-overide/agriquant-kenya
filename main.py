from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import httpx
import os
import re
import asyncio
from datetime import datetime
from bs4 import BeautifulSoup
import random
import urllib3
import json
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

app = FastAPI(title="Kenya Agri-Predict Dashboard API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION ---
# Using your provided key (PLEASE ROTATE THIS KEY AFTER TESTING)
WEATHER_API_KEY = "7bb7778e1e2b4ec5a7050654260506" 
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "gemini")  # configurable for future providers

# Crop mapping tailored for Laikipia & General Kenya
# kamis_id: Product ID on KAMIS (kamis.kilimo.go.ke) — None if not tracked
# kg_per_unit: Weight in kg for converting per-Kg prices to per-unit prices
CROP_MAPPING = {
    "maize": {"unit": "90kg Bag", "kamis_id": 1, "kg_per_unit": 90, "soko_name": "Dry Maize"},
    "tomatoes": {"unit": "Crate (~30kg)", "kamis_id": 61, "kg_per_unit": 30, "soko_name": "Tomatoes"},
    "cabbages": {"unit": "Head (~1.5kg)", "kamis_id": 58, "kg_per_unit": 1.5, "soko_name": "Cabbages"},
    "onions": {"unit": "Kg", "kamis_id": None, "kg_per_unit": 1, "soko_name": "Dry Onions"},
    "french_beans": {"unit": "Kg", "kamis_id": None, "kg_per_unit": 1, "soko_name": "French beans"},
    "potatoes": {"unit": "50kg Bag", "kamis_id": 57, "kg_per_unit": 50, "soko_name": "White Irish Potatoes"},
    "wheat": {"unit": "90kg Bag", "kamis_id": 3, "kg_per_unit": 90, "soko_name": "Wheat"},
}

# Reasonable per-Kg price bounds (KES) for each crop.
# Prices outside these ranges are almost certainly data errors or extreme outliers.
REASONABLE_PRICE_RANGES = {
    "maize":         {"min": 25,  "max": 100},    # 90kg bag = KES 2,250–9,000
    "tomatoes":      {"min": 20,  "max": 200},    # crate   = KES 600–6,000
    "cabbages":      {"min": 5,   "max": 80},     # head    = KES 7.5–120
    "onions":        {"min": 30,  "max": 200},
    "french_beans":  {"min": 30,  "max": 250},
    "potatoes":      {"min": 15,  "max": 120},    # 50kg bag = KES 750–6,000
    "wheat":         {"min": 25,  "max": 150},    # 90kg bag = KES 2,250–13,500
}


def _is_reasonable_price(price_per_kg: float, crop: str) -> bool:
    """Check if a per-kg price falls within the expected range for the crop."""
    bounds = REASONABLE_PRICE_RANGES.get(crop, {"min": 1, "max": 500})
    return bounds["min"] <= price_per_kg <= bounds["max"]


def _filter_outliers_iqr(values: list[float]) -> list[float]:
    """Remove extreme outliers using IQR method (1.5x interquartile range)."""
    if len(values) < 4:
        return values
    s = sorted(values)
    n = len(s)
    q1 = s[n // 4]
    q3 = s[3 * n // 4]
    iqr = q3 - q1
    lower = q1 - 1.5 * iqr
    upper = q3 + 1.5 * iqr
    return [v for v in values if lower <= v <= upper]


def _sanitize_market_entries(
    entries: list[dict], crop: str, kg_per_unit: float
) -> list[dict]:
    """
    Filter a list of raw per-market price entries:
      1. Drop prices outside the reasonable per-kg range for this crop.
      2. Apply IQR outlier removal on the remaining values.
      3. Return only clean entries.
    """
    clean = []
    for e in entries:
        ws = e.get("wholesale_per_kg")
        rt = e.get("retail_per_kg")
        # Keep the entry only if at least one price is reasonable
        ws_ok = ws and _is_reasonable_price(ws, crop)
        rt_ok = rt and _is_reasonable_price(rt, crop)
        if ws_ok or rt_ok:
            clean.append({
                **e,
                "wholesale_per_kg": ws if ws_ok else None,
                "retail_per_kg": rt if rt_ok else None,
            })

    # IQR outlier filtering on wholesale and retail separately
    ws_vals = [e["wholesale_per_kg"] for e in clean if e.get("wholesale_per_kg")]
    rt_vals = [e["retail_per_kg"] for e in clean if e.get("retail_per_kg")]
    ws_clean = set(_filter_outliers_iqr(ws_vals)) if ws_vals else set()
    rt_clean = set(_filter_outliers_iqr(rt_vals)) if rt_vals else set()

    result = []
    for e in clean:
        ws = e.get("wholesale_per_kg")
        rt = e.get("retail_per_kg")
        ws = ws if ws and ws in ws_clean else None
        rt = rt if rt and rt in rt_clean else None
        if ws or rt:
            result.append({**e, "wholesale_per_kg": ws, "retail_per_kg": rt})

    return result


# User agents to prevent web scraping blocks
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
]

# --- Price cache: persists last scraped KAMIS prices so they become the fallback ---
PRICE_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "price_cache.json")


def _load_price_cache() -> dict:
    """Load cached per-market prices from disk. Returns empty dict if missing."""
    try:
        with open(PRICE_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_price_cache(data: dict):
    """Persist per-market prices to disk for future fallback use."""
    try:
        with open(PRICE_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Price cache save error: {e}")


# ==========================================
# 0. ROOT & API INFO
# ==========================================
from fastapi.responses import RedirectResponse, JSONResponse

@app.get("/")
async def root():
    return RedirectResponse(url="https://agriquant-kenya.pages.dev")

@app.get("/api")
async def api_info():
    return JSONResponse({
        "service": "kilimo.hub@ke API",
        "version": "1.2",
        "endpoints": {
            "weather": "GET /api/weather/<location>",
            "prices": "GET /api/prices/<crop>",
            "markets": "GET /api/prices/<crop>/markets",
            "analysis": "GET /api/analysis/<crop>",
            "advice": "POST /api/advice",
            "chat": "POST /api/chat",
            "submit_feedback": "POST /api/comments",
            "get_feedback": "GET /api/comments?password=<admin_password>",
        },
        "data_sources": [
            "KAMIS (kamis.kilimo.go.ke) — Kenya Agricultural Market Information System",
            "Mkulima Online (soko.mkulimaonline.org) — Farmer marketplace JSON API",
            "Mkulima Bora (portal.mkulimabora.org) — Digital agriculture marketplace with daily market prices",
        ],
        "frontend": "https://agriquant-kenya.pages.dev",
    })

# ==========================================
# 1. LIVE WEATHER DATA (Using your API Key)
# ==========================================
@app.get("/api/weather/{location}")
async def get_live_weather(location: str):
    url = "http://api.weatherapi.com/v1/forecast.json"
    params = {
        "key": WEATHER_API_KEY,
        "q": location + ", Kenya",
        "days": 14,
        "aqi": "no",
        "alerts": "yes"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError:
            raise HTTPException(status_code=404, detail=f"Location '{location}' not found in Kenya.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Weather API error: {str(e)}")
        
        current = data['current']
        forecast = data['forecast']['forecastday']
        
        # Agricultural Risk Engine
        risk_alerts = []
        for day in forecast:
            min_temp = day['day']['mintemp_c']
            max_temp = day['day']['maxtemp_c']
            rain_chance = day['day']['daily_chance_of_rain']
            date_str = day['date']
            
            if min_temp < 5:
                risk_alerts.append(f"❄️ Frost risk on {date_str}. Cover sensitive crops.")
            if rain_chance > 75:
                risk_alerts.append(f"🌧️ Heavy rain expected on {date_str}. Delay fertilizer application.")
            if max_temp > 32 and rain_chance < 20:
                risk_alerts.append(f"☀️ Heat stress on {date_str}. Increase irrigation.")

        return {
            "location": data['location']['name'],
            "current_temp": current['temp_c'],
            "condition": current['condition']['text'],
            "humidity": current['humidity'],
            "wind_kph": current['wind_kph'],
            "soil_moisture_estimate": min(100, current['humidity'] * 0.65), 
            "forecast": [{"date": d['date'], "max": d['day']['maxtemp_c'], "min": d['day']['mintemp_c'], "rain_mm": d['day']['totalprecip_mm'], "rain_chance": d['day']['daily_chance_of_rain']} for d in forecast],
            "agri_risk_alerts": risk_alerts
        }

# ==========================================
# 2. KAMIS MARKET PRICE SCRAPER
# ==========================================
# Source: Kenya Agricultural Market Information System (kamis.kilimo.go.ke)
# Official government data from the Ministry of Agriculture & Livestock Development.
# Prices are published per Kg with Wholesale and Retail columns across
# dozens of markets in every county.  Updated daily by KAMIS field officers.

KAMIS_BASE_URL = "https://kamis.kilimo.go.ke/site/market"

async def scrape_kamis_prices(kamis_id: int) -> dict | None:
    """
    Fetches live wholesale & retail prices from KAMIS for a given product ID.
    Returns a dict with aggregated stats, or None if no data is available.
    """
    url = f"{KAMIS_BASE_URL}?product={kamis_id}"
    headers = {"User-Agent": random.choice(USER_AGENTS)}

    async with httpx.AsyncClient(follow_redirects=True, verify=False) as client:
        try:
            response = await client.get(url, headers=headers, timeout=15.0)
            if response.status_code != 200:
                return None

            soup = BeautifulSoup(response.text, "html.parser")
            table = soup.find("table")
            if not table:
                return None

            rows = table.find_all("tr")[1:]  # skip header row

            wholesale_prices = []
            retail_prices = []
            latest_date = None

            for row in rows:
                cols = row.find_all("td")
                if len(cols) < 10:
                    continue

                wholesale_text = cols[5].get_text(strip=True)
                retail_text = cols[6].get_text(strip=True)
                date_text = cols[9].get_text(strip=True)

                # Track the most recent date
                if date_text and (latest_date is None or date_text > latest_date):
                    latest_date = date_text

                # Parse "46.67/Kg" -> 46.67
                for text, bucket in [(wholesale_text, wholesale_prices), (retail_text, retail_prices)]:
                    match = re.match(r"([\d,]+\.?\d*)", text.replace(",", ""))
                    if match:
                        price = float(match.group(1))
                        if 1 < price < 500000:  # sanity check
                            bucket.append(price)

            if not retail_prices:
                return None

            return {
                "wholesale_values": wholesale_prices,
                "retail_values": retail_prices,
                "latest_date": latest_date,
                "market_count": len(rows),
            }

        except Exception as e:
            print(f"KAMIS scraper error for product {kamis_id}: {e}")
            return None


def _parse_price(text: str) -> float | None:
    """Parse a KAMIS price string like '46.67/Kg' into a float, or None."""
    match = re.match(r"([\d,]+\.?\d*)", text.replace(",", ""))
    if match:
        price = float(match.group(1))
        if 1 < price < 500000:
            return price
    return None


# --- Key Kenyan markets for multi-market comparison ---
KEY_MARKETS = ["nairobi", "nyeri", "nakuru", "kisumu", "eldoret", "thika", "meru", "kitale"]

async def scrape_kamis_per_market(kamis_id: int) -> list[dict] | None:
    """
    Scrapes KAMIS and returns per-market price breakdown.
    Each entry: {market, county, wholesale, retail, date}
    """
    url = f"{KAMIS_BASE_URL}?product={kamis_id}"
    headers = {"User-Agent": random.choice(USER_AGENTS)}

    async with httpx.AsyncClient(follow_redirects=True, verify=False) as client:
        try:
            response = await client.get(url, headers=headers, timeout=15.0)
            if response.status_code != 200:
                return None

            soup = BeautifulSoup(response.text, "html.parser")
            table = soup.find("table")
            if not table:
                return None

            rows = table.find_all("tr")[1:]  # skip header

            # Try to detect column layout from header row
            header_row = table.find("tr")
            header_texts = []
            if header_row:
                header_texts = [th.get_text(strip=True).lower() for th in header_row.find_all(["th", "td"])]

            # Detect market column index
            market_col = 1  # default
            county_col = 0  # default
            for i, ht in enumerate(header_texts):
                if "market" in ht:
                    market_col = i
                elif "county" in ht:
                    county_col = i

            market_data = []
            for row in rows:
                cols = row.find_all("td")
                if len(cols) < 10:
                    continue

                market_name = cols[market_col].get_text(strip=True) if market_col < len(cols) else ""
                county_name = cols[county_col].get_text(strip=True) if county_col < len(cols) else ""
                wholesale = _parse_price(cols[5].get_text(strip=True))
                retail = _parse_price(cols[6].get_text(strip=True))
                date_text = cols[9].get_text(strip=True) if len(cols) > 9 else ""

                if retail is not None or wholesale is not None:
                    market_data.append({
                        "market": market_name,
                        "county": county_name,
                        "wholesale_per_kg": wholesale,
                        "retail_per_kg": retail,
                        "date": date_text,
                    })

            return market_data if market_data else None

        except Exception as e:
            print(f"KAMIS per-market scraper error for product {kamis_id}: {e}")
            return None


# ==========================================
# 2a. MKULIMA ONLINE PRICE DATA (soko.mkulimaonline.org)
# ==========================================
# Source: Mkulima Online — a Kenyan agricultural marketplace platform
# Provides live wholesale & retail prices via a JSON API across 55+ markets
# and 76+ commodities. Data is updated regularly from market surveys.

SOKO_API_URL = "https://soko.mkulimaonline.org/api/table-data/"


async def scrape_mkulima_online(soko_name: str) -> list[dict] | None:
    """
    Fetches per-market price data from Mkulima Online for a given commodity.
    Returns a list of dicts: {market, county, wholesale_per_kg, retail_per_kg, date}
    or None if the request fails / no data available.
    """
    params = {"commodity": soko_name}
    headers = {"User-Agent": random.choice(USER_AGENTS), "Accept": "application/json"}

    async with httpx.AsyncClient(follow_redirects=True, verify=False) as client:
        try:
            response = await client.get(SOKO_API_URL, params=params, headers=headers, timeout=15.0)
            if response.status_code != 200:
                print(f"Mkulima Online returned status {response.status_code} for {soko_name}")
                return None

            data = response.json()
            if not isinstance(data, dict):
                return None

            # API returns {buy: [...], sell: [...]}
            # "buy" = what buyers pay (retail-ish), "sell" = what sellers ask (wholesale-ish)
            buy_entries = data.get("buy", [])
            sell_entries = data.get("sell", [])

            # Merge buy + sell by market name to get both prices per market
            market_map: dict[str, dict] = {}

            for item in sell_entries:
                mkt = (item.get("market") or "").strip()
                if not mkt:
                    continue
                key = mkt.lower()
                ws = _safe_float(item.get("wholesale_kg"))
                rt = _safe_float(item.get("retail_kg"))
                county = (item.get("county") or "").strip()
                date_str = (item.get("date") or "").strip()
                market_map.setdefault(key, {
                    "market": mkt,
                    "county": county,
                    "wholesale_per_kg": None,
                    "retail_per_kg": None,
                    "date": date_str,
                })
                if ws:
                    market_map[key]["wholesale_per_kg"] = ws
                if rt:
                    market_map[key]["retail_per_kg"] = rt
                if date_str and not market_map[key]["date"]:
                    market_map[key]["date"] = date_str

            for item in buy_entries:
                mkt = (item.get("market") or "").strip()
                if not mkt:
                    continue
                key = mkt.lower()
                rt = _safe_float(item.get("retail_kg"))
                ws = _safe_float(item.get("wholesale_kg"))
                county = (item.get("county") or "").strip()
                date_str = (item.get("date") or "").strip()

                if key not in market_map:
                    market_map[key] = {
                        "market": mkt,
                        "county": county,
                        "wholesale_per_kg": None,
                        "retail_per_kg": None,
                        "date": date_str,
                    }
                # Fill in missing prices from buy side
                if rt and not market_map[key]["retail_per_kg"]:
                    market_map[key]["retail_per_kg"] = rt
                if ws and not market_map[key]["wholesale_per_kg"]:
                    market_map[key]["wholesale_per_kg"] = ws
                if date_str and not market_map[key]["date"]:
                    market_map[key]["date"] = date_str

            result = [v for v in market_map.values() if v["wholesale_per_kg"] or v["retail_per_kg"]]
            return result if result else None

        except Exception as e:
            print(f"Mkulima Online scraper error for {soko_name}: {e}")
            return None


def _safe_float(val) -> float | None:
    """Convert a value to float safely, returning None on failure."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if 0.1 < f < 500000 else None
    except (ValueError, TypeError):
        return None


# ==========================================
# SOURCE 3: MKULIMA BORA (portal.mkulimabora.org)
# ==========================================
# Mkulima Bora is a digital agriculture marketplace and data platform that
# aggregates real-time crop prices from major markets across Kenya.
# The platform is associated with the broader Kenyan farming ecosystem
# including community programmes like Mugambo wa Murimi (Inooro FM/TV),
# which broadcasts farming content and connects farmers to market information.
# Data is updated daily from market surveys and published as wholesale/retail
# prices per kilogram at specific market locations.

MKULIMA_BORA_BASE = "https://portal.mkulimabora.org/market-prices"
MKULIMA_BORA_SLUGS: dict[str, str] = {
    "maize": "dry-maize",
    "tomatoes": "tomatoes",
    "cabbages": "cabbages",
    "onions": "dry-onions",
    "french_beans": "french-beans",
    "potatoes": "red-irish-potato",
    "wheat": "wheat",
}


async def scrape_mkulima_bora(crop_slug: str) -> list[dict] | None:
    """
    Scrape per-market price data from Mkulima Bora (portal.mkulimabora.org).
    Parses the HTML table at /market-prices/{crop_slug} and returns a list of
    dicts: {market, county, wholesale_per_kg, retail_per_kg, date}.
    Returns None on failure or if no valid data is found.
    """
    url = f"{MKULIMA_BORA_BASE}/{crop_slug}"
    headers = {"User-Agent": random.choice(USER_AGENTS)}

    async with httpx.AsyncClient(follow_redirects=True, verify=False) as client:
        try:
            response = await client.get(url, headers=headers, timeout=12.0)
            if response.status_code != 200:
                print(f"Mkulima Bora returned status {response.status_code} for {crop_slug}")
                return None

            soup = BeautifulSoup(response.text, "html.parser")

            # The site renders prices in a <table class="table-modern table">
            table = soup.find("table", class_="table-modern")
            if not table:
                # Fallback: look for any table inside the premium wrapper
                wrapper = soup.find("div", class_="table-wrap-premium")
                if wrapper:
                    table = wrapper.find("table")
            if not table:
                print(f"Mkulima Bora: no price table found for {crop_slug}")
                return None

            rows = table.find_all("tr")
            entries: list[dict] = []

            for row in rows[1:]:  # skip header
                cells = row.find_all("td")
                if len(cells) < 5:
                    continue

                market = cells[0].get_text(strip=True)
                county = cells[1].get_text(strip=True) if len(cells) > 1 else ""

                # Wholesale and retail are in <span class="price-pill ..."> elements
                ws_text = ""
                rt_text = ""
                if len(cells) > 2:
                    ws_span = cells[2].find("span", class_="price-pill")
                    ws_text = ws_span.get_text(strip=True) if ws_span else cells[2].get_text(strip=True)
                if len(cells) > 3:
                    rt_span = cells[3].find("span", class_="price-pill")
                    rt_text = rt_span.get_text(strip=True) if rt_span else cells[3].get_text(strip=True)

                date_str = cells[5].get_text(strip=True) if len(cells) > 5 else ""

                # Parse prices — strip "Ksh" prefix and commas
                def _parse_price(text: str) -> float | None:
                    cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
                    if not cleaned:
                        return None
                    try:
                        val = float(cleaned)
                        return val if 0.1 < val < 500000 else None
                    except ValueError:
                        return None

                ws = _parse_price(ws_text)
                rt = _parse_price(rt_text)

                if not market or (ws is None and rt is None):
                    continue

                entries.append({
                    "market": market,
                    "county": county if county != "—" else "",
                    "wholesale_per_kg": ws,
                    "retail_per_kg": rt,
                    "date": date_str,
                })

            return entries if entries else None

        except Exception as e:
            print(f"Mkulima Bora scraper error for {crop_slug}: {e}")
            return None


@app.get("/api/prices/{crop}")
async def get_market_prices(crop: str):
    crop = crop.lower()
    if crop not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")

    crop_info = CROP_MAPPING[crop]
    kamis_id = crop_info["kamis_id"]
    kg_per_unit = crop_info["kg_per_unit"]

    # --- Attempt live scrape from KAMIS ---
    kamis_data = None
    if kamis_id is not None:
        kamis_data = await scrape_kamis_prices(kamis_id)

    if kamis_data is not None and kamis_data["retail_values"]:
        wholesale_vals = sorted(kamis_data["wholesale_values"])
        retail_vals = sorted(kamis_data["retail_values"])

        def median(vals):
            n = len(vals)
            if n == 0:
                return 0
            return vals[n // 2]

        # Median wholesale across markets
        wholesale_per_kg = median(wholesale_vals) if wholesale_vals else median(retail_vals) * 0.85
        # Median retail across markets
        retail_per_kg = median(retail_vals)
        # Farm gate: 80% of the 25th-percentile wholesale (filters outlier markets)
        if len(wholesale_vals) >= 3:
            p25 = wholesale_vals[len(wholesale_vals) // 4]
        elif wholesale_vals:
            p25 = wholesale_vals[0]
        else:
            p25 = wholesale_per_kg * 0.85
        farm_gate_per_kg = p25 * 0.80

        # Convert from per-Kg to per-unit
        farm_price = round(farm_gate_per_kg * kg_per_unit, 2)
        wholesale_price = round(wholesale_per_kg * kg_per_unit, 2)
        retail_price = round(retail_per_kg * kg_per_unit, 2)

        source_count = kamis_data["market_count"]
        data_date = kamis_data["latest_date"] or "today"
        data_status = f"Live from KAMIS ({source_count} markets, {data_date})"
    else:
        # --- Secondary source: Mkulima Bora ---
        bora_slug = MKULIMA_BORA_SLUGS.get(crop)
        bora_entries = await scrape_mkulima_bora(bora_slug) if bora_slug else None

        if bora_entries and len(bora_entries) >= 2:
            ws_vals = sorted([e["wholesale_per_kg"] for e in bora_entries if e.get("wholesale_per_kg")])
            rt_vals = sorted([e["retail_per_kg"] for e in bora_entries if e.get("retail_per_kg")])

            def _median(vals):
                if not vals:
                    return None
                return sorted(vals)[len(vals) // 2]

            wholesale_per_kg = _median(ws_vals) if ws_vals else (_median(rt_vals) or 0) * 0.85
            retail_per_kg = _median(rt_vals) or wholesale_per_kg * 1.35

            # Farm gate: 80% of 25th-percentile wholesale
            if len(ws_vals) >= 3:
                p25 = ws_vals[len(ws_vals) // 4]
            elif ws_vals:
                p25 = ws_vals[0]
            else:
                p25 = wholesale_per_kg * 0.85
            farm_gate_per_kg = p25 * 0.80

            farm_price = round(farm_gate_per_kg * kg_per_unit, 2)
            wholesale_price = round(wholesale_per_kg * kg_per_unit, 2)
            retail_price = round(retail_per_kg * kg_per_unit, 2)

            latest_date = max((e.get("date", "") for e in bora_entries if e.get("date")), default="recent")
            data_status = f"Live from Mkulima Bora ({len(bora_entries)} markets, {latest_date})"
        else:
            # Last resort: hardcoded baselines
            baselines_per_kg = {
                "maize": 50, "tomatoes": 100, "cabbages": 27,
                "onions": 80, "french_beans": 120, "potatoes": 70, "wheat": 100,
            }
            base = baselines_per_kg.get(crop, 50)
            farm_gate_per_kg = base * 0.85
            wholesale_per_kg = base
            retail_per_kg = base * 1.50

            farm_price = round(farm_gate_per_kg * kg_per_unit, 2)
            wholesale_price = round(wholesale_per_kg * kg_per_unit, 2)
            retail_price = round(retail_per_kg * kg_per_unit, 2)
            data_status = "Estimated baseline (KAMIS & Mkulima Bora unavailable)"

    margin = round(((retail_price - farm_price) / farm_price) * 100, 2) if farm_price else 0

    return {
        "crop": crop.capitalize(),
        "unit": crop_info["unit"],
        "farm_gate_price_ksh": farm_price,
        "wholesale_price_ksh": wholesale_price,
        "retail_price_ksh": retail_price,
        "profit_margin_estimate": margin,
        "data_status": data_status,
    }


async def _async_none():
    """No-op coroutine used as a placeholder in asyncio.gather()."""
    return None


# ==========================================
# 2b. PER-MARKET PRICE COMPARISON (Multi-Source)
# ==========================================
@app.get("/api/prices/{crop}/markets")
async def get_market_prices_by_market(crop: str):
    """
    Returns per-market wholesale & retail prices for a given crop
    in the crop's default unit (crate, bag, head, etc.).
    Fetches from KAMIS + Mkulima Online + Mkulima Bora concurrently and merges results.
    Falls back to cached prices or hardcoded baselines when live data is unavailable.
    """
    crop = crop.lower()
    if crop not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")

    crop_info = CROP_MAPPING[crop]
    kamis_id = crop_info["kamis_id"]
    soko_name = crop_info.get("soko_name", "")
    kg_per_unit = crop_info["kg_per_unit"]
    unit_name = crop_info["unit"]
    bora_slug = MKULIMA_BORA_SLUGS.get(crop)

    # --- Fetch from all three sources concurrently ---
    kamis_raw, soko_raw, bora_raw = await asyncio.gather(
        scrape_kamis_per_market(kamis_id) if kamis_id is not None else _async_none(),
        scrape_mkulima_online(soko_name) if soko_name else _async_none(),
        scrape_mkulima_bora(bora_slug) if bora_slug else _async_none(),
    )

    sources_used = []
    # Unified list of per-market entries (per-kg prices)
    all_entries: dict[str, list[dict]] = {}

    def _merge_entries(entries: list[dict], source_tag: str):
        for e in entries:
            name = e["market"].strip()
            if not name:
                continue
            key = name.lower()
            all_entries.setdefault(key, [])
            all_entries[key].append({**e, "_source": source_tag})

    if kamis_raw:
        _merge_entries(kamis_raw, "KAMIS")
        sources_used.append("KAMIS")
    if soko_raw:
        _merge_entries(soko_raw, "Mkulima Online")
        sources_used.append("Mkulima Online")
    if bora_raw:
        _merge_entries(bora_raw, "Mkulima Bora")
        sources_used.append("Mkulima Bora")

    # --- Sanitize: filter out unreasonable prices & outliers ---
    for key in list(all_entries.keys()):
        all_entries[key] = _sanitize_market_entries(all_entries[key], crop, kg_per_unit)
        if not all_entries[key]:
            del all_entries[key]

    market_data = []
    data_source = "live" if sources_used else "none"

    def _median(vals):
        if not vals:
            return None
        s = sorted(vals)
        return s[len(s) // 2]

    # Aggregate per market: median wholesale & retail across all sources
    for market_key, entries in all_entries.items():
        wholesale_vals = [e["wholesale_per_kg"] for e in entries if e.get("wholesale_per_kg")]
        retail_vals = [e["retail_per_kg"] for e in entries if e.get("retail_per_kg")]

        ws = _median(wholesale_vals)
        rt = _median(retail_vals)
        latest = max((e.get("date", "") for e in entries if e.get("date")), default="")
        county = entries[0].get("county", "")
        market_name = entries[0]["market"]
        entry_sources = list(set(e["_source"] for e in entries))

        market_data.append({
            "market": market_name,
            "county": county,
            "wholesale_price": round(ws * kg_per_unit, 2) if ws else None,
            "retail_price": round(rt * kg_per_unit, 2) if rt else None,
            "date": latest,
            "is_key_market": market_key in KEY_MARKETS,
            "sources": entry_sources,
        })

    # Save to cache if we got live data
    if market_data:
        cache = _load_price_cache()
        cache[crop] = {
            "markets": market_data,
            "unit": unit_name,
            "kg_per_unit": kg_per_unit,
            "sources": sources_used,
            "scraped_at": datetime.now().isoformat(),
        }
        _save_price_cache(cache)

    # If no live data at all, try the cache
    if not market_data:
        cache = _load_price_cache()
        if crop in cache:
            cached = cache[crop]
            market_data = cached.get("markets", [])
            data_source = "cached"
            sources_used = cached.get("sources", ["cached"])
        else:
            # Last resort: minimal hardcoded baseline
            data_source = "baseline"
            sources_used = ["baseline"]
            hard_coded = {
                "maize": {"nairobi": 55, "nyeri": 48, "nakuru": 50},
                "tomatoes": {"nairobi": 110, "nyeri": 95, "nakuru": 100},
                "cabbages": {"nairobi": 30, "nyeri": 25, "nakuru": 27},
                "onions": {"nairobi": 90, "nyeri": 75, "nakuru": 80},
                "french_beans": {"nairobi": 130, "nyeri": 115, "nakuru": 120},
                "potatoes": {"nairobi": 80, "nyeri": 65, "nakuru": 70},
                "wheat": {"nairobi": 110, "nyeri": 95, "nakuru": 100},
            }
            crop_baselines = hard_coded.get(crop, {})
            for market_name, base_per_kg in crop_baselines.items():
                market_data.append({
                    "market": market_name.capitalize(),
                    "county": market_name.capitalize(),
                    "wholesale_price": round(base_per_kg * kg_per_unit, 2),
                    "retail_price": round(base_per_kg * 1.35 * kg_per_unit, 2),
                    "date": "estimated",
                    "is_key_market": market_name.lower() in KEY_MARKETS,
                    "sources": ["baseline"],
                })

    # Sort: key markets first, then by retail price descending
    market_data.sort(key=lambda m: (not m["is_key_market"], -(m["retail_price"] or 0)))

    source_label = " + ".join(sources_used) if sources_used else "none"
    status_labels = {
        "live": f"Live from {source_label} ({len(market_data)} markets)",
        "cached": f"Cached data ({len(market_data)} markets)",
        "baseline": "Estimated baseline prices",
        "none": "No live data available",
    }

    return {
        "crop": crop.capitalize(),
        "unit": unit_name,
        "kg_per_unit": kg_per_unit,
        "markets": market_data,
        "data_source": data_source,
        "data_sources": sources_used,
        "data_status": status_labels.get(data_source, "Unknown"),
    }


# ==========================================
# 2c. PRICE ANALYSIS & PREDICTION ENGINE (Multi-Source)
# ==========================================
@app.get("/api/analysis/{crop}")
async def get_price_analysis(crop: str, user_lat: float = None, user_lon: float = None):
    """
    Provides price analysis, best-market recommendation, and simple
    price predictions based on multi-market data from KAMIS + Mkulima Online.
    All prices are in the crop's default unit (crate, bag, head, etc.).
    """
    crop = crop.lower()
    if crop not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")

    crop_info = CROP_MAPPING[crop]
    kamis_id = crop_info["kamis_id"]
    soko_name = crop_info.get("soko_name", "")
    kg_per_unit = crop_info["kg_per_unit"]
    unit_name = crop_info["unit"]
    bora_slug = MKULIMA_BORA_SLUGS.get(crop)

    # --- Fetch from all three sources concurrently ---
    kamis_raw, soko_raw, bora_raw = await asyncio.gather(
        scrape_kamis_per_market(kamis_id) if kamis_id is not None else _async_none(),
        scrape_mkulima_online(soko_name) if soko_name else _async_none(),
        scrape_mkulima_bora(bora_slug) if bora_slug else _async_none(),
    )

    sources_used = []
    raw_markets = []  # per-kg entries from all sources

    if kamis_raw:
        for e in kamis_raw:
            raw_markets.append({**e, "_source": "KAMIS"})
        sources_used.append("KAMIS")

    if soko_raw:
        for e in soko_raw:
            raw_markets.append({**e, "_source": "Mkulima Online"})
        sources_used.append("Mkulima Online")

    if bora_raw:
        for e in bora_raw:
            raw_markets.append({**e, "_source": "Mkulima Bora"})
        sources_used.append("Mkulima Bora")

    data_source = "live" if sources_used else "none"

    # --- Sanitize live data: filter unreasonable prices & outliers ---
    if raw_markets and data_source == "live":
        raw_markets = _sanitize_market_entries(raw_markets, crop, kg_per_unit)

    # If no live data, try cache
    if not raw_markets:
        cache = _load_price_cache()
        if crop in cache:
            cached_markets = cache[crop].get("markets", [])
            for m in cached_markets:
                ws = m.get("wholesale_price")
                rt = m.get("retail_price")
                if ws or rt:
                    # Cache stores per-unit prices; convert back to per-kg
                    ws_kg = round(ws / kg_per_unit, 2) if ws else None
                    rt_kg = round(rt / kg_per_unit, 2) if rt else None
                    raw_markets.append({
                        "market": m["market"],
                        "county": m.get("county", ""),
                        "wholesale_per_kg": ws_kg,
                        "retail_per_kg": rt_kg,
                        "date": m.get("date", "cached"),
                        "_source": "cache",
                    })
            data_source = "cached"

    if not raw_markets:
        data_source = "baseline"
        sources_used = ["baseline"]
        baselines = {
            "maize": {"Nairobi": 55, "Nyeri": 48, "Nakuru": 50},
            "tomatoes": {"Nairobi": 110, "Nyeri": 95, "Nakuru": 100},
            "cabbages": {"Nairobi": 30, "Nyeri": 25, "Nakuru": 27},
            "onions": {"Nairobi": 90, "Nyeri": 75, "Nakuru": 80},
            "french_beans": {"Nairobi": 130, "Nyeri": 115, "Nakuru": 120},
            "potatoes": {"Nairobi": 80, "Nyeri": 65, "Nakuru": 70},
            "wheat": {"Nairobi": 110, "Nyeri": 95, "Nakuru": 100},
        }
        crop_base = baselines.get(crop, {"Nairobi": 50, "Nyeri": 45, "Nakuru": 48})
        for mkt, price_per_kg in crop_base.items():
            raw_markets.append({
                "market": mkt, "county": mkt,
                "wholesale_per_kg": price_per_kg,
                "retail_per_kg": round(price_per_kg * 1.35, 2),
                "date": "baseline",
                "_source": "baseline",
            })

    # Aggregate per market — convert per-kg to per-unit
    grouped: dict[str, list[dict]] = {}
    for entry in raw_markets:
        name = entry["market"].strip()
        if name:
            grouped.setdefault(name.lower(), []).append(entry)

    market_summaries = []
    all_retail = []
    all_wholesale = []

    for mkt_key, entries in grouped.items():
        ws_vals = [e["wholesale_per_kg"] * kg_per_unit for e in entries if e.get("wholesale_per_kg")]
        rt_vals = [e["retail_per_kg"] * kg_per_unit for e in entries if e.get("retail_per_kg")]
        if not rt_vals and not ws_vals:
            continue

        def _med(v):
            v_sorted = sorted(v)
            return v_sorted[len(v_sorted) // 2] if v_sorted else 0

        ws_med = round(_med(ws_vals), 2) if ws_vals else 0
        rt_med = round(_med(rt_vals), 2) if rt_vals else round(ws_med * 1.3, 2)
        margin_pct = round(((rt_med - ws_med) / ws_med) * 100, 1) if ws_med else 0

        market_summaries.append({
            "market": entries[0]["market"],
            "county": entries[0].get("county", ""),
            "wholesale_price": ws_med,
            "retail_price": rt_med,
            "margin_pct": margin_pct,
            "is_key_market": mkt_key in KEY_MARKETS,
        })
        if rt_med: all_retail.append(rt_med)
        if ws_med: all_wholesale.append(ws_med)

    import statistics
    avg_retail = round(statistics.mean(all_retail), 2) if all_retail else 0
    avg_wholesale = round(statistics.mean(all_wholesale), 2) if all_wholesale else 0
    std_retail = round(statistics.stdev(all_retail), 2) if len(all_retail) > 1 else 0
    min_retail = round(min(all_retail), 2) if all_retail else 0
    max_retail = round(max(all_retail), 2) if all_retail else 0
    price_spread = round(max_retail - min_retail, 2)
    cv = round((std_retail / avg_retail) * 100, 1) if avg_retail else 0

    market_summaries.sort(key=lambda m: m["retail_price"], reverse=True)
    best_market = market_summaries[0] if market_summaries else None
    worst_market = market_summaries[-1] if market_summaries else None
    by_ws = sorted(market_summaries, key=lambda m: m["wholesale_price"])
    cheapest_source = by_ws[0] if by_ws else None

    predictions = []
    for ms in market_summaries[:8]:
        deviation = ((ms["retail_price"] - avg_retail) / avg_retail * 100) if avg_retail else 0
        predicted_change_pct = round(-deviation * 0.3, 1)
        predicted_retail = round(ms["retail_price"] * (1 + predicted_change_pct / 100), 2)

        if predicted_change_pct > 3:
            trend = "rising"
            emoji = "📈"
        elif predicted_change_pct < -3:
            trend = "falling"
            emoji = "📉"
        else:
            trend = "stable"
            emoji = "➡️"

        predictions.append({
            "market": ms["market"],
            "current_price": ms["retail_price"],
            "predicted_price": predicted_retail,
            "predicted_change_pct": predicted_change_pct,
            "trend": trend,
            "trend_emoji": emoji,
            "confidence": "high" if cv < 15 else "medium" if cv < 30 else "low",
        })

    MARKET_COORDS = {
        "nairobi": (-1.286, 36.817), "nyeri": (-0.420, 36.951),
        "nakuru": (-0.303, 36.070), "kisumu": (-0.092, 34.762),
        "eldoret": (0.514, 35.270), "thika": (-1.033, 37.070),
        "meru": (0.047, 37.656), "kitale": (1.016, 35.003),
        "nanyuki": (-0.009, 37.074), "rumuruti": (0.182, 36.871),
        "nyahururu": (-0.042, 36.360),
    }

    nearest_market = None
    distance_km = None
    if user_lat is not None and user_lon is not None:
        import math
        min_dist = float("inf")
        for mkt_key, (mkt_lat, mkt_lon) in MARKET_COORDS.items():
            dlat = math.radians(mkt_lat - user_lat)
            dlon = math.radians(mkt_lon - user_lon)
            a = math.sin(dlat/2)**2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(mkt_lat)) * math.sin(dlon/2)**2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            dist = 6371 * c
            if dist < min_dist:
                min_dist = dist
                nearest_market = mkt_key
                distance_km = round(dist, 1)

    advice_lines = []
    if best_market and cheapest_source:
        advice_lines.append(
            f"🏆 Best market to sell {crop.capitalize()}: {best_market['market']} "
            f"(KES {best_market['retail_price']:,.0f}/{unit_name} retail)"
        )
        advice_lines.append(
            f"🛒 Cheapest source: {cheapest_source['market']} "
            f"(KES {cheapest_source['wholesale_price']:,.0f}/{unit_name} wholesale)"
        )

    if cv < 15:
        advice_lines.append("📊 Prices are stable across markets — low arbitrage opportunity.")
    elif cv < 30:
        advice_lines.append(f"📊 Moderate price variation (CV {cv}%) — consider selling in higher-paying markets.")
    else:
        advice_lines.append(
            f"📊 High price disparity (CV {cv}%) — significant arbitrage opportunity! "
            f"Spread: KES {price_spread:,.0f}/{unit_name} between cheapest and most expensive market."
        )

    if nearest_market:
        advice_lines.append(f"📍 Nearest major market: {nearest_market.capitalize()} ({distance_km} km away)")

    if sources_used:
        advice_lines.append(f"📡 Data sources: {', '.join(sources_used)}")

    return {
        "crop": crop.capitalize(),
        "unit": unit_name,
        "kg_per_unit": kg_per_unit,
        "data_source": data_source,
        "data_sources": sources_used,
        "market_analysis": market_summaries[:15],
        "statistics": {
            "avg_retail": avg_retail,
            "avg_wholesale": avg_wholesale,
            "price_spread": price_spread,
            "min_retail": min_retail,
            "max_retail": max_retail,
            "volatility_cv_pct": cv,
        },
        "predictions": predictions,
        "recommendation": {
            "best_sell_market": best_market["market"] if best_market else None,
            "best_sell_price": best_market["retail_price"] if best_market else None,
            "cheapest_buy_market": cheapest_source["market"] if cheapest_source else None,
            "cheapest_buy_price": cheapest_source["wholesale_price"] if cheapest_source else None,
        },
        "nearest_market": nearest_market.capitalize() if nearest_market else None,
        "distance_km": distance_km,
        "advisory": "\n".join(advice_lines),
    }


# ==========================================
# 3. AI FARMER ADVISORY ENGINE (Bilingual)
# ==========================================
@app.post("/api/advice")
async def generate_farmer_advice(payload: dict):
    weather = payload.get("weather", {})
    prices = payload.get("prices", {})
    lang = payload.get("lang", "en")
    crop = prices.get("crop", "Your crop")
    location = weather.get("location", "your area")

    alerts = weather.get("agri_risk_alerts", [])
    current_temp = weather.get("current_temp", 25)
    margin = prices.get("profit_margin_estimate", 0)
    farm_price = prices.get("farm_gate_price_ksh", 0)
    retail_price = prices.get("retail_price_ksh", 0)
    data_status = prices.get("data_status", "Unknown")

    is_laikipia = any(
        kw in location.lower()
        for kw in ("laikipia", "nanyuki", "rumuruti", "nyahururu", "dol dol")
    )

    if lang == "sw":
        # ===== SWAHILI VERSION =====
        advice_parts = []

        # Greeting
        summary_header = (
            f"**Habari mkulima wa {location}!** Karibu kwenye taarifa yako ya leo.\n\n"
        )

        # Weather alerts
        if alerts:
            advice_parts.append("**Kuhusu hali ya hewa:**")
            for alert in alerts[:3]:
                advice_parts.append(f"  - {alert}")
            advice_parts.append("")

        # Temperature advice
        if current_temp > 28:
            advice_parts.append(
                f"🌡️ Joto ni kali sana leo — {current_temp}°C. "
                "Mwagilia maji asubuhi na mapema (kabla ya saa mbili) au jioni ili kuokoa maji. "
                "Pia funika mimea yako kwa mulch ili kudumisha unyevu wa udongo."
            )
        elif current_temp < 12:
            advice_parts.append(
                f"🥶 Baridi kali sana — {current_temp}°C. "
                "Hakikisha umefunika mimea yako hasa mahindi na maharagwe. "
                "Angalia magonjwa ya fangasi kama blight ambayo hujitokeza katika hali ya baridi na unyevunyevu."
            )
        else:
            advice_parts.append(
                f"☀️ Hali ya hewa ni nzuri leo — {current_temp}°C. "
                "Endelea na shughuli zako za kilimo kama kawaida."
            )

        # Market advice
        advice_parts.append("")
        if margin < 20:
            advice_parts.append(
                f"**Kuhusu soko:** Bei ya {crop} haifai sana kwa sasa. "
                f"Mapato ni {margin}% tu kutoka shambani hadi sokoni. "
                "Fikiria kuungana na wakulima wengine kwenye kikundi ili muuze pamoja "
                "na kupata bei bora. Pia jaribu kuongeza thamani — kwa mfano, "
                "kausha au saga bidhaa yako kabla ya kuuza."
            )
        elif margin > 40:
            advice_parts.append(
                f"**Kuhusu soko:** Bei ya {crop} soko ni nzuri sana sasa hivi! "
                f"Faida ni {margin}% kutoka shambani hadi sokoni. "
                "Ni wakati mwafaka wa kuvuna na kupeleka sokoni. "
                "Hakikisha usafiri wako ni wa haraka ili bidhaa isiharibike njiani."
            )
        else:
            advice_parts.append(
                f"**Kuhusu soko:** Bei ya {crop} ni ya kawaida — faida ni {margin}%. "
                "Endelea kufuatilia soko kila siku. Bei zinaweza kupanda wiki zijazo."
            )

        # Laikipia context
        if is_laikipia:
            advice_parts.append("")
            advice_parts.append(
                f"🏔️ **Kuhusu eneo lako:** Eneo lako la {location} lina hali ya hewa ya kipekee. "
                "Udongo wa volkeno unaweza kuwa na asidi — pima pH mara kwa mara. "
                "Ukipanda ngano au waru, hakikisha kuna mifereji ya maji ya kutosha "
                "ili kuzuia mafuriko wakati wa mvua kubwa."
            )

        # Closing
        advice_parts.append("")
        advice_parts.append(
            f"*Kumbuka: data hii inatoka KAMIS (serikali) na hali ya hewa ya leo. "
            f"Kila la heri mkulima!*\n"
            f"*Hali ya data: {data_status}*"
        )

        summary = summary_header + "\n".join(advice_parts)

    else:
        # ===== ENGLISH VERSION =====
        advice_parts = []

        # Greeting
        summary_header = (
            f"**Hello, farmer from {location}!** Welcome to your daily briefing.\n\n"
        )

        # Weather alerts
        if alerts:
            advice_parts.append("**Weather Alerts:**")
            for alert in alerts[:3]:
                advice_parts.append(f"  - {alert}")
            advice_parts.append("")

        # Temperature advice
        if current_temp > 28:
            advice_parts.append(
                f"🌡️ It is hot today — {current_temp}°C. "
                "Irrigate early in the morning (before 8 AM) or in the evening to save water. "
                "Consider mulching your crops to retain soil moisture."
            )
        elif current_temp < 12:
            advice_parts.append(
                f"🥶 It is very cold today — {current_temp}°C. "
                "Cover your crops, especially maize and beans. "
                "Watch out for fungal diseases like blight that thrive in cold, damp conditions."
            )
        else:
            advice_parts.append(
                f"☀️ Weather is pleasant today — {current_temp}°C. "
                "Carry on with your normal farming activities."
            )

        # Market advice
        advice_parts.append("")
        if margin < 20:
            advice_parts.append(
                f"**Market Update:** The profit margin for {crop} is low at {margin}%. "
                "Middlemen are capturing most of the value. "
                "Consider forming a cooperative to sell directly to wholesalers. "
                "You could also add value — for example, dry or mill your produce before selling."
            )
        elif margin > 40:
            advice_parts.append(
                f"**Market Update:** Excellent margins for {crop} at {margin}%! "
                "The market is paying well right now. "
                "Harvest and transport to market as soon as possible. "
                "Make sure your transport is quick so produce stays fresh."
            )
        else:
            advice_parts.append(
                f"**Market Update:** Margins for {crop} are moderate at {margin}%. "
                "Keep watching the market daily — prices may rise in the coming weeks."
            )

        # Laikipia context
        if is_laikipia:
            advice_parts.append("")
            advice_parts.append(
                f"🏔️ **Regional Context:** Your area around {location} has unique micro-climates. "
                "Volcanic soils can become acidic — test your soil pH regularly. "
                "If growing wheat or potatoes, ensure proper drainage to prevent "
                "waterlogging during heavy rains."
            )

        # Closing
        advice_parts.append("")
        advice_parts.append(
            f"*Remember: this data comes from KAMIS (government) and today's weather readings. "
            f"Happy farming!*\n"
            f"*Data status: {data_status}*"
        )

        summary = summary_header + "\n".join(advice_parts)

    return {"advisory_report": summary}


# ==========================================
# 4. GEMINI AI CHATBOT (Kenyan Farming Expert)
# ==========================================
@app.post("/api/chat")
async def gemini_chat(payload: dict):
    """
    Chat with a Kenyan farming expert AI powered by Google Gemini.
    Accepts conversation history, current dashboard context, and language preference.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Gemini API key is not configured. Set the GEMINI_API_KEY environment variable to enable the chatbot."
        )

    messages = payload.get("messages", [])
    context = payload.get("context", {})
    lang = payload.get("lang", "en")

    # --- Build a context-aware system prompt ---
    location = context.get("location", "Kenya")
    current_temp = context.get("current_temp", "N/A")
    condition = context.get("condition", "N/A")
    crop = context.get("crop", "maize")
    farm_price = context.get("farm_gate_price_ksh", "N/A")
    retail_price = context.get("retail_price_ksh", "N/A")
    margin = context.get("profit_margin_estimate", "N/A")
    alerts = context.get("agri_risk_alerts", [])

    if lang == "sw":
        system_prompt = (
            "Wewe ni mtaalamu wa kilimo nchini Kenya, unaitwa 'Mkulima Bora'. "
            "Unazungumza Kiswahili cha Kenya (si cha kitabu) — tumia maneno ambayo mkulima wa kawaida anasikia kila siku. "
            "Unajua sana kuhusu: hali ya hewa, bei za soko (KAMIS), ushauri wa mimea, na kilimo cha eneo la Laikipia na Kenya nzima. "
            "Jibu maswali kwa urahisi na kwa maneno mafupi. Toa ushauri unaoweza kutekelezwa mara moja. "
            "Usitoe majibu ya kitaalamu sana — fikiria unazungumza na mkulima shambani.\n\n"
            f"Hali ya sasa ya mkulima uliyenaye mbele yako:\n"
            f"- Eneo: {location}\n"
            f"- Joto la sasa: {current_temp}°C, Hali: {condition}\n"
            f"- Mimea anayolima: {crop}\n"
            f"- Bei shambani: KSh {farm_price} | Bei ya rejareja: KSh {retail_price} | Faida: {margin}%\n"
        )
        if alerts:
            system_prompt += f"- Tahadhari za hali ya hewa: {'; '.join(alerts[:3])}\n"
    else:
        system_prompt = (
            "You are a Kenyan farming expert AI assistant called 'Mkulima Bora'. "
            "You speak clear, practical English that a Kenyan farmer can easily understand. "
            "You are knowledgeable about: weather conditions, KAMIS market prices, crop advice, "
            "and agriculture in Laikipia and across Kenya. "
            "Give short, actionable advice. Avoid overly technical jargon — "
            "imagine you are speaking to a farmer in the field.\n\n"
            f"Current context for the farmer you are helping:\n"
            f"- Location: {location}\n"
            f"- Current temperature: {current_temp}°C, Condition: {condition}\n"
            f"- Crop being farmed: {crop}\n"
            f"- Farm gate price: KSh {farm_price} | Retail price: KSh {retail_price} | Margin: {margin}%\n"
        )
        if alerts:
            system_prompt += f"- Weather alerts: {'; '.join(alerts[:3])}\n"

    # --- Build Gemini contents array ---
    # System prompt goes in as the first user turn
    contents = [
        {"role": "user", "parts": [{"text": system_prompt}]},
        {"role": "model", "parts": [{"text": "Understood. I am ready to help the farmer with advice based on the context provided."}]}
    ]

    # Map conversation history
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        gemini_role = "user" if role == "user" else "model"
        contents.append({"role": gemini_role, "parts": [{"text": content}]})

    gemini_url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
    )
    gemini_body = {
        "contents": contents,
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 1024
        }
    }

    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(gemini_url, json=gemini_body, timeout=30.0)
            resp.raise_for_status()
            result = resp.json()
        except httpx.HTTPStatusError as e:
            error_detail = e.response.text if e.response else str(e)
            raise HTTPException(
                status_code=502,
                detail=f"Gemini API returned an error: {error_detail}"
            )
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to reach Gemini API: {str(e)}"
            )

    # Extract the reply text from Gemini response
    try:
        reply_text = result["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        reply_text = "Sorry, I could not generate a response at this time. Please try again."

    return {"reply": reply_text}


# ==========================================
# 6. FEEDBACK / COMMENTS (Local JSON Storage)
# ==========================================
import uuid

COMMENTS_FILE = os.path.join(os.path.dirname(__file__), "comments.json")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "agriquant2026")


def _load_comments() -> list:
    try:
        with open(COMMENTS_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _save_comments(comments: list):
    with open(COMMENTS_FILE, "w") as f:
        json.dump(comments, f, indent=2)


@app.post("/api/comments")
async def submit_comment(data: dict):
    """Submit feedback/comment from the dashboard."""
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip()
    message = (data.get("message") or "").strip()
    rating = data.get("rating", 0)

    if not name or not message:
        raise HTTPException(status_code=400, detail="Name and message are required.")

    comments = _load_comments()
    comment = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "email": email,
        "message": message,
        "rating": rating,
        "timestamp": datetime.now().isoformat(),
    }
    comments.insert(0, comment)  # newest first
    _save_comments(comments)
    return {"success": True, "id": comment["id"]}


@app.get("/api/comments")
async def get_comments(password: str = ""):
    """Retrieve all comments (admin only, password-protected)."""
    if password != ADMIN_PASSWORD:
        return {"authorized": False, "comments": []}
    comments = _load_comments()
    return {"authorized": True, "comments": comments}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

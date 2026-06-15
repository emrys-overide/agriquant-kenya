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
    "maize": {"unit": "90kg Bag", "kamis_id": 1, "kg_per_unit": 90},
    "tomatoes": {"unit": "Crate (~30kg)", "kamis_id": 61, "kg_per_unit": 30},
    "cabbages": {"unit": "Head (~1.5kg)", "kamis_id": 58, "kg_per_unit": 1.5},
    "onions": {"unit": "Kg", "kamis_id": None, "kg_per_unit": 1},
    "french_beans": {"unit": "Kg", "kamis_id": None, "kg_per_unit": 1},
    "potatoes": {"unit": "50kg Bag", "kamis_id": 57, "kg_per_unit": 50},
    "wheat": {"unit": "90kg Bag", "kamis_id": 3, "kg_per_unit": 90},
}

# User agents to prevent web scraping blocks
USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
]

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
        # Fallback: realistic baseline averages for Kenya
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
        data_status = "Estimated baseline (KAMIS data unavailable for this crop)"

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


# ==========================================
# 2b. PER-MARKET PRICE COMPARISON
# ==========================================
@app.get("/api/prices/{crop}/markets")
async def get_market_prices_by_market(crop: str):
    """
    Returns per-market wholesale & retail prices for a given crop,
    focusing on key markets: Nairobi, Nyeri, Nakuru, Kisumu, Eldoret, etc.
    """
    crop = crop.lower()
    if crop not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")

    crop_info = CROP_MAPPING[crop]
    kamis_id = crop_info["kamis_id"]
    kg_per_unit = crop_info["kg_per_unit"]

    # Baseline fallback data per market (used when KAMIS is unreachable)
    baselines_per_kg = {
        "maize": {"nairobi": 55, "nyeri": 48, "nakuru": 50, "kisumu": 52, "eldoret": 45, "thika": 53, "meru": 47, "kitale": 44},
        "tomatoes": {"nairobi": 110, "nyeri": 95, "nakuru": 100, "kisumu": 105, "eldoret": 90, "thika": 108, "meru": 92, "kitale": 88},
        "cabbages": {"nairobi": 30, "nyeri": 25, "nakuru": 27, "kisumu": 28, "eldoret": 24, "thika": 29, "meru": 25, "kitale": 23},
        "onions": {"nairobi": 90, "nyeri": 75, "nakuru": 80, "kisumu": 85, "eldoret": 72, "thika": 88, "meru": 74, "kitale": 70},
        "french_beans": {"nairobi": 130, "nyeri": 115, "nakuru": 120, "kisumu": 125, "eldoret": 110, "thika": 128, "meru": 112, "kitale": 108},
        "potatoes": {"nairobi": 80, "nyeri": 65, "nakuru": 70, "kisumu": 75, "eldoret": 60, "thika": 78, "meru": 63, "kitale": 58},
        "wheat": {"nairobi": 110, "nyeri": 95, "nakuru": 100, "kisumu": 105, "eldoret": 90, "thika": 108, "meru": 93, "kitale": 88},
    }

    market_data = []
    data_source = "live"

    if kamis_id is not None:
        raw_markets = await scrape_kamis_per_market(kamis_id)
        if raw_markets:
            # Group by market name (case-insensitive)
            grouped: dict[str, list[dict]] = {}
            for entry in raw_markets:
                name = entry["market"].strip()
                if name:
                    grouped.setdefault(name.lower(), []).append(entry)

            # Aggregate per market: median wholesale & retail
            for market_key, entries in grouped.items():
                wholesale_vals = sorted([e["wholesale_per_kg"] for e in entries if e["wholesale_per_kg"]])
                retail_vals = sorted([e["retail_per_kg"] for e in entries if e["retail_per_kg"]])

                def _median(vals):
                    n = len(vals)
                    if n == 0: return None
                    return vals[n // 2]

                ws = _median(wholesale_vals)
                rt = _median(retail_vals)
                latest = max((e["date"] for e in entries if e["date"]), default="")
                county = entries[0]["county"]

                market_data.append({
                    "market": entries[0]["market"],
                    "county": county,
                    "wholesale_per_kg": round(ws, 2) if ws else None,
                    "retail_per_kg": round(rt, 2) if rt else None,
                    "wholesale_per_unit": round(ws * kg_per_unit, 2) if ws else None,
                    "retail_per_unit": round(rt * kg_per_unit, 2) if rt else None,
                    "date": latest,
                    "is_key_market": market_key in KEY_MARKETS,
                })

    # If no live data, use baseline estimates
    if not market_data:
        data_source = "baseline"
        crop_baselines = baselines_per_kg.get(crop, {})
        for market_name, base_price in crop_baselines.items():
            market_data.append({
                "market": market_name.capitalize(),
                "county": market_name.capitalize(),
                "wholesale_per_kg": round(base_price, 2),
                "retail_per_kg": round(base_price * 1.35, 2),
                "wholesale_per_unit": round(base_price * kg_per_unit, 2),
                "retail_per_unit": round(base_price * 1.35 * kg_per_unit, 2),
                "date": "estimated",
                "is_key_market": market_name.lower() in KEY_MARKETS,
            })

    # Sort: key markets first, then by retail price descending
    market_data.sort(key=lambda m: (not m["is_key_market"], -(m["retail_per_kg"] or 0)))

    return {
        "crop": crop.capitalize(),
        "unit": crop_info["unit"],
        "kg_per_unit": kg_per_unit,
        "markets": market_data,
        "data_source": data_source,
        "data_status": f"Live from KAMIS ({len(market_data)} markets)" if data_source == "live" else "Estimated baseline prices",
    }


# ==========================================
# 2c. PRICE ANALYSIS & PREDICTION ENGINE
# ==========================================
@app.get("/api/analysis/{crop}")
async def get_price_analysis(crop: str, user_lat: float = None, user_lon: float = None):
    """
    Provides price analysis, best-market recommendation, and simple
    price predictions based on multi-market data from KAMIS.
    """
    crop = crop.lower()
    if crop not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")

    crop_info = CROP_MAPPING[crop]
    kamis_id = crop_info["kamis_id"]
    kg_per_unit = crop_info["kg_per_unit"]

    # Get per-market data
    raw_markets = []
    if kamis_id is not None:
        raw_markets = await scrape_kamis_per_market(kamis_id) or []

    # --- Build analysis from available data ---
    # Fallback baseline if no live data
    if not raw_markets:
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
        for mkt, price in crop_base.items():
            raw_markets.append({
                "market": mkt,
                "county": mkt,
                "wholesale_per_kg": price,
                "retail_per_kg": round(price * 1.35, 2),
                "date": "baseline",
            })

    # Aggregate per market
    grouped: dict[str, list[dict]] = {}
    for entry in raw_markets:
        name = entry["market"].strip()
        if name:
            grouped.setdefault(name.lower(), []).append(entry)

    market_summaries = []
    all_retail = []
    all_wholesale = []

    for mkt_key, entries in grouped.items():
        ws_vals = [e["wholesale_per_kg"] for e in entries if e.get("wholesale_per_kg")]
        rt_vals = [e["retail_per_kg"] for e in entries if e.get("retail_per_kg")]
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
            "wholesale_per_kg": ws_med,
            "retail_per_kg": rt_med,
            "wholesale_per_unit": round(ws_med * kg_per_unit, 2),
            "retail_per_unit": round(rt_med * kg_per_unit, 2),
            "margin_pct": margin_pct,
            "is_key_market": mkt_key in KEY_MARKETS,
        })
        if rt_med: all_retail.append(rt_med)
        if ws_med: all_wholesale.append(ws_med)

    # --- Statistical analysis ---
    import statistics
    avg_retail = round(statistics.mean(all_retail), 2) if all_retail else 0
    avg_wholesale = round(statistics.mean(all_wholesale), 2) if all_wholesale else 0
    std_retail = round(statistics.stdev(all_retail), 2) if len(all_retail) > 1 else 0
    min_retail = round(min(all_retail), 2) if all_retail else 0
    max_retail = round(max(all_retail), 2) if all_retail else 0
    price_spread = round(max_retail - min_retail, 2)

    # Coefficient of variation — measures how volatile prices are across markets
    cv = round((std_retail / avg_retail) * 100, 1) if avg_retail else 0

    # --- Best market to sell (highest retail price) ---
    market_summaries.sort(key=lambda m: m["retail_per_kg"], reverse=True)
    best_market = market_summaries[0] if market_summaries else None
    worst_market = market_summaries[-1] if market_summaries else None

    # --- Best market to buy (lowest wholesale) ---
    market_summaries_by_ws = sorted(market_summaries, key=lambda m: m["wholesale_per_kg"])
    cheapest_source = market_summaries_by_ws[0] if market_summaries_by_ws else None

    # --- Price prediction (simple mean-reversion model) ---
    # If current market price is above average → likely to decrease
    # If below average → likely to increase
    # Prediction confidence based on price spread / volatility
    predictions = []
    for ms in market_summaries[:8]:  # top 8 markets
        deviation = ((ms["retail_per_kg"] - avg_retail) / avg_retail * 100) if avg_retail else 0
        # Mean reversion: predict movement toward average
        predicted_change_pct = round(-deviation * 0.3, 1)  # 30% reversion factor
        predicted_retail = round(ms["retail_per_kg"] * (1 + predicted_change_pct / 100), 2)

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
            "current_retail_per_kg": ms["retail_per_kg"],
            "predicted_retail_per_kg": predicted_retail,
            "predicted_change_pct": predicted_change_pct,
            "trend": trend,
            "trend_emoji": emoji,
            "confidence": "high" if cv < 15 else "medium" if cv < 30 else "low",
        })

    # --- Location-based recommendation ---
    # Approximate coordinates for key Kenyan markets
    MARKET_COORDS = {
        "nairobi": (-1.286, 36.817),
        "nyeri": (-0.420, 36.951),
        "nakuru": (-0.303, 36.070),
        "kisumu": (-0.092, 34.762),
        "eldoret": (0.514, 35.270),
        "thika": (-1.033, 37.070),
        "meru": (0.047, 37.656),
        "kitale": (1.016, 35.003),
        "nanyuki": (-0.009, 37.074),
        "rumuruti": (0.182, 36.871),
        "nyahururu": (-0.042, 36.360),
    }

    nearest_market = None
    distance_km = None
    if user_lat is not None and user_lon is not None:
        import math
        min_dist = float("inf")
        for mkt_key, (mkt_lat, mkt_lon) in MARKET_COORDS.items():
            # Haversine distance
            dlat = math.radians(mkt_lat - user_lat)
            dlon = math.radians(mkt_lon - user_lon)
            a = math.sin(dlat/2)**2 + math.cos(math.radians(user_lat)) * math.cos(math.radians(mkt_lat)) * math.sin(dlon/2)**2
            c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
            dist = 6371 * c  # Earth radius in km
            if dist < min_dist:
                min_dist = dist
                nearest_market = mkt_key
                distance_km = round(dist, 1)

    # --- Build advisory text ---
    advice_lines = []
    if best_market and worst_market:
        advice_lines.append(
            f"🏆 Best market to sell {crop.capitalize()}: {best_market['market']} "
            f"(KES {best_market['retail_per_kg']}/kg retail)"
        )
        advice_lines.append(
            f"🛒 Cheapest source: {cheapest_source['market'] if cheapest_source else 'N/A'} "
            f"(KES {cheapest_source['wholesale_per_kg']}/kg wholesale)" if cheapest_source else ""
        )

    if cv < 15:
        advice_lines.append("📊 Prices are stable across markets — low arbitrage opportunity.")
    elif cv < 30:
        advice_lines.append(
            f"📊 Moderate price variation (CV {cv}%) — consider selling in higher-paying markets."
        )
    else:
        advice_lines.append(
            f"📊 High price disparity (CV {cv}%) — significant arbitrage opportunity! "
            f"Spread: KES {price_spread}/kg between cheapest and most expensive market."
        )

    if nearest_market:
        advice_lines.append(
            f"📍 Nearest major market: {nearest_market.capitalize()} ({distance_km} km away)"
        )

    return {
        "crop": crop.capitalize(),
        "unit": crop_info["unit"],
        "kg_per_unit": kg_per_unit,
        "market_analysis": market_summaries[:15],
        "statistics": {
            "avg_retail_per_kg": avg_retail,
            "avg_wholesale_per_kg": avg_wholesale,
            "price_spread_per_kg": price_spread,
            "min_retail_per_kg": min_retail,
            "max_retail_per_kg": max_retail,
            "volatility_cv_pct": cv,
        },
        "predictions": predictions,
        "recommendation": {
            "best_sell_market": best_market["market"] if best_market else None,
            "best_sell_price": best_market["retail_per_kg"] if best_market else None,
            "cheapest_buy_market": cheapest_source["market"] if cheapest_source else None,
            "cheapest_buy_price": cheapest_source["wholesale_per_kg"] if cheapest_source else None,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

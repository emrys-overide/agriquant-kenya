"""
AgriQuant Kenya – Cloudflare Python Worker
Ports all API endpoints from the FastAPI backend (main.py).
Endpoints:
  GET  /api/weather/<location>
  GET  /api/prices/<crop>
  GET  /api/prices/<crop>/markets
  GET  /api/analysis/<crop>
  POST /api/advice
  POST /api/chat
"""

from js import Response, fetch, Headers, Object
import json
import re
import random
from urllib.parse import urlparse, parse_qs

# ── Configuration ──────────────────────────────────────────────────

WEATHER_API_KEY = "7bb7778e1e2b4ec5a7050654260506"

CROP_MAPPING = {
    "maize":         {"unit": "90kg Bag",        "kamis_id": 1,    "kg_per_unit": 90,  "soko_name": "Dry Maize"},
    "tomatoes":      {"unit": "Crate (~30kg)",   "kamis_id": 61,   "kg_per_unit": 30,  "soko_name": "Tomatoes"},
    "cabbages":      {"unit": "Head (~1.5kg)",   "kamis_id": 58,   "kg_per_unit": 1.5, "soko_name": "Cabbages"},
    "onions":        {"unit": "Kg",               "kamis_id": None, "kg_per_unit": 1,   "soko_name": "Dry Onions"},
    "french_beans":  {"unit": "Kg",               "kamis_id": None, "kg_per_unit": 1,   "soko_name": "French beans"},
    "potatoes":      {"unit": "50kg Bag",         "kamis_id": 57,   "kg_per_unit": 50,  "soko_name": "White Irish Potatoes"},
    "wheat":         {"unit": "90kg Bag",         "kamis_id": 3,    "kg_per_unit": 90,  "soko_name": "Wheat"},
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
]

KAMIS_BASE_URL = "https://kamis.kilimo.go.ke/site/market"

# Reasonable per-Kg price bounds (KES) for each crop.
REASONABLE_PRICE_RANGES = {
    "maize":         {"min": 25,  "max": 100},
    "tomatoes":      {"min": 20,  "max": 200},
    "cabbages":      {"min": 5,   "max": 80},
    "onions":        {"min": 30,  "max": 200},
    "french_beans":  {"min": 30,  "max": 250},
    "potatoes":      {"min": 15,  "max": 120},
    "wheat":         {"min": 25,  "max": 150},
}


def _is_reasonable_price(price_per_kg, crop):
    bounds = REASONABLE_PRICE_RANGES.get(crop, {"min": 1, "max": 500})
    return bounds["min"] <= price_per_kg <= bounds["max"]


def _filter_outliers_iqr(values):
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


def _sanitize_market_entries(entries, crop, kg_per_unit):
    clean = []
    for e in entries:
        ws = e.get("wholesale_per_kg")
        rt = e.get("retail_per_kg")
        ws_ok = ws and _is_reasonable_price(ws, crop)
        rt_ok = rt and _is_reasonable_price(rt, crop)
        if ws_ok or rt_ok:
            clean.append({
                **e,
                "wholesale_per_kg": ws if ws_ok else None,
                "retail_per_kg": rt if rt_ok else None,
            })
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


# ── Helpers ────────────────────────────────────────────────────────

SCRAPE_TIMEOUT_MS = 10000  # 10 second timeout for all scraping requests


async def fetch_with_timeout(url, init_dict=None, timeout_ms=SCRAPE_TIMEOUT_MS):
    """Fetch with an asyncio timeout to prevent hanging requests."""
    import asyncio
    try:
        options = init_dict if init_dict else Object.fromEntries([])
        resp = await asyncio.wait_for(fetch(url, options), timeout=timeout_ms / 1000)
        return resp
    except asyncio.TimeoutError:
        return None
    except Exception:
        return None


def json_response(data, status=200):
    """Build a JSON Response with proper CORS headers."""
    # Create Headers object empty, then set each header individually
    h = Headers.new()
    h.set("Content-Type", "application/json")
    h.set("Access-Control-Allow-Origin", "*")
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    h.set("Access-Control-Allow-Headers", "Content-Type")
    return Response.new(json.dumps(data), status=status, headers=h)


def error_response(detail, status=500):
    return json_response({"detail": detail}, status)


def cors_preflight():
    """Return a 204 response for CORS preflight."""
    h = Headers.new()
    h.set("Access-Control-Allow-Origin", "*")
    h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    h.set("Access-Control-Allow-Headers", "Content-Type")
    return Response.new(None, status=204, headers=h)


# ── KAMIS scraper (pure regex – no external dependencies) ─────────

async def scrape_kamis_prices(kamis_id):
    """
    Fetches live wholesale & retail prices from KAMIS.
    Uses regex on the HTML table rows.
    Returns dict with aggregated stats, or None.
    """
    url = KAMIS_BASE_URL + "?product=" + str(kamis_id)
    ua = random.choice(USER_AGENTS)

    try:
        resp = await fetch_with_timeout(url, Object.fromEntries([
            ["headers", Object.fromEntries([["User-Agent", ua]])],
            ["redirect", "follow"],
        ]))
        if resp is None or resp.status != 200:
            return None
        html = await resp.text()
    except Exception:
        return None

    # Extract <tr>...</tr> blocks
    tr_blocks = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
    if not tr_blocks:
        return None

    wholesale_prices = []
    retail_prices = []
    latest_date = None
    row_count = 0

    for tr in tr_blocks[1:]:          # skip header row
        cols = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.DOTALL)
        if len(cols) < 10:
            continue
        row_count += 1

        def strip(s):
            return re.sub(r"<[^>]+>", "", s).strip()

        wholesale_text = strip(cols[5])
        retail_text    = strip(cols[6])
        date_text      = strip(cols[9])

        if date_text and (latest_date is None or date_text > latest_date):
            latest_date = date_text

        for text, bucket in [(wholesale_text, wholesale_prices), (retail_text, retail_prices)]:
            cleaned = text.replace(",", "")
            m = re.match(r"([\d]+\.?\d*)", cleaned)
            if m:
                price = float(m.group(1))
                if 1 < price < 500000:
                    bucket.append(price)

    if not retail_prices:
        return None

    return {
        "wholesale_values": wholesale_prices,
        "retail_values": retail_prices,
        "latest_date": latest_date,
        "market_count": row_count,
    }


KEY_MARKETS = ["nairobi", "nyeri", "nakuru", "kisumu", "eldoret", "thika", "meru", "kitale"]

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


def _parse_price(text):
    """Parse a KAMIS price string like '46.67/Kg' into a float, or None."""
    cleaned = text.replace(",", "")
    m = re.match(r"([\d]+\.?\d*)", cleaned)
    if m:
        price = float(m.group(1))
        if 1 < price < 500000:
            return price
    return None


async def scrape_kamis_per_market(kamis_id):
    """
    Scrapes KAMIS and returns per-market price breakdown.
    Each entry: {market, county, wholesale, retail, date}
    """
    url = KAMIS_BASE_URL + "?product=" + str(kamis_id)
    ua = random.choice(USER_AGENTS)

    try:
        resp = await fetch_with_timeout(url, Object.fromEntries([
            ["headers", Object.fromEntries([["User-Agent", ua]])],
            ["redirect", "follow"],
        ]))
        if resp is None or resp.status != 200:
            return None
        html = await resp.text()
    except Exception:
        return None

    tr_blocks = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
    if not tr_blocks:
        return None

    def strip(s):
        return re.sub(r"<[^>]+>", "", s).strip()

    # Try to detect market column from header
    market_col = 1
    county_col = 0
    if tr_blocks:
        header_cols = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", tr_blocks[0], re.DOTALL)
        for i, hc in enumerate(header_cols):
            ht = strip(hc).lower()
            if "market" in ht:
                market_col = i
            elif "county" in ht:
                county_col = i

    market_data = []
    for tr in tr_blocks[1:]:
        cols = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.DOTALL)
        if len(cols) < 10:
            continue

        market_name = strip(cols[market_col]) if market_col < len(cols) else ""
        county_name = strip(cols[county_col]) if county_col < len(cols) else ""
        wholesale = _parse_price(strip(cols[5]))
        retail = _parse_price(strip(cols[6]))
        date_text = strip(cols[9]) if len(cols) > 9 else ""

        if retail is not None or wholesale is not None:
            market_data.append({
                "market": market_name,
                "county": county_name,
                "wholesale_per_kg": wholesale,
                "retail_per_kg": retail,
                "date": date_text,
            })

    return market_data if market_data else None


# ── Mkulima Online scraper (soko.mkulimaonline.org) ─────────────

SOKO_API_URL = "https://soko.mkulimaonline.org/api/table-data/"


def _safe_float(val):
    """Convert a value to float safely, returning None on failure."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if 0.1 < f < 500000 else None
    except (ValueError, TypeError):
        return None


# ── Mkulima Bora scraper (portal.mkulimabora.org) ──────────────────
# Mkulima Bora is a digital agriculture marketplace that aggregates
# real-time crop prices from major markets across Kenya.
# Associated with community programmes like Mugambo wa Murimi (Inooro FM/TV).

MKULIMA_BORA_BASE = "https://portal.mkulimabora.org/market-prices"
MKULIMA_BORA_SLUGS = {
    "maize": "dry-maize",
    "tomatoes": "tomatoes",
    "cabbages": "cabbages",
    "onions": "dry-onions",
    "french_beans": "french-beans",
    "potatoes": "red-irish-potato",
    "wheat": "wheat",
}


async def scrape_mkulima_bora(crop_slug):
    """
    Scrape per-market price data from Mkulima Bora (portal.mkulimabora.org).
    Uses regex to parse the HTML table. Returns list of dicts:
    {market, county, wholesale_per_kg, retail_per_kg, date} or None.
    """
    url = MKULIMA_BORA_BASE + "/" + crop_slug
    ua = random.choice(USER_AGENTS)

    try:
        resp = await fetch_with_timeout(url, Object.fromEntries([
            ["headers", Object.fromEntries([["User-Agent", ua]])],
            ["redirect", "follow"],
        ]))
        if resp is None or resp.status != 200:
            return None

        html = await resp.text()

        # Find the table-modern table rows
        rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.DOTALL)
        if not rows:
            return None

        entries = []
        for row_html in rows[1:]:  # skip header row
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row_html, re.DOTALL)
            if len(cells) < 5:
                continue

            # Strip HTML tags to get plain text
            def strip_tags(s):
                return re.sub(r"<[^>]+>", "", s).strip()

            market = strip_tags(cells[0])
            county = strip_tags(cells[1]) if len(cells) > 1 else ""

            # Parse prices from price-pill spans or cell text
            def parse_price_html(cell_html):
                # Try to find price inside span.price-pill first
                pill_match = re.search(r"class=[\"'][^\"']*price-pill[^\"']*[\"'][^>]*>(.*?)</span>", cell_html, re.DOTALL)
                text = pill_match.group(1) if pill_match else cell_html
                text = strip_tags(text)
                cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
                if not cleaned:
                    return None
                try:
                    val = float(cleaned)
                    return val if 0.1 < val < 500000 else None
                except ValueError:
                    return None

            ws = parse_price_html(cells[2]) if len(cells) > 2 else None
            rt = parse_price_html(cells[3]) if len(cells) > 3 else None
            date_str = strip_tags(cells[5]) if len(cells) > 5 else ""

            if not market or (ws is None and rt is None):
                continue

            entries.append({
                "market": market,
                "county": county if county != "\u2014" else "",
                "wholesale_per_kg": ws,
                "retail_per_kg": rt,
                "date": date_str,
            })

        return entries if entries else None

    except Exception as e:
        return None


async def scrape_mkulima_online(soko_name):
    """
    Fetches per-market price data from Mkulima Online for a given commodity.
    Returns a list of dicts: {market, county, wholesale_per_kg, retail_per_kg, date}
    or None if the request fails / no data available.
    """
    from urllib.parse import quote
    url = SOKO_API_URL + "?commodity=" + quote(soko_name)
    ua = random.choice(USER_AGENTS)

    try:
        resp = await fetch_with_timeout(url, Object.fromEntries([
            ["headers", Object.fromEntries([["User-Agent", ua], ["Accept", "application/json"]])],
            ["redirect", "follow"],
        ]))
        if resp is None or resp.status != 200:
            return None
        data = json.loads(await resp.text())
    except Exception:
        return None

    if not isinstance(data, dict):
        return None

    buy_entries = data.get("buy", [])
    sell_entries = data.get("sell", [])

    market_map = {}

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
            "market": mkt, "county": county,
            "wholesale_per_kg": None, "retail_per_kg": None, "date": date_str,
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
                "market": mkt, "county": county,
                "wholesale_per_kg": None, "retail_per_kg": None, "date": date_str,
            }
        if rt and not market_map[key]["retail_per_kg"]:
            market_map[key]["retail_per_kg"] = rt
        if ws and not market_map[key]["wholesale_per_kg"]:
            market_map[key]["wholesale_per_kg"] = ws
        if date_str and not market_map[key]["date"]:
            market_map[key]["date"] = date_str

    result = [v for v in market_map.values() if v["wholesale_per_kg"] or v["retail_per_kg"]]
    return result if result else None


# ── Request router ─────────────────────────────────────────────────

async def on_fetch(request, env):
    parsed = urlparse(request.url)
    path = parsed.path.rstrip("/")
    query = parse_qs(parsed.query)

    # Handle CORS preflight
    if request.method == "OPTIONS":
        return cors_preflight()

    # ── Root redirect ─────────────────────────────────────────────────
    if path == "" or path == "/":
        h = Headers.new()
        h.set("Location", "https://agriquant-kenya.pages.dev")
        return Response.new(None, status=302, headers=h)

    # ── API info ──────────────────────────────────────────────────────
    if path == "/api" and request.method == "GET":
        return json_response({
            "service": "AgriQuant Kenya API",
            "version": "1.1",
            "endpoints": {
                "weather": "GET /api/weather/<location>",
                "prices": "GET /api/prices/<crop>",
                "markets": "GET /api/prices/<crop>/markets",
                "analysis": "GET /api/analysis/<crop>",
                "advice": "POST /api/advice",
                "chat": "POST /api/chat",
            },
            "data_sources": [
                "KAMIS (kamis.kilimo.go.ke) — Kenya Agricultural Market Information System",
                "Mkulima Online (soko.mkulimaonline.org) — Farmer marketplace JSON API",
                "Mkulima Bora (portal.mkulimabora.org) — Digital agriculture marketplace with daily market prices",
            ],
            "frontend": "https://agriquant-kenya.pages.dev",
        })

    # ── GET /api/weather/<location> ────────────────────────────────
    m = re.match(r"^/api/weather/(.+)$", path)
    if m and request.method == "GET":
        location = m.group(1)
        if not location:
            return error_response("Location is required.", 400)

        wapi_key = WEATHER_API_KEY
        try:
            wapi_key = env.WEATHER_API_KEY or wapi_key
        except Exception:
            pass

        api_url = (
            "http://api.weatherapi.com/v1/forecast.json"
            "?key=" + wapi_key + "&q=" + location + ",+Kenya&days=14&aqi=no&alerts=yes"
        )

        try:
            resp = await fetch(api_url)
            if resp.status != 200:
                return error_response("Location '" + location + "' not found in Kenya.", 404)
            data = json.loads(await resp.text())
        except Exception as e:
            return error_response("Weather API error: " + str(e), 500)

        current  = data["current"]
        forecast = data["forecast"]["forecastday"]

        risk_alerts = []
        for day in forecast:
            min_t = day["day"]["mintemp_c"]
            max_t = day["day"]["maxtemp_c"]
            rain  = day["day"]["daily_chance_of_rain"]
            date_s = day["date"]
            if min_t < 5:
                risk_alerts.append("Frost risk on " + date_s + ". Cover sensitive crops.")
            if rain > 75:
                risk_alerts.append("Heavy rain expected on " + date_s + ". Delay fertilizer application.")
            if max_t > 32 and rain < 20:
                risk_alerts.append("Heat stress on " + date_s + ". Increase irrigation.")

        return json_response({
            "location": data["location"]["name"],
            "current_temp": current["temp_c"],
            "condition": current["condition"]["text"],
            "humidity": current["humidity"],
            "wind_kph": current["wind_kph"],
            "soil_moisture_estimate": min(100, current["humidity"] * 0.65),
            "forecast": [
                {
                    "date": d["date"],
                    "max": d["day"]["maxtemp_c"],
                    "min": d["day"]["mintemp_c"],
                    "rain_mm": d["day"]["totalprecip_mm"],
                    "rain_chance": d["day"]["daily_chance_of_rain"],
                }
                for d in forecast
            ],
            "agri_risk_alerts": risk_alerts,
        })

    # ── GET /api/prices/<crop>/markets (Multi-Source) ──────────────
    m = re.match(r"^/api/prices/(.+)/markets$", path)
    if m and request.method == "GET":
        crop = m.group(1).lower()
        if crop not in CROP_MAPPING:
            return error_response("Crop not supported.", 400)

        crop_info = CROP_MAPPING[crop]
        kamis_id = crop_info["kamis_id"]
        soko_name = crop_info.get("soko_name", "")
        kg_per_unit = crop_info["kg_per_unit"]

        baselines_per_kg = {
            "maize": {"nairobi": 55, "nyeri": 48, "nakuru": 50, "kisumu": 52, "eldoret": 45, "thika": 53, "meru": 47, "kitale": 44},
            "tomatoes": {"nairobi": 110, "nyeri": 95, "nakuru": 100, "kisumu": 105, "eldoret": 90, "thika": 108, "meru": 92, "kitale": 88},
            "cabbages": {"nairobi": 30, "nyeri": 25, "nakuru": 27, "kisumu": 28, "eldoret": 24, "thika": 29, "meru": 25, "kitale": 23},
            "onions": {"nairobi": 90, "nyeri": 75, "nakuru": 80, "kisumu": 85, "eldoret": 72, "thika": 88, "meru": 74, "kitale": 70},
            "french_beans": {"nairobi": 130, "nyeri": 115, "nakuru": 120, "kisumu": 125, "eldoret": 110, "thika": 128, "meru": 112, "kitale": 108},
            "potatoes": {"nairobi": 80, "nyeri": 65, "nakuru": 70, "kisumu": 75, "eldoret": 60, "thika": 78, "meru": 63, "kitale": 58},
            "wheat": {"nairobi": 110, "nyeri": 95, "nakuru": 100, "kisumu": 105, "eldoret": 90, "thika": 108, "meru": 93, "kitale": 88},
        }

        # Fetch from all three sources concurrently
        import asyncio

        bora_slug = MKULIMA_BORA_SLUGS.get(crop)

        async def _fetch_kamis():
            if kamis_id is not None:
                return await scrape_kamis_per_market(kamis_id)
            return None

        async def _fetch_soko():
            if soko_name:
                return await scrape_mkulima_online(soko_name)
            return None

        async def _fetch_bora():
            if bora_slug:
                return await scrape_mkulima_bora(bora_slug)
            return None

        kamis_raw, soko_raw, bora_raw = await asyncio.gather(
            _fetch_kamis(), _fetch_soko(), _fetch_bora()
        )

        sources_used = []
        all_entries = {}

        def merge_entries(entries, source_tag):
            for e in entries:
                name = e["market"].strip()
                if not name:
                    continue
                key = name.lower()
                all_entries.setdefault(key, [])
                all_entries[key].append({**e, "_source": source_tag})

        if kamis_raw:
            merge_entries(kamis_raw, "KAMIS")
            sources_used.append("KAMIS")
        if soko_raw:
            merge_entries(soko_raw, "Mkulima Online")
            sources_used.append("Mkulima Online")
        if bora_raw:
            merge_entries(bora_raw, "Mkulima Bora")
            sources_used.append("Mkulima Bora")

        # --- Sanitize: filter out unreasonable prices & outliers ---
        for key in list(all_entries.keys()):
            all_entries[key] = _sanitize_market_entries(all_entries[key], crop, kg_per_unit)
            if not all_entries[key]:
                del all_entries[key]

        market_data = []
        data_source = "live" if sources_used else "none"

        def _med(vals):
            if not vals:
                return None
            s = sorted(vals)
            return s[len(s) // 2]

        for mkt_key, entries in all_entries.items():
            ws_vals = [e["wholesale_per_kg"] for e in entries if e.get("wholesale_per_kg")]
            rt_vals = [e["retail_per_kg"] for e in entries if e.get("retail_per_kg")]

            ws = _med(ws_vals)
            rt = _med(rt_vals)
            latest = ""
            for e in entries:
                if e.get("date") and e["date"] > latest:
                    latest = e["date"]
            county = entries[0].get("county", "")
            entry_sources = list(set(e["_source"] for e in entries))

            market_data.append({
                "market": entries[0]["market"],
                "county": county,
                "wholesale_price": round(ws * kg_per_unit, 2) if ws else None,
                "retail_price": round(rt * kg_per_unit, 2) if rt else None,
                "date": latest,
                "is_key_market": mkt_key in KEY_MARKETS,
                "sources": entry_sources,
            })

        if not market_data:
            data_source = "baseline"
            sources_used = ["baseline"]
            crop_baselines = baselines_per_kg.get(crop, {})
            for mkt_name, base_price in crop_baselines.items():
                market_data.append({
                    "market": mkt_name.capitalize(),
                    "county": mkt_name.capitalize(),
                    "wholesale_price": round(base_price * kg_per_unit, 2),
                    "retail_price": round(base_price * 1.35 * kg_per_unit, 2),
                    "date": "estimated",
                    "is_key_market": mkt_name.lower() in KEY_MARKETS,
                    "sources": ["baseline"],
                })

        market_data.sort(key=lambda x: (not x["is_key_market"], -(x["retail_price"] or 0)))

        source_label = " + ".join(sources_used) if sources_used else "none"
        if data_source == "live":
            status_text = "Live from " + source_label + " (" + str(len(market_data)) + " markets)"
        elif data_source == "baseline":
            status_text = "Estimated baseline prices"
        else:
            status_text = "No data available"

        return json_response({
            "crop": crop.capitalize(),
            "unit": crop_info["unit"],
            "kg_per_unit": kg_per_unit,
            "markets": market_data,
            "data_source": data_source,
            "data_sources": sources_used,
            "data_status": status_text,
        })

    # ── GET /api/analysis/<crop> (Multi-Source) ────────────────────
    m = re.match(r"^/api/analysis/(.+)$", path)
    if m and request.method == "GET":
        import math
        import asyncio as aio

        crop = m.group(1).lower()
        if crop not in CROP_MAPPING:
            return error_response("Crop not supported.", 400)

        crop_info = CROP_MAPPING[crop]
        kamis_id = crop_info["kamis_id"]
        soko_name = crop_info.get("soko_name", "")
        kg_per_unit = crop_info["kg_per_unit"]
        unit_name = crop_info["unit"]

        user_lat = float(query.get("user_lat", [None])[0]) if query.get("user_lat") else None
        user_lon = float(query.get("user_lon", [None])[0]) if query.get("user_lon") else None

        bora_slug = MKULIMA_BORA_SLUGS.get(crop)

        async def _fetch_kamis_a():
            if kamis_id is not None:
                return await scrape_kamis_per_market(kamis_id)
            return None

        async def _fetch_soko_a():
            if soko_name:
                return await scrape_mkulima_online(soko_name)
            return None

        async def _fetch_bora_a():
            if bora_slug:
                return await scrape_mkulima_bora(bora_slug)
            return None

        kamis_raw, soko_raw, bora_raw = await aio.gather(
            _fetch_kamis_a(), _fetch_soko_a(), _fetch_bora_a()
        )

        sources_used = []
        raw_markets = []

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

        # --- Sanitize live data ---
        if raw_markets and data_source == "live":
            raw_markets = _sanitize_market_entries(raw_markets, crop, kg_per_unit)

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

        grouped = {}
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

            def _med3(v):
                vs = sorted(v)
                return vs[len(vs) // 2] if vs else 0

            ws_med = round(_med3(ws_vals), 2) if ws_vals else 0
            rt_med = round(_med3(rt_vals), 2) if rt_vals else round(ws_med * 1.3, 2)
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

        n_rt = len(all_retail)
        avg_retail = round(sum(all_retail) / n_rt, 2) if n_rt else 0
        avg_wholesale = round(sum(all_wholesale) / len(all_wholesale), 2) if all_wholesale else 0

        if n_rt > 1:
            variance = sum((x - avg_retail) ** 2 for x in all_retail) / (n_rt - 1)
            std_retail = round(variance ** 0.5, 2)
        else:
            std_retail = 0

        min_retail = round(min(all_retail), 2) if all_retail else 0
        max_retail = round(max(all_retail), 2) if all_retail else 0
        price_spread = round(max_retail - min_retail, 2)
        cv = round((std_retail / avg_retail) * 100, 1) if avg_retail else 0

        market_summaries.sort(key=lambda x: x["retail_price"], reverse=True)
        best_market = market_summaries[0] if market_summaries else None
        worst_market = market_summaries[-1] if market_summaries else None
        by_ws = sorted(market_summaries, key=lambda x: x["wholesale_price"])
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

        nearest_market = None
        distance_km = None
        if user_lat is not None and user_lon is not None:
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
                "🏆 Best market to sell " + crop.capitalize() + ": " + best_market["market"] +
                " (KES " + str(best_market["retail_price"]) + "/" + unit_name + " retail)"
            )
            advice_lines.append(
                "🛒 Cheapest source: " + cheapest_source["market"] +
                " (KES " + str(cheapest_source["wholesale_price"]) + "/" + unit_name + " wholesale)"
            )

        if cv < 15:
            advice_lines.append("📊 Prices are stable across markets — low arbitrage opportunity.")
        elif cv < 30:
            advice_lines.append("📊 Moderate price variation (CV " + str(cv) + "%) — consider selling in higher-paying markets.")
        else:
            advice_lines.append(
                "📊 High price disparity (CV " + str(cv) + "%) — significant arbitrage opportunity! " +
                "Spread: KES " + str(price_spread) + "/" + unit_name + " between cheapest and most expensive market."
            )

        if nearest_market:
            advice_lines.append(
                "📍 Nearest major market: " + nearest_market.capitalize() + " (" + str(distance_km) + " km away)"
            )

        if sources_used:
            advice_lines.append("📡 Data sources: " + ", ".join(sources_used))

        return json_response({
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
        })

    # ── GET /api/prices/<crop> ─────────────────────────────────────
    m = re.match(r"^/api/prices/(.+)$", path)
    if m and request.method == "GET":
        crop = m.group(1).lower()
        if crop not in CROP_MAPPING:
            return error_response("Crop not supported.", 400)

        crop_info   = CROP_MAPPING[crop]
        kamis_id    = crop_info["kamis_id"]
        kg_per_unit = crop_info["kg_per_unit"]

        kamis_data = None
        if kamis_id is not None:
            kamis_data = await scrape_kamis_prices(kamis_id)

        if kamis_data and kamis_data["retail_values"]:
            wv = sorted(kamis_data["wholesale_values"])
            rv = sorted(kamis_data["retail_values"])

            def median(v):
                n = len(v)
                return v[n // 2] if n else 0

            wholesale_per_kg = median(wv) if wv else median(rv) * 0.85
            retail_per_kg    = median(rv)

            if len(wv) >= 3:
                p25 = wv[len(wv) // 4]
            elif wv:
                p25 = wv[0]
            else:
                p25 = wholesale_per_kg * 0.85
            farm_gate_per_kg = p25 * 0.80

            farm_price      = round(farm_gate_per_kg * kg_per_unit, 2)
            wholesale_price = round(wholesale_per_kg * kg_per_unit, 2)
            retail_price    = round(retail_per_kg * kg_per_unit, 2)

            sc = kamis_data["market_count"]
            dd = kamis_data["latest_date"] or "today"
            data_status = "Live from KAMIS (" + str(sc) + " markets, " + dd + ")"
        else:
            # --- Secondary source: Mkulima Bora ---
            bora_slug = MKULIMA_BORA_SLUGS.get(crop)
            bora_entries = await scrape_mkulima_bora(bora_slug) if bora_slug else None

            if bora_entries and len(bora_entries) >= 2:
                ws_vals = sorted([e["wholesale_per_kg"] for e in bora_entries if e.get("wholesale_per_kg")])
                rt_vals = sorted([e["retail_per_kg"] for e in bora_entries if e.get("retail_per_kg")])

                def _med(vals):
                    if not vals:
                        return None
                    return vals[len(vals) // 2]

                wholesale_per_kg = _med(ws_vals) if ws_vals else (_med(rt_vals) or 0) * 0.85
                retail_per_kg = _med(rt_vals) or wholesale_per_kg * 1.35

                if len(ws_vals) >= 3:
                    p25 = ws_vals[len(ws_vals) // 4]
                elif ws_vals:
                    p25 = ws_vals[0]
                else:
                    p25 = wholesale_per_kg * 0.85
                farm_gate_per_kg = p25 * 0.80

                farm_price      = round(farm_gate_per_kg * kg_per_unit, 2)
                wholesale_price = round(wholesale_per_kg * kg_per_unit, 2)
                retail_price    = round(retail_per_kg * kg_per_unit, 2)

                latest_date = max((e.get("date", "") for e in bora_entries if e.get("date")), default="recent")
                data_status = "Live from Mkulima Bora (" + str(len(bora_entries)) + " markets, " + latest_date + ")"
            else:
                # Last resort: hardcoded baselines
                baselines = {
                    "maize": 50, "tomatoes": 100, "cabbages": 27,
                    "onions": 80, "french_beans": 120, "potatoes": 70, "wheat": 100,
                }
                base = baselines.get(crop, 50)
                fg_pk  = base * 0.85
                ws_pk  = base
                rt_pk  = base * 1.50
                farm_price      = round(fg_pk * kg_per_unit, 2)
                wholesale_price = round(ws_pk * kg_per_unit, 2)
                retail_price    = round(rt_pk * kg_per_unit, 2)
                data_status     = "Estimated baseline (KAMIS & Mkulima Bora unavailable)"

        margin = (
            round(((retail_price - farm_price) / farm_price) * 100, 2)
            if farm_price else 0
        )

        return json_response({
            "crop": crop.capitalize(),
            "unit": crop_info["unit"],
            "farm_gate_price_ksh": farm_price,
            "wholesale_price_ksh": wholesale_price,
            "retail_price_ksh": retail_price,
            "profit_margin_estimate": margin,
            "data_status": data_status,
        })

    # ── POST /api/advice ───────────────────────────────────────────
    if path == "/api/advice" and request.method == "POST":
        try:
            body = json.loads(await request.text())
        except Exception:
            return error_response("Invalid JSON body.", 400)

        weather  = body.get("weather", {})
        prices   = body.get("prices", {})
        lang     = body.get("lang", "en")
        crop     = prices.get("crop", "Your crop")
        location = weather.get("location", "your area")

        alerts       = weather.get("agri_risk_alerts", [])
        current_temp = weather.get("current_temp", 25)
        margin       = prices.get("profit_margin_estimate", 0)
        data_status  = prices.get("data_status", "Unknown")

        is_laikipia = any(
            kw in location.lower()
            for kw in ("laikipia", "nanyuki", "rumuruti", "nyahururu", "dol dol")
        )

        if lang == "sw":
            parts = []
            header = "**Habari mkulima wa " + location + "!** Karibu kwenye taarifa yako ya leo.\n\n"

            if alerts:
                parts.append("**Kuhusu hali ya hewa:**")
                for a in alerts[:3]:
                    parts.append("  - " + str(a))
                parts.append("")

            if current_temp > 28:
                parts.append(
                    "Joto ni kali sana leo \u2014 " + str(current_temp) + "\u00b0C. "
                    "Mwagilia maji asubuhi na mapema (kabla ya saa mbili) au jioni ili kuokoa maji. "
                    "Pia funika mimea yako kwa mulch ili kudumisha unyevu wa udongo."
                )
            elif current_temp < 12:
                parts.append(
                    "Baridi kali sana \u2014 " + str(current_temp) + "\u00b0C. "
                    "Hakikisha umefunika mimea yako hasa mahindi na maharagwe. "
                    "Angalia magonjwa ya fangasi kama blight ambayo hujitokeza katika hali ya baridi na unyevunyevu."
                )
            else:
                parts.append(
                    "Hali ya hewa ni nzuri leo \u2014 " + str(current_temp) + "\u00b0C. "
                    "Endelea na shughuli zako za kilimo kama kawaida."
                )

            parts.append("")
            if margin < 20:
                parts.append(
                    "**Kuhusu soko:** Bei ya " + crop + " haifai sana kwa sasa. "
                    "Mapato ni " + str(margin) + "% tu kutoka shambani hadi sokoni. "
                    "Fikiria kuungana na wakulima wengine kwenye kikundi ili muuze pamoja "
                    "na kupata bei bora. Pia jaribu kuongeza thamani \u2014 kwa mfano, "
                    "kausha au saga bidhaa yako kabla ya kuuza."
                )
            elif margin > 40:
                parts.append(
                    "**Kuhusu soko:** Bei ya " + crop + " soko ni nzuri sana sasa hivi! "
                    "Faida ni " + str(margin) + "% kutoka shambani hadi sokoni. "
                    "Ni wakati mwafaka wa kuvuna na kupeleka sokoni. "
                    "Hakikisha usafiri wako ni wa haraka ili bidhaa isiharibike njiani."
                )
            else:
                parts.append(
                    "**Kuhusu soko:** Bei ya " + crop + " ni ya kawaida \u2014 faida ni " + str(margin) + "%. "
                    "Endelea kufuatilia soko kila siku. Bei zinaweza kupanda wiki zijazo."
                )

            if is_laikipia:
                parts.append("")
                parts.append(
                    "Eneo lako la " + location + " lina hali ya hewa ya kipekee. "
                    "Udongo wa volkeno unaweza kuwa na asidi \u2014 pima pH mara kwa mara. "
                    "Ukipanda ngano au waru, hakikisha kuna mifereji ya maji ya kutosha "
                    "ili kuzuia mafuriko wakati wa mvua kubwa."
                )

            parts.append("")
            parts.append(
                "*Kumbuka: data hii inatoka KAMIS (serikali) na hali ya hewa ya leo. "
                "Kila la heri mkulima!*\n"
                "*Hali ya data: " + data_status + "*"
            )
            summary = header + "\n".join(parts)

        else:  # English
            parts = []
            header = "**Hello, farmer from " + location + "!** Welcome to your daily briefing.\n\n"

            if alerts:
                parts.append("**Weather Alerts:**")
                for a in alerts[:3]:
                    parts.append("  - " + str(a))
                parts.append("")

            if current_temp > 28:
                parts.append(
                    "It is hot today \u2014 " + str(current_temp) + "\u00b0C. "
                    "Irrigate early in the morning (before 8 AM) or in the evening to save water. "
                    "Consider mulching your crops to retain soil moisture."
                )
            elif current_temp < 12:
                parts.append(
                    "It is very cold today \u2014 " + str(current_temp) + "\u00b0C. "
                    "Cover your crops, especially maize and beans. "
                    "Watch out for fungal diseases like blight that thrive in cold, damp conditions."
                )
            else:
                parts.append(
                    "Weather is pleasant today \u2014 " + str(current_temp) + "\u00b0C. "
                    "Carry on with your normal farming activities."
                )

            parts.append("")
            if margin < 20:
                parts.append(
                    "**Market Update:** The profit margin for " + crop + " is low at " + str(margin) + "%. "
                    "Middlemen are capturing most of the value. "
                    "Consider forming a cooperative to sell directly to wholesalers. "
                    "You could also add value \u2014 for example, dry or mill your produce before selling."
                )
            elif margin > 40:
                parts.append(
                    "**Market Update:** Excellent margins for " + crop + " at " + str(margin) + "%! "
                    "The market is paying well right now. "
                    "Harvest and transport to market as soon as possible. "
                    "Make sure your transport is quick so produce stays fresh."
                )
            else:
                parts.append(
                    "**Market Update:** Margins for " + crop + " are moderate at " + str(margin) + "%. "
                    "Keep watching the market daily \u2014 prices may rise in the coming weeks."
                )

            if is_laikipia:
                parts.append("")
                parts.append(
                    "Your area around " + location + " has unique micro-climates. "
                    "Volcanic soils can become acidic \u2014 test your soil pH regularly. "
                    "If growing wheat or potatoes, ensure proper drainage to prevent "
                    "waterlogging during heavy rains."
                )

            parts.append("")
            parts.append(
                "*Remember: this data comes from KAMIS (government) and today's weather readings. "
                "Happy farming!*\n"
                "*Data status: " + data_status + "*"
            )
            summary = header + "\n".join(parts)

        return json_response({"advisory_report": summary})

    # ── POST /api/chat (Gemini) ────────────────────────────────────
    if path == "/api/chat" and request.method == "POST":
        try:
            body = json.loads(await request.text())
        except Exception:
            return error_response("Invalid JSON body.", 400)

        gemini_key = ""
        try:
            gemini_key = env.GEMINI_API_KEY or ""
        except Exception:
            pass

        if not gemini_key:
            return error_response(
                "Gemini API key is not configured. Set the GEMINI_API_KEY secret to enable the chatbot.",
                503,
            )

        messages = body.get("messages", [])
        context  = body.get("context", {})
        lang     = body.get("lang", "en")

        location     = context.get("location", "Kenya")
        cur_temp     = context.get("current_temp", "N/A")
        condition    = context.get("condition", "N/A")
        crop_name    = context.get("crop", "maize")
        fgp          = context.get("farm_gate_price_ksh", "N/A")
        rp           = context.get("retail_price_ksh", "N/A")
        mgn          = context.get("profit_margin_estimate", "N/A")
        risk_alerts  = context.get("agri_risk_alerts", [])

        if lang == "sw":
            sys_prompt = (
                "Wewe ni mtaalamu wa kilimo nchini Kenya, unaitwa 'Mkulima Bora'. "
                "Unazungumza Kiswahili cha Kenya (si cha kitabu). "
                "Unajua sana kuhusu: hali ya hewa, bei za soko (KAMIS), ushauri wa mimea, "
                "na kilimo cha eneo la Laikipia na Kenya nzima. "
                "Jibu maswali kwa urahisi na kwa maneno mafupi.\n\n"
                "Hali ya sasa ya mkulima:\n"
                "- Eneo: " + str(location) + "\n"
                "- Joto: " + str(cur_temp) + "\u00b0C, Hali: " + str(condition) + "\n"
                "- Mimea: " + str(crop_name) + "\n"
                "- Bei shambani: KSh " + str(fgp) + " | Bei ya rejareja: KSh " + str(rp) + " | Faida: " + str(mgn) + "%\n"
            )
            if risk_alerts:
                sys_prompt += "- Tahadhari: " + "; ".join(risk_alerts[:3]) + "\n"
        else:
            sys_prompt = (
                "You are a Kenyan farming expert AI assistant called 'Mkulima Bora'. "
                "You speak clear, practical English that a Kenyan farmer can easily understand. "
                "Give short, actionable advice.\n\n"
                "Current context:\n"
                "- Location: " + str(location) + "\n"
                "- Temperature: " + str(cur_temp) + "\u00b0C, Condition: " + str(condition) + "\n"
                "- Crop: " + str(crop_name) + "\n"
                "- Farm gate: KSh " + str(fgp) + " | Retail: KSh " + str(rp) + " | Margin: " + str(mgn) + "%\n"
            )
            if risk_alerts:
                sys_prompt += "- Alerts: " + "; ".join(risk_alerts[:3]) + "\n"

        contents = [
            {"role": "user", "parts": [{"text": sys_prompt}]},
            {"role": "model", "parts": [{"text": "Understood. I am ready to help the farmer."}]},
        ]
        for msg in messages:
            role = "user" if msg.get("role", "user") == "user" else "model"
            contents.append({"role": role, "parts": [{"text": msg.get("content", "")}]})

        gemini_url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            "gemini-2.0-flash:generateContent?key=" + gemini_key
        )
        gemini_body = json.dumps({
            "contents": contents,
            "generationConfig": {"temperature": 0.7, "maxOutputTokens": 1024},
        })

        try:
            resp = await fetch(gemini_url, Object.fromEntries([
                ["method", "POST"],
                ["headers", Object.fromEntries([["Content-Type", "application/json"]])],
                ["body", gemini_body],
            ]))
            if resp.status != 200:
                err_text = await resp.text()
                return error_response("Gemini API error: " + err_text, 502)
            result = json.loads(await resp.text())
        except Exception as e:
            return error_response("Failed to reach Gemini API: " + str(e), 500)

        try:
            reply_text = result["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError, TypeError):
            reply_text = "Sorry, I could not generate a response at this time. Please try again."

        return json_response({"reply": reply_text})

    # ── Fallback ───────────────────────────────────────────────────
    return error_response(
        "Not found. Available: /api/weather/<loc>, /api/prices/<crop>, /api/prices/<crop>/markets, /api/analysis/<crop>, POST /api/advice, POST /api/chat",
        404,
    )

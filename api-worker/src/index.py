"""
AgriQuant Kenya – Cloudflare Python Worker
Ports all API endpoints from the FastAPI backend (main.py).
Endpoints:
  GET  /api/weather/<location>
  GET  /api/prices/<crop>
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
    "maize":         {"unit": "90kg Bag",        "kamis_id": 1,    "kg_per_unit": 90},
    "tomatoes":      {"unit": "Crate (~30kg)",   "kamis_id": 61,   "kg_per_unit": 30},
    "cabbages":      {"unit": "Head (~1.5kg)",   "kamis_id": 58,   "kg_per_unit": 1.5},
    "onions":        {"unit": "Kg",               "kamis_id": None, "kg_per_unit": 1},
    "french_beans":  {"unit": "Kg",               "kamis_id": None, "kg_per_unit": 1},
    "potatoes":      {"unit": "50kg Bag",         "kamis_id": 57,   "kg_per_unit": 50},
    "wheat":         {"unit": "90kg Bag",         "kamis_id": 3,    "kg_per_unit": 90},
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
]

KAMIS_BASE_URL = "https://kamis.kilimo.go.ke/site/market"


# ── Helpers ────────────────────────────────────────────────────────

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
        resp = await fetch(url, Object.fromEntries([
            ["headers", Object.fromEntries([["User-Agent", ua]])],
            ["redirect", "follow"],
        ]))
        if resp.status != 200:
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


# ── Request router ─────────────────────────────────────────────────

async def on_fetch(request, env):
    parsed = urlparse(request.url)
    path = parsed.path.rstrip("/")
    query = parse_qs(parsed.query)

    # Handle CORS preflight
    if request.method == "OPTIONS":
        return cors_preflight()

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
            data_status     = "Estimated baseline (KAMIS data unavailable for this crop)"

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
        "Not found. Available: /api/weather/<loc>, /api/prices/<crop>, POST /api/advice, POST /api/chat",
        404,
    )

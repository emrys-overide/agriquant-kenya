import httpx
import logging
import json
from datetime import datetime
from typing import Optional, Dict, Any
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.models.schemas import WeatherSnapshot
from backend.app.core.config import settings

logger = logging.getLogger(__name__)

async def get_or_fetch_weather(location: str, session: AsyncSession) -> Dict[str, Any]:
    # Check cache in DB (valid for 3 hours)
    stmt = select(WeatherSnapshot).where(WeatherSnapshot.location == location.title())
    res = await session.execute(stmt)
    cached = res.scalars().first()
    
    now = datetime.utcnow()
    if cached and cached.forecast_json and (now - cached.updated_at).total_seconds() < 10800:
        return {
            "location": cached.location,
            "current_temp": cached.current_temp,
            "condition": cached.condition,
            "humidity": cached.humidity,
            "wind_kph": cached.wind_kph,
            "soil_moisture_estimate": cached.soil_moisture_estimate,
            "soil_moisture_volumetric_m3": cached.soil_moisture_volumetric_m3,
            "soil_temperature_c": cached.soil_temperature_c,
            "soil_moisture_status": cached.soil_moisture_status,
            "forecast": json.loads(cached.forecast_json),
            "agri_risk_alerts": json.loads(cached.risk_alerts_json or "[]"),
        }

    # Fetch live from WeatherAPI + Open-Meteo
    wapi_key = settings.WEATHER_API_KEY
    if not wapi_key:
        raise ValueError("Weather service is not configured (WEATHER_API_KEY missing).")

    api_url = f"https://api.weatherapi.com/v1/forecast.json?key={wapi_key}&q={location}, Kenya&days=14&aqi=no&alerts=yes"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(api_url)
        if resp.status_code != 200:
            raise LookupError(f"Location '{location}' not found.")
        data = resp.json()

    current = data["current"]
    forecast = data["forecast"]["forecastday"]
    loc_data = data.get("location", {})
    lat = loc_data.get("lat")
    lon = loc_data.get("lon")

    soil_volumetric = None
    soil_temp_c = None
    soil_status = "Optimal"
    soil_pct = None

    if lat is not None and lon is not None:
        try:
            om_url = f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}&current=soil_temperature_0cm,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm&timezone=Africa/Nairobi"
            async with httpx.AsyncClient(timeout=6.0) as client:
                om_resp = await client.get(om_url)
                if om_resp.status_code == 200:
                    om_curr = om_resp.json().get("current", {})
                    sm1 = om_curr.get("soil_moisture_0_to_1cm")
                    sm2 = om_curr.get("soil_moisture_1_to_3cm")
                    soil_temp_c = om_curr.get("soil_temperature_0cm")
                    sm_val = sm1 if sm1 is not None else sm2
                    if sm_val is not None:
                        soil_volumetric = round(sm_val, 3)
                        soil_pct = round(min(100.0, max(0.0, (sm_val / 0.35) * 100)), 1)
                        if sm_val < 0.12:
                            soil_status = "Dry (Irrigation Needed)"
                        elif sm_val > 0.32:
                            soil_status = "Saturated / Waterlogged"
                        else:
                            soil_status = "Optimal Field Capacity"
        except Exception as e:
            logger.warning(f"Open-Meteo telemetry fetch failed: {e}")

    if soil_pct is None:
        soil_pct = round(min(100.0, max(10.0, current["humidity"] * 0.45)), 1)
        soil_status = "Estimated (Telemetry pending)"

    risk_alerts = []
    if soil_volumetric is not None:
        if soil_volumetric < 0.12:
            risk_alerts.append("Low topsoil moisture. Deep morning irrigation recommended.")
        elif soil_volumetric > 0.35:
            risk_alerts.append("Topsoil saturated. Ensure adequate field furrow drainage.")

    for day in forecast:
        min_t = day["day"]["mintemp_c"]
        max_t = day["day"]["maxtemp_c"]
        rain = day["day"]["daily_chance_of_rain"]
        date_s = day["date"]
        if min_t < 5:
            risk_alerts.append(f"Frost risk on {date_s}. Cover sensitive crops.")
        if rain > 75:
            risk_alerts.append(f"Heavy rain expected on {date_s}. Delay fertilizer application.")
        if max_t > 32 and rain < 20:
            risk_alerts.append(f"Heat stress on {date_s}. Increase irrigation.")

    forecast_clean = [
        {
            "date": d["date"],
            "max": d["day"]["maxtemp_c"],
            "min": d["day"]["mintemp_c"],
            "rain_mm": d["day"]["totalprecip_mm"],
            "rain_chance": d["day"]["daily_chance_of_rain"],
        }
        for d in forecast
    ]

    # Save to database
    if not cached:
        cached = WeatherSnapshot(location=loc_data.get("name", location).title())
        session.add(cached)
    cached.current_temp = current["temp_c"]
    cached.condition = current["condition"]["text"]
    cached.humidity = current["humidity"]
    cached.wind_kph = current["wind_kph"]
    cached.soil_moisture_estimate = soil_pct
    cached.soil_moisture_volumetric_m3 = soil_volumetric
    cached.soil_temperature_c = soil_temp_c
    cached.soil_moisture_status = soil_status
    cached.forecast_json = json.dumps(forecast_clean)
    cached.risk_alerts_json = json.dumps(risk_alerts)
    cached.updated_at = datetime.utcnow()

    return {
        "location": cached.location,
        "current_temp": cached.current_temp,
        "condition": cached.condition,
        "humidity": cached.humidity,
        "wind_kph": cached.wind_kph,
        "soil_moisture_estimate": cached.soil_moisture_estimate,
        "soil_moisture_volumetric_m3": cached.soil_moisture_volumetric_m3,
        "soil_temperature_c": cached.soil_temperature_c,
        "soil_moisture_status": cached.soil_moisture_status,
        "forecast": forecast_clean,
        "agri_risk_alerts": risk_alerts,
    }

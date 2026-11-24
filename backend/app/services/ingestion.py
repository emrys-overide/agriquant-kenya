import asyncio
import logging
import random
import re
import json
import httpx
from bs4 import BeautifulSoup
from datetime import datetime
from typing import Dict, List, Optional
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.models.schemas import CropSummary, MarketPrice
from backend.app.db.session import AsyncSessionLocal

logger = logging.getLogger(__name__)

CROP_MAPPING = {
    "maize": {"unit": "90kg Bag", "kamis_id": 1, "kg_per_unit": 90, "soko_name": "Dry Maize"},
    "tomatoes": {"unit": "Crate (~30kg)", "kamis_id": 61, "kg_per_unit": 30, "soko_name": "Tomatoes"},
    "cabbages": {"unit": "Head (~1.5kg)", "kamis_id": 58, "kg_per_unit": 1.5, "soko_name": "Cabbages"},
    "onions": {"unit": "Kg", "kamis_id": 158, "kg_per_unit": 1, "soko_name": "Dry Onions"},
    "french_beans": {"unit": "Kg", "kamis_id": 177, "kg_per_unit": 1, "soko_name": "French beans"},
    "potatoes": {"unit": "50kg Bag", "kamis_id": 57, "kg_per_unit": 50, "soko_name": "White Irish Potatoes"},
    "wheat": {"unit": "90kg Bag", "kamis_id": 3, "kg_per_unit": 90, "soko_name": "Wheat"},
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
]

KAMIS_BASE_URL = "https://kamis.kilimo.go.ke/site/market"
SOKO_API_URL = "https://soko.mkulimaonline.org/api/table-data/"
KEY_MARKETS = ["nairobi", "nyeri", "nakuru", "kisumu", "eldoret", "thika", "meru", "kitale"]

REASONABLE_PRICE_RANGES = {
    "maize": {"min": 25, "max": 100},
    "tomatoes": {"min": 20, "max": 200},
    "cabbages": {"min": 5, "max": 80},
    "onions": {"min": 30, "max": 200},
    "french_beans": {"min": 30, "max": 250},
    "potatoes": {"min": 15, "max": 120},
    "wheat": {"min": 25, "max": 150},
}

def is_reasonable_price(price_per_kg: float, crop: str) -> bool:
    bounds = REASONABLE_PRICE_RANGES.get(crop, {"min": 1, "max": 500})
    return bounds["min"] <= price_per_kg <= bounds["max"]

def filter_outliers_iqr(values: List[float]) -> List[float]:
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

def parse_price(text: str) -> Optional[float]:
    cleaned = text.replace(",", "")
    m = re.match(r"([\d]+\.?\d*)", cleaned)
    if m:
        try:
            val = float(m.group(1))
            if 1 < val < 500000:
                return val
        except ValueError:
            return None
    return None

def safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        f = float(val)
        return f if 0.1 < f < 500000 else None
    except (ValueError, TypeError):
        return None

async def scrape_kamis_per_market(kamis_id: int) -> Optional[List[dict]]:
    url = f"{KAMIS_BASE_URL}?product={kamis_id}"
    headers = {"User-Agent": random.choice(USER_AGENTS)}
    try:
        async with httpx.AsyncClient(verify=False, timeout=12.0) as client:
            resp = await client.get(url, headers=headers, follow_redirects=True)
            if resp.status_code != 200:
                return None
            soup = BeautifulSoup(resp.text, "html.parser")
            table = soup.find("table")
            if not table:
                return None
            
            rows = table.find_all("tr")
            if len(rows) < 2:
                return None

            header_cols = [th.text.strip().lower() for th in rows[0].find_all(["th", "td"])]
            market_col, county_col = 1, 0
            for idx, col_name in enumerate(header_cols):
                if "market" in col_name:
                    market_col = idx
                elif "county" in col_name:
                    county_col = idx

            market_data = []
            for tr in rows[1:]:
                tds = [td.text.strip() for td in tr.find_all("td")]
                if len(tds) < 10:
                    continue
                market_name = tds[market_col] if market_col < len(tds) else ""
                county_name = tds[county_col] if county_col < len(tds) else ""
                ws = parse_price(tds[5])
                rt = parse_price(tds[6])
                date_txt = tds[9] if len(tds) > 9 else ""

                if ws or rt:
                    market_data.append({
                        "market": market_name,
                        "county": county_name,
                        "wholesale_per_kg": ws,
                        "retail_per_kg": rt,
                        "date": date_txt
                    })
            return market_data if market_data else None
    except Exception as e:
        logger.warning(f"KAMIS scrape error for id {kamis_id}: {e}")
        return None

async def scrape_mkulima_online(soko_name: str) -> Optional[List[dict]]:
    url = f"{SOKO_API_URL}?commodity={soko_name}"
    headers = {"User-Agent": random.choice(USER_AGENTS), "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(verify=False, timeout=10.0) as client:
            resp = await client.get(url, headers=headers, follow_redirects=True)
            if resp.status_code != 200:
                return None
            data = resp.json()
            if not isinstance(data, dict):
                return None

            market_map = {}
            for item in data.get("sell", []):
                mkt = (item.get("market") or "").strip()
                if not mkt:
                    continue
                key = mkt.lower()
                market_map.setdefault(key, {
                    "market": mkt,
                    "county": (item.get("county") or "").strip(),
                    "wholesale_per_kg": safe_float(item.get("wholesale_kg")),
                    "retail_per_kg": safe_float(item.get("retail_kg")),
                    "date": (item.get("date") or "").strip()
                })

            for item in data.get("buy", []):
                mkt = (item.get("market") or "").strip()
                if not mkt:
                    continue
                key = mkt.lower()
                ws = safe_float(item.get("wholesale_kg"))
                rt = safe_float(item.get("retail_kg"))
                if key not in market_map:
                    market_map[key] = {
                        "market": mkt,
                        "county": (item.get("county") or "").strip(),
                        "wholesale_per_kg": ws,
                        "retail_per_kg": rt,
                        "date": (item.get("date") or "").strip()
                    }
                else:
                    if ws and not market_map[key]["wholesale_per_kg"]:
                        market_map[key]["wholesale_per_kg"] = ws
                    if rt and not market_map[key]["retail_per_kg"]:
                        market_map[key]["retail_per_kg"] = rt

            return list(market_map.values()) if market_map else None
    except Exception as e:
        logger.warning(f"Mkulima online scrape error for {soko_name}: {e}")
        return None

def sanitize_entries(entries: List[dict], crop: str, kg_per_unit: float) -> List[dict]:
    clean = []
    for e in entries:
        ws = e.get("wholesale_per_kg")
        rt = e.get("retail_per_kg")
        if ws is not None and not is_reasonable_price(ws, crop):
            ws = None
        if rt is not None and not is_reasonable_price(rt, crop):
            rt = None
        if ws is not None or rt is not None:
            clean.append({**e, "wholesale_per_kg": ws, "retail_per_kg": rt})
    return clean

async def sync_crop_data(crop: str, session: AsyncSession):
    info = CROP_MAPPING.get(crop)
    if not info:
        return
    kamis_id = info["kamis_id"]
    soko_name = info.get("soko_name")
    kg_per_unit = info["kg_per_unit"]

    kamis_raw, soko_raw = await asyncio.gather(
        scrape_kamis_per_market(kamis_id) if kamis_id else asyncio.sleep(0),
        scrape_mkulima_online(soko_name) if soko_name else asyncio.sleep(0)
    )

    all_entries = {}
    sources_used = []
    if kamis_raw:
        sources_used.append("KAMIS")
        for e in kamis_raw:
            m = e["market"].strip()
            if m:
                all_entries.setdefault(m.lower(), []).append({**e, "_source": "KAMIS"})
    if soko_raw:
        sources_used.append("Mkulima Online")
        for e in soko_raw:
            m = e["market"].strip()
            if m:
                all_entries.setdefault(m.lower(), []).append({**e, "_source": "Mkulima Online"})

    for k in list(all_entries.keys()):
        all_entries[k] = sanitize_entries(all_entries[k], crop, kg_per_unit)
        if not all_entries[k]:
            del all_entries[k]

    def median_val(v):
        if not v:
            return None
        s = sorted(v)
        return s[len(s) // 2]

    # Update or insert MarketPrice records
    all_ws_per_kg = []
    all_rt_per_kg = []
    latest_date_str = ""

    for mkt_key, entries in all_entries.items():
        ws_list = [e["wholesale_per_kg"] for e in entries if e.get("wholesale_per_kg")]
        rt_list = [e["retail_per_kg"] for e in entries if e.get("retail_per_kg")]
        ws = median_val(ws_list)
        rt = median_val(rt_list)
        if ws:
            all_ws_per_kg.append(ws)
        if rt:
            all_rt_per_kg.append(rt)

        date_val = max((e.get("date", "") for e in entries if e.get("date")), default="")
        if date_val and date_val > latest_date_str:
            latest_date_str = date_val

        m_name = entries[0]["market"]
        c_name = entries[0].get("county", "")
        srcs = list(set(e["_source"] for e in entries))

        # Upsert market price
        stmt = select(MarketPrice).where(MarketPrice.crop == crop, MarketPrice.market == m_name)
        res = await session.execute(stmt)
        record = res.scalars().first()
        if not record:
            record = MarketPrice(crop=crop, market=m_name)
            session.add(record)
        record.county = c_name
        record.wholesale_price = round(ws * kg_per_unit, 2) if ws else None
        record.retail_price = round(rt * kg_per_unit, 2) if rt else None
        record.date = date_val
        record.is_key_market = mkt_key in KEY_MARKETS
        record.sources = json.dumps(srcs)
        record.updated_at = datetime.utcnow()

    # Calculate national summary
    if all_rt_per_kg:
        med_ws = median_val(all_ws_per_kg) if all_ws_per_kg else median_val(all_rt_per_kg) * 0.85
        med_rt = median_val(all_rt_per_kg)
        p25 = sorted(all_ws_per_kg)[len(all_ws_per_kg) // 4] if len(all_ws_per_kg) >= 3 else med_ws * 0.85
        farm_per_kg = p25 * 0.80

        farm_price = round(farm_per_kg * kg_per_unit, 2) if farm_per_kg else None
        wholesale_price = round(med_ws * kg_per_unit, 2) if med_ws else None
        retail_price = round(med_rt * kg_per_unit, 2) if med_rt else None
        margin = round(((retail_price - farm_price) / farm_price) * 100, 2) if (farm_price and retail_price and farm_price > 0) else 0.0
        status_msg = f"Live synchronized from {', '.join(sources_used)} ({len(all_entries)} markets, {latest_date_str or 'today'})"
        has_data = True
    else:
        # Check existing summary
        farm_price, wholesale_price, retail_price, margin = None, None, None, 0.0
        status_msg = "Official market survey pending for this crop today."
        has_data = False

    stmt = select(CropSummary).where(CropSummary.crop == crop)
    res = await session.execute(stmt)
    summary_record = res.scalars().first()
    if not summary_record:
        summary_record = CropSummary(crop=crop, unit=info["unit"])
        session.add(summary_record)
    
    if has_data:
        summary_record.farm_gate_price_ksh = farm_price
        summary_record.wholesale_price_ksh = wholesale_price
        summary_record.retail_price_ksh = retail_price
        summary_record.profit_margin_estimate = margin
        summary_record.data_status = status_msg
        summary_record.has_data = True
        summary_record.updated_at = datetime.utcnow()

async def run_full_ingestion():
    logger.info("Starting background agricultural market data ingestion...")
    async with AsyncSessionLocal() as session:
        try:
            for crop in CROP_MAPPING.keys():
                await sync_crop_data(crop, session)
            await session.commit()
            logger.info("Background market data ingestion completed successfully.")
        except Exception as e:
            await session.rollback()
            logger.error(f"Ingestion failed: {e}")

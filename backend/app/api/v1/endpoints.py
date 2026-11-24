import json
import logging
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Header, Query
from sqlalchemy.future import select
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.db.session import get_db
from backend.app.models.schemas import CropSummary, MarketPrice, UserFeedback
from backend.app.services.weather import get_or_fetch_weather
from backend.app.services.ingestion import CROP_MAPPING, KEY_MARKETS, run_full_ingestion
from backend.app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Distance and Coordinate Hubs for Spatial Arbitrage
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

@router.get("/weather/{location}")
async def weather_endpoint(location: str, db: AsyncSession = Depends(get_db)):
    if not location or not location.strip():
        raise HTTPException(status_code=400, detail="Location is required.")
    try:
        data = await get_or_fetch_weather(location.strip(), db)
        return data
    except LookupError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Weather fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Weather provider error.")

@router.get("/prices/{crop}")
async def get_crop_summary(crop: str, db: AsyncSession = Depends(get_db)):
    crop_clean = crop.lower()
    if crop_clean not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")
    
    info = CROP_MAPPING[crop_clean]
    stmt = select(CropSummary).where(CropSummary.crop == crop_clean)
    res = await db.execute(stmt)
    record = res.scalars().first()
    
    if record and record.has_data:
        return {
            "crop": crop_clean.capitalize(),
            "unit": record.unit,
            "farm_gate_price_ksh": record.farm_gate_price_ksh,
            "wholesale_price_ksh": record.wholesale_price_ksh,
            "retail_price_ksh": record.retail_price_ksh,
            "profit_margin_estimate": record.profit_margin_estimate,
            "data_status": record.data_status,
            "has_data": True,
            "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        }
    
    return {
        "crop": crop_clean.capitalize(),
        "unit": info["unit"],
        "farm_gate_price_ksh": None,
        "wholesale_price_ksh": None,
        "retail_price_ksh": None,
        "profit_margin_estimate": 0.0,
        "data_status": "No official market records reported today (KAMIS survey pending)",
        "has_data": False,
    }

@router.get("/prices/{crop}/markets")
async def get_crop_markets(crop: str, db: AsyncSession = Depends(get_db)):
    crop_clean = crop.lower()
    if crop_clean not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")
    
    info = CROP_MAPPING[crop_clean]
    stmt = select(MarketPrice).where(MarketPrice.crop == crop_clean)
    res = await db.execute(stmt)
    records = res.scalars().all()
    
    markets = []
    sources = set()
    for r in records:
        src_list = json.loads(r.sources) if r.sources else []
        for s in src_list:
            sources.add(s)
        markets.append({
            "market": r.market,
            "county": r.county or "",
            "wholesale_price": r.wholesale_price,
            "retail_price": r.retail_price,
            "date": r.date or "",
            "is_key_market": r.is_key_market,
            "sources": src_list,
        })
        
    return {
        "crop": crop_clean.capitalize(),
        "unit": info["unit"],
        "count": len(markets),
        "data_source": "database_sync",
        "sources_used": list(sources),
        "markets": markets,
        "status_note": None if markets else "Official market records pending for today."
    }

@router.get("/analysis/{crop}")
async def get_spatial_analysis(
    crop: str, 
    user_lat: Optional[float] = Query(None), 
    user_lon: Optional[float] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    crop_clean = crop.lower()
    if crop_clean not in CROP_MAPPING:
        raise HTTPException(status_code=400, detail="Crop not supported.")
    
    info = CROP_MAPPING[crop_clean]
    stmt = select(MarketPrice).where(MarketPrice.crop == crop_clean)
    res = await db.execute(stmt)
    records = res.scalars().all()
    
    if not records:
        return {
            "crop": crop_clean.capitalize(),
            "unit": info["unit"],
            "markets_analyzed": 0,
            "statistics": {
                "avg_retail": 0, "avg_wholesale": 0, "price_spread": 0, "volatility_cv_pct": 0
            },
            "markets": [],
            "recommendation": {
                "best_sell_market": "Data pending", "best_sell_price": None,
                "cheapest_buy_market": "Data pending", "cheapest_buy_price": None,
                "advice_en": "Market surveys pending. Check back once local markets report.",
                "advice_sw": "Taarifa za masoko bado hazijatolewa. Tafadhali angalia tena baadaye."
            }
        }

    valid_retails = [r.retail_price for r in records if r.retail_price]
    valid_wholesales = [r.wholesale_price for r in records if r.wholesale_price]
    
    avg_retail = round(sum(valid_retails) / len(valid_retails), 2) if valid_retails else 0
    avg_wholesale = round(sum(valid_wholesales) / len(valid_wholesales), 2) if valid_wholesales else 0
    price_spread = round(avg_retail - avg_wholesale, 2)
    
    # Volatility CV%
    if len(valid_retails) > 1 and avg_retail > 0:
        variance = sum((x - avg_retail) ** 2 for x in valid_retails) / len(valid_retails)
        std_dev = variance ** 0.5
        cv_pct = round((std_dev / avg_retail) * 100, 1)
    else:
        cv_pct = 0.0

    market_entries = []
    best_sell_mkt = None
    best_sell_pr = 0
    cheapest_buy_mkt = None
    cheapest_buy_pr = float("inf")

    for r in records:
        rt = r.retail_price or 0
        ws = r.wholesale_price or 0
        diff = round(rt - avg_retail, 2) if rt else 0
        
        # Spatial hub categorization
        if rt > avg_retail * 1.10:
            hub_type = "Premium Destination Hub"
        elif ws < avg_wholesale * 0.90:
            hub_type = "Producer / Farm Hub"
        else:
            hub_type = "Balanced Trading Hub"

        if rt > best_sell_pr:
            best_sell_pr = rt
            best_sell_mkt = r.market
        if ws > 0 and ws < cheapest_buy_pr:
            cheapest_buy_pr = ws
            cheapest_buy_mkt = r.market

        market_entries.append({
            "market": r.market,
            "county": r.county,
            "retail_price": rt or None,
            "wholesale_price": ws or None,
            "diff_from_national_retail": diff,
            "hub_classification": hub_type,
            "sources": json.loads(r.sources) if r.sources else [],
        })

    return {
        "crop": crop_clean.capitalize(),
        "unit": info["unit"],
        "markets_analyzed": len(records),
        "statistics": {
            "avg_retail": avg_retail,
            "avg_wholesale": avg_wholesale,
            "price_spread": price_spread,
            "volatility_cv_pct": cv_pct,
        },
        "markets": market_entries,
        "recommendation": {
            "best_sell_market": best_sell_mkt or "Nairobi",
            "best_sell_price": best_sell_pr if best_sell_pr > 0 else None,
            "cheapest_buy_market": cheapest_buy_mkt or "Nakuru",
            "cheapest_buy_price": cheapest_buy_pr if cheapest_buy_pr < float("inf") else None,
            "advice_en": f"Top selling margin observed in {best_sell_mkt or 'Nairobi'}. Source inventory from {cheapest_buy_mkt or 'production hubs'} to maximize arbitrage.",
            "advice_sw": f"Mauzo bora zaidi yameonekana {best_sell_mkt or 'Nairobi'}. Nunua kutoka {cheapest_buy_mkt or 'mashambani'} ili kupata faida kubwa.",
        }
    }

@router.post("/trigger-ingestion")
async def trigger_ingestion(authorization: Optional[str] = Header(None)):
    token = settings.ADMIN_TOKEN
    if not token or not authorization or authorization.replace("Bearer ", "").strip() != token:
        raise HTTPException(status_code=401, detail="Unauthorized admin token.")
    await run_full_ingestion()
    return {"success": True, "message": "Manual ingestion triggered and completed."}

@router.post("/comments")
async def post_comment(payload: dict, db: AsyncSession = Depends(get_db)):
    name = str(payload.get("name", "")).strip()
    email = str(payload.get("email", "")).strip()
    msg = str(payload.get("message", "")).strip()
    rating = payload.get("rating", 5)

    if not name or len(name) > 100 or not isinstance(payload.get("name"), str):
        raise HTTPException(status_code=400, detail="Invalid name.")
    if not msg or len(msg) > 2000 or not isinstance(payload.get("message"), str):
        raise HTTPException(status_code=400, detail="Invalid message.")
    if not isinstance(rating, int) or rating < 1 or rating > 5:
        raise HTTPException(status_code=400, detail="Rating must be integer 1 to 5.")

    fb = UserFeedback(name=name, email=email or None, message=msg, rating=rating)
    db.add(fb)
    await db.commit()
    return {"success": True, "id": fb.id}

@router.get("/comments")
async def get_comments(authorization: Optional[str] = Header(None), db: AsyncSession = Depends(get_db)):
    token = settings.ADMIN_TOKEN
    if not token or not authorization or authorization.replace("Bearer ", "").strip() != token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    
    stmt = select(UserFeedback).order_by(UserFeedback.created_at.desc()).limit(100)
    res = await db.execute(stmt)
    rows = res.scalars().all()
    
    return {
        "authorized": True,
        "comments": [
            {
                "id": str(r.id),
                "name": r.name,
                "email": r.email,
                "message": r.message,
                "rating": r.rating,
                "timestamp": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ]
    }

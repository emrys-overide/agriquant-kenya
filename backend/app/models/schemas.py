from sqlalchemy import Column, Integer, String, Float, DateTime, Text, Boolean, Index
from datetime import datetime, timezone
from backend.app.db.session import Base

def utc_now():
    return datetime.now(timezone.utc)

class CropSummary(Base):
    __tablename__ = "crop_summaries"
    
    id = Column(Integer, primary_key=True, index=True)
    crop = Column(String(50), nullable=False, unique=True, index=True)
    unit = Column(String(50), nullable=False)
    farm_gate_price_ksh = Column(Float, nullable=True)
    wholesale_price_ksh = Column(Float, nullable=True)
    retail_price_ksh = Column(Float, nullable=True)
    profit_margin_estimate = Column(Float, default=0.0)
    data_status = Column(String(255), nullable=False)
    has_data = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, index=True)


class MarketPrice(Base):
    __tablename__ = "market_prices"
    
    id = Column(Integer, primary_key=True, index=True)
    crop = Column(String(50), nullable=False, index=True)
    market = Column(String(100), nullable=False, index=True)
    county = Column(String(100), nullable=True)
    wholesale_price = Column(Float, nullable=True)
    retail_price = Column(Float, nullable=True)
    date = Column(String(50), nullable=True)
    is_key_market = Column(Boolean, default=False)
    sources = Column(Text, nullable=True)  # JSON-encoded array or comma-separated
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, index=True)

    __table_args__ = (
        Index("ix_crop_market", "crop", "market", unique=True),
    )


class WeatherSnapshot(Base):
    __tablename__ = "weather_snapshots"
    
    id = Column(Integer, primary_key=True, index=True)
    location = Column(String(100), nullable=False, unique=True, index=True)
    current_temp = Column(Float, nullable=True)
    condition = Column(String(100), nullable=True)
    humidity = Column(Integer, nullable=True)
    wind_kph = Column(Float, nullable=True)
    soil_moisture_estimate = Column(Float, nullable=True)
    soil_moisture_volumetric_m3 = Column(Float, nullable=True)
    soil_temperature_c = Column(Float, nullable=True)
    soil_moisture_status = Column(String(100), nullable=True)
    forecast_json = Column(Text, nullable=True)
    risk_alerts_json = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now)


class UserFeedback(Base):
    __tablename__ = "user_feedback"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    email = Column(String(150), nullable=True)
    message = Column(Text, nullable=False)
    rating = Column(Integer, default=5)
    created_at = Column(DateTime, default=utc_now, index=True)

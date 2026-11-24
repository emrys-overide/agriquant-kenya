from pydantic_settings import BaseSettings
from typing import List
import os

class Settings(BaseSettings):
    PROJECT_NAME: str = "Agriquant Intelligence API"
    VERSION: str = "2.0.0"
    APP_ENV: str = "production"
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./agriquant.db")
    
    # Redis / Celery (Optional, falls back to in-memory/async background scheduler if not provided)
    REDIS_URL: str = os.getenv("REDIS_URL", "")
    
    # External APIs
    WEATHER_API_KEY: str = os.getenv("WEATHER_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    ADMIN_TOKEN: str = os.getenv("ADMIN_TOKEN", "")
    
    # CORS
    ALLOWED_ORIGINS: str = os.getenv(
        "ALLOWED_ORIGINS", 
        "https://agriquant-kenya.pages.dev,http://localhost:3000,http://127.0.0.1:3000"
    )
    
    # Scraping / Ingestion
    INGESTION_INTERVAL_MINUTES: int = 360  # Every 6 hours
    
    @property
    def cors_origins(self) -> List[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()

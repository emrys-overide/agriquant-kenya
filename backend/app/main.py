import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from backend.app.core.config import settings
from backend.app.db.session import engine, Base
from backend.app.api.v1.endpoints import router as api_v1_router
from backend.app.services.ingestion import run_full_ingestion

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("agriquant-backend")

background_task = None

async def periodic_ingestion_loop():
    while True:
        try:
            logger.info("Running periodic background scraping sync...")
            await run_full_ingestion()
        except Exception as e:
            logger.error(f"Periodic ingestion loop error: {e}")
        # Sleep for configured interval (in seconds)
        await asyncio.sleep(settings.INGESTION_INTERVAL_MINUTES * 60)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize DB schemas on startup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database schemas initialized.")
    
    # Start background ingestion task
    task = asyncio.create_task(periodic_ingestion_loop())
    yield
    task.cancel()
    await engine.dispose()

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Request size enforcement middleware (max 32KB payload)
@app.middleware("http")
async def enforce_request_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > 32_768:
                return JSONResponse({"detail": "Request body too large."}, status_code=413)
        except ValueError:
            return JSONResponse({"detail": "Invalid Content-Length."}, status_code=400)
    return await call_next(request)

# Security and CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# Mount API routes
app.include_router(api_v1_router, prefix="/api")

@app.get("/")
async def root():
    return RedirectResponse(url="https://agriquant-kenya.pages.dev")

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "environment": settings.APP_ENV,
    }

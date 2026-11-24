import pytest
from httpx import AsyncClient, ASGITransport
from backend.app.main import app
from backend.app.db.session import engine, Base

@pytest.fixture(scope="session", autouse=True)
def setup_database():
    import asyncio
    async def _init():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    asyncio.run(_init())
    yield

@pytest.mark.asyncio
async def test_health_check():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert "version" in data

@pytest.mark.asyncio
async def test_unsupported_crop_returns_400():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/prices/invalid_crop_xyz")
        assert response.status_code == 400
        assert "Crop not supported" in response.json()["detail"]

@pytest.mark.asyncio
async def test_valid_crop_structure():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/prices/maize")
        assert response.status_code == 200
        data = response.json()
        assert data["crop"] == "Maize"
        assert data["unit"] == "90kg Bag"
        assert "has_data" in data

@pytest.mark.asyncio
async def test_comments_feedback_validation():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Invalid rating
        bad_resp = await client.post("/api/comments", json={"name": "Kael", "message": "Good", "rating": 10})
        assert bad_resp.status_code == 400

        # Valid submission
        good_resp = await client.post("/api/comments", json={"name": "Kael", "message": "Super fast response!", "rating": 5})
        assert good_resp.status_code == 200
        assert good_resp.json()["success"] is True

@pytest.mark.asyncio
async def test_admin_comments_protection():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        unauth = await client.get("/api/comments")
        assert unauth.status_code == 401

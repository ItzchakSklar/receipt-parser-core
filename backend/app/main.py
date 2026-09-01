from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import auth, categories, dashboard, invoices, system

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SmartReceipt API",
    description="Multi-tenant expense & receipt management for small businesses.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(invoices.router)
app.include_router(dashboard.router)
app.include_router(system.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}

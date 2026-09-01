import logging

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import Base, engine, ensure_schema
from app.routers import auth, categories, dashboard, invoices, system

logger = logging.getLogger("smartreceipt.validation")

Base.metadata.create_all(bind=engine)
ensure_schema()

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


@app.exception_handler(RequestValidationError)
async def log_validation_errors(request: Request, exc: RequestValidationError) -> JSONResponse:
    logger.error(
        "422 Unprocessable Entity on %s %s\n  errors: %s\n  content-type: %s",
        request.method,
        request.url.path,
        exc.errors(),
        request.headers.get("content-type"),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=jsonable_encoder({"detail": exc.errors()}),
    )


app.include_router(auth.router)
app.include_router(categories.router)
app.include_router(invoices.router)
app.include_router(dashboard.router)
app.include_router(system.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}

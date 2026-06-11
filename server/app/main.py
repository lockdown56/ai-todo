from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import SessionLocal
from app.errors import ApiError, api_error_handler, validation_error_handler
from app.routers import checklist, health, lists, tags, tasks
from app.services import initialize_data


def create_app(*, initialize: bool = True) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if initialize:
            async with SessionLocal() as session:
                await initialize_data(session)
        yield

    app = FastAPI(title="Todo List API", version="0.1.0", lifespan=lifespan)
    settings = get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(health.router)
    app.include_router(lists.router)
    app.include_router(tasks.router)
    app.include_router(checklist.router)
    app.include_router(tags.router)
    return app


app = create_app()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the existing ASGI app (Socket.IO + Flask wrapped earlier)
try:
    import app as flask_app_module
except Exception:
    # Fallback if running as package
    from . import app as flask_app_module


app = FastAPI(title="LeadGen Backend (FastAPI wrapper)")

# Allow the frontend to connect during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Mount the existing ASGI application (Socket.IO + Flask) at root.
# This preserves all existing HTTP endpoints and WebSocket behavior while
# allowing the process to be started via `uvicorn backend.fastapi_app:app`.
app.mount("/", flask_app_module.asgi_app)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

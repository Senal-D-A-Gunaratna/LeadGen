from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Import the existing ASGI app (Socket.IO + Flask wrapped earlier).
# Prefer the fully-qualified package import so static checkers (mypy)
# can resolve the module; fall back to relative import for different
# run contexts.
try:
    from servers.backend import app as flask_app_module
except Exception:
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
from asgiref.wsgi import WsgiToAsgi

# Mount the existing Flask/Socket.IO app. If the Flask module exposes an
# `asgi_app` (python-socketio AsyncServer wrapped ASGI app) use it; otherwise
# wrap the Flask WSGI app with `WsgiToAsgi` so it can be mounted under
# FastAPI/Starlette for development convenience.
flask_asgi = getattr(flask_app_module, 'asgi_app', None)
if flask_asgi is not None:
    app.mount("/", flask_asgi)
else:
    # Expect the Flask `app` object to be available as `flask_app_module.app`
    wsgi_app = getattr(flask_app_module, 'app', None)
    if wsgi_app is not None:
        app.mount("/", WsgiToAsgi(wsgi_app))
    else:
        # Last resort: mount nothing (requests to root will 404)
        pass


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}

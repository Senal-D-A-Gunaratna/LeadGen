from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.middleware.wsgi import WSGIMiddleware
from fastapi import FastAPI

# import your existing Flask app (adjust import to your layout)
from servers.backend.src import app as flask_module  # flask_module.app is the Flask app

# FastAPI app for /api
fastapi_app = FastAPI()
# ...existing code... (register routers on fastapi_app)

# Compose root ASGI app: mount FastAPI at /api, everything else to the Flask WSGI app
# This removes Socket.IO integration and serves the Flask app via WSGI middleware.
flask_wsgi = WSGIMiddleware(flask_module.app)
# Mount Flask at root so existing `/api/...` Flask endpoints continue to work.
app = Starlette(routes=[Mount("/_fastapi", app=fastapi_app), Mount("/", app=flask_wsgi)])

from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.middleware.wsgi import WSGIMiddleware
from fastapi import FastAPI

# import your existing Flask app (adjust import to your layout)
from servers.backend.src import app as flask_module  # flask_module.app is the Flask app

# import the preconfigured FastAPI application containing all routes
from servers.backend.src import fastapi_main

# FastAPI app for /api: reuse the instance defined in fastapi_main so
# all route handlers remain available when uvicorn starts fastapi_app.
fastapi_app: FastAPI = fastapi_main.fastapi_app

# Compose root ASGI app: serve the FastAPI application at the root so
# all `/api/...` routes are handled by it. The Flask WSGI app acts as a
# fallback for any other paths (e.g. legacy non-API pages).
flask_wsgi = WSGIMiddleware(flask_module.app)
app = Starlette(routes=[Mount("/", app=fastapi_app), Mount("/", app=flask_wsgi)])

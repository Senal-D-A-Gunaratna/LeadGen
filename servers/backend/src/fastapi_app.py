from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.middleware.wsgi import WSGIMiddleware
from fastapi import FastAPI
import socketio  # type: ignore

# import your existing Flask app (adjust import to your layout)
from servers.backend.src import app as flask_module  # flask_module.app is the Flask app

# FastAPI app for /api
fastapi_app = FastAPI()
# ...existing code... (register routers on fastapi_app)

# Socket.IO AsyncServer and ASGI wrapper that falls back to the Flask WSGI app
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
flask_wsgi = WSGIMiddleware(flask_module.app)
socketio_asgi = socketio.ASGIApp(sio, other_asgi_app=flask_wsgi)

# Compose root ASGI app: mount FastAPI at /api, everything else to socketio_asgi (Flask + /socket.io)
app = Starlette(routes=[Mount("/api", app=fastapi_app), Mount("/", app=socketio_asgi)])

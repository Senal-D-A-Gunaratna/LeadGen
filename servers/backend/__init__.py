"""Compatibility shim for `servers.backend` package.

This module re-exports modules moved into `servers/backend/src` so
existing imports such as `from servers.backend import app` continue
to work after the source files were relocated.
"""

"""
Expose modules from `src/` as package submodules by adding
`servers/backend/src` to the package search path and importing
the main modules so both `from servers.backend import app` and
`import servers.backend.database` work as before.
"""
import os
from pathlib import Path

_pkg_dir = Path(__file__).resolve().parent
_src_dir = str(_pkg_dir / 'src')
if _src_dir not in __path__:
    __path__.insert(0, _src_dir)

# Explicitly import from the `src` package to make static checkers (mypy)
# and runtime imports resolve predictably.
from .src import app as app
from .src import database as database
from .src import api_endpoints as api_endpoints
from .src import fastapi_main as fastapi_main
from .src import fastapi_app as fastapi_app
from .src import config as config
from .src import utils as utils

__all__ = [
    'app', 'database', 'api_endpoints', 'fastapi_main', 'fastapi_app', 'config', 'utils'
]

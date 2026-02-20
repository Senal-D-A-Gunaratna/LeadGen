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

# Insert the `src` directory into the package search path so
# `import servers.backend.database` will find modules located in
# `servers/backend/src/*.py`.
_pkg_dir = Path(__file__).resolve().parent
_src_dir = str(_pkg_dir / 'src')
if _src_dir not in __path__:  # type: ignore[name-defined]
    __path__.insert(0, _src_dir)  # type: ignore[name-defined]

from . import app as app
from . import database as database
from . import api_endpoints as api_endpoints
from . import fastapi_main as fastapi_main
from . import fastapi_app as fastapi_app
from . import config as config
from . import utils as utils

__all__ = [
    'app', 'database', 'api_endpoints', 'fastapi_main', 'fastapi_app', 'config', 'utils'
]

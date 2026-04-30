"""Package marker for `servers.backend`.

This file ensures the `servers.backend` package is explicit so tools
like mypy and Python import machinery resolve modules consistently.
"""

__all__ = [
    'app', 'database', 'api_endpoints', 'fastapi_main'
]
"""Make servers.backend a package for static analysis and imports."""

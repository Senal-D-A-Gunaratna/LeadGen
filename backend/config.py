"""
Backend configuration for attendance cutoffs and timezone.
This file centralizes attendance cutoff values used by the server.
"""
import os
from typing import Tuple

# Cutoff times are wall-clock times in HH:MM[:SS] format (server local time)
ATTENDANCE_ONTIME_END = os.environ.get('ATTENDANCE_ONTIME_END', '07:15:00')
ATTENDANCE_LATE_END = os.environ.get('ATTENDANCE_LATE_END', '13:30:00')

# TIMEZONE left empty to indicate system local timezone should be used.
# If you want to enforce a specific timezone, set TIMEZONE to an IANA name
# and use zoneinfo to convert; default behavior uses system local tz.
TIMEZONE = os.environ.get('TIMEZONE', '')


def parse_time_str(hhmmss: str) -> Tuple[int, int, int]:
    """Return (hour, minute, second) triple for an HH:MM or HH:MM:SS string."""
    parts = hhmmss.split(':')
    if len(parts) == 2:
        h, m = parts
        s = '0'
    else:
        h, m, s = parts
    return int(h), int(m), int(s)


# Authoritative static filter values used for registration/profile forms

GRADES = [
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
]

PREFECT_ROLES = [
    "Head Prefect",
    "Deputy Head Prefect",
    "Super Senior Prefect",
    "Senior Prefect",
    "Junior Prefect",
]

CLASSES = [
    "Nena",
    "Guna",
    "Edi",
    "Bala",
    "Suru",
    "Viru",
    "Diri",
]

# End of backend/config.py
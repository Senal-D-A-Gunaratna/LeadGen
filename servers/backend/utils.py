"""
Utility functions for attendance computation.
"""
from datetime import time, datetime, timezone
from typing import Union


def compute_attendance_status(dt_local: Union[datetime, None], ontime_cutoff: str, late_cutoff: str) -> str:
    """
    Compute attendance status based on a local datetime and cutoff strings.

    Rules (server local time):
      - on_time: arrival at or before `ontime_cutoff` (<=)
      - late: after `ontime_cutoff` and at or before `late_cutoff` (>) and (<=)
      - absent: after `late_cutoff` or dt_local is None

    `ontime_cutoff` and `late_cutoff` are 'HH:MM' or 'HH:MM:SS' strings.
    """
    if dt_local is None:
        return 'absent'

    def parse_t(s: str) -> time:
        parts = s.split(':')
        if len(parts) == 2:
            h, m = parts
            sec_str = '0'
        else:
            h, m, sec_str = parts
        return time(int(h), int(m), int(sec_str))

    on_t = parse_t(ontime_cutoff)
    late_t = parse_t(late_cutoff)

    # Normalize to a naive local time for comparison (hour, minute, second)
    local_time = time(dt_local.hour, dt_local.minute, dt_local.second)

    # on_time: <= on_t
    if local_time <= on_t:
        return 'on time'
    # late: > on_t and <= late_t
    if local_time > on_t and local_time <= late_t:
        return 'late'
    # otherwise absent
    return 'absent'

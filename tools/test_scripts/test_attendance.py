import pytest
from datetime import datetime

from backend.utils import compute_attendance_status


def make_dt(h, m, s=0):
    return datetime(2026, 1, 21, h, m, s)


@pytest.mark.parametrize("h,m,s,expected", [
    (7, 14, 59, 'on time'),
    (7, 15, 0, 'on time'),
    (7, 15, 1, 'late'),
    (13, 30, 0, 'late'),
    (13, 30, 1, 'absent'),
])
def test_compute_attendance_status_boundaries(h, m, s, expected):
    dt = make_dt(h, m, s)
    status = compute_attendance_status(dt, '07:15:00', '13:30:00')
    assert status == expected

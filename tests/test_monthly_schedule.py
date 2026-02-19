"""Tests for monthly schedule image generation."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from auto_post.monthly_schedule import (
    ScheduleEntry,
    ScheduleRenderConfig,
    build_monthly_caption,
    extract_month_entries_from_json,
    render_monthly_schedule_image,
    resolve_target_year_month,
)


def test_resolve_target_year_month_next():
    now = datetime(2026, 2, 25, 16, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
    year, month = resolve_target_year_month(now=now, target="next")
    assert (year, month) == (2026, 3)


def test_resolve_target_year_month_current():
    now = datetime(2026, 2, 25, 16, 0, tzinfo=ZoneInfo("Asia/Tokyo"))
    year, month = resolve_target_year_month(now=now, target="current")
    assert (year, month) == (2026, 2)


def test_build_monthly_caption_defaults():
    entries = [
        ScheduleEntry(day=date(2026, 3, 1), title="午前クラス", classroom="東京教室", venue="浅草橋"),
        ScheduleEntry(day=date(2026, 3, 2), title="午後クラス", classroom="沼津教室", venue="沼津"),
    ]
    caption = build_monthly_caption(2026, 3, entries, default_tags="木彫り 教室日程")
    assert "2026年3月の教室日程です。" in caption
    assert "#木彫り" in caption
    assert "#教室日程" in caption


def test_render_monthly_schedule_image_size():
    entries = [
        ScheduleEntry(
            day=date(2026, 3, 5),
            title="体験クラス",
            classroom="東京教室",
            venue="浅草橋",
            start=datetime(2026, 3, 5, 10, 30, tzinfo=ZoneInfo("Asia/Tokyo")),
        ),
        ScheduleEntry(
            day=date(2026, 3, 5),
            title="夜クラス",
            classroom="つくば教室",
            venue="つくば",
            start=datetime(2026, 3, 5, 18, 0, tzinfo=ZoneInfo("Asia/Tokyo")),
        ),
    ]
    image = render_monthly_schedule_image(2026, 3, entries, ScheduleRenderConfig(width=768, height=1024))
    assert image.size == (768, 1024)


def test_extract_month_entries_from_participants_index_shape():
    payload = {
        "generated_at": "2026-02-25T12:00:00+09:00",
        "timezone": "Asia/Tokyo",
        "dates": {
            "2026-03-05": [
                {
                    "lesson_id": "abc",
                    "classroom": "東京教室",
                    "venue": "浅草橋",
                    "start_at": "2026-03-05T10:30:00+09:00",
                    "participants": [
                        {"student_id": "s1", "display_name": "A"},
                        {"student_id": "s2", "display_name": "B"},
                    ],
                }
            ]
        },
    }
    entries = extract_month_entries_from_json(payload, 2026, 3, timezone="Asia/Tokyo")
    assert len(entries) == 1
    assert entries[0].day == date(2026, 3, 5)
    assert entries[0].classroom == "東京教室"
    assert entries[0].venue == "浅草橋"
    assert entries[0].title == "2名"

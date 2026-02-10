"""Tests for gallery exporter author ID handling."""

from auto_post.gallery_exporter import GalleryExporter


class _FakeNotion:
    def __init__(self, db_info: dict, pages: list[dict]):
        self._db_info = db_info
        self._pages = pages

    def get_database_info(self, _database_id: str) -> dict:
        return self._db_info

    def list_database_pages(self, _database_id: str) -> list[dict]:
        return self._pages


def _make_exporter() -> GalleryExporter:
    return GalleryExporter.__new__(GalleryExporter)


def test_build_author_id_map_uses_student_id_property():
    exporter = _make_exporter()
    exporter.notion = _FakeNotion(
        db_info={"properties": {"生徒ID": {"type": "rich_text"}}},
        pages=[
            {
                "id": "author-1",
                "properties": {
                    "生徒ID": {
                        "type": "rich_text",
                        "rich_text": [{"plain_text": "ST-001"}],
                    }
                },
            },
            {
                "id": "author-2",
                "properties": {"生徒ID": {"type": "number", "number": 102}},
            },
            {
                "id": "author-3",
                "properties": {
                    "生徒ID": {
                        "type": "unique_id",
                        "unique_id": {"prefix": "S-", "number": 55},
                    }
                },
            },
            {
                "id": "author-4",
                "properties": {
                    "生徒ID": {
                        "type": "unique_id",
                        "unique_id": {"prefix": "T", "number": 9},
                    }
                },
            },
        ],
    )

    author_map = exporter._build_author_id_map("author-db")

    assert author_map == {
        "author-1": "ST-001",
        "author-2": "102",
        "author-3": "S-55",
        "author-4": "T-9",
    }


def test_build_author_id_map_skips_name_like_values():
    exporter = _make_exporter()
    exporter.notion = _FakeNotion(
        db_info={"properties": {"生徒ID": {"type": "rich_text"}}},
        pages=[
            {
                "id": "author-1",
                "properties": {
                    "生徒ID": {"type": "rich_text", "rich_text": [{"plain_text": "たろう"}]}
                },
            },
            {
                "id": "author-2",
                "properties": {
                    "生徒ID": {
                        "type": "rich_text",
                        "rich_text": [{"plain_text": "nickname|本名"}],
                    }
                },
            },
            {
                "id": "author-3",
                "properties": {
                    "生徒ID": {"type": "rich_text", "rich_text": [{"plain_text": "TARO"}]}
                },
            },
        ],
    )

    author_map = exporter._build_author_id_map("author-db")

    assert author_map == {}


def test_format_author_joins_relation_ids():
    exporter = _make_exporter()

    author = exporter._format_author(["ST-001", "ST-002"], props={})

    assert author == "ST-001 / ST-002"


def test_format_author_select_fallback_accepts_only_id_like_value():
    exporter = _make_exporter()

    safe_author = exporter._format_author(
        [],
        props={"作者": {"select": {"name": "ST-001"}}},
    )
    unsafe_author = exporter._format_author(
        [],
        props={"作者": {"select": {"name": "山田太郎"}}},
    )

    assert safe_author == "ST-001"
    assert unsafe_author is None

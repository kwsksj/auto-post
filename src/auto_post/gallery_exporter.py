"""Export gallery.json from Notion and upload to R2."""

from __future__ import annotations

import io
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests
from PIL import Image, ImageOps

from .config import Config
from .notion_db import NotionDB
from .r2_storage import R2Storage

logger = logging.getLogger(__name__)

THUMB_WIDTH_DEFAULT = 600
THUMB_RATIO = 4 / 5
GALLERY_JSON_KEY = "gallery.json"
THUMB_PREFIX = "thumbs"


@dataclass
class ExportStats:
    total_pages: int = 0
    exported: int = 0
    skipped_no_images: int = 0
    skipped_no_completed_date: int = 0
    thumb_generated: int = 0
    thumb_skipped_existing: int = 0
    thumb_failed: int = 0


class GalleryExporter:
    """Export works from Notion into gallery.json and upload to R2."""

    def __init__(self, config: Config):
        self.config = config
        self.notion = NotionDB(
            config.notion.token,
            config.notion.database_id,
            config.notion.tags_database_id,
        )
        self.r2 = R2Storage(config.r2)

        if not self.config.r2.public_url:
            raise ValueError("R2_PUBLIC_URL is required for gallery export")

    def export(
        self,
        output_path: Path | None = None,
        upload: bool = True,
        generate_thumbs: bool = True,
        thumb_width: int = THUMB_WIDTH_DEFAULT,
    ) -> tuple[dict, ExportStats]:
        db_info = self.notion.get_database_info()
        pages = self.notion.list_database_pages(self.notion.database_id)

        tag_db_id = self._get_relation_database_id(db_info, "タグ")
        author_db_id = self._get_relation_database_id(db_info, "作者")

        tag_map = self.notion.get_database_title_map(tag_db_id) if tag_db_id else {}
        author_map = (
            self.notion.get_database_title_map(author_db_id) if author_db_id else {}
        )

        stats = ExportStats(total_pages=len(pages))
        works: list[dict] = []

        for page in pages:
            work = self._parse_work_page(
                page=page,
                tag_map=tag_map,
                author_map=author_map,
                generate_thumbs=generate_thumbs,
                thumb_width=thumb_width,
                stats=stats,
            )
            if work:
                works.append(work)
                stats.exported += 1

        works.sort(key=lambda w: w["id"])
        works.sort(key=lambda w: w["completed_date"], reverse=True)

        payload = {
            "version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "works": works,
        }

        if output_path:
            output_path.write_text(
                self._dump_json(payload),
                encoding="utf-8",
            )

        if upload:
            self.r2.put_json(
                payload,
                GALLERY_JSON_KEY,
                cache_control="max-age=300",
                ensure_ascii=False,
            )

        return payload, stats

    def _get_relation_database_id(self, db_info: dict, prop_name: str) -> str | None:
        prop = db_info.get("properties", {}).get(prop_name)
        if not prop:
            logger.warning("Relation property not found: %s", prop_name)
            return None
        if prop.get("type") != "relation":
            logger.warning("Property %s is not relation (type=%s)", prop_name, prop.get("type"))
            return None
        return prop.get("relation", {}).get("database_id")

    def _parse_work_page(
        self,
        page: dict,
        tag_map: dict[str, str],
        author_map: dict[str, str],
        generate_thumbs: bool,
        thumb_width: int,
        stats: ExportStats,
    ) -> dict | None:
        props = page.get("properties", {})

        work_id = page.get("id")
        title = self._get_title_from_props(props, "作品名")

        completed_date = self._get_date(props, "完成日")
        if not completed_date:
            stats.skipped_no_completed_date += 1
            logger.warning("Missing completed_date: %s", work_id)
            return None

        images = self._get_files(props, "画像")
        if not images:
            stats.skipped_no_images += 1
            logger.warning("No images: %s", work_id)
            return None

        caption = self._get_rich_text(props, "キャプション")
        studio = self._get_select(props, "教室")

        tags = self._get_relation_names(props, "タグ", tag_map)
        if not tags:
            tags = self._get_tags_fallback(props)

        author = self._get_relation_names(props, "作者", author_map)
        author_name = self._format_author(author, props)

        thumb_url = None
        if generate_thumbs:
            thumb_url = self._ensure_thumbnail(
                work_id=work_id,
                image_url=images[0],
                thumb_width=thumb_width,
                stats=stats,
            )

        if not thumb_url:
            thumb_url = images[0]

        work = {
            "id": work_id,
            "title": title or "",
            "completed_date": completed_date,
            "caption": caption or None,
            "author": author_name,
            "studio": studio or None,
            "tags": tags,
            "images": images,
            "thumb": thumb_url,
        }
        return work

    def _format_author(self, author_names: list[str], props: dict) -> str | None:
        if author_names:
            return " / ".join([n for n in author_names if n]) or None
        # Fallback if relation is not used
        select_val = self._get_select(props, "作者")
        if select_val:
            return select_val
        return None

    def _get_title_from_props(self, props: dict, key: str) -> str:
        if props.get(key, {}).get("title"):
            return "".join(t.get("plain_text", "") for t in props[key]["title"]).strip()
        return ""

    def _get_date(self, props: dict, key: str) -> str | None:
        date_obj = props.get(key, {}).get("date")
        if date_obj and date_obj.get("start"):
            return date_obj["start"][:10]
        return None

    def _get_select(self, props: dict, key: str) -> str | None:
        sel = props.get(key, {}).get("select")
        if sel:
            return sel.get("name")
        return None

    def _get_rich_text(self, props: dict, key: str) -> str | None:
        rtext = props.get(key, {}).get("rich_text")
        if rtext:
            return "".join(t.get("plain_text", "") for t in rtext).strip()
        return None

    def _get_files(self, props: dict, key: str) -> list[str]:
        files = props.get(key, {}).get("files", [])
        urls = []
        for file in files:
            if file.get("type") == "external":
                urls.append(file["external"]["url"])
            elif file.get("type") == "file":
                urls.append(file["file"]["url"])
        return urls

    def _get_relation_names(
        self,
        props: dict,
        key: str,
        name_map: dict[str, str],
    ) -> list[str]:
        rel = props.get(key, {})
        if rel.get("type") != "relation":
            return []
        ids = [r.get("id") for r in rel.get("relation", []) if r.get("id")]
        names = [name_map.get(rid, "") for rid in ids]
        return [n for n in names if n]

    def _get_tags_fallback(self, props: dict) -> list[str]:
        t_prop = props.get("タグ")
        if not t_prop:
            return []
        if t_prop.get("type") == "multi_select":
            return [opt.get("name") for opt in t_prop.get("multi_select", []) if opt.get("name")]
        if t_prop.get("type") == "rich_text":
            raw = self._get_rich_text(props, "タグ")
            if raw:
                return [t.strip().lstrip("#") for t in raw.split() if t.strip()]
        return []

    def _ensure_thumbnail(
        self,
        work_id: str,
        image_url: str,
        thumb_width: int,
        stats: ExportStats,
    ) -> str | None:
        key = f"{THUMB_PREFIX}/{work_id}.jpg"
        if self.r2.exists(key):
            stats.thumb_skipped_existing += 1
            return self._public_url(key)

        try:
            resp = requests.get(image_url, timeout=30)
            resp.raise_for_status()
            image = Image.open(io.BytesIO(resp.content))
            image = ImageOps.exif_transpose(image)
            image = self._center_crop(image, THUMB_RATIO)
            image = image.resize(
                (thumb_width, int(thumb_width / THUMB_RATIO)), Image.LANCZOS
            ).convert("RGB")

            buf = io.BytesIO()
            image.save(buf, format="JPEG", quality=80)
            self.r2.upload(
                buf.getvalue(),
                key,
                "image/jpeg",
                cache_control="max-age=31536000",
            )
            stats.thumb_generated += 1
            return self._public_url(key)
        except Exception as e:
            stats.thumb_failed += 1
            logger.warning("Thumbnail generation failed (%s): %s", work_id, e)
            return None

    def _center_crop(self, image: Image.Image, target_ratio: float) -> Image.Image:
        width, height = image.size
        current_ratio = width / height
        if current_ratio > target_ratio:
            new_width = int(height * target_ratio)
            left = (width - new_width) // 2
            box = (left, 0, left + new_width, height)
        else:
            new_height = int(width / target_ratio)
            top = (height - new_height) // 2
            box = (0, top, width, top + new_height)
        return image.crop(box)

    def _public_url(self, key: str) -> str:
        base = (self.config.r2.public_url or "").rstrip("/")
        return f"{base}/{key}"

    def _dump_json(self, payload: dict) -> str:
        import json

        return json.dumps(payload, ensure_ascii=False, indent=2)

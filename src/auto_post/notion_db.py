"""Notion database integration."""

import logging
from dataclasses import dataclass
from datetime import datetime

from notion_client import Client

logger = logging.getLogger(__name__)


@dataclass
class WorkItem:
    """Represents a work item from Notion database."""

    page_id: str
    work_name: str
    student_name: str | None
    image_urls: list[str]
    scheduled_date: datetime | None
    skip: bool
    caption: str | None
    tags: str | None
    ig_posted: bool
    ig_post_id: str | None
    x_posted: bool
    x_post_id: str | None


class NotionDB:
    """Notion database client."""

    def __init__(self, token: str, database_id: str):
        self.client = Client(auth=token)
        self.database_id = database_id

    def get_posts_for_date(self, target_date: datetime) -> list[WorkItem]:
        """Get posts scheduled for a specific date."""
        date_str = target_date.strftime("%Y-%m-%d")

        response = self.client.databases.query(
            database_id=self.database_id,
            filter={
                "and": [
                    {
                        "property": "投稿予定日",
                        "date": {"equals": date_str},
                    },
                    {
                        "or": [
                            {"property": "スキップ", "checkbox": {"equals": False}},
                            {"property": "スキップ", "checkbox": {"is_empty": True}},
                        ]
                    },
                    {
                        "or": [
                            {"property": "Instagram投稿済", "checkbox": {"equals": False}},
                            {"property": "X投稿済", "checkbox": {"equals": False}},
                        ]
                    },
                ]
            },
        )

        return [self._parse_page(page) for page in response["results"]]

    def _parse_page(self, page: dict) -> WorkItem:
        """Parse a Notion page into a WorkItem."""
        props = page["properties"]

        # Extract title (作品名)
        work_name = ""
        if props.get("作品名", {}).get("title"):
            work_name = props["作品名"]["title"][0]["plain_text"] if props["作品名"]["title"] else ""

        # Extract select (生徒名)
        student_name = None
        if props.get("生徒名", {}).get("select"):
            student_name = props["生徒名"]["select"]["name"]

        # Extract files (画像)
        image_urls = []
        if props.get("画像", {}).get("files"):
            for file in props["画像"]["files"]:
                if file["type"] == "external":
                    image_urls.append(file["external"]["url"])
                elif file["type"] == "file":
                    image_urls.append(file["file"]["url"])

        # Extract date (投稿予定日)
        scheduled_date = None
        if props.get("投稿予定日", {}).get("date"):
            date_obj = props["投稿予定日"]["date"]
            if date_obj and date_obj.get("start"):
                scheduled_date = datetime.fromisoformat(date_obj["start"])

        # Extract checkboxes
        skip = props.get("スキップ", {}).get("checkbox", False)
        ig_posted = props.get("Instagram投稿済", {}).get("checkbox", False)
        x_posted = props.get("X投稿済", {}).get("checkbox", False)

        # Extract rich text fields
        caption = self._get_rich_text(props, "キャプション")
        tags = self._get_rich_text(props, "タグ")
        ig_post_id = self._get_rich_text(props, "Instagram投稿ID")
        x_post_id = self._get_rich_text(props, "X投稿ID")

        return WorkItem(
            page_id=page["id"],
            work_name=work_name,
            student_name=student_name,
            image_urls=image_urls,
            scheduled_date=scheduled_date,
            skip=skip,
            caption=caption,
            tags=tags,
            ig_posted=ig_posted,
            ig_post_id=ig_post_id,
            x_posted=x_posted,
            x_post_id=x_post_id,
        )

    def _get_rich_text(self, props: dict, key: str) -> str | None:
        """Extract plain text from a rich_text property."""
        if props.get(key, {}).get("rich_text"):
            texts = props[key]["rich_text"]
            if texts:
                return "".join(t["plain_text"] for t in texts)
        return None

    def update_post_status(
        self,
        page_id: str,
        ig_posted: bool | None = None,
        ig_post_id: str | None = None,
        x_posted: bool | None = None,
        x_post_id: str | None = None,
        error_log: str | None = None,
    ):
        """Update the post status in Notion."""
        properties = {}

        if ig_posted is not None:
            properties["Instagram投稿済"] = {"checkbox": ig_posted}
        if ig_post_id is not None:
            properties["Instagram投稿ID"] = {"rich_text": [{"text": {"content": ig_post_id}}]}
        if x_posted is not None:
            properties["X投稿済"] = {"checkbox": x_posted}
        if x_post_id is not None:
            properties["X投稿ID"] = {"rich_text": [{"text": {"content": x_post_id}}]}
        if error_log is not None:
            # Append to existing error log
            page = self.client.pages.retrieve(page_id)
            current_log = self._get_rich_text(page["properties"], "エラーログ") or ""
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
            new_entry = f"{timestamp} | {error_log}"
            updated_log = f"{current_log}\n{new_entry}" if current_log else new_entry
            properties["エラーログ"] = {"rich_text": [{"text": {"content": updated_log[:2000]}}]}

        if properties:
            self.client.pages.update(page_id=page_id, properties=properties)
            logger.info(f"Updated Notion page: {page_id}")

    def add_work(
        self,
        work_name: str,
        image_urls: list[str],
        student_name: str | None = None,
        scheduled_date: datetime | None = None,
        tags: str | None = None,
    ) -> str:
        """Add a new work item to the database. Returns page ID."""
        properties = {
            "作品名": {"title": [{"text": {"content": work_name}}]},
            "画像": {
                "files": [{"type": "external", "name": f"image_{i+1}", "external": {"url": url}} for i, url in enumerate(image_urls)]
            },
        }

        if student_name:
            properties["生徒名"] = {"select": {"name": student_name}}
        if scheduled_date:
            properties["投稿予定日"] = {"date": {"start": scheduled_date.strftime("%Y-%m-%d")}}
        if tags:
            properties["タグ"] = {"rich_text": [{"text": {"content": tags}}]}

        response = self.client.pages.create(
            parent={"database_id": self.database_id},
            properties=properties,
        )

        logger.info(f"Created Notion page: {response['id']}")
        return response["id"]

    def list_works(self, filter_student: str | None = None, only_unposted: bool = False) -> list[WorkItem]:
        """List all work items, optionally filtered."""
        filters = []

        if filter_student:
            filters.append({"property": "生徒名", "select": {"equals": filter_student}})

        if only_unposted:
            filters.append({
                "or": [
                    {"property": "Instagram投稿済", "checkbox": {"equals": False}},
                    {"property": "X投稿済", "checkbox": {"equals": False}},
                ]
            })

        query_params = {"database_id": self.database_id}
        if filters:
            query_params["filter"] = {"and": filters} if len(filters) > 1 else filters[0]

        response = self.client.databases.query(**query_params)
        return [self._parse_page(page) for page in response["results"]]

    def get_database_info(self) -> dict:
        """Get database schema information."""
        return self.client.databases.retrieve(self.database_id)

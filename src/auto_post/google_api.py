"""Google Drive and Spreadsheet integration."""

import io
import json
import logging
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from .config import INSTAGRAM_MAX_CAROUSEL, Columns, GoogleConfig

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
]


@dataclass
class ImageFile:
    """Represents an image file from Google Drive."""

    id: str
    name: str
    mime_type: str
    created_time: datetime


@dataclass
class WorkFolder:
    """Represents a work folder containing images."""

    id: str
    name: str
    images: list[ImageFile]

    @property
    def image_count(self) -> int:
        return len(self.images)

    @property
    def first_photo_date(self) -> datetime | None:
        if not self.images:
            return None
        return min(img.created_time for img in self.images)


class GoogleAPI:
    """Google Drive and Spreadsheet API client."""

    def __init__(self, config: GoogleConfig):
        self.config = config
        self._credentials = None
        self._drive_service = None
        self._sheets_client = None

    @property
    def credentials(self) -> Credentials:
        if self._credentials is None:
            self._credentials = Credentials.from_service_account_file(
                str(self.config.credentials_path), scopes=SCOPES
            )
        return self._credentials

    @property
    def drive_service(self):
        if self._drive_service is None:
            self._drive_service = build("drive", "v3", credentials=self.credentials)
        return self._drive_service

    @property
    def sheets_client(self) -> gspread.Client:
        if self._sheets_client is None:
            self._sheets_client = gspread.authorize(self.credentials)
        return self._sheets_client

    def get_spreadsheet(self) -> gspread.Spreadsheet:
        """Get the management spreadsheet."""
        return self.sheets_client.open_by_key(self.config.spreadsheet_id)

    def get_main_sheet(self) -> gspread.Worksheet:
        """Get the main worksheet."""
        ss = self.get_spreadsheet()
        try:
            return ss.worksheet("メイン")
        except gspread.WorksheetNotFound:
            return ss.sheet1

    def list_folders(self, parent_folder_id: str | None = None) -> list[WorkFolder]:
        """List all work folders in the specified parent folder."""
        folder_id = parent_folder_id or self.config.drive_folder_id

        # List subfolders
        query = f"'{folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
        results = (
            self.drive_service.files()
            .list(q=query, fields="files(id, name)", orderBy="name")
            .execute()
        )

        folders = []
        for folder in results.get("files", []):
            images = self._list_images_in_folder(folder["id"])
            if images:  # Only include folders with images
                folders.append(
                    WorkFolder(id=folder["id"], name=folder["name"], images=images)
                )

        return folders

    def _list_images_in_folder(self, folder_id: str) -> list[ImageFile]:
        """List all image files in a folder."""
        query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false"
        results = (
            self.drive_service.files()
            .list(
                q=query,
                fields="files(id, name, mimeType, createdTime)",
                orderBy="name",
            )
            .execute()
        )

        images = []
        for file in results.get("files", []):
            created_time = datetime.fromisoformat(
                file["createdTime"].replace("Z", "+00:00")
            )
            images.append(
                ImageFile(
                    id=file["id"],
                    name=file["name"],
                    mime_type=file["mimeType"],
                    created_time=created_time,
                )
            )

        # Sort by name (handles 01_, 02_ prefixes)
        images.sort(key=lambda x: x.name)
        return images

    def download_image(self, file_id: str) -> tuple[bytes, str]:
        """Download an image file and return (content, mime_type)."""
        # Get file metadata
        file = (
            self.drive_service.files().get(fileId=file_id, fields="mimeType").execute()
        )
        mime_type = file["mimeType"]

        # Download content
        request = self.drive_service.files().get_media(fileId=file_id)
        buffer = io.BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)

        done = False
        while not done:
            _, done = downloader.next_chunk()

        return buffer.getvalue(), mime_type

    def scan_folders_to_spreadsheet(self, default_tags: str) -> int:
        """Scan folders and update the spreadsheet. Returns count of new rows added."""
        sheet = self.get_main_sheet()
        existing_data = sheet.get_all_values()

        # Get existing folder IDs
        existing_folder_ids = set()
        if len(existing_data) > 1:
            for row in existing_data[1:]:
                if row and row[Columns.FOLDER_ID]:
                    existing_folder_ids.add(row[Columns.FOLDER_ID])

        # Scan folders
        folders = self.list_folders()
        new_rows = []

        for folder in folders:
            if folder.id in existing_folder_ids:
                logger.debug(f"Skipping existing folder: {folder.name}")
                continue

            # Handle folders with more than 10 images (split into multiple rows)
            if folder.image_count > INSTAGRAM_MAX_CAROUSEL:
                chunks = [
                    folder.images[i : i + INSTAGRAM_MAX_CAROUSEL]
                    for i in range(0, folder.image_count, INSTAGRAM_MAX_CAROUSEL)
                ]
                for idx, chunk in enumerate(chunks):
                    suffix = f" ({idx + 1}/{len(chunks)})"
                    new_rows.append(
                        self._create_row(folder, default_tags, suffix, len(chunk))
                    )
            else:
                new_rows.append(self._create_row(folder, default_tags))

            logger.info(f"Added folder: {folder.name} ({folder.image_count} images)")

        # Append new rows
        if new_rows:
            sheet.append_rows(new_rows, value_input_option="USER_ENTERED")
            logger.info(f"Added {len(new_rows)} new rows to spreadsheet")

        return len(new_rows)

    def _create_row(
        self,
        folder: WorkFolder,
        default_tags: str,
        suffix: str = "",
        image_count: int | None = None,
    ) -> list:
        """Create a row for the spreadsheet."""
        folder_link = f'=HYPERLINK("https://drive.google.com/drive/folders/{folder.id}", "{folder.name}")'
        first_date = folder.first_photo_date

        return [
            folder.id,  # folder_id
            folder.name + suffix,  # folder_name
            folder_link,  # folder_link
            image_count or folder.image_count,  # image_count
            first_date.strftime("%Y-%m-%d %H:%M:%S") if first_date else "",  # first_photo_date
            "",  # work_name
            "",  # scheduled_date
            "",  # skip
            "",  # caption
            default_tags,  # tags
            "",  # instagram_posted
            "",  # instagram_post_id
            "",  # x_posted
            "",  # x_post_id
            "",  # error_log
        ]

    def get_posts_for_date(self, target_date: datetime) -> list[dict]:
        """Get posts scheduled for a specific date."""
        sheet = self.get_main_sheet()
        data = sheet.get_all_values()

        if len(data) <= 1:
            return []

        target_str = target_date.strftime("%Y-%m-%d")
        posts = []

        for row_idx, row in enumerate(data[1:], start=2):
            if len(row) <= Columns.SCHEDULED_DATE:
                continue

            scheduled = row[Columns.SCHEDULED_DATE]
            if not scheduled:
                continue

            # Check if date matches
            try:
                scheduled_date = datetime.strptime(scheduled.split()[0], "%Y-%m-%d")
                if scheduled_date.strftime("%Y-%m-%d") != target_str:
                    continue
            except ValueError:
                continue

            # Check skip flag
            skip = row[Columns.SKIP] if len(row) > Columns.SKIP else ""
            if skip.upper() == "TRUE":
                continue

            # Check if already posted
            ig_posted = row[Columns.IG_POSTED] if len(row) > Columns.IG_POSTED else ""
            x_posted = row[Columns.X_POSTED] if len(row) > Columns.X_POSTED else ""
            if ig_posted.upper() == "TRUE" and x_posted.upper() == "TRUE":
                continue

            posts.append(
                {
                    "row_idx": row_idx,
                    "folder_id": row[Columns.FOLDER_ID],
                    "folder_name": row[Columns.FOLDER_NAME],
                    "work_name": row[Columns.WORK_NAME] if len(row) > Columns.WORK_NAME else "",
                    "caption": row[Columns.CAPTION] if len(row) > Columns.CAPTION else "",
                    "tags": row[Columns.TAGS] if len(row) > Columns.TAGS else "",
                    "ig_posted": ig_posted.upper() == "TRUE",
                    "x_posted": x_posted.upper() == "TRUE",
                }
            )

        return posts

    def update_post_status(
        self,
        row_idx: int,
        ig_posted: bool | None = None,
        ig_post_id: str | None = None,
        x_posted: bool | None = None,
        x_post_id: str | None = None,
        error_log: str | None = None,
    ):
        """Update the post status in the spreadsheet."""
        sheet = self.get_main_sheet()

        if ig_posted is not None:
            sheet.update_cell(row_idx, Columns.IG_POSTED + 1, "TRUE" if ig_posted else "")
        if ig_post_id is not None:
            sheet.update_cell(row_idx, Columns.IG_POST_ID + 1, ig_post_id)
        if x_posted is not None:
            sheet.update_cell(row_idx, Columns.X_POSTED + 1, "TRUE" if x_posted else "")
        if x_post_id is not None:
            sheet.update_cell(row_idx, Columns.X_POST_ID + 1, x_post_id)
        if error_log is not None:
            # Append to existing error log
            current = sheet.cell(row_idx, Columns.ERROR_LOG + 1).value or ""
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
            new_log = f"{timestamp} | {error_log}"
            updated = f"{current}\n{new_log}" if current else new_log
            sheet.update_cell(row_idx, Columns.ERROR_LOG + 1, updated)

    def setup_spreadsheet(self, default_tags: str):
        """Initialize the spreadsheet with headers."""
        ss = self.get_spreadsheet()

        # Create or get main sheet
        try:
            sheet = ss.worksheet("メイン")
        except gspread.WorksheetNotFound:
            sheet = ss.add_worksheet(title="メイン", rows=1000, cols=20)

        # Check if headers exist
        existing = sheet.row_values(1)
        if existing and existing[0] == "folder_id":
            logger.info("Headers already exist")
            return

        # Set headers
        headers = [
            "folder_id",
            "folder_name",
            "folder_link",
            "image_count",
            "first_photo_date",
            "work_name",
            "scheduled_date",
            "skip",
            "caption",
            "tags",
            "instagram_posted",
            "instagram_post_id",
            "x_posted",
            "x_post_id",
            "error_log",
        ]
        sheet.update("A1:O1", [headers])
        sheet.format("A1:O1", {"textFormat": {"bold": True}})
        sheet.freeze(rows=1)

        logger.info("Spreadsheet headers initialized")

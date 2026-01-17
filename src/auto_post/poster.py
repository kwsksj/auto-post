"""Main posting logic."""

import logging
import time
from datetime import datetime

from .config import Config
from .google_api import GoogleAPI
from .instagram import InstagramClient, InstagramAPIError
from .r2_storage import R2Storage
from .x_twitter import XClient, XAPIError

logger = logging.getLogger(__name__)


def generate_caption(work_name: str, custom_caption: str, tags: str, default_tags: str) -> str:
    """Generate caption from work name and tags."""
    caption = ""

    if custom_caption and custom_caption.strip():
        caption = custom_caption.strip()
    elif work_name and work_name.strip():
        caption = f"{work_name.strip()}の木彫りです！"

    final_tags = tags.strip() if tags and tags.strip() else default_tags

    if caption:
        return f"{caption}\n\n{final_tags}"
    return final_tags


class Poster:
    """Main posting orchestrator."""

    def __init__(self, config: Config):
        self.config = config
        self.google = GoogleAPI(config.google)
        self.r2 = R2Storage(config.r2)
        self.instagram = InstagramClient(config.instagram)
        self.x = XClient(config.x)

    def run_daily_post(self, target_date: datetime | None = None) -> dict:
        """
        Run the daily posting job.

        Returns:
            dict with 'processed', 'ig_success', 'x_success', 'errors' counts
        """
        if target_date is None:
            target_date = datetime.now()

        logger.info(f"Starting daily post for {target_date.strftime('%Y-%m-%d')}")

        # Get posts scheduled for today
        posts = self.google.get_posts_for_date(target_date)
        logger.info(f"Found {len(posts)} posts scheduled for today")

        stats = {"processed": 0, "ig_success": 0, "x_success": 0, "errors": 0}

        for post in posts:
            try:
                self._process_post(post, stats)
                stats["processed"] += 1
                time.sleep(2)  # Rate limit between posts
            except Exception as e:
                logger.error(f"Failed to process post {post['folder_name']}: {e}")
                stats["errors"] += 1
                self.google.update_post_status(
                    post["row_idx"], error_log=f"Processing error: {e}"
                )

        logger.info(
            f"Daily post complete: {stats['processed']} processed, "
            f"{stats['ig_success']} IG, {stats['x_success']} X, {stats['errors']} errors"
        )

        return stats

    def _process_post(self, post: dict, stats: dict):
        """Process a single post."""
        folder_id = post["folder_id"]
        row_idx = post["row_idx"]

        logger.info(f"Processing: {post['folder_name']}")

        # Generate caption
        caption = generate_caption(
            post["work_name"],
            post["caption"],
            post["tags"],
            self.config.default_tags,
        )

        # Get images from folder
        folders = self.google.list_folders()
        folder = next((f for f in folders if f.id == folder_id), None)

        if folder is None:
            raise ValueError(f"Folder not found: {folder_id}")

        if not folder.images:
            raise ValueError(f"No images in folder: {folder_id}")

        # Download images
        images_data = []
        for img in folder.images:
            content, mime_type = self.google.download_image(img.id)
            images_data.append((content, img.name, mime_type))
            logger.debug(f"Downloaded: {img.name}")

        # Post to Instagram (if not already posted)
        if not post["ig_posted"]:
            try:
                ig_post_id = self._post_to_instagram(images_data, caption)
                self.google.update_post_status(
                    row_idx, ig_posted=True, ig_post_id=ig_post_id
                )
                stats["ig_success"] += 1
                logger.info(f"Instagram posted: {ig_post_id}")
            except InstagramAPIError as e:
                logger.error(f"Instagram error: {e}")
                self.google.update_post_status(row_idx, error_log=f"Instagram: {e}")
                stats["errors"] += 1

        # Post to X (if not already posted)
        if not post["x_posted"]:
            try:
                x_post_id = self._post_to_x(images_data, caption)
                self.google.update_post_status(
                    row_idx, x_posted=True, x_post_id=x_post_id
                )
                stats["x_success"] += 1
                logger.info(f"X posted: {x_post_id}")
            except XAPIError as e:
                logger.error(f"X error: {e}")
                self.google.update_post_status(row_idx, error_log=f"X: {e}")
                stats["errors"] += 1

    def _post_to_instagram(
        self, images_data: list[tuple[bytes, str, str]], caption: str
    ) -> str:
        """Post images to Instagram."""
        # Upload images to R2 and get presigned URLs
        r2_keys = []
        image_urls = []

        try:
            for content, filename, mime_type in images_data:
                key, url = self.r2.upload_and_get_url(content, filename, mime_type)
                r2_keys.append(key)
                image_urls.append(url)

            # Post to Instagram
            if len(image_urls) == 1:
                return self.instagram.post_single_image(image_urls[0], caption)
            else:
                return self.instagram.post_carousel(image_urls, caption)

        finally:
            # Clean up R2 files
            for key in r2_keys:
                try:
                    self.r2.delete(key)
                except Exception as e:
                    logger.warning(f"Failed to delete R2 file {key}: {e}")

    def _post_to_x(
        self, images_data: list[tuple[bytes, str, str]], caption: str
    ) -> str:
        """Post images to X."""
        # X accepts direct uploads, no need for R2
        image_contents = [(content, filename) for content, filename, _ in images_data]
        return self.x.post_with_images(caption, image_contents)

    def scan_folders(self) -> int:
        """Scan folders and update spreadsheet. Returns count of new rows."""
        return self.google.scan_folders_to_spreadsheet(self.config.default_tags)

    def setup_spreadsheet(self):
        """Initialize the spreadsheet with headers."""
        self.google.setup_spreadsheet(self.config.default_tags)

    def test_post(self, folder_id: str, platform: str = "both") -> dict:
        """
        Test post a specific folder.

        Args:
            folder_id: Google Drive folder ID
            platform: 'instagram', 'x', or 'both'

        Returns:
            dict with post IDs
        """
        # Get folder info
        folders = self.google.list_folders()
        folder = next((f for f in folders if f.id == folder_id), None)

        if folder is None:
            raise ValueError(f"Folder not found: {folder_id}")

        # Download images
        images_data = []
        for img in folder.images:
            content, mime_type = self.google.download_image(img.id)
            images_data.append((content, img.name, mime_type))

        caption = generate_caption(
            folder.name, "", self.config.default_tags, self.config.default_tags
        )

        result = {}

        if platform in ("instagram", "both"):
            ig_post_id = self._post_to_instagram(images_data, caption)
            result["instagram_post_id"] = ig_post_id

        if platform in ("x", "both"):
            x_post_id = self._post_to_x(images_data, caption)
            result["x_post_id"] = x_post_id

        return result

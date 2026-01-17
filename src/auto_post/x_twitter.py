"""X (Twitter) API integration using tweepy."""

import logging
import time

import tweepy

from .config import X_MAX_IMAGES, XConfig

logger = logging.getLogger(__name__)


class XAPIError(Exception):
    """X API error."""

    pass


class XClient:
    """X (Twitter) API client using tweepy."""

    def __init__(self, config: XConfig):
        self.config = config
        self._client = None
        self._api = None

    @property
    def client(self) -> tweepy.Client:
        """Get tweepy Client (v2 API)."""
        if self._client is None:
            self._client = tweepy.Client(
                consumer_key=self.config.api_key,
                consumer_secret=self.config.api_key_secret,
                access_token=self.config.access_token,
                access_token_secret=self.config.access_token_secret,
            )
        return self._client

    @property
    def api(self) -> tweepy.API:
        """Get tweepy API (v1.1 API for media upload)."""
        if self._api is None:
            auth = tweepy.OAuth1UserHandler(
                consumer_key=self.config.api_key,
                consumer_secret=self.config.api_key_secret,
                access_token=self.config.access_token,
                access_token_secret=self.config.access_token_secret,
            )
            self._api = tweepy.API(auth)
        return self._api

    def upload_media(self, content: bytes, filename: str) -> str:
        """Upload media and return media_id."""
        # tweepy requires a file-like object
        import io

        media = self.api.media_upload(filename=filename, file=io.BytesIO(content))
        logger.info(f"Uploaded media: {media.media_id_string}")
        return media.media_id_string

    def post_with_images(self, text: str, image_contents: list[tuple[bytes, str]]) -> str:
        """
        Post a tweet with images.

        Args:
            text: Tweet text
            image_contents: List of (content_bytes, filename) tuples

        Returns:
            Tweet ID
        """
        # X allows max 4 images per tweet
        images_to_post = image_contents[:X_MAX_IMAGES]

        if len(image_contents) > X_MAX_IMAGES:
            logger.warning(
                f"X only allows {X_MAX_IMAGES} images per tweet, "
                f"posting first {X_MAX_IMAGES} of {len(image_contents)}"
            )

        # Upload images
        media_ids = []
        for content, filename in images_to_post:
            media_id = self.upload_media(content, filename)
            media_ids.append(media_id)
            time.sleep(0.5)  # Rate limit

        # Post tweet
        try:
            response = self.client.create_tweet(text=text, media_ids=media_ids)
            tweet_id = response.data["id"]
            logger.info(f"Posted tweet: {tweet_id}")
            return tweet_id
        except tweepy.TweepyException as e:
            raise XAPIError(f"Failed to post tweet: {e}") from e

    def post_text_only(self, text: str) -> str:
        """Post a text-only tweet."""
        try:
            response = self.client.create_tweet(text=text)
            tweet_id = response.data["id"]
            logger.info(f"Posted tweet: {tweet_id}")
            return tweet_id
        except tweepy.TweepyException as e:
            raise XAPIError(f"Failed to post tweet: {e}") from e

"""Configuration management."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


@dataclass
class InstagramConfig:
    """Instagram API configuration."""

    app_id: str
    app_secret: str
    access_token: str
    business_account_id: str

    @classmethod
    def from_env(cls) -> "InstagramConfig":
        return cls(
            app_id=os.environ["INSTAGRAM_APP_ID"],
            app_secret=os.environ["INSTAGRAM_APP_SECRET"],
            access_token=os.environ["INSTAGRAM_ACCESS_TOKEN"],
            business_account_id=os.environ.get(
                "INSTAGRAM_BUSINESS_ACCOUNT_ID", "17841422021372550"
            ),
        )


@dataclass
class XConfig:
    """X (Twitter) API configuration."""

    api_key: str
    api_key_secret: str
    access_token: str
    access_token_secret: str

    @classmethod
    def from_env(cls) -> "XConfig":
        return cls(
            api_key=os.environ["X_API_KEY"],
            api_key_secret=os.environ["X_API_KEY_SECRET"],
            access_token=os.environ["X_ACCESS_TOKEN"],
            access_token_secret=os.environ["X_ACCESS_TOKEN_SECRET"],
        )


@dataclass
class R2Config:
    """Cloudflare R2 configuration."""

    account_id: str
    access_key_id: str
    secret_access_key: str
    bucket_name: str

    @classmethod
    def from_env(cls) -> "R2Config":
        return cls(
            account_id=os.environ["R2_ACCOUNT_ID"],
            access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            bucket_name=os.environ.get("R2_BUCKET_NAME", "instagram-temp"),
        )

    @property
    def endpoint_url(self) -> str:
        return f"https://{self.account_id}.r2.cloudflarestorage.com"


@dataclass
class GoogleConfig:
    """Google API configuration."""

    credentials_path: Path
    spreadsheet_id: str
    drive_folder_id: str

    @classmethod
    def from_env(cls) -> "GoogleConfig":
        return cls(
            credentials_path=Path(
                os.environ.get("GOOGLE_CREDENTIALS_PATH", "credentials.json")
            ),
            spreadsheet_id=os.environ["GOOGLE_SPREADSHEET_ID"],
            drive_folder_id=os.environ["GOOGLE_DRIVE_FOLDER_ID"],
        )


@dataclass
class Config:
    """Application configuration."""

    instagram: InstagramConfig
    x: XConfig
    r2: R2Config
    google: GoogleConfig
    notification_email: str | None
    grouping_threshold_minutes: int
    default_tags: str

    @classmethod
    def load(cls, env_file: Path | None = None) -> "Config":
        """Load configuration from environment variables."""
        if env_file:
            load_dotenv(env_file)
        else:
            load_dotenv()

        return cls(
            instagram=InstagramConfig.from_env(),
            x=XConfig.from_env(),
            r2=R2Config.from_env(),
            google=GoogleConfig.from_env(),
            notification_email=os.environ.get("NOTIFICATION_EMAIL"),
            grouping_threshold_minutes=int(
                os.environ.get("GROUPING_THRESHOLD_MINUTES", "10")
            ),
            default_tags=os.environ.get(
                "DEFAULT_TAGS",
                "#木彫り教室生徒作品 #木彫り #woodcarving #彫刻 #handcarved #woodart #ハンドメイド #手仕事",
            ),
        )


# Constants
INSTAGRAM_MAX_CAROUSEL = 10
X_MAX_IMAGES = 4

# Spreadsheet column indices (0-based)
class Columns:
    FOLDER_ID = 0
    FOLDER_NAME = 1
    FOLDER_LINK = 2
    IMAGE_COUNT = 3
    FIRST_PHOTO_DATE = 4
    WORK_NAME = 5
    SCHEDULED_DATE = 6
    SKIP = 7
    CAPTION = 8
    TAGS = 9
    IG_POSTED = 10
    IG_POST_ID = 11
    X_POSTED = 12
    X_POST_ID = 13
    ERROR_LOG = 14

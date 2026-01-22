"""Token Management Logic."""

import logging
from datetime import datetime, timedelta

import requests

from .config import InstagramConfig
from .r2_storage import R2Storage

logger = logging.getLogger(__name__)

TOKEN_FILE_KEY = "config/instagram_token.json"
EXPIRY_THRESHOLD_DAYS = 20  # Refresh if less than 20 days remain


class TokenManager:
    """
    Manages Instagram Access Token lifecycle.
    Persists token in R2 storage.
    """

    def __init__(self, r2_storage: R2Storage, config: InstagramConfig):
        self.r2 = r2_storage
        self.config = config

    def get_valid_token(self) -> str:
        """
        Get a valid access token.
        1. Check R2 for stored token.
        2. If invalid/missing, use Env token.
        3. Check expiry and refresh if needed.
        4. Return the valid string.
        """
        stored_data = self.r2.get_json(TOKEN_FILE_KEY)

        token = self.config.access_token # Default from env
        expires_at = None

        if stored_data:
            logger.info("Loaded token from R2 storage")
            token = stored_data.get("access_token", token)
            expires_at_str = stored_data.get("expires_at")
            if expires_at_str:
                expires_at = datetime.fromisoformat(expires_at_str)

        # If we don't know expiry (e.g. from env), we should probably fetch it or force refresh?
        # But Graph API debug_token endpoint requires a token to check itself.

        # Let's check expiry via API if not known, or if known check against threshold
        remaining_days = self._check_expiry(token, expires_at)

        if remaining_days is not None and remaining_days < EXPIRY_THRESHOLD_DAYS:
            logger.warning(f"Token expires in {remaining_days:.1f} days. Refreshing...")
            new_token, new_expires_in = self._refresh_token(token)
            if new_token:
                self._save_token(new_token, new_expires_in)
                return new_token
            else:
                logger.error("Failed to refresh token. Using old token.")

        return token

    def _check_expiry(self, token: str, known_expires_at: datetime | None) -> float | None:
        """
        Check remaining days.
        If known_expires_at is None, query API to get debug info.
        """
        if known_expires_at:
            delta = known_expires_at - datetime.now()
            return delta.days + (delta.seconds / 86400)

        # Query API for expiry
        # GET https://graph.facebook.com/debug_token?input_token={token}&access_token={token}
        try:
            url = "https://graph.facebook.com/v19.0/debug_token"
            params = {
                "input_token": token,
                "access_token": token # debug_token endpoint uses the token itself for auth usually, or app token
            }
            resp = requests.get(url, params=params, timeout=10)
            data = resp.json()

            if "data" in data and "expires_at" in data["data"]:
                # expires_at is unix timestamp
                ts = data["data"]["expires_at"]
                if ts == 0: # Never expires?
                    return 999
                expires_at = datetime.fromtimestamp(ts)

                # Save it so we don't query every time?
                # Actually, if we are here, it means we didn't have it in R2.
                # We should save it to R2 now to avoid API calls next time.
                self._save_token(token, ts - int(datetime.now().timestamp()))

                delta = expires_at - datetime.now()
                return delta.days

            return None
        except Exception as e:
            logger.warning(f"Failed to check token expiry: {e}")
            return None

    def _refresh_token(self, current_token: str) -> tuple[str | None, int | None]:
        """
        Refresh the long-lived token.
        GET https://graph.facebook.com/v19.0/oauth/access_token?
            grant_type=fb_exchange_token&
            client_id={app-id}&
            client_secret={app-secret}&
            fb_exchange_token={current-token}
        """
        try:
            url = "https://graph.facebook.com/v19.0/oauth/access_token"
            params = {
                "grant_type": "fb_exchange_token",
                "client_id": self.config.app_id,
                "client_secret": self.config.app_secret,
                "fb_exchange_token": current_token
            }
            resp = requests.get(url, params=params, timeout=10)
            resp.raise_for_status()
            data = resp.json()

            new_token = data.get("access_token")
            expires_in = data.get("expires_in") # Seconds

            return new_token, expires_in
        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return None, None

    def _save_token(self, token: str, expires_in_seconds: int):
        """Save token and calculated expiry to R2."""
        expires_at = datetime.now() + timedelta(seconds=expires_in_seconds)
        data = {
            "access_token": token,
            "expires_at": expires_at.isoformat(),
            "updated_at": datetime.now().isoformat()
        }
        self.r2.put_json(data, TOKEN_FILE_KEY)
        logger.info(f"Token saved to R2. Expires at: {expires_at}")

    def force_refresh(self) -> str | None:
        """Force a token refresh and save to R2."""
        token = self.get_valid_token() # Load current valid one first
        new_token, expires_in = self._refresh_token(token)
        if new_token:
            self._save_token(new_token, expires_in)
            return new_token
        return None

"""Command-line interface."""

import logging
import sys
from datetime import datetime
from pathlib import Path

import click

from .config import Config
from .poster import Poster

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


@click.group()
@click.option(
    "--env-file",
    type=click.Path(exists=True, path_type=Path),
    help="Path to .env file",
)
@click.option("--debug/--no-debug", default=False, help="Enable debug logging")
@click.pass_context
def main(ctx, env_file: Path | None, debug: bool):
    """Instagram/X auto-posting system for woodcarving class photos."""
    if debug:
        logging.getLogger().setLevel(logging.DEBUG)

    ctx.ensure_object(dict)
    ctx.obj["env_file"] = env_file


@main.command()
@click.pass_context
def setup(ctx):
    """Initialize the spreadsheet with headers."""
    config = Config.load(ctx.obj.get("env_file"))
    poster = Poster(config)
    poster.setup_spreadsheet()
    click.echo("Spreadsheet initialized successfully")


@main.command()
@click.pass_context
def scan(ctx):
    """Scan Google Drive folders and update spreadsheet."""
    config = Config.load(ctx.obj.get("env_file"))
    poster = Poster(config)
    count = poster.scan_folders()
    click.echo(f"Added {count} new folders to spreadsheet")


@main.command()
@click.option("--date", type=click.DateTime(formats=["%Y-%m-%d"]), help="Target date (default: today)")
@click.pass_context
def post(ctx, date: datetime | None):
    """Run the daily posting job."""
    config = Config.load(ctx.obj.get("env_file"))
    poster = Poster(config)

    target_date = date or datetime.now()
    stats = poster.run_daily_post(target_date)

    click.echo(f"Processed: {stats['processed']}")
    click.echo(f"Instagram success: {stats['ig_success']}")
    click.echo(f"X success: {stats['x_success']}")
    click.echo(f"Errors: {stats['errors']}")

    if stats["errors"] > 0:
        sys.exit(1)


@main.command()
@click.argument("folder_id")
@click.option(
    "--platform",
    type=click.Choice(["instagram", "x", "both"]),
    default="both",
    help="Platform to post to",
)
@click.pass_context
def test_post(ctx, folder_id: str, platform: str):
    """Test post a specific folder."""
    config = Config.load(ctx.obj.get("env_file"))
    poster = Poster(config)

    result = poster.test_post(folder_id, platform)

    if "instagram_post_id" in result:
        click.echo(f"Instagram post ID: {result['instagram_post_id']}")
    if "x_post_id" in result:
        click.echo(f"X post ID: {result['x_post_id']}")


@main.command()
@click.pass_context
def refresh_token(ctx):
    """Refresh the Instagram access token."""
    config = Config.load(ctx.obj.get("env_file"))
    from .instagram import InstagramClient

    client = InstagramClient(config.instagram)
    new_token, expiry = client.refresh_token()

    click.echo(f"New token: {new_token[:20]}...")
    click.echo(f"Expiry: {expiry.strftime('%Y-%m-%d')}")
    click.echo("\nPlease update INSTAGRAM_ACCESS_TOKEN in your .env file or GitHub secrets")


@main.command()
@click.pass_context
def list_folders(ctx):
    """List all work folders in Google Drive."""
    config = Config.load(ctx.obj.get("env_file"))
    from .google_api import GoogleAPI

    google = GoogleAPI(config.google)
    folders = google.list_folders()

    click.echo(f"Found {len(folders)} folders:\n")
    for folder in folders:
        click.echo(f"  {folder.name} ({folder.image_count} images)")
        click.echo(f"    ID: {folder.id}")
        if folder.first_photo_date:
            click.echo(f"    First photo: {folder.first_photo_date.strftime('%Y-%m-%d %H:%M')}")
        click.echo()


if __name__ == "__main__":
    main()

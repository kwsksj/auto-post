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
@click.argument("page_id")
@click.option(
    "--platform",
    type=click.Choice(["instagram", "x", "both"]),
    default="both",
    help="Platform to post to",
)
@click.pass_context
def test_post(ctx, page_id: str, platform: str):
    """Test post a specific Notion page."""
    config = Config.load(ctx.obj.get("env_file"))
    poster = Poster(config)

    result = poster.test_post(page_id, platform)

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
@click.option("--student", help="Filter by student name")
@click.option("--unposted", is_flag=True, help="Show only unposted items")
@click.pass_context
def list_works(ctx, student: str | None, unposted: bool):
    """List all work items from Notion."""
    config = Config.load(ctx.obj.get("env_file"))
    poster = Poster(config)

    works = poster.list_works(student=student, only_unposted=unposted)

    click.echo(f"Found {len(works)} works:\n")
    for work in works:
        status = []
        if work.ig_posted:
            status.append("IG")
        if work.x_posted:
            status.append("X")
        status_str = f" [{','.join(status)}]" if status else ""

        click.echo(f"  {work.work_name}{status_str}")
        click.echo(f"    Page ID: {work.page_id}")
        if work.student_name:
            click.echo(f"    Student: {work.student_name}")
        if work.scheduled_date:
            click.echo(f"    Scheduled: {work.scheduled_date.strftime('%Y-%m-%d')}")
        click.echo(f"    Images: {len(work.image_urls)}")
        click.echo()


@main.command()
@click.pass_context
def check_notion(ctx):
    """Check Notion database connection and schema."""
    config = Config.load(ctx.obj.get("env_file"))
    from .notion_db import NotionDB

    notion = NotionDB(config.notion.token, config.notion.database_id)

    try:
        info = notion.get_database_info()
        click.echo(f"Database: {info['title'][0]['plain_text'] if info.get('title') else 'Untitled'}")
        click.echo(f"ID: {info['id']}")
        click.echo("\nProperties:")
        for name, prop in info.get("properties", {}).items():
            click.echo(f"  - {name} ({prop['type']})")
    except Exception as e:
        click.echo(f"Error connecting to Notion: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    main()

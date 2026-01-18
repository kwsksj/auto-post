"""Tests for poster module."""

import pytest

from auto_post.poster import generate_caption


class TestGenerateCaption:
    """Tests for generate_caption function."""

    def test_with_work_name(self):
        """Test caption generation with work name."""
        result = generate_caption(
            work_name="ふくろう",
            custom_caption=None,
            tags=None,
            default_tags="#tag1 #tag2",
        )
        assert result == "ふくろうの木彫りです！\n\n#tag1 #tag2"

    def test_with_custom_caption(self):
        """Test that custom caption takes precedence."""
        result = generate_caption(
            work_name="ふくろう",
            custom_caption="カスタムキャプション",
            tags="#custom",
            default_tags="#tag1 #tag2",
        )
        assert result == "カスタムキャプション\n\n#custom"

    def test_with_custom_tags(self):
        """Test custom tags override default."""
        result = generate_caption(
            work_name="ねこ",
            custom_caption=None,
            tags="#猫 #cat",
            default_tags="#tag1 #tag2",
        )
        assert result == "ねこの木彫りです！\n\n#猫 #cat"

    def test_empty_work_name(self):
        """Test with empty work name returns only tags."""
        result = generate_caption(
            work_name="",
            custom_caption=None,
            tags=None,
            default_tags="#tag1 #tag2",
        )
        assert result == "#tag1 #tag2"

    def test_whitespace_handling(self):
        """Test whitespace is trimmed."""
        result = generate_caption(
            work_name="  いぬ  ",
            custom_caption=None,
            tags="  #dog  ",
            default_tags="#tag1",
        )
        assert result == "いぬの木彫りです！\n\n#dog"

    def test_none_values(self):
        """Test with None values."""
        result = generate_caption(
            work_name="くま",
            custom_caption=None,
            tags=None,
            default_tags="#default",
        )
        assert result == "くまの木彫りです！\n\n#default"

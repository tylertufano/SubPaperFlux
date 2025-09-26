from app.jobs.validation import validate_job


def test_rss_poll_allows_missing_instapaper():
    result = validate_job("rss_poll", {"feed_id": "feed-123"})
    assert result["ok"] is True
    assert result["missing"] == []


def test_rss_poll_requires_feed_id():
    result = validate_job("rss_poll", {})
    assert result["ok"] is False
    assert "feed_id" in result["missing"]


def test_publish_requires_feed_and_instapaper():
    missing_feed = validate_job("publish", {"instapaper_id": "insta-1"})
    assert missing_feed["ok"] is False
    assert "feed_id" in missing_feed["missing"]

    missing_instapaper = validate_job("publish", {"feed_id": "feed-1"})
    assert missing_instapaper["ok"] is False
    assert "instapaper_id" in missing_instapaper["missing"]

    valid = validate_job(
        "publish",
        {"feed_id": "feed-1", "instapaper_id": "insta-1"},
    )
    assert valid["ok"] is True

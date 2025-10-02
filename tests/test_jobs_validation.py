from app.jobs.validation import validate_job


def test_rss_poll_allows_missing_instapaper():
    result = validate_job("rss_poll", {"feed_id": "feed-123"})
    assert result["ok"] is True
    assert result["missing"] == []


def test_rss_poll_requires_feed_id():
    result = validate_job("rss_poll", {})
    assert result["ok"] is False
    assert "feed_id" in result["missing"]


def test_publish_requires_instapaper_allows_missing_feed():
    missing_instapaper = validate_job("publish", {"feed_id": "feed-1"})
    assert missing_instapaper["ok"] is False
    assert "instapaper_id" in missing_instapaper["missing"]

    instapaper_only = validate_job("publish", {"instapaper_id": "insta-1"})
    assert instapaper_only["ok"] is True

    blank_feed = validate_job(
        "publish",
        {"feed_id": "", "instapaper_id": "insta-1"},
    )
    assert blank_feed["ok"] is True

from app.jobs.validation import validate_job


def test_rss_poll_allows_missing_instapaper():
    result = validate_job("rss_poll", {"feed_id": "feed-123"})
    assert result["ok"] is True
    assert result["missing"] == []


def test_rss_poll_requires_feed_id():
    result = validate_job("rss_poll", {})
    assert result["ok"] is False
    assert "feed_id" in result["missing"]

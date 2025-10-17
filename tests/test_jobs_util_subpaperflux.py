from app.jobs import util_subpaperflux as spf_util


def test_ensure_default_api_user_agent_adds_header_when_missing():
    payload: dict = {}

    spf_util._ensure_default_api_user_agent(payload)

    headers = payload.get("headers") or {}
    assert headers.get("User-Agent") == spf_util._DEFAULT_API_LOGIN_USER_AGENT


def test_ensure_default_api_user_agent_preserves_existing_header():
    payload = {"headers": {"user-agent": "CustomAgent/1.0"}}

    spf_util._ensure_default_api_user_agent(payload)

    headers = payload.get("headers") or {}
    assert headers.get("user-agent") == "CustomAgent/1.0"
    # Ensure we did not inject a duplicate header with different casing.
    assert [key.lower() for key in headers] == ["user-agent"]

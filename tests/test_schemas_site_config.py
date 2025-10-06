import pytest
from pydantic import TypeAdapter, ValidationError

from app.schemas import (
    ApiConfig,
    SeleniumConfig,
    SiteConfig,
    SiteConfigApiOut,
    SiteConfigSeleniumOut,
)


site_config_adapter = TypeAdapter(SiteConfig)


def test_site_config_selenium_requires_config_block():
    with pytest.raises(ValidationError) as exc:
        site_config_adapter.validate_python(
            {
                "name": "Example",
                "site_url": "https://example.com",
                "login_type": "selenium",
            }
        )
    assert "selenium_config" in str(exc.value)


def test_site_config_selenium_requires_selectors():
    with pytest.raises(ValidationError) as exc:
        site_config_adapter.validate_python(
            {
                "name": "Example",
                "site_url": "https://example.com",
                "login_type": "selenium",
                "selenium_config": {
                    "username_selector": "#user",
                    "password_selector": "#pass",
                },
            }
        )
    assert "login_button_selector" in str(exc.value)


def test_site_config_api_requires_config_block():
    with pytest.raises(ValidationError) as exc:
        site_config_adapter.validate_python(
            {
                "name": "Example",
                "site_url": "https://example.com",
                "login_type": "api",
            }
        )
    assert "api_config" in str(exc.value)


def test_site_config_api_requires_endpoint_and_method():
    with pytest.raises(ValidationError) as exc:
        site_config_adapter.validate_python(
            {
                "name": "Example",
                "site_url": "https://example.com",
                "login_type": "api",
                "api_config": {
                    "endpoint": "https://example.com/api",
                },
            }
        )
    assert "method" in str(exc.value)


def test_site_config_serialization_excludes_unrelated_config():
    selenium = SiteConfigSeleniumOut(
        id="abc",
        name="Example",
        site_url="https://example.com",
        owner_user_id="user-123",
        selenium_config=SeleniumConfig(
            username_selector="#user",
            password_selector="#pass",
            login_button_selector="#login",
        ),
    )
    selenium_dump = selenium.model_dump()
    assert "api_config" not in selenium_dump
    assert "selenium_config" in selenium_dump

    api = SiteConfigApiOut(
        id="def",
        name="Example API",
        site_url="https://example.com",
        owner_user_id="user-1",
        api_config=ApiConfig(
            endpoint="https://example.com/api",
            method="POST",
        ),
    )
    api_dump = api.model_dump()
    assert "selenium_config" not in api_dump
    assert "api_config" in api_dump

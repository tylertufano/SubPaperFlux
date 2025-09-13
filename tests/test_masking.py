from app.routers.credentials import _mask_value, _mask_credential


def test_mask_value():
    assert _mask_value("") == ""
    assert _mask_value("ab") == "****"
    out = _mask_value("abcdef")
    assert out.startswith("ab") and out.endswith("ef")


def test_mask_credential():
    data = {
        "username": "u",
        "password": "p@ssw0rd",
        "oauth_token": "tok12345",
        "oauth_token_secret": "sec12345",
        "consumer_secret": "csec",
        "api_key": "k12345",
    }
    masked = _mask_credential("site_login", data)
    assert masked["password"] != data["password"]
    masked2 = _mask_credential("instapaper", data)
    assert masked2["oauth_token"] != data["oauth_token"]
    assert masked2["oauth_token_secret"] != data["oauth_token_secret"]
    masked3 = _mask_credential("miniflux", data)
    assert masked3["api_key"] != data["api_key"]


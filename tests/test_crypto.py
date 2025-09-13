import os
import base64

from app.security.crypto import encrypt_dict, decrypt_dict, is_encrypted


def test_encrypt_decrypt_roundtrip(monkeypatch):
    key = base64.urlsafe_b64encode(os.urandom(32)).decode()
    monkeypatch.setenv("CREDENTIALS_ENC_KEY", key)
    data = {"a": 1, "b": "secret"}
    enc = encrypt_dict(data)
    assert is_encrypted(enc)
    dec = decrypt_dict(enc)
    assert dec == data


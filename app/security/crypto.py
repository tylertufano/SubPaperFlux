import os
import json
import base64
from typing import Any, Dict, Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_key() -> bytes:
    key_b64 = os.getenv("CREDENTIALS_ENC_KEY")
    if not key_b64:
        raise RuntimeError("CREDENTIALS_ENC_KEY is not set. Unable to encrypt/decrypt credentials.")
    try:
        # Accept raw 32-byte base64 urlsafe string
        return base64.urlsafe_b64decode(key_b64)
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("CREDENTIALS_ENC_KEY must be a base64-urlsafe encoded 32-byte key.") from e


def is_encrypted(data: Dict[str, Any]) -> bool:
    return isinstance(data, dict) and data.get("_enc") is True and data.get("alg") == "AESGCM"


def encrypt_dict(plain: Dict[str, Any]) -> Dict[str, Any]:
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    pt = json.dumps(plain).encode("utf-8")
    ct = aesgcm.encrypt(nonce, pt, associated_data=None)
    return {
        "_enc": True,
        "alg": "AESGCM",
        "n": base64.urlsafe_b64encode(nonce).decode("ascii"),
        "ct": base64.urlsafe_b64encode(ct).decode("ascii"),
    }


def decrypt_dict(data: Dict[str, Any]) -> Dict[str, Any]:
    if not is_encrypted(data):
        # Treat as plaintext credentials (backward-compatible)
        return data
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = base64.urlsafe_b64decode(data["n"])  # type: ignore[index]
    ct = base64.urlsafe_b64decode(data["ct"])  # type: ignore[index]
    pt = aesgcm.decrypt(nonce, ct, associated_data=None)
    return json.loads(pt.decode("utf-8"))


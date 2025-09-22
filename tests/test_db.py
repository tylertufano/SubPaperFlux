from unittest.mock import MagicMock

from app import db


def test_configure_rls_sets_user_id(monkeypatch):
    token = db.set_current_user_id("user-123")
    monkeypatch.setattr(db, "is_postgres", lambda: True)
    session = MagicMock()

    try:
        applied = db._configure_rls(session)
    finally:
        db.reset_current_user_id(token)

    assert applied is True
    assert session.exec.call_count == 1
    args, kwargs = session.exec.call_args
    assert len(args) == 1
    clause = args[0]
    assert getattr(clause, "text", str(clause)) == "SET app.user_id = :user_id"
    assert kwargs == {"params": {"user_id": "user-123"}}

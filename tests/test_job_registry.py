from app.jobs import register_handler, get_handler, known_job_types


def dummy(**kwargs):
    return "ok"


def test_registry():
    register_handler("demo", dummy)
    h = get_handler("demo")
    assert h is not None
    assert "demo" in known_job_types()


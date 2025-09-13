import os
import sys
from sqlmodel import Session

from .db import engine, is_postgres
from .db_admin import prepare_postgres_search


def main(argv=None):
    argv = argv or sys.argv[1:]
    if not is_postgres():
        print("Not using Postgres backend (DATABASE_URL). Nothing to do.")
        return 0
    with Session(engine) as session:
        details = prepare_postgres_search(session)
        print("Prepared Postgres search/indices:")
        print(details)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


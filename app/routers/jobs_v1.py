from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
import time
from sqlmodel import select, desc
from ..jobs.validation import validate_job

from ..auth.oidc import get_current_user
from ..db import get_session
from ..models import Job
from ..schemas import JobsPage, JobOut


router = APIRouter(prefix="/v1/jobs", tags=["v1"])


@router.get("/", response_model=JobsPage, summary="List jobs", description="List jobs with filters, pagination, and sorting.")
def list_jobs(
    current_user=Depends(get_current_user),
    session=Depends(get_session),
    status: Optional[str] = Query(None, description="Filter by status (comma-separated for multiple)"),
    type: Optional[str] = Query(None, alias="job_type", description="Filter by job type"),
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=200),
    order_by: str = Query("created", description="Sort key: attempts|available_at|id"),
    order_dir: str = Query("desc", description="asc|desc"),
):
    user_id = current_user["sub"]
    stmt = select(Job).where(Job.owner_user_id == user_id)
    if status:
        statuses = [s.strip() for s in status.split(',') if s.strip()]
        if len(statuses) == 1:
            stmt = stmt.where(Job.status == statuses[0])
        else:
            stmt = stmt.where(Job.status.in_(statuses))
    if type:
        stmt = stmt.where(Job.type == type)
    # Total
    total = session.exec(stmt.count()).one() if hasattr(stmt, "count") else len(session.exec(stmt).all())

    # Sorting
    if order_by == "attempts":
        stmt = stmt.order_by(Job.attempts.desc() if order_dir == "desc" else Job.attempts)
    elif order_by == "available_at":
        stmt = stmt.order_by(Job.available_at.desc() if order_dir == "desc" else Job.available_at)
    else:
        stmt = stmt.order_by(Job.id.desc() if order_dir == "desc" else Job.id)

    stmt = stmt.offset((page - 1) * size).limit(size)
    rows = session.exec(stmt).all()

    items = [
        JobOut(
            id=r.id,
            type=r.type,
            status=r.status,
            attempts=r.attempts or 0,
            last_error=r.last_error,
            available_at=r.available_at,
            owner_user_id=r.owner_user_id,
            payload=r.payload or {},
            details=r.details or {},
        )
        for r in rows
    ]
    has_next = (page * size) < total
    total_pages = int((total + size - 1) // size) if size else 1
    return JobsPage(items=items, total=int(total), page=page, size=size, has_next=has_next, total_pages=total_pages)


@router.get("/{job_id}", response_model=JobOut, summary="Get job", description="Get a single job by id.")
def get_job(job_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    job = session.get(Job, job_id)
    if not job or job.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Not found")
    return JobOut(
        id=job.id,
        type=job.type,
        status=job.status,
        attempts=job.attempts or 0,
        last_error=job.last_error,
        available_at=job.available_at,
        owner_user_id=job.owner_user_id,
        payload=job.payload or {},
        details=job.details or {},
    )


@router.post("/validate", response_model=dict, summary="Validate a job payload", description="Dry-run validation per job type")
def validate_job_payload(body: dict, current_user=Depends(get_current_user)):
    job_type = body.get("type")
    payload = body.get("payload", {})
    if not job_type:
        raise HTTPException(status_code=400, detail="Missing 'type'")
    result = validate_job(job_type, payload)
    return {"type": job_type, **result}


@router.post("/{job_id}/retry", response_model=JobOut, summary="Retry a job", description="Reset attempts and requeue a failed/dead job")
def retry_job(job_id: str, current_user=Depends(get_current_user), session=Depends(get_session)):
    job = session.get(Job, job_id)
    if not job or job.owner_user_id != current_user["sub"]:
        raise HTTPException(status_code=404, detail="Not found")
    if job.status not in ("failed", "dead"):
        raise HTTPException(status_code=400, detail="Job not in failed/dead state")
    job.status = "queued"
    job.attempts = 0
    job.last_error = None
    job.dead_at = None
    job.available_at = time.time()
    session.add(job)
    session.commit()
    session.refresh(job)
    return JobOut(
        id=job.id,
        type=job.type,
        status=job.status,
        attempts=job.attempts or 0,
        last_error=job.last_error,
        available_at=job.available_at,
        owner_user_id=job.owner_user_id,
        payload=job.payload or {},
        details=job.details or {},
    )


@router.post("/retry-all", response_model=dict, summary="Retry all jobs", description="Requeue all failed/dead jobs optionally filtered by type.")
def retry_all_jobs(body: dict, current_user=Depends(get_current_user), session=Depends(get_session)):
    statuses = body.get("status") or ["failed", "dead"]
    if isinstance(statuses, str):
        statuses = [statuses]
    job_type = body.get("type")
    stmt = select(Job).where(Job.owner_user_id == current_user["sub"], Job.status.in_(statuses))
    if job_type:
        stmt = stmt.where(Job.type == job_type)
    rows = session.exec(stmt).all()
    now = time.time()
    for j in rows:
        j.status = "queued"
        j.attempts = 0
        j.last_error = None
        j.dead_at = None
        j.available_at = now
        session.add(j)
    session.commit()
    return {"requeued": len(rows)}

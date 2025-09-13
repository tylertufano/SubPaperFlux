from fastapi import APIRouter, Depends, status

from ..auth.oidc import get_current_user
from ..schemas import JobRequest
from ..db import get_session
from ..models import Job
from ..jobs import get_handler


router = APIRouter()


@router.post("/", status_code=status.HTTP_202_ACCEPTED)
def enqueue_job(body: JobRequest, current_user=Depends(get_current_user), session=Depends(get_session)):
    # Validate job type against registered handlers
    if not get_handler(body.type):
        return {"enqueued": False, "error": f"Unknown job type: {body.type}"}
    # Minimal persistence; an actual queue system can consume from DB or a broker
    job = Job(type=body.type, payload=body.payload, status="queued", owner_user_id=current_user["sub"])
    session.add(job)
    session.commit()
    return {"enqueued": True, "job_id": job.id, "type": body.type}

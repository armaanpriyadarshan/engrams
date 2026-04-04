from workers.celery_app import celery
from engine.compiler import compile_source


@celery.task(name="compile_source", bind=True, max_retries=2)
def compile_source_task(self, source_id: str):
    try:
        result = compile_source(source_id)
        return result
    except Exception as exc:
        raise self.retry(exc=exc, countdown=10)

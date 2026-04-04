from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes.feed import router as feed_router
from routes.compile import router as compile_router

app = FastAPI(title="Engrams API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(feed_router, prefix="/api/engrams")
app.include_router(compile_router, prefix="/api/engrams")


@app.get("/health")
def health():
    return {"status": "ok"}

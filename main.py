from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from agent import stream_agent_response
from fastapi.responses import StreamingResponse

app = FastAPI(title="Task AI Assistant API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/chat")
async def chat_endpoint(request: Request):
    data = await request.json()
    user_query = data.get("query")
    
    return StreamingResponse(
        stream_agent_response(user_query), 
        media_type="application/x-ndjson"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
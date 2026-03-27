# Multi-Step Task Bot (Structured Reasoning without ReAct)

A lightweight AI assistant that decides between:

- Direct answering for simple requests
- Structured planning and execution for tasks needing live web research

Unlike classic ReAct-style loops, this project uses an explicit plan-then-execute workflow in LangGraph and streams progress events to the UI in real time.

![Architecture](Architecture.png)

## What This Project Does

The bot receives a user query and routes it through one of two paths:

1. Direct path: For simple/general requests, the assistant responds immediately.
2. Plan-and-execute path: For complex or time-sensitive requests, the assistant:
   - Creates a short plan (2 to 4 steps)
   - Executes one step at a time (with web search tool access)
   - Synthesizes results into a final answer

The frontend renders this process as a live "Execution Plan" timeline.

## Tech Stack

- Backend: FastAPI + Uvicorn
- Agent Orchestration: LangGraph
- LLM: Google Gemini via `langchain_google_genai` (or Ollama if switched)
- Tooling: DuckDuckGo Search (`DuckDuckGoSearchRun`)
- Frontend: HTML + Tailwind CSS + Vanilla JavaScript
- Streaming Protocol: NDJSON (`application/x-ndjson`)

## Project Structure

```text
Task-2/
  agent.py         # LangGraph agent logic, routing, planning, execution, synthesis
  main.py          # FastAPI server with streaming /chat endpoint
  index.html       # Chat UI shell
  script.js        # Streaming client + plan widget renderer
  Architecture.png # Architecture diagram
```

## How the Agent Works

### 1) Routing Decision

`route_initial` (via structured output `RouteDecision`) decides:

- `direct` -> go to direct response node
- `plan_and_execute` -> go to planner node

### 2) Planner Node

`plan_node` produces a short list of research steps (`Plan.steps`).

### 3) Executor Node

`execute_step_node` runs one step at a time and can call `search_internet` (DuckDuckGo).

### 4) Synthesizer Node

`synthesize_node` combines all step outputs into a polished final Markdown answer.

### 5) Streaming Output

`stream_agent_response(...)` emits NDJSON events consumed by the frontend:

- `plan`
- `step_executed`
- `final_answer`

## API

### POST `/chat`

Request JSON:

```json
{
  "query": "Plan a 2-day academic visit to Norway.",
  "thread_id": "default_user"
}
```

Response:

- Content type: `application/x-ndjson`
- Streamed line-delimited JSON events, for example:

```json
{"type":"plan","steps":["...","..."]}
{"type":"step_executed","step":"..."}
{"type":"final_answer","content":"..."}
```

## Setup and Run

### 1) Create environment and install dependencies

```bash
python -m venv .venv
.venv\Scripts\activate
pip install fastapi uvicorn langgraph langchain-core langchain-community langchain-ollama langchain-google-genai duckduckgo-search pydantic typing_extensions
```

### 2) Configure Gemini API key

Set your environment variable:

```bash
set GEMINI_API_KEY=your_api_key_here
```

Important: In the current `agent.py`, the model is initialized with:

```python
google_api_key="GEMINI_API_KEY"
```

This is a literal string, not the environment variable value. Update it to use `os.getenv("GEMINI_API_KEY")` (or pass a real key directly) before running.

### 3) Run backend

```bash
python main.py
```

Server starts on `http://localhost:8000`.

### 4) Open frontend

Open `index.html` in your browser (or serve it via any static server).

## Usage Notes

- Press Enter to send, Shift+Enter for newline.
- The UI shows:
  - typing indicator
  - plan card with step status
  - final AI response rendered as Markdown (with MathJax support)
- CORS is currently open (`allow_origins=["*"]`) for easy local testing.

## Why "Structured Reasoning without ReAct"

This project favors explicit graph nodes and deterministic transitions over free-form reasoning traces:

- Clear separation of routing, planning, execution, and synthesis
- Easier observability in UI and logs
- Better control over when tools are used
- Cleaner user-facing responses (no internal reasoning leakage)

## Future Improvements

- Add `requirements.txt` and pin versions
- Load API keys securely from env by default
- Add retry/backoff for tool and LLM errors
- Add unit tests for graph routing and stream event contracts
- Add persistent conversation store beyond in-memory checkpointing
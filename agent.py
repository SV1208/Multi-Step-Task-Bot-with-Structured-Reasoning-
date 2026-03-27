import json
import operator
from typing import Annotated, List, Tuple, Literal
from typing_extensions import TypedDict
from pydantic import BaseModel, Field

from langchain_ollama import ChatOllama
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

from langchain_community.tools import DuckDuckGoSearchRun
from langchain_core.tools import tool

from langchain_google_genai import ChatGoogleGenerativeAI
import os

# ==========================================
# 1. Initialize Model & Tools
# ==========================================
# llm = ChatOllama(model="qwen2.5", temperature=0)

llm = ChatGoogleGenerativeAI(
    model="models/gemini-3.1-flash-lite-preview",
    temperature=0,
    google_api_key="GEMINI_API_KEY")


ddg_search = DuckDuckGoSearchRun()

@tool
def search_internet(query: str) -> str:
    """Search the internet for real-time, up-to-date information, news, or facts."""
    try:
        return ddg_search.invoke(query)
    except Exception as e:
        return f"Search failed: {str(e)}"

llm_with_tools = llm.bind_tools([search_internet])

# ==========================================
# 2. Define State & Schemas
# ==========================================
class State(TypedDict):
    messages: Annotated[list, add_messages]
    plan: List[str]
    past_steps: Annotated[List[Tuple[str, str]], operator.add] 

class RouteDecision(BaseModel):
    """Decides if the task needs step-by-step execution or a direct answer."""
    route: Literal["direct", "plan_and_execute"] = Field(
        description="Choose 'direct' for recipes, general knowledge, casual chat, math, or coding. Choose 'plan_and_execute' ONLY for tasks requiring live web research, current events, or complex multi-step real-world planning."
    )

class Plan(BaseModel):
    """A step-by-step research plan."""
    steps: List[str] = Field(description="List 2-4 web-search or data-gathering tasks. NEVER plan physical human tasks like 'Gather ingredients'.")

# ==========================================
# 3. Helper to get the CURRENT request
# ==========================================
def get_latest_user_request(messages: list) -> str:
    """Iterate backwards to find the most recent human message to prevent context bleed."""
    for msg in reversed(messages):
        if isinstance(msg, HumanMessage):
            return msg.content
    return ""

# ==========================================
# 4. Define Graph Nodes
# ==========================================
def traffic_controller_node(state: State):
    """Decides whether to answer directly or build a plan."""
    router_llm = llm.with_structured_output(RouteDecision)
    current_req = get_latest_user_request(state["messages"])
    
    prompt = f"""Analyze this user request: '{current_req}'
    Does this require real-time internet research and multi-step execution, or can it be answered directly using internal knowledge (like a recipe or general fact)?"""
    
    try:
        decision = router_llm.invoke([HumanMessage(content=prompt)])
        return {"route_decision": decision.route}
    except Exception:
        return {"route_decision": "direct"} # Failsafe

def direct_response_node(state: State):
    """Handles standard queries without over-engineering a plan."""
    system_msg = SystemMessage(content="You are a highly capable AI assistant. Answer the user's request directly, clearly, and format it beautifully in Markdown.")
    messages = [system_msg] + state["messages"]
    
    response = llm.invoke(messages)
    return {"messages": [response]}

def plan_node(state: State):
    """Builds an execution plan only for complex tasks."""
    planner_llm = llm.with_structured_output(Plan)
    current_req = get_latest_user_request(state["messages"])
    
    system_msg = SystemMessage(
        content="You are an expert AI orchestrator. Break the user's complex request down into 2 to 4 actionable internet research steps. Do not plan physical actions."
    )
    
    try:
        plan_result = planner_llm.invoke([system_msg, HumanMessage(content=current_req)])
        steps = plan_result.steps
    except Exception:
        steps = ["Analyze the core request", "Search for relevant live data", "Formulate the final response"]
         
    return {"plan": steps, "past_steps": []}

def execute_step_node(state: State):
    """Executes a search task based on the plan."""
    plan = state.get("plan", [])
    past_steps = state.get("past_steps", [])
    
    current_step_index = len(past_steps)
    if current_step_index >= len(plan):
        return {} 
        
    current_step = plan[current_step_index]
    user_req = get_latest_user_request(state["messages"]) 
    
    prompt = f"""You are an AI processing step {current_step_index + 1} of a task.
    ORIGINAL USER REQUEST: "{user_req}"
    YOUR CURRENT STEP: "{current_step}"
    """
    
    if past_steps:
        prompt += "\n--- PREVIOUS STEPS COMPLETED ---\n"
        for step, result in past_steps:
            prompt += f"Step: {step}\nResult: {result}\n\n"
            
    prompt += "\nPerform this CURRENT STEP thoroughly. Use the 'search_internet' tool to gather live data if needed. Output ONLY the raw data/research found. Do not write introductory remarks."
    
    messages = [HumanMessage(content=prompt)]
    response = llm_with_tools.invoke(messages)
    
    if hasattr(response, 'tool_calls') and response.tool_calls:
        messages.append(response) 
        for tool_call in response.tool_calls:
            if tool_call["name"] == "search_internet":
                search_result = search_internet.invoke(tool_call["args"])
                messages.append(ToolMessage(content=search_result, tool_call_id=tool_call["id"]))
        response = llm_with_tools.invoke(messages)

    return {"past_steps": [(current_step, response.content)]}

def synthesize_node(state: State):
    """Combines all step results into a final answer."""
    user_req = get_latest_user_request(state["messages"])
    past_steps = state.get("past_steps", [])
    
    prompt = f"""You are an AI finalizing a response for the user's request: '{user_req}'
    You have compiled the following research:
    """
    for step, result in past_steps:
        prompt += f"### {step}\n{result}\n\n"
        
    prompt += """Synthesize this into a cohesive, highly readable final response formatted in Markdown. 
    CRITICAL RULES:
    1. Do NOT mention your internal process (e.g., do not say 'I researched' or 'Based on step 1').
    2. Present the answer confidently and directly to the user."""

    response = llm.invoke([HumanMessage(content=prompt)])
    return {"messages": [response]}

# ==========================================
# 5. Build and Compile the Graph
# ==========================================
def route_initial(state: State):
    # This reads a temporary key that traffic_controller_node sets
    # Note: To do this perfectly in LangGraph, we evaluate state.
    # But since route_decision isn't formally in our TypedDict state to avoid clutter,
    # we can just run the traffic_controller logic inside the edge function itself, 
    # OR define it in State. Let's run a quick peek at the last message.
    
    router_llm = llm.with_structured_output(RouteDecision)
    current_req = get_latest_user_request(state["messages"])
    prompt = f"""Analyze this user request: '{current_req}'
    Does this require real-time internet research and multi-step execution, or can it be answered directly using internal knowledge (like a recipe or general fact)?"""
    try:
        decision = router_llm.invoke([HumanMessage(content=prompt)])
        if decision.route == "direct":
            return "direct_response"
        return "planner"
    except:
        return "direct_response"

def router(state: State):
    """Determines whether to execute another step or move to synthesis."""
    plan = state.get("plan", [])
    past_steps = state.get("past_steps", [])
    if len(past_steps) < len(plan):
        return "execute_step"
    return "synthesize"

graph_builder = StateGraph(State)

# Nodes
graph_builder.add_node("direct_response", direct_response_node)
graph_builder.add_node("planner", plan_node)
graph_builder.add_node("executor", execute_step_node)
graph_builder.add_node("synthesizer", synthesize_node)

# Edges
graph_builder.add_conditional_edges(START, route_initial)
graph_builder.add_edge("direct_response", END)
graph_builder.add_edge("planner", "executor")
graph_builder.add_conditional_edges("executor", router, {
    "execute_step": "executor",
    "synthesize": "synthesizer"
})
graph_builder.add_edge("synthesizer", END)

memory = MemorySaver()
task_agent = graph_builder.compile(checkpointer=memory)

# ==========================================
# 6. API Interface Function (STREAMING)
# ==========================================
def stream_agent_response(user_input: str, thread_id: str = "default_user"):
    initial_state = {"messages": [HumanMessage(content=user_input)]}
    config = {"configurable": {"thread_id": thread_id}}
    
    for event in task_agent.stream(initial_state, config=config):
        for node_name, node_state in event.items():
            
            # If the router bypassed the plan directly to standard response
            if node_name == "direct_response":
                final_text = node_state["messages"][-1].content
                yield json.dumps({"type": "final_answer", "content": final_text}) + "\n"

            elif node_name == "planner":
                yield json.dumps({"type": "plan", "steps": node_state["plan"]}) + "\n"
                
            elif node_name == "executor":
                latest_step, latest_result = node_state["past_steps"][-1]
                yield json.dumps({
                    "type": "step_executed", 
                    "step": latest_step, 
                }) + "\n"
                
            elif node_name == "synthesizer":
                final_text = node_state["messages"][-1].content
                yield json.dumps({"type": "final_answer", "content": final_text}) + "\n"
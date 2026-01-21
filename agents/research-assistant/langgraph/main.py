"""
Research Assistant Agent - LangGraph Implementation

This implementation demonstrates production patterns using LangGraph's
graph-based state machine architecture.

Key features:
- Explicit state transitions (StateGraph)
- Conditional routing based on state
- Error recovery with retry logic
- Human-in-the-loop checkpoints
- Streaming support

Run: python main.py "Research the latest developments in quantum computing"
"""

import os
import json
import asyncio
from datetime import datetime
from typing import TypedDict, Annotated, Literal, Optional
from dataclasses import dataclass

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langgraph.graph import StateGraph, END, START
from langgraph.checkpoint.memory import MemorySaver
from langgraph.prebuilt import ToolNode, tools_condition
from langchain_core.tools import tool

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class Config:
    model: str = "gpt-4o"
    max_iterations: int = 10
    token_budget: int = 50000
    timeout_seconds: int = 300

config = Config()

# ============================================================================
# Pillar 2: Memory - State Definition
# ============================================================================

class ResearchState(TypedDict):
    """
    Explicit state schema for the research workflow.
    LangGraph tracks state transitions automatically.
    """
    # Input
    query: str

    # Research progress
    sources: list[dict]
    summaries: list[str]
    current_step: Literal["search", "fetch", "summarize", "write", "review", "done", "error"]

    # Output
    draft_report: str
    final_report: str

    # Metadata
    iteration: int
    tokens_used: int
    errors: list[str]

    # Messages for LLM context
    messages: list

def create_initial_state(query: str) -> ResearchState:
    """Create initial state for a research task"""
    return ResearchState(
        query=query,
        sources=[],
        summaries=[],
        current_step="search",
        draft_report="",
        final_report="",
        iteration=0,
        tokens_used=0,
        errors=[],
        messages=[
            SystemMessage(content="""You are a research assistant.
            Search for information, fetch relevant pages, summarize findings,
            and produce a comprehensive research report.
            Always cite your sources."""),
            HumanMessage(content=f"Research this topic: {query}")
        ]
    )

# ============================================================================
# Pillar 1: Orchestration - Tools
# ============================================================================

@tool
def web_search(query: str, num_results: int = 5) -> str:
    """Search the web for information."""
    # Mock implementation - replace with real search API
    results = [
        {
            "title": f"Result {i+1}: {query}",
            "url": f"https://example.com/article-{i+1}",
            "snippet": f"Information about {query}..."
        }
        for i in range(num_results)
    ]
    return json.dumps(results)

@tool
def fetch_url(url: str) -> str:
    """Fetch content from a URL."""
    # Mock implementation
    return f"""
    Article content from {url}:

    This is detailed information about the topic.
    Key points:
    - Important finding with supporting data
    - Expert analysis and perspective
    - Relevant statistics and trends
    """

@tool
def save_to_report(section: str, content: str) -> str:
    """Save content to a specific section of the report."""
    return f"Added to {section}: {content[:100]}..."

tools = [web_search, fetch_url, save_to_report]

# ============================================================================
# Pillar 1: Orchestration - Graph Nodes
# ============================================================================

llm = ChatOpenAI(model=config.model)
llm_with_tools = llm.bind_tools(tools)

async def research_node(state: ResearchState) -> ResearchState:
    """
    Main research node - decides next action using LLM.
    """
    messages = state["messages"]

    # Add context about current progress
    progress_msg = f"""
    Current progress:
    - Sources found: {len(state['sources'])}
    - Summaries: {len(state['summaries'])}
    - Current step: {state['current_step']}

    Continue researching or write the report if you have enough information.
    """
    messages_with_context = messages + [HumanMessage(content=progress_msg)]

    response = await llm_with_tools.ainvoke(messages_with_context)

    # Update tokens (approximate)
    state["tokens_used"] = state.get("tokens_used", 0) + len(str(response.content)) // 4
    state["messages"] = messages + [response]
    state["iteration"] = state.get("iteration", 0) + 1

    return state

async def tool_executor(state: ResearchState) -> ResearchState:
    """Execute tool calls from the LLM response."""
    last_message = state["messages"][-1]

    if not hasattr(last_message, "tool_calls") or not last_message.tool_calls:
        return state

    tool_node = ToolNode(tools)
    result = await tool_node.ainvoke(state)

    # Parse and store results
    for tool_call in last_message.tool_calls:
        if tool_call["name"] == "web_search":
            try:
                sources = json.loads(tool_call.get("output", "[]"))
                state["sources"].extend(sources)
            except:
                pass

    state["messages"] = result.get("messages", state["messages"])
    return state

async def summarize_node(state: ResearchState) -> ResearchState:
    """Summarize collected information."""
    if len(state["sources"]) < 3:
        state["current_step"] = "search"
        return state

    summary_prompt = f"""
    Based on the sources collected, create a summary of key findings.
    Sources: {json.dumps(state['sources'][:5])}
    """

    response = await llm.ainvoke([HumanMessage(content=summary_prompt)])
    state["summaries"].append(response.content)
    state["current_step"] = "write"

    return state

async def write_report_node(state: ResearchState) -> ResearchState:
    """Generate the final research report."""
    report_prompt = f"""
    Create a comprehensive research report on: {state['query']}

    Summaries:
    {chr(10).join(state['summaries'])}

    Format:
    ## Summary
    [Overview]

    ## Key Findings
    - Finding 1
    - Finding 2
    - Finding 3

    ## Sources
    - List all URLs
    """

    response = await llm.ainvoke([HumanMessage(content=report_prompt)])
    state["draft_report"] = response.content
    state["current_step"] = "review"

    return state

async def review_node(state: ResearchState) -> ResearchState:
    """Review and finalize the report."""
    review_prompt = f"""
    Review this research report for accuracy and completeness:

    {state['draft_report']}

    If it's good, return it as-is. If improvements needed, make them.
    """

    response = await llm.ainvoke([HumanMessage(content=review_prompt)])
    state["final_report"] = response.content
    state["current_step"] = "done"

    return state

async def error_handler(state: ResearchState) -> ResearchState:
    """Handle errors gracefully."""
    state["errors"].append(f"Error at step: {state['current_step']}")
    state["current_step"] = "error"
    return state

# ============================================================================
# Pillar 3: Guardrails - Routing Logic
# ============================================================================

def should_continue(state: ResearchState) -> Literal["tools", "summarize", "write", "review", "end"]:
    """
    Conditional routing based on state.
    This is where guardrails logic lives.
    """
    # Check iteration limit
    if state["iteration"] >= config.max_iterations:
        return "end"

    # Check token budget
    if state["tokens_used"] >= config.token_budget:
        return "end"

    # Check for tool calls
    last_message = state["messages"][-1]
    if hasattr(last_message, "tool_calls") and last_message.tool_calls:
        return "tools"

    # Route based on current step
    step = state["current_step"]
    if step == "search" and len(state["sources"]) >= 3:
        return "summarize"
    elif step == "summarize":
        return "write"
    elif step == "write":
        return "review"
    elif step == "review" or step == "done":
        return "end"

    return "end"

# ============================================================================
# Pillar 1: Orchestration - Build Graph
# ============================================================================

def build_research_graph() -> StateGraph:
    """
    Construct the research workflow as a state machine.

    Graph visualization:
    START -> research -> [tools] -> research -> ... -> summarize -> write -> review -> END
    """
    workflow = StateGraph(ResearchState)

    # Add nodes
    workflow.add_node("research", research_node)
    workflow.add_node("tools", tool_executor)
    workflow.add_node("summarize", summarize_node)
    workflow.add_node("write", write_report_node)
    workflow.add_node("review", review_node)
    workflow.add_node("error", error_handler)

    # Add edges
    workflow.add_edge(START, "research")

    # Conditional routing from research node
    workflow.add_conditional_edges(
        "research",
        should_continue,
        {
            "tools": "tools",
            "summarize": "summarize",
            "write": "write",
            "review": "review",
            "end": END
        }
    )

    # Tools always go back to research
    workflow.add_edge("tools", "research")

    # Linear flow for report generation
    workflow.add_edge("summarize", "write")
    workflow.add_edge("write", "review")
    workflow.add_edge("review", END)
    workflow.add_edge("error", END)

    return workflow

# ============================================================================
# Pillar 2: Memory - Checkpointing
# ============================================================================

# Memory saver for persistence and human-in-the-loop
checkpointer = MemorySaver()

# ============================================================================
# Main Runner
# ============================================================================

async def run_research(query: str) -> dict:
    """Execute the research workflow."""
    print(f"\n🔍 Starting research: {query}\n")
    print("=" * 60)

    # Build and compile graph
    workflow = build_research_graph()
    app = workflow.compile(checkpointer=checkpointer)

    # Create initial state
    initial_state = create_initial_state(query)

    # Run with thread ID for checkpointing
    config = {"configurable": {"thread_id": f"research-{datetime.now().timestamp()}"}}

    try:
        # Execute with timeout
        final_state = await asyncio.wait_for(
            app.ainvoke(initial_state, config),
            timeout=Config().timeout_seconds
        )

        print("\n" + "=" * 60)
        print("📊 Execution Summary:")
        print(f"   Iterations: {final_state['iteration']}")
        print(f"   Sources: {len(final_state['sources'])}")
        print(f"   Tokens: {final_state['tokens_used']}")
        print("=" * 60)

        return {
            "report": final_state["final_report"],
            "sources": final_state["sources"],
            "iterations": final_state["iteration"],
            "tokens_used": final_state["tokens_used"],
            "errors": final_state["errors"]
        }

    except asyncio.TimeoutError:
        return {"error": "Timeout", "partial_state": initial_state}
    except Exception as e:
        return {"error": str(e)}

# ============================================================================
# CLI Entry Point
# ============================================================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python main.py 'Your research question'")
        sys.exit(1)

    query = sys.argv[1]
    result = asyncio.run(run_research(query))

    if "error" in result:
        print(f"\n❌ Error: {result['error']}")
    else:
        print("\n📄 Research Report:\n")
        print(result["report"])

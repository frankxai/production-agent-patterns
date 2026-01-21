"""
Research Assistant Agent - OpenAI Agents SDK Implementation

This implementation demonstrates all 7 pillars of production agent systems:
1. Orchestration: Multi-step workflow with handoffs
2. Memory: Session and conversation context
3. Guardrails: Input/output validation
4. Observability: Tracing with decorators
5. Security: API key management, rate limiting
6. Cost Management: Token tracking
7. Lifecycle: Error handling, graceful degradation

Run: python main.py "Research the latest developments in quantum computing"
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional
from dataclasses import dataclass, field

from openai import OpenAI
from agents import Agent, Runner, function_tool, handoff, GuardContext
from agents.tracing import trace

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class AgentConfig:
    """Production configuration with sensible defaults"""
    model: str = "gpt-4o"
    max_tokens: int = 4096
    temperature: float = 0.7
    max_iterations: int = 10
    token_budget: int = 50000  # Cost management
    timeout_seconds: int = 300

config = AgentConfig()

# ============================================================================
# Pillar 2: Memory - Session State
# ============================================================================

@dataclass
class ResearchState:
    """Explicit state management for the research workflow"""
    query: str
    sources: list[dict] = field(default_factory=list)
    summaries: list[str] = field(default_factory=list)
    draft_report: str = ""
    final_report: str = ""
    tokens_used: int = 0
    errors: list[str] = field(default_factory=list)
    created_at: datetime = field(default_factory=datetime.now)

# ============================================================================
# Pillar 3: Guardrails - Input/Output Validation
# ============================================================================

def validate_query(query: str) -> tuple[bool, str]:
    """Input guardrail: Validate research query"""
    if len(query) < 10:
        return False, "Query too short. Please provide more context."
    if len(query) > 1000:
        return False, "Query too long. Please be more concise."

    # Check for prohibited content (simplified)
    prohibited = ["hack", "exploit", "illegal"]
    for word in prohibited:
        if word.lower() in query.lower():
            return False, f"Query contains prohibited content: {word}"

    return True, "Valid query"

def validate_output(report: str) -> tuple[bool, str]:
    """Output guardrail: Validate research report"""
    if len(report) < 100:
        return False, "Report too short. Research may have failed."

    # Check for required sections
    required_sections = ["Summary", "Key Findings", "Sources"]
    for section in required_sections:
        if section.lower() not in report.lower():
            return False, f"Report missing required section: {section}"

    return True, "Valid report"

# ============================================================================
# Pillar 1: Orchestration - Tools
# ============================================================================

@function_tool
@trace("web_search")
async def web_search(query: str, num_results: int = 5) -> str:
    """
    Search the web for information on a topic.

    Args:
        query: The search query
        num_results: Number of results to return (default 5)

    Returns:
        JSON string with search results
    """
    # In production, replace with actual search API (Serper, Tavily, etc.)
    # This is a mock for demonstration
    mock_results = [
        {
            "title": f"Result {i+1} for: {query}",
            "url": f"https://example.com/article-{i+1}",
            "snippet": f"This is a snippet about {query}. It contains relevant information..."
        }
        for i in range(num_results)
    ]
    return json.dumps(mock_results)

@function_tool
@trace("fetch_url")
async def fetch_url(url: str) -> str:
    """
    Fetch and extract content from a URL.

    Args:
        url: The URL to fetch

    Returns:
        Extracted text content from the page
    """
    # In production, use aiohttp + BeautifulSoup or similar
    # This is a mock for demonstration
    return f"""
    Content from {url}:

    This is the extracted article content. In production, this would be
    the actual text content from the web page, cleaned and formatted
    for processing by the LLM.

    Key points:
    - Point 1 about the topic
    - Point 2 with supporting evidence
    - Point 3 with expert quotes
    """

@function_tool
@trace("summarize_content")
async def summarize_content(content: str, max_length: int = 200) -> str:
    """
    Summarize long content into key points.

    Args:
        content: The content to summarize
        max_length: Maximum length of summary in words

    Returns:
        Condensed summary of the content
    """
    client = OpenAI()
    response = client.chat.completions.create(
        model="gpt-4o-mini",  # Use cheaper model for summarization
        messages=[
            {"role": "system", "content": f"Summarize the following content in {max_length} words or less. Focus on key facts and insights."},
            {"role": "user", "content": content}
        ],
        max_tokens=500
    )
    return response.choices[0].message.content

# ============================================================================
# Pillar 1: Orchestration - Specialized Agents
# ============================================================================

# Research Agent - Gathers information
research_agent = Agent(
    name="researcher",
    model=config.model,
    instructions="""You are a research specialist. Your job is to:
    1. Search for relevant information using the web_search tool
    2. Fetch detailed content from promising URLs
    3. Summarize findings

    Be thorough but efficient. Focus on credible sources.
    Always cite your sources with URLs.

    When you have gathered enough information (at least 3 sources),
    hand off to the writer agent.""",
    tools=[web_search, fetch_url, summarize_content],
)

# Writer Agent - Synthesizes research into report
writer_agent = Agent(
    name="writer",
    model=config.model,
    instructions="""You are a technical writer. Your job is to:
    1. Take research findings and synthesize them into a clear report
    2. Structure the report with: Summary, Key Findings, Sources
    3. Ensure all claims are supported by the research

    Format your report in markdown.
    Include a bullet-point list of sources at the end.""",
    tools=[],
)

# Add handoff from researcher to writer
research_agent = Agent(
    name="researcher",
    model=config.model,
    instructions=research_agent.instructions,
    tools=[web_search, fetch_url, summarize_content, handoff(writer_agent)],
)

# ============================================================================
# Pillar 4: Observability - Tracing
# ============================================================================

class TokenTracker:
    """Track token usage for cost management"""
    def __init__(self):
        self.total_tokens = 0
        self.calls = []

    def track(self, model: str, input_tokens: int, output_tokens: int):
        self.total_tokens += input_tokens + output_tokens
        self.calls.append({
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "timestamp": datetime.now().isoformat()
        })

    def get_cost_estimate(self) -> float:
        """Estimate cost based on current pricing"""
        # Simplified pricing (actual varies by model)
        return self.total_tokens * 0.00001  # ~$0.01 per 1000 tokens

token_tracker = TokenTracker()

# ============================================================================
# Pillar 5: Security - Context Guards
# ============================================================================

async def security_guard(ctx: GuardContext) -> Optional[str]:
    """Guard that runs before each tool call"""
    # Check token budget
    if token_tracker.total_tokens > config.token_budget:
        return "Token budget exceeded. Stopping execution."

    # Check for sensitive operations
    if ctx.tool_name == "fetch_url":
        url = ctx.tool_args.get("url", "")
        if "internal" in url or "private" in url:
            return "Cannot access internal/private URLs"

    return None  # Allow the operation

# ============================================================================
# Main Runner
# ============================================================================

async def run_research(query: str) -> dict:
    """
    Execute the research workflow with all production patterns.

    Args:
        query: The research question

    Returns:
        Dictionary with report and metadata
    """
    # Initialize state
    state = ResearchState(query=query)

    # Pillar 3: Input validation
    is_valid, message = validate_query(query)
    if not is_valid:
        return {"error": message, "state": state}

    print(f"\n🔍 Starting research: {query}\n")
    print("=" * 60)

    try:
        # Pillar 1: Orchestration with Runner
        runner = Runner(
            agent=research_agent,
            max_turns=config.max_iterations,
        )

        # Execute with timeout
        result = await asyncio.wait_for(
            runner.run(query),
            timeout=config.timeout_seconds
        )

        state.final_report = result.final_output

        # Pillar 3: Output validation
        is_valid, message = validate_output(state.final_report)
        if not is_valid:
            state.errors.append(f"Output validation failed: {message}")

        # Pillar 4: Observability
        print("\n" + "=" * 60)
        print("📊 Execution Summary:")
        print(f"   Total tokens: {token_tracker.total_tokens}")
        print(f"   Estimated cost: ${token_tracker.get_cost_estimate():.4f}")
        print(f"   Tool calls: {len(token_tracker.calls)}")
        print("=" * 60 + "\n")

        return {
            "report": state.final_report,
            "tokens_used": token_tracker.total_tokens,
            "cost_estimate": token_tracker.get_cost_estimate(),
            "errors": state.errors,
            "duration_seconds": (datetime.now() - state.created_at).total_seconds()
        }

    except asyncio.TimeoutError:
        state.errors.append("Execution timed out")
        return {"error": "Timeout", "state": state}
    except Exception as e:
        state.errors.append(str(e))
        return {"error": str(e), "state": state}

# ============================================================================
# CLI Entry Point
# ============================================================================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python main.py 'Your research question'")
        print("Example: python main.py 'What are the latest developments in quantum computing?'")
        sys.exit(1)

    query = sys.argv[1]
    result = asyncio.run(run_research(query))

    if "error" in result:
        print(f"\n❌ Error: {result['error']}")
    else:
        print("\n📄 Research Report:\n")
        print(result["report"])

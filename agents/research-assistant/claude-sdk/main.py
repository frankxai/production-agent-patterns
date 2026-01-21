"""
Research Assistant Agent - Claude Agent SDK Implementation

This implementation demonstrates all 7 pillars of production agent systems
using Anthropic's Claude Agent SDK with hooks for fine-grained control.

Key features:
- Hooks system: PreToolUse, PostToolUse, Stop for control flow
- MCP-native design for tool integration
- Multi-cloud auth support (API, Bedrock, Vertex)
- Production patterns from Claude Code

Run: python main.py "Research the latest developments in quantum computing"
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional, Any
from dataclasses import dataclass, field
from enum import Enum

from anthropic import Anthropic
from claude_agent_sdk import (
    Agent,
    AgentConfig,
    Tool,
    ToolResult,
    HookType,
    HookContext,
    hook,
)

# ============================================================================
# Configuration
# ============================================================================

class AuthProvider(Enum):
    """Supported authentication providers"""
    API = "api"           # Direct Anthropic API
    BEDROCK = "bedrock"   # AWS Bedrock
    VERTEX = "vertex"     # Google Vertex AI

@dataclass
class Config:
    """Production configuration"""
    model: str = "claude-sonnet-4-20250514"
    auth_provider: AuthProvider = AuthProvider.API
    max_tokens: int = 4096
    max_iterations: int = 15
    token_budget: int = 100000
    timeout_seconds: int = 300

config = Config()

# ============================================================================
# Pillar 2: Memory - State Management
# ============================================================================

@dataclass
class ResearchState:
    """Explicit state for the research workflow"""
    query: str
    sources: list[dict] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)
    report: str = ""
    tokens_used: int = 0
    tool_calls: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=datetime.now)

# Global state (in production, use proper state management)
state = ResearchState(query="")

# ============================================================================
# Pillar 3: Guardrails - Hooks System
# ============================================================================

@hook(HookType.PRE_TOOL_USE)
async def pre_tool_guard(ctx: HookContext) -> Optional[str]:
    """
    Hook that runs BEFORE each tool call.
    Return a string to block the tool call with that message.
    Return None to allow the tool call.
    """
    global state

    # Budget check
    if state.tokens_used > config.token_budget:
        return "Token budget exceeded. Please summarize findings."

    # URL safety check
    if ctx.tool_name == "fetch_url":
        url = ctx.tool_args.get("url", "")
        blocked_domains = ["internal.", "private.", "localhost"]
        for domain in blocked_domains:
            if domain in url:
                return f"Blocked: Cannot access {domain} URLs"

    # Rate limiting check (simplified)
    recent_calls = [c for c in state.tool_calls
                   if (datetime.now() - c["timestamp"]).seconds < 60]
    if len(recent_calls) > 10:
        return "Rate limit: Too many tool calls per minute"

    # Log the tool call
    state.tool_calls.append({
        "tool": ctx.tool_name,
        "args": ctx.tool_args,
        "timestamp": datetime.now()
    })

    return None  # Allow

@hook(HookType.POST_TOOL_USE)
async def post_tool_handler(ctx: HookContext, result: ToolResult) -> ToolResult:
    """
    Hook that runs AFTER each tool call.
    Can modify or validate tool results.
    """
    global state

    # Track token usage (approximate)
    state.tokens_used += len(str(result.output)) // 4

    # Store sources if from web search
    if ctx.tool_name == "web_search" and result.success:
        try:
            sources = json.loads(result.output)
            state.sources.extend(sources)
        except json.JSONDecodeError:
            pass

    # PII detection in output (simplified)
    if result.success:
        pii_patterns = ["SSN:", "credit card:", "password:"]
        for pattern in pii_patterns:
            if pattern.lower() in str(result.output).lower():
                return ToolResult(
                    success=True,
                    output="[Content redacted: PII detected]"
                )

    return result

@hook(HookType.STOP)
async def stop_handler(ctx: HookContext) -> bool:
    """
    Hook that determines if the agent should stop.
    Return True to stop, False to continue.
    """
    global state

    # Stop if we've exceeded iterations
    if ctx.iteration > config.max_iterations:
        return True

    # Stop if we have enough sources and a report
    if len(state.sources) >= 3 and len(state.report) > 500:
        return True

    return False

# ============================================================================
# Pillar 1: Orchestration - Tools
# ============================================================================

web_search_tool = Tool(
    name="web_search",
    description="Search the web for information on a topic",
    parameters={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query"
            },
            "num_results": {
                "type": "integer",
                "description": "Number of results (default 5)",
                "default": 5
            }
        },
        "required": ["query"]
    }
)

fetch_url_tool = Tool(
    name="fetch_url",
    description="Fetch and extract content from a URL",
    parameters={
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The URL to fetch"
            }
        },
        "required": ["url"]
    }
)

save_finding_tool = Tool(
    name="save_finding",
    description="Save an important finding from research",
    parameters={
        "type": "object",
        "properties": {
            "finding": {
                "type": "string",
                "description": "The key finding to save"
            },
            "source": {
                "type": "string",
                "description": "Source URL for the finding"
            }
        },
        "required": ["finding"]
    }
)

# Tool implementations
async def execute_tool(name: str, args: dict) -> ToolResult:
    """Execute a tool and return the result"""
    global state

    if name == "web_search":
        # Mock implementation - replace with real search API
        query = args.get("query", "")
        num_results = args.get("num_results", 5)
        results = [
            {
                "title": f"Result {i+1}: {query}",
                "url": f"https://example.com/article-{i+1}",
                "snippet": f"Information about {query}..."
            }
            for i in range(num_results)
        ]
        return ToolResult(success=True, output=json.dumps(results))

    elif name == "fetch_url":
        # Mock implementation - replace with real fetcher
        url = args.get("url", "")
        content = f"""
        Content from {url}:

        This article discusses the topic in detail. Key points include:
        - Important finding 1
        - Supporting evidence 2
        - Expert perspective 3

        [Full article content would appear here in production]
        """
        return ToolResult(success=True, output=content)

    elif name == "save_finding":
        finding = args.get("finding", "")
        source = args.get("source", "unknown")
        state.findings.append({"finding": finding, "source": source})
        return ToolResult(success=True, output=f"Saved finding: {finding[:50]}...")

    return ToolResult(success=False, output=f"Unknown tool: {name}")

# ============================================================================
# Pillar 4: Observability
# ============================================================================

def log_execution(message: str, level: str = "INFO"):
    """Structured logging for observability"""
    timestamp = datetime.now().isoformat()
    print(f"[{timestamp}] [{level}] {message}")

# ============================================================================
# Pillar 5: Security - Multi-Cloud Auth
# ============================================================================

def get_client(provider: AuthProvider) -> Anthropic:
    """Get appropriately configured client based on auth provider"""
    if provider == AuthProvider.API:
        return Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

    elif provider == AuthProvider.BEDROCK:
        # For AWS Bedrock
        return Anthropic(
            aws_access_key=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
            aws_region=os.environ.get("AWS_REGION", "us-east-1"),
        )

    elif provider == AuthProvider.VERTEX:
        # For Google Vertex AI
        return Anthropic(
            vertex_project=os.environ.get("GOOGLE_PROJECT_ID"),
            vertex_region=os.environ.get("GOOGLE_REGION", "us-central1"),
        )

    raise ValueError(f"Unknown provider: {provider}")

# ============================================================================
# Main Agent
# ============================================================================

SYSTEM_PROMPT = """You are a research assistant that helps users find and synthesize information.

Your workflow:
1. Use web_search to find relevant sources
2. Use fetch_url to get detailed content from promising sources
3. Use save_finding to record important discoveries
4. After gathering at least 3 sources, synthesize findings into a report

Report format:
## Summary
[2-3 sentence overview]

## Key Findings
- Finding 1 (with source)
- Finding 2 (with source)
- Finding 3 (with source)

## Sources
- [Title](URL)

Be thorough but efficient. Cite all sources."""

async def run_research(query: str) -> dict:
    """Execute the research workflow"""
    global state
    state = ResearchState(query=query)

    log_execution(f"Starting research: {query}")

    # Input validation (Pillar 3)
    if len(query) < 10:
        return {"error": "Query too short", "query": query}

    client = get_client(config.auth_provider)

    # Create agent with hooks
    agent = Agent(
        client=client,
        model=config.model,
        system=SYSTEM_PROMPT,
        tools=[web_search_tool, fetch_url_tool, save_finding_tool],
        tool_executor=execute_tool,
        max_tokens=config.max_tokens,
    )

    try:
        # Run with timeout
        result = await asyncio.wait_for(
            agent.run(query),
            timeout=config.timeout_seconds
        )

        state.report = result.output

        # Log completion
        log_execution(f"Research complete. Tokens: {state.tokens_used}")

        return {
            "report": state.report,
            "sources": state.sources,
            "findings": state.findings,
            "tokens_used": state.tokens_used,
            "tool_calls": len(state.tool_calls),
            "duration_seconds": (datetime.now() - state.started_at).total_seconds()
        }

    except asyncio.TimeoutError:
        log_execution("Research timed out", level="ERROR")
        return {"error": "Timeout", "partial_findings": state.findings}

    except Exception as e:
        log_execution(f"Error: {str(e)}", level="ERROR")
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
        print(f"\n📊 Stats: {result['tokens_used']} tokens, {result['tool_calls']} tool calls")

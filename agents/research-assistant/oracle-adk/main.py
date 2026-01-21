"""
Research Assistant Agent - Oracle ADK Implementation

This implementation demonstrates production patterns using Oracle's
Agent Development Kit (ADK) with OCI Generative AI Service.

Key features:
- Native OCI integration (IAM, Vault, Logging)
- Select AI for database-grounded queries
- AI Vector Search for semantic retrieval
- Enterprise security patterns
- Cost-effective with OCI pricing

Run: python main.py "Research the latest developments in quantum computing"
"""

import os
import json
import asyncio
from datetime import datetime
from typing import Optional, Any
from dataclasses import dataclass, field

import oci
from oci.generative_ai_inference import GenerativeAiInferenceClient
from oci.generative_ai_inference.models import (
    ChatDetails,
    CohereChatRequest,
    OnDemandServingMode,
)

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class OCIConfig:
    """OCI-specific configuration"""
    compartment_id: str = os.environ.get("OCI_COMPARTMENT_ID", "")
    region: str = os.environ.get("OCI_REGION", "us-chicago-1")
    model_id: str = "cohere.command-a"  # Or "meta.llama-3.3-70b-instruct"
    max_tokens: int = 4096
    temperature: float = 0.7
    max_iterations: int = 10
    token_budget: int = 100000

config = OCIConfig()

# ============================================================================
# Pillar 5: Security - OCI Authentication
# ============================================================================

def get_oci_config():
    """
    Get OCI configuration from standard locations.
    Supports: config file, instance principal, resource principal
    """
    try:
        # Try instance principal first (for OCI compute)
        return oci.auth.signers.get_resource_principals_signer()
    except:
        pass

    try:
        # Fall back to config file
        return oci.config.from_file()
    except:
        pass

    # Manual configuration
    return {
        "user": os.environ.get("OCI_USER_OCID"),
        "key_file": os.environ.get("OCI_KEY_FILE"),
        "fingerprint": os.environ.get("OCI_FINGERPRINT"),
        "tenancy": os.environ.get("OCI_TENANCY_OCID"),
        "region": config.region,
    }

# ============================================================================
# Pillar 2: Memory - State Management
# ============================================================================

@dataclass
class ResearchState:
    """Research workflow state"""
    query: str
    sources: list[dict] = field(default_factory=list)
    findings: list[str] = field(default_factory=list)
    report: str = ""
    tokens_used: int = 0
    tool_calls: int = 0
    errors: list[str] = field(default_factory=list)
    started_at: datetime = field(default_factory=datetime.now)

# ============================================================================
# Pillar 1: Orchestration - Tools
# ============================================================================

class Tool:
    """Base class for ADK tools"""
    def __init__(self, name: str, description: str, parameters: dict):
        self.name = name
        self.description = description
        self.parameters = parameters

    async def execute(self, **kwargs) -> dict:
        raise NotImplementedError

class WebSearchTool(Tool):
    """Search the web for information"""
    def __init__(self):
        super().__init__(
            name="web_search",
            description="Search the web for information on a topic",
            parameters={
                "query": {"type": "string", "description": "Search query"},
                "num_results": {"type": "integer", "default": 5}
            }
        )

    async def execute(self, query: str, num_results: int = 5) -> dict:
        # Mock implementation - replace with real search API
        results = [
            {
                "title": f"Result {i+1}: {query}",
                "url": f"https://example.com/article-{i+1}",
                "snippet": f"Information about {query}..."
            }
            for i in range(num_results)
        ]
        return {"success": True, "results": results}

class FetchURLTool(Tool):
    """Fetch content from a URL"""
    def __init__(self):
        super().__init__(
            name="fetch_url",
            description="Fetch and extract content from a URL",
            parameters={
                "url": {"type": "string", "description": "URL to fetch"}
            }
        )

    async def execute(self, url: str) -> dict:
        # Mock implementation
        content = f"""
        Article from {url}:

        Key findings about the topic:
        - Finding 1 with supporting evidence
        - Finding 2 with expert analysis
        - Finding 3 with relevant data
        """
        return {"success": True, "content": content}

class VectorSearchTool(Tool):
    """
    Oracle-specific: Search using AI Vector Search in Autonomous Database.
    This is unique to Oracle - semantic search directly in the database.
    """
    def __init__(self):
        super().__init__(
            name="vector_search",
            description="Search knowledge base using semantic similarity (Oracle AI Vector Search)",
            parameters={
                "query": {"type": "string", "description": "Semantic search query"},
                "top_k": {"type": "integer", "default": 5}
            }
        )

    async def execute(self, query: str, top_k: int = 5) -> dict:
        """
        In production, this would:
        1. Generate embedding for query using OCI Generative AI
        2. Execute vector similarity search in Autonomous DB
        3. Return semantically similar documents
        """
        # Mock implementation
        # Real implementation would use:
        # SELECT content, VECTOR_DISTANCE(embedding, :query_vec, COSINE) as distance
        # FROM documents
        # ORDER BY distance
        # FETCH FIRST :top_k ROWS ONLY

        results = [
            {
                "content": f"Semantically similar content {i+1} for: {query}",
                "distance": 0.1 * (i + 1),
                "source": f"internal_doc_{i+1}"
            }
            for i in range(top_k)
        ]
        return {"success": True, "results": results}

# ============================================================================
# Pillar 3: Guardrails - Input/Output Validation
# ============================================================================

def validate_input(query: str) -> tuple[bool, str]:
    """Input guardrail"""
    if len(query) < 10:
        return False, "Query too short"
    if len(query) > 2000:
        return False, "Query too long"

    # OCI-specific: Check for prohibited content
    prohibited = ["hack", "exploit", "illegal"]
    for word in prohibited:
        if word.lower() in query.lower():
            return False, f"Prohibited content: {word}"

    return True, "Valid"

def validate_output(report: str) -> tuple[bool, str]:
    """Output guardrail"""
    if len(report) < 100:
        return False, "Report too short"

    required = ["summary", "finding", "source"]
    for term in required:
        if term.lower() not in report.lower():
            return False, f"Missing: {term}"

    return True, "Valid"

# ============================================================================
# Main Agent
# ============================================================================

class OracleResearchAgent:
    """
    Research agent using Oracle ADK patterns.

    Architecture:
    - OCI Generative AI for LLM inference
    - Tools for web search and URL fetching
    - Optional: AI Vector Search for knowledge base
    - OCI Logging for observability
    """

    def __init__(self):
        self.oci_config = get_oci_config()
        self.client = GenerativeAiInferenceClient(self.oci_config)
        self.tools = [
            WebSearchTool(),
            FetchURLTool(),
            VectorSearchTool(),
        ]
        self.state = None

    def _get_tool_descriptions(self) -> str:
        """Format tool descriptions for the prompt"""
        descriptions = []
        for tool in self.tools:
            params = ", ".join([f"{k}: {v['type']}" for k, v in tool.parameters.items()])
            descriptions.append(f"- {tool.name}({params}): {tool.description}")
        return "\n".join(descriptions)

    async def _call_llm(self, messages: list[dict]) -> str:
        """Call OCI Generative AI"""
        # Format messages for Cohere
        chat_history = []
        for msg in messages[:-1]:
            chat_history.append({
                "role": "USER" if msg["role"] == "user" else "CHATBOT",
                "message": msg["content"]
            })

        current_message = messages[-1]["content"]

        request = CohereChatRequest(
            message=current_message,
            chat_history=chat_history,
            max_tokens=config.max_tokens,
            temperature=config.temperature,
        )

        response = self.client.chat(
            chat_details=ChatDetails(
                compartment_id=config.compartment_id,
                serving_mode=OnDemandServingMode(model_id=config.model_id),
                chat_request=request,
            )
        )

        return response.data.chat_response.text

    async def _execute_tool(self, tool_name: str, args: dict) -> dict:
        """Execute a tool by name"""
        for tool in self.tools:
            if tool.name == tool_name:
                return await tool.execute(**args)
        return {"error": f"Unknown tool: {tool_name}"}

    async def run(self, query: str) -> dict:
        """Execute research workflow"""
        self.state = ResearchState(query=query)

        # Pillar 3: Input validation
        is_valid, msg = validate_input(query)
        if not is_valid:
            return {"error": msg}

        print(f"\n🔍 Starting Oracle ADK research: {query}\n")

        system_prompt = f"""You are a research assistant using Oracle Cloud Infrastructure.

Available tools:
{self._get_tool_descriptions()}

To use a tool, respond with:
TOOL: tool_name
ARGS: {{"param": "value"}}

After gathering information from at least 3 sources, write your report.

Report format:
## Summary
[Overview]

## Key Findings
- Finding 1
- Finding 2

## Sources
- [Source 1](url)
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Research: {query}"}
        ]

        iteration = 0
        while iteration < config.max_iterations:
            iteration += 1
            self.state.tool_calls += 1

            # Call LLM
            response = await self._call_llm(messages)
            messages.append({"role": "assistant", "content": response})

            # Check for tool call
            if "TOOL:" in response:
                # Parse tool call (simplified)
                lines = response.split("\n")
                tool_name = None
                tool_args = {}

                for line in lines:
                    if line.startswith("TOOL:"):
                        tool_name = line.replace("TOOL:", "").strip()
                    elif line.startswith("ARGS:"):
                        try:
                            args_str = line.replace("ARGS:", "").strip()
                            tool_args = json.loads(args_str)
                        except:
                            pass

                if tool_name:
                    result = await self._execute_tool(tool_name, tool_args)
                    messages.append({
                        "role": "user",
                        "content": f"Tool result: {json.dumps(result)}"
                    })

                    # Store sources
                    if "results" in result:
                        self.state.sources.extend(result["results"])
            else:
                # No tool call, check if report is complete
                if "## Summary" in response and "## Sources" in response:
                    self.state.report = response
                    break

        # Pillar 3: Output validation
        is_valid, msg = validate_output(self.state.report)
        if not is_valid:
            self.state.errors.append(f"Output validation: {msg}")

        # Pillar 4: Observability
        duration = (datetime.now() - self.state.started_at).total_seconds()
        print(f"\n📊 Completed in {duration:.1f}s with {self.state.tool_calls} tool calls")

        return {
            "report": self.state.report,
            "sources": self.state.sources,
            "tool_calls": self.state.tool_calls,
            "duration_seconds": duration,
            "errors": self.state.errors
        }

# ============================================================================
# CLI Entry Point
# ============================================================================

async def main():
    import sys

    if len(sys.argv) < 2:
        print("Usage: python main.py 'Your research question'")
        sys.exit(1)

    query = sys.argv[1]
    agent = OracleResearchAgent()
    result = await agent.run(query)

    if "error" in result:
        print(f"\n❌ Error: {result['error']}")
    else:
        print("\n📄 Research Report:\n")
        print(result["report"])

if __name__ == "__main__":
    asyncio.run(main())

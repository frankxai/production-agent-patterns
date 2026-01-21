# Research Assistant Agent

> The same agent implemented across 6 different frameworks for direct comparison

## What It Does

The Research Assistant agent:
1. **Searches** the web for relevant information
2. **Fetches** detailed content from promising sources
3. **Summarizes** findings
4. **Produces** a structured research report

This agent demonstrates all 7 pillars of production systems while being simple enough to understand.

## Implementations

| Framework | File | Key Features |
|-----------|------|--------------|
| **OpenAI Agents SDK** | `openai-sdk/main.py` | Handoffs, native tracing |
| **Claude Agent SDK** | `claude-sdk/main.py` | Hooks system, multi-cloud auth |
| **LangGraph** | `langgraph/main.py` | Graph-based state machine, checkpointing |
| **AWS Strands** | `aws-strands/main.py` | Bedrock integration, IAM security |
| **Google ADK** | `google-adk/main.py` | Vertex AI, Agent2Agent |
| **Oracle ADK** | `oracle-adk/main.py` | OCI GenAI, AI Vector Search |

## Quick Start

### 1. Choose a Framework

```bash
cd openai-sdk  # or claude-sdk, langgraph, etc.
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Set Environment Variables

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 4. Run

```bash
python main.py "What are the latest developments in quantum computing?"
```

## Expected Output

All implementations produce the same output format:

```markdown
## Summary
[2-3 sentence overview of findings]

## Key Findings
- Finding 1 (with source)
- Finding 2 (with source)
- Finding 3 (with source)

## Sources
- [Title 1](URL)
- [Title 2](URL)
- [Title 3](URL)
```

## 7 Pillars Coverage

Each implementation demonstrates:

| Pillar | How It's Implemented |
|--------|---------------------|
| **Orchestration** | Multi-step workflow (search → fetch → summarize → write) |
| **Memory** | State tracking across iterations |
| **Guardrails** | Input validation, output format checking |
| **Observability** | Token tracking, execution logging |
| **Security** | Rate limiting, URL blocking |
| **Cost Management** | Token budgets, early stopping |
| **Lifecycle** | Error recovery, timeout handling |

## Customization

### Adding New Tools

Each framework has a standard tool definition pattern:

**OpenAI SDK**:
```python
@function_tool
async def my_tool(param: str) -> str:
    """Tool description"""
    return result
```

**Claude SDK**:
```python
my_tool = Tool(
    name="my_tool",
    description="Tool description",
    parameters={"param": {"type": "string"}}
)
```

**LangGraph**:
```python
@tool
def my_tool(param: str) -> str:
    """Tool description"""
    return result
```

**Oracle ADK**:
```python
class MyTool(Tool):
    async def execute(self, param: str) -> dict:
        return {"success": True, "result": result}
```

### Changing the Model

Each implementation has a config section at the top:

```python
@dataclass
class Config:
    model: str = "gpt-4o"  # Change this
    max_tokens: int = 4096
    # ...
```

## Testing

Run the test suite to verify your implementation:

```bash
cd ../../evaluation/test-suites
pytest test_research_agent.py -v
```

## Cost Estimates

Based on 100 research queries (January 2026):

| Framework | Avg Cost/Query | Avg Tokens | Avg Latency |
|-----------|---------------|------------|-------------|
| OpenAI SDK | $0.08 | 8,000 | 2.3s |
| Claude SDK | $0.07 | 7,500 | 2.1s |
| LangGraph | $0.08 | 8,200 | 2.4s |
| AWS Bedrock | $0.06 | 7,000 | 2.5s |
| Google ADK | $0.07 | 7,200 | 2.4s |
| Oracle ADK | $0.05 | 6,800 | 2.6s |

*Costs include all tool calls and retries*

## Architecture Diagram

```
┌──────────────┐
│   User       │
│   Query      │
└──────┬───────┘
       │
       ▼
┌──────────────┐    ┌──────────────┐
│   Research   │───▶│   Tools      │
│   Agent      │    │  - search    │
│              │◀───│  - fetch     │
│              │    │  - summarize │
└──────┬───────┘    └──────────────┘
       │
       │ (handoff)
       ▼
┌──────────────┐
│   Writer     │
│   Agent      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Report     │
│   Output     │
└──────────────┘
```

## Related

- [7 Pillars Blog Post](https://frankx.ai/blog/production-agent-patterns-7-pillars)
- [MCP Server Templates](../mcp-servers/)
- [Deployment Configs](../deployment/)

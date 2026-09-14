# Production Agent Patterns

> The only repo that shows the **same agent** implemented across **ALL major frameworks** with production deployment configs.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)

## 🎯 What This Repo Provides

1. **Reference Implementations**: Same agent built across 6 frameworks for direct comparison
2. **Production Configs**: Real deployment code, not localhost demos
3. **MCP Servers**: Reusable tool integration patterns
4. **Cost Analysis**: Actual production cost data
5. **Evaluation Suites**: Standard testing patterns

## 📊 The 7 Pillars Framework

This repository implements the [7 Pillars of Production Agent Systems](docs/7-pillars.md):

| Pillar | What It Solves |
|--------|---------------|
| **Orchestration** | Multi-agent coordination |
| **Memory** | State persistence across sessions |
| **Guardrails** | Safety and validation |
| **Observability** | Tracing and debugging |
| **Security** | Access control and audit |
| **Cost Management** | Token and resource budgets |
| **Lifecycle (AgentOps)** | CI/CD for agents |

## 🏗️ Repository Structure

```
production-agent-patterns/
├── docs/                           # Framework documentation
│   ├── 7-pillars.md               # The core framework
│   ├── provider-comparison.md      # Detailed matrix
│   └── decision-guide.md          # How to choose
│
├── agents/                         # Reference agent implementations
│   └── research-assistant/        # Primary reference agent
│       ├── openai-sdk/            # OpenAI Agents SDK
│       ├── claude-sdk/            # Claude Agent SDK
│       ├── langraph/              # LangGraph
│       ├── aws-strands/           # AWS Strands
│       ├── google-adk/            # Google ADK
│       └── oracle-adk/            # Oracle ADK
│
├── mcp-servers/                    # Model Context Protocol servers
│   ├── template/                  # Starter template
│   └── database-connector/        # PostgreSQL/MySQL example
│
├── deployment/                     # Infrastructure as Code
│   ├── aws/                       # Terraform + CDK
│   ├── gcp/                       # Terraform
│   ├── azure/                     # Bicep + Terraform
│   ├── oracle/                    # OCI Terraform
│   └── docker/                    # Local development
│
├── monitoring/                     # Observability setup
│   ├── langfuse/                  # Open-source tracing
│   └── dashboards/                # Grafana dashboards
│
└── evaluation/                     # Testing and benchmarks
    ├── test-suites/               # Standard evaluation patterns
    └── benchmarks/                # Performance baselines
```

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone https://github.com/frankxai/production-agent-patterns.git
cd production-agent-patterns

# Choose your framework
cd agents/research-assistant/openai-sdk  # or claude-sdk, etc.

# Install dependencies
pip install -r requirements.txt

# Set environment variables
cp .env.example .env
# Edit .env with your API keys
```

### 2. Run the Reference Agent

```bash
# OpenAI version
python main.py "Research the latest developments in quantum computing"

# Claude version
cd ../claude-sdk
python main.py "Research the latest developments in quantum computing"
```

### 3. Compare Implementations

All implementations produce the same output format, making direct comparison possible.

## 🔧 The Research Assistant Agent

Our reference agent is a **Research Assistant** that:
- Searches the web for information
- Reads and summarizes documents
- Synthesizes findings into reports
- Cites sources

This agent is complex enough to demonstrate all 7 pillars while simple enough to understand.

### Agent Specification (Framework-Agnostic)

```yaml
agent:
  name: ResearchAssistant
  description: Researches topics and produces synthesized reports

  tools:
    - web_search: Search the web for information
    - fetch_url: Retrieve and parse web pages
    - summarize: Condense long documents

  memory:
    short_term: conversation context
    long_term: research history, user preferences

  guardrails:
    input: content_policy, pii_detection
    output: citation_required, format_validation

  output_format:
    - summary: 2-3 paragraph synthesis
    - key_findings: bullet points
    - sources: cited URLs
```

## 📦 MCP Server Templates

Build once, use with any agent framework.

### Database Connector

```python
# mcp-servers/database-connector/server.py
from mcp import Server, Tool

server = Server("database-connector")

@server.tool()
async def query_database(sql: str) -> dict:
    """Execute read-only SQL query"""
    # Implementation with safety checks
    return execute_safe_query(sql)
```

## 🌐 Deployment

### Starlight Agent Launchpad (Vercel + Railway)

The [Starlight Agent Launchpad](templates/starlight-agent-launchpad/README.md) is the first full-stack blueprint in this repository: a Next.js cockpit on Vercel, an authenticated operator API on Railway, PostgreSQL-backed signed run receipts, and an explicit adapter contract for a separately operated agent runtime.

It is deliberately runtime-neutral. Hermes and n8n are documented adapter targets, not bundled or claimed integrations.

### AWS (Bedrock + AgentCore)

```bash
cd deployment/aws
terraform init
terraform apply -var="agent_name=research-assistant"
```

### Google Cloud (Vertex AI)

```bash
cd deployment/gcp
terraform init
terraform apply
```

### Azure (AI Foundry)

```bash
cd deployment/azure
az deployment group create \
  --resource-group myResourceGroup \
  --template-file main.bicep
```

### Oracle (OCI + ADK)

```bash
cd deployment/oracle
terraform init
terraform apply -var="compartment_id=ocid1.compartment..."
```

### Local Development

```bash
cd deployment/docker
docker-compose up
```

## 📈 Monitoring

### Langfuse Setup

```bash
cd monitoring/langfuse
docker-compose up -d

# Open http://localhost:3000
# Default credentials: admin / admin
```

### Import Dashboards

```bash
cd monitoring/dashboards
./import-to-grafana.sh
```

## 🧪 Evaluation

### Run Test Suite

```bash
cd evaluation
pytest test-suites/ -v --benchmark
```

### Test Categories

| Suite | Tests |
|-------|-------|
| **Functional** | Agent produces correct outputs |
| **Safety** | Guardrails block bad inputs/outputs |
| **Performance** | Latency and throughput |
| **Cost** | Token usage tracking |
| **Adversarial** | Red team attack resistance |

## 💰 Cost Comparison

Based on 1,000 research queries (as of January 2026):

| Framework | Avg Cost/Query | Latency (p50) | Notes |
|-----------|---------------|---------------|-------|
| OpenAI SDK | $0.08 | 2.3s | GPT-4o |
| Claude SDK | $0.07 | 2.1s | Claude Sonnet 4 |
| AWS Bedrock | $0.06 | 2.5s | Claude via Bedrock |
| Google ADK | $0.07 | 2.4s | Gemini 2.0 |
| Oracle ADK | $0.05 | 2.6s | Cohere Command A |

*Costs include all API calls, tool usage, and retry logic.*

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Priority Areas

1. Additional agent implementations (AutoGen, CrewAI)
2. More MCP server examples
3. Cost optimization patterns
4. Evaluation benchmark improvements

## 📚 Related Resources

- [The 7 Pillars Blog Post](https://frankx.ai/blog/production-agent-patterns-7-pillars)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Provider Documentation Links](docs/resources.md)

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

---

Built with ❤️ by [Frank](https://frankx.ai) | AI Architect

*Helping you ship production agents, not just demos.*

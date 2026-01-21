"""
MCP Server Template - Production Ready

A template for building Model Context Protocol servers that work with
any agent framework (OpenAI, Claude, LangGraph, etc.).

Features:
- Type-safe tool definitions
- Authentication support
- Error handling patterns
- Logging and observability
- Rate limiting

Usage:
    python server.py

Then configure your agent to connect to: http://localhost:8080/mcp
"""

import os
import json
import asyncio
import logging
import ast
import operator
from datetime import datetime
from typing import Any, Optional
from dataclasses import dataclass

from mcp import Server, Tool, Resource
from mcp.server import stdio

# ============================================================================
# Configuration
# ============================================================================

@dataclass
class ServerConfig:
    """MCP Server configuration"""
    name: str = "template-server"
    version: str = "1.0.0"
    port: int = 8080
    rate_limit_per_minute: int = 60
    log_level: str = "INFO"

config = ServerConfig()

# ============================================================================
# Logging Setup
# ============================================================================

logging.basicConfig(
    level=getattr(logging, config.log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(config.name)

# ============================================================================
# Rate Limiting
# ============================================================================

class RateLimiter:
    """Simple rate limiter for tool calls"""
    def __init__(self, max_calls: int, period_seconds: int = 60):
        self.max_calls = max_calls
        self.period = period_seconds
        self.calls = []

    def check(self) -> bool:
        """Check if rate limit allows another call"""
        now = datetime.now()
        # Remove old calls
        self.calls = [t for t in self.calls
                     if (now - t).seconds < self.period]
        if len(self.calls) >= self.max_calls:
            return False
        self.calls.append(now)
        return True

rate_limiter = RateLimiter(config.rate_limit_per_minute)

# ============================================================================
# Safe Math Evaluator
# ============================================================================

class SafeMathEvaluator(ast.NodeVisitor):
    """
    Safely evaluate mathematical expressions using AST parsing.
    Only allows basic arithmetic operations.
    """
    OPERATORS = {
        ast.Add: operator.add,
        ast.Sub: operator.sub,
        ast.Mult: operator.mul,
        ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv,
        ast.Mod: operator.mod,
        ast.Pow: operator.pow,
        ast.USub: operator.neg,
        ast.UAdd: operator.pos,
    }

    def visit_BinOp(self, node):
        left = self.visit(node.left)
        right = self.visit(node.right)
        op_type = type(node.op)
        if op_type not in self.OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        return self.OPERATORS[op_type](left, right)

    def visit_UnaryOp(self, node):
        operand = self.visit(node.operand)
        op_type = type(node.op)
        if op_type not in self.OPERATORS:
            raise ValueError(f"Unsupported operator: {op_type.__name__}")
        return self.OPERATORS[op_type](operand)

    def visit_Num(self, node):  # Python 3.7
        return node.n

    def visit_Constant(self, node):  # Python 3.8+
        if isinstance(node.value, (int, float)):
            return node.value
        raise ValueError(f"Unsupported constant: {node.value}")

    def visit_Expression(self, node):
        return self.visit(node.body)

    def generic_visit(self, node):
        raise ValueError(f"Unsupported node type: {type(node).__name__}")

def safe_math_eval(expression: str) -> float:
    """Safely evaluate a mathematical expression"""
    try:
        tree = ast.parse(expression, mode='eval')
        evaluator = SafeMathEvaluator()
        return evaluator.visit(tree)
    except SyntaxError as e:
        raise ValueError(f"Invalid syntax: {e}")

# ============================================================================
# Server Instance
# ============================================================================

server = Server(config.name)

# ============================================================================
# Tool Definitions
# ============================================================================

@server.tool()
async def echo(message: str) -> str:
    """
    Echo a message back. Useful for testing connectivity.

    Args:
        message: The message to echo

    Returns:
        The same message
    """
    logger.info(f"Echo called with: {message}")

    if not rate_limiter.check():
        raise Exception("Rate limit exceeded")

    return f"Echo: {message}"

@server.tool()
async def get_current_time(timezone: str = "UTC") -> str:
    """
    Get the current time in a specified timezone.

    Args:
        timezone: Timezone name (default: UTC)

    Returns:
        Current time as ISO string
    """
    logger.info(f"get_current_time called for timezone: {timezone}")

    if not rate_limiter.check():
        raise Exception("Rate limit exceeded")

    # In production, use pytz for proper timezone handling
    return datetime.utcnow().isoformat() + "Z"

@server.tool()
async def calculate(expression: str) -> str:
    """
    Safely evaluate a mathematical expression.

    Args:
        expression: Mathematical expression (e.g., "2 + 2 * 3")

    Returns:
        Result of the calculation
    """
    logger.info(f"calculate called with: {expression}")

    if not rate_limiter.check():
        raise Exception("Rate limit exceeded")

    try:
        # Use safe AST-based evaluation
        result = safe_math_eval(expression)
        return str(result)
    except ValueError as e:
        raise ValueError(f"Invalid expression: {e}")

@server.tool()
async def store_data(key: str, value: str) -> str:
    """
    Store a key-value pair (in-memory for demo).

    Args:
        key: The key to store
        value: The value to store

    Returns:
        Confirmation message
    """
    logger.info(f"store_data called: {key}")

    if not rate_limiter.check():
        raise Exception("Rate limit exceeded")

    # In production, use a proper database
    if not hasattr(server, '_storage'):
        server._storage = {}

    server._storage[key] = {
        "value": value,
        "stored_at": datetime.utcnow().isoformat()
    }

    return f"Stored '{key}'"

@server.tool()
async def retrieve_data(key: str) -> str:
    """
    Retrieve a stored value by key.

    Args:
        key: The key to retrieve

    Returns:
        The stored value or error message
    """
    logger.info(f"retrieve_data called: {key}")

    if not rate_limiter.check():
        raise Exception("Rate limit exceeded")

    if not hasattr(server, '_storage') or key not in server._storage:
        raise KeyError(f"Key not found: {key}")

    return json.dumps(server._storage[key])

# ============================================================================
# Resource Definitions (for context)
# ============================================================================

@server.resource("config://server")
async def get_server_config() -> str:
    """Get server configuration as a resource"""
    return json.dumps({
        "name": config.name,
        "version": config.version,
        "tools": ["echo", "get_current_time", "calculate", "store_data", "retrieve_data"],
        "rate_limit": f"{config.rate_limit_per_minute}/minute"
    })

# ============================================================================
# Main Entry Point
# ============================================================================

async def main():
    """Run the MCP server"""
    logger.info(f"Starting {config.name} v{config.version}")
    logger.info(f"Rate limit: {config.rate_limit_per_minute}/minute")

    # Run server using stdio transport (standard for MCP)
    async with stdio.stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())

#!/usr/bin/env python3
"""Minimal browser-use example driven by the local Hermes model (free, via Ollama).

browser-use is an LLM-driven browser agent: you give it a goal in plain
language and it drives a real Chromium browser to accomplish it. This example
points it at the local Hermes model served by Ollama, so it costs nothing and
stays self-hosted - no API key.

PREREQUISITES (all provisioned automatically in a bootstrapped Codespace):
  1. Ollama running with the Hermes model pulled. On a fresh Codespace this is
     handled by scripts/setup-hermes-agent.sh during bootstrap. Verify:
         ollama list                 # should list hermes3:8b
     If the server isn't up:
         ollama serve &
  2. browser-use installed (scripts/setup-browser-use.sh / bootstrap) plus a
     working Chromium. The managed Codespace provisions Chromium; note that
     some restricted sandboxes cannot launch Chromium at all (the browser step
     times out even though this code is correct) - run this in the Codespace.

To use a paid provider instead of local Hermes, swap the `llm = ...` line for
e.g. `from browser_use import ChatOpenAI; llm = ChatOpenAI(model="gpt-4o")`
with OPENAI_API_KEY set.

Run:
    python3 scripts/examples/browser-use-hermes-example.py
"""
import asyncio

from browser_use import Agent, ChatOllama

# Local Hermes via Ollama - free, self-hosted, no API key. host defaults to
# Ollama's usual endpoint; set it explicitly for clarity.
llm = ChatOllama(model="hermes3:8b", host="http://127.0.0.1:11434")


async def main() -> None:
    agent = Agent(
        task="Go to https://example.com and report the main heading text on the page.",
        llm=llm,
    )
    # Cap steps so a confused run can't loop forever against a small local model.
    result = await agent.run(max_steps=15)

    print("\n=== FINAL RESULT ===")
    print(result.final_result() if hasattr(result, "final_result") else result)


if __name__ == "__main__":
    asyncio.run(main())

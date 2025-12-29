// Test with ANTHROPIC_API_KEY (if set)
import { query } from '@anthropic-ai/claude-agent-sdk';

async function test() {
  // DON'T remove ANTHROPIC_API_KEY - use it if available
  const q = query({
    prompt: 'Say "hi"',
    options: {
      tools: [],
      maxTurns: 1
      // No env override - will use ANTHROPIC_API_KEY if set
    }
  });

  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log('API Key Source:', msg.apiKeySource);
    }
    if (msg.type === 'result') {
      console.log('Result:', msg.subtype);
      if (msg.subtype === 'success') {
        console.log('Response:', msg.result);
      }
    }
  }
}

test().catch(console.error);

// Check Agent SDK authentication
import { query } from '@anthropic-ai/claude-agent-sdk';

async function checkAuth() {
  // Remove ANTHROPIC_API_KEY to use Claude Code auth
  const { ANTHROPIC_API_KEY, ...envWithoutApiKey } = process.env;

  const q = query({
    prompt: 'Say "hi"',
    options: {
      tools: [],
      maxTurns: 1,
      env: envWithoutApiKey as Record<string, string>
    }
  });

  for await (const msg of q) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      console.log('=== Auth Info ===');
      console.log('API Key Source:', msg.apiKeySource);
      console.log('Model:', msg.model);
      console.log('Tools:', msg.tools.length);
    }
    if (msg.type === 'result') {
      console.log('\n=== Result ===');
      console.log('Cost USD:', msg.total_cost_usd);
      if (msg.subtype === 'success') {
        console.log('Response:', msg.result);
      }
    }
  }
}

checkAuth().catch(console.error);

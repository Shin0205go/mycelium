/**
 * Interactive Tool Selector - Arrow-key based tool selection with details view
 */

import chalk from 'chalk';
import type { AgentManifest } from '../mcp-client.js';

export type ToolInfo = AgentManifest['availableTools'][0];

/**
 * Interactive tool selector with arrow-key navigation and detail view
 * @param tools - List of available tools
 */
export function interactiveToolSelector(tools: ToolInfo[]): Promise<void> {
  return new Promise((resolve) => {
    let selectedIndex = 0;
    let viewingDetail = false;

    const render = () => {
      process.stdout.write('\x1B[?25l'); // Hide cursor
      console.log(chalk.cyan('\nTools:') + chalk.gray(' (↑↓: move, Enter: view details, q: back)\n'));

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i];
        const isSelected = i === selectedIndex;
        const shortName = tool.name.replace(`${tool.source}__`, '');

        const marker = isSelected ? chalk.cyan('▶') : ' ';
        const name = isSelected ? chalk.cyan.bold(shortName) : shortName;
        const source = chalk.gray(`[${tool.source}]`);

        console.log(`  ${marker} ${name} ${source}`);
      }
    };

    const clearScreen = () => {
      const totalLines = tools.length + 3;
      process.stdout.write(`\x1B[${totalLines}A`);
      for (let i = 0; i < totalLines; i++) {
        process.stdout.write('\x1B[2K\n');
      }
      process.stdout.write(`\x1B[${totalLines}A`);
    };

    const showDetail = (tool: ToolInfo) => {
      clearScreen();
      const shortName = tool.name.replace(`${tool.source}__`, '');
      console.log(chalk.cyan(`\n${chalk.bold(shortName)}`));
      console.log(chalk.gray(`Source: ${tool.source}`));
      console.log(chalk.gray(`Full name: ${tool.name}\n`));
      if (tool.description) {
        console.log(tool.description);
      } else {
        console.log(chalk.gray('No description available.'));
      }
      console.log(chalk.gray('\nPress any key to go back...'));
    };

    render();

    const wasRaw = process.stdin.isRaw;
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const cleanup = () => {
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(wasRaw || false);
      }
      process.stdin.removeListener('data', onKeyPress);
      process.stdout.write('\x1B[?25h'); // Show cursor
    };

    const onKeyPress = (key: Buffer) => {
      const keyStr = key.toString();

      if (viewingDetail) {
        // Any key goes back to list
        viewingDetail = false;
        clearScreen();
        render();
        return;
      }

      if (keyStr === '\x1B[A' || keyStr === 'k') { // Up arrow or k
        clearScreen();
        selectedIndex = (selectedIndex - 1 + tools.length) % tools.length;
        render();
      } else if (keyStr === '\x1B[B' || keyStr === 'j') { // Down arrow or j
        clearScreen();
        selectedIndex = (selectedIndex + 1) % tools.length;
        render();
      } else if (keyStr === '\r' || keyStr === '\n') { // Enter
        viewingDetail = true;
        showDetail(tools[selectedIndex]);
      } else if (keyStr === 'q' || keyStr === '\x1B' || keyStr === '\x03') { // q, Escape, Ctrl+C
        clearScreen();
        cleanup();
        resolve();
      }
    };

    process.stdin.on('data', onKeyPress);
  });
}

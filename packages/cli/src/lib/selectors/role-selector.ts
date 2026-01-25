/**
 * Interactive Role Selector - Arrow-key based role selection
 */

import chalk from 'chalk';
import type { ListRolesResult } from '../mcp-client.js';

export type RoleInfo = ListRolesResult['roles'][0];

/**
 * Interactive role selector with arrow-key navigation
 * @param roles - List of available roles
 * @returns Selected role ID or null if cancelled
 */
export function interactiveRoleSelector(roles: RoleInfo[]): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIndex = roles.findIndex(r => r.isCurrent);
    if (selectedIndex === -1) selectedIndex = 0;

    const render = () => {
      process.stdout.write('\x1B[?25l'); // Hide cursor
      console.log(chalk.cyan('\nSelect Role:') + chalk.gray(' (↑↓: move, Enter: select, q: cancel)\n'));

      for (let i = 0; i < roles.length; i++) {
        const role = roles[i];
        const isSelected = i === selectedIndex;
        const isCurrent = role.isCurrent;

        const marker = isSelected ? chalk.cyan('▶') : ' ';
        const name = isSelected ? chalk.cyan.bold(role.id) : (isCurrent ? chalk.green(role.id) : role.id);
        const currentTag = isCurrent ? chalk.green(' (current)') : '';

        console.log(`  ${marker} ${name}${currentTag}`);
        console.log(chalk.gray(`    Skills: ${role.skills.join(', ') || 'none'}`));
        console.log(chalk.gray(`    Tools: ${role.toolCount} | Servers: ${role.serverCount}\n`));
      }
    };

    const clearScreen = () => {
      const totalLines = roles.length * 4 + 3;
      process.stdout.write(`\x1B[${totalLines}A`);
      for (let i = 0; i < totalLines; i++) {
        process.stdout.write('\x1B[2K\n');
      }
      process.stdout.write(`\x1B[${totalLines}A`);
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

      if (keyStr === '\x1B[A' || keyStr === 'k') { // Up arrow or k
        clearScreen();
        selectedIndex = (selectedIndex - 1 + roles.length) % roles.length;
        render();
      } else if (keyStr === '\x1B[B' || keyStr === 'j') { // Down arrow or j
        clearScreen();
        selectedIndex = (selectedIndex + 1) % roles.length;
        render();
      } else if (keyStr === '\r' || keyStr === '\n') { // Enter
        clearScreen();
        cleanup();
        resolve(roles[selectedIndex].id);
      } else if (keyStr === 'q' || keyStr === '\x1B' || keyStr === '\x03') { // q, Escape, Ctrl+C
        clearScreen();
        cleanup();
        console.log(chalk.gray('Cancelled'));
        resolve(null);
      }
    };

    process.stdin.on('data', onKeyPress);
  });
}

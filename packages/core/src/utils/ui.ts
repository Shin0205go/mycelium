// ============================================================================
// Mycelium CLI - UI Utilities
// ============================================================================

import ora, { type Ora } from 'ora';
import Table from 'cli-table3';
import boxen from 'boxen';
import figures from 'figures';
import chalk from 'chalk';
import { distance } from 'fastest-levenshtein';

// ============================================================================
// Icons
// ============================================================================

export const icons = {
  success: chalk.green(figures.tick),
  error: chalk.red(figures.cross),
  warning: chalk.yellow(figures.warning),
  info: chalk.blue(figures.info),
  pointer: chalk.cyan(figures.pointer),
  arrowRight: figures.arrowRight,
  bullet: figures.bullet,
  // Emoji icons
  role: '🎭',
  tool: '🔧',
  model: '🧠',
  auth: '🔐',
  session: '💾',
  tokens: '📊',
  cost: '💰',
  mushroom: '🍄',
  server: '🖥️',
  skill: '✨',
} as const;

// ============================================================================
// Spinners
// ============================================================================

export function createSpinner(text: string): Ora {
  return ora({
    text,
    spinner: 'dots',
    color: 'cyan',
  });
}

// ============================================================================
// Tables
// ============================================================================

export interface RoleInfo {
  id: string;
  description: string;
  serverCount: number;
  toolCount: number;
  skills: string[];
  isCurrent: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  server?: string;
}

export function createRolesTable(roles: RoleInfo[], currentRole: string): string {
  const table = new Table({
    head: [
      chalk.cyan('Role'),
      chalk.cyan('Skills'),
      chalk.cyan('Tools'),
      chalk.cyan('Status'),
    ],
    style: {
      head: [],
      border: ['gray'],
    },
    colWidths: [18, 35, 8, 10],
    wordWrap: true,
  });

  for (const role of roles) {
    const isCurrent = role.id === currentRole;
    const roleDisplay = isCurrent
      ? chalk.green(`${icons.role} ${role.id}`)
      : `   ${role.id}`;
    const skills = role.skills.slice(0, 3).join(', ') + (role.skills.length > 3 ? '...' : '');
    const status = isCurrent ? chalk.green('current') : '';

    table.push([roleDisplay, skills, role.toolCount.toString(), status]);
  }

  return table.toString();
}

export function createToolsTable(tools: ToolInfo[]): string {
  // Group tools by server
  const grouped = new Map<string, ToolInfo[]>();

  for (const tool of tools) {
    const server = tool.server || 'other';
    if (!grouped.has(server)) {
      grouped.set(server, []);
    }
    grouped.get(server)!.push(tool);
  }

  const table = new Table({
    head: [chalk.cyan('Tool'), chalk.cyan('Description')],
    style: {
      head: [],
      border: ['gray'],
    },
    colWidths: [30, 50],
    wordWrap: true,
  });

  for (const [server, serverTools] of grouped) {
    // Server header
    table.push([
      { content: chalk.yellow(`${icons.server} ${server} (${serverTools.length})`), colSpan: 2 },
    ]);

    // Tools under this server
    for (const tool of serverTools.slice(0, 5)) {
      const shortName = tool.name.replace(`${server}__`, '');
      const desc = tool.description?.slice(0, 45) || '';
      table.push([`  ${shortName}`, desc]);
    }

    if (serverTools.length > 5) {
      table.push([{ content: chalk.gray(`  ... and ${serverTools.length - 5} more`), colSpan: 2 }]);
    }
  }

  return table.toString();
}

// ============================================================================
// Boxes
// ============================================================================

export function statusBox(content: string, title?: string): string {
  return boxen(content, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'cyan',
    title,
    titleAlignment: 'left',
  });
}

export function errorBox(message: string, suggestions?: string[]): string {
  let content = chalk.red(message);

  if (suggestions && suggestions.length > 0) {
    content += '\n\n' + chalk.yellow('Try:');
    for (const suggestion of suggestions) {
      content += `\n  ${icons.bullet} ${suggestion}`;
    }
  }

  return boxen(content, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: { top: 1, bottom: 1, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'red',
    title: 'Error',
    titleAlignment: 'left',
  });
}

export function successBox(message: string): string {
  return boxen(chalk.green(message), {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'green',
  });
}

export function usageBox(input: number, output: number, cost: number, model: string): string {
  const content = [
    `${icons.tokens} Input:  ${input.toLocaleString()} tokens`,
    `${icons.tokens} Output: ${output.toLocaleString()} tokens`,
    `${icons.cost} Cost:   $${cost.toFixed(4)}`,
    `${icons.model} Model:  ${model}`,
  ].join('\n');

  return boxen(content, {
    padding: { left: 1, right: 1, top: 0, bottom: 0 },
    margin: { top: 1, bottom: 0, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'gray',
    title: 'Usage',
    titleAlignment: 'left',
  });
}

// ============================================================================
// Status Header
// ============================================================================

export function createHeader(role: string, model: string, queryCount: number): string {
  const shortModel = model.split('-').slice(-2, -1)[0] || model; // Extract "haiku" from "claude-3-5-haiku-20241022"
  const content = `  ${icons.role} Role: ${chalk.bold(role)}  │  ${icons.model} ${shortModel}  │  ${icons.session} Queries: ${queryCount}`;

  return boxen(content, {
    padding: { left: 0, right: 0, top: 0, bottom: 0 },
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
    borderStyle: 'round',
    borderColor: 'cyan',
    title: `${icons.mushroom} Mycelium`,
    titleAlignment: 'left',
  });
}

// ============================================================================
// Fuzzy Command Matching
// ============================================================================

export function suggestCommand(input: string, commands: string[]): string[] {
  return commands
    .map(cmd => ({ cmd, dist: distance(input.toLowerCase(), cmd.toLowerCase()) }))
    .filter(s => s.dist <= 3)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 2)
    .map(s => s.cmd);
}

// ============================================================================
// Help Display
// ============================================================================

export function createHelpTable(): string {
  const table = new Table({
    style: {
      head: [],
      border: ['gray'],
    },
    colWidths: [20, 40],
  });

  table.push(
    [chalk.cyan('Commands'), ''],
    ['  /roles', 'Select and switch roles'],
    ['  /tools', 'List available tools'],
    ['  /status', 'Show current status'],
    ['  /model <name>', 'Change model'],
    ['  /help', 'Show this help'],
    ['  /quit', 'Exit'],
    ['', ''],
    [chalk.cyan('Shortcuts'), ''],
    ['  Ctrl+R', 'Select role'],
    ['  Ctrl+T', 'List tools'],
    ['  Ctrl+S', 'Show status'],
    ['  Ctrl+H', 'Show help'],
  );

  return table.toString();
}

// ============================================================================
// Banner
// ============================================================================

export function createBanner(): string {
  const art = `
${chalk.cyan('    ╭──────────────────────────────────────────────────────────────╮')}
${chalk.cyan('    │')}  ${chalk.red('  ,--.')}                                                      ${chalk.cyan('│')}
${chalk.cyan('    │')}  ${chalk.red(' ( ○ ○)')}  ${chalk.bold.cyan('MYCELIUM')} ${chalk.gray('- Agent Router Client')}                   ${chalk.cyan('│')}
${chalk.cyan('    │')}  ${chalk.yellow('   ║')}     ${chalk.gray('Connecting agents like fungal networks')}            ${chalk.cyan('│')}
${chalk.cyan('    │')}  ${chalk.yellow('  ╱╲╱╲')}                                                     ${chalk.cyan('│')}
${chalk.cyan('    ╰──────────────────────────────────────────────────────────────╯')}
`;
  return art;
}

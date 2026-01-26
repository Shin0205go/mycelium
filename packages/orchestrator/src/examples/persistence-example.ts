// ============================================================================
// Mycelium Orchestrator - Persistence Example
// ============================================================================

import { createOrchestrator } from '../orchestrator.js';
import type { OrchestratorConfig } from '../types.js';
import type { BaseSkillDefinition, Logger } from '@mycelium/shared';

// Simple logger implementation
const logger: Logger = {
  debug: (msg: string, meta?: any) => console.log(`[DEBUG] ${msg}`, meta || ''),
  info: (msg: string, meta?: any) => console.log(`[INFO] ${msg}`, meta || ''),
  warn: (msg: string, meta?: any) => console.warn(`[WARN] ${msg}`, meta || ''),
  error: (msg: string, meta?: any) => console.error(`[ERROR] ${msg}`, meta || ''),
};

// Example skill definition
const exampleSkill: BaseSkillDefinition = {
  id: 'file-manager',
  displayName: 'File Manager',
  description: 'Manages files and directories',
  allowedRoles: ['developer'],
  allowedTools: ['read_file', 'write_file', 'list_directory'],
  metadata: {},
};

async function main() {
  console.log('=== Orchestrator Persistence Example ===\n');

  // -------------------------------------------------------------------------
  // Example 1: Basic Persistence Setup
  // -------------------------------------------------------------------------
  console.log('--- Example 1: Basic Persistence ---');

  const config: OrchestratorConfig = {
    logger,
    skills: [exampleSkill],
    persistence: {
      enabled: true,
      strategy: 'file',
      storageDir: './orchestrator-data',
      autoSave: true,
      autoSaveInterval: 30000, // 30 seconds
      loadOnInit: true,
    },
  };

  const orchestrator = createOrchestrator(config);
  await orchestrator.initialize();

  console.log('✓ Orchestrator initialized with persistence\n');

  // -------------------------------------------------------------------------
  // Example 2: Spawn Workers and Save State
  // -------------------------------------------------------------------------
  console.log('--- Example 2: Spawn Workers ---');

  const worker1 = orchestrator.spawnWorker({ 
    skillId: 'file-manager',
    workerId: 'worker-001'
  });

  const worker2 = orchestrator.spawnWorker({ 
    skillId: 'file-manager',
    workerId: 'worker-002'
  });

  console.log(`✓ Spawned workers: ${worker1.id}, ${worker2.id}`);
  console.log('State:', orchestrator.getState());
  console.log('');

  // -------------------------------------------------------------------------
  // Example 3: Execute Tasks
  // -------------------------------------------------------------------------
  console.log('--- Example 3: Execute Tasks ---');

  await orchestrator.executeTask({
    workerId: 'worker-001',
    prompt: 'Read configuration file',
    context: { file: 'config.json' },
  });

  await orchestrator.executeTask({
    workerId: 'worker-002',
    prompt: 'List project files',
  });

  console.log('✓ Tasks executed');
  console.log('Completed results:', orchestrator.getCompletedResults().length);
  console.log('');

  // -------------------------------------------------------------------------
  // Example 4: Manual Snapshot Save
  // -------------------------------------------------------------------------
  console.log('--- Example 4: Manual Snapshot ---');

  await orchestrator.saveSnapshot();
  console.log('✓ Snapshot saved manually\n');

  // -------------------------------------------------------------------------
  // Example 5: Shutdown and Restore
  // -------------------------------------------------------------------------
  console.log('--- Example 5: Shutdown and Restore ---');

  await orchestrator.shutdown();
  console.log('✓ Orchestrator shut down (auto-saved)\n');

  // Create new orchestrator instance
  const newOrchestrator = createOrchestrator(config);
  await newOrchestrator.initialize();

  console.log('✓ New orchestrator initialized');
  console.log('Restored state:', newOrchestrator.getState());
  console.log('Restored workers:', newOrchestrator.getAllWorkers().map(w => w.id));
  console.log('Restored results:', newOrchestrator.getCompletedResults().length);
  console.log('');

  // -------------------------------------------------------------------------
  // Example 6: Continue Work After Restore
  // -------------------------------------------------------------------------
  console.log('--- Example 6: Continue After Restore ---');

  const worker3 = newOrchestrator.spawnWorker({ 
    skillId: 'file-manager',
    workerId: 'worker-003'
  });

  await newOrchestrator.executeTask({
    workerId: worker3.id,
    prompt: 'Create new directory',
  });

  console.log('✓ New worker spawned and task executed');
  console.log('Total workers:', newOrchestrator.getAllWorkers().length);
  console.log('Total results:', newOrchestrator.getCompletedResults().length);
  console.log('');

  // -------------------------------------------------------------------------
  // Example 7: Cleanup
  // -------------------------------------------------------------------------
  console.log('--- Example 7: Cleanup ---');

  await newOrchestrator.terminateAllWorkers();
  await newOrchestrator.deleteSnapshot();
  await newOrchestrator.shutdown();

  console.log('✓ All workers terminated and snapshot deleted\n');

  // -------------------------------------------------------------------------
  // Example 8: Persistence Disabled
  // -------------------------------------------------------------------------
  console.log('--- Example 8: Without Persistence ---');

  const noPersistConfig: OrchestratorConfig = {
    logger,
    skills: [exampleSkill],
    // No persistence config
  };

  const noPersistOrchestrator = createOrchestrator(noPersistConfig);
  await noPersistOrchestrator.initialize();

  console.log('Persistence enabled?', noPersistOrchestrator.isPersistenceEnabled());

  try {
    await noPersistOrchestrator.saveSnapshot();
  } catch (error) {
    console.log('✓ Expected error:', (error as Error).message);
  }

  await noPersistOrchestrator.shutdown();
  console.log('');

  console.log('=== Examples Complete ===');
}

// Run examples
main().catch(console.error);

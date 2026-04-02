import path from 'node:path';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { createChatModel } from '../services/llm.js';
import { buildSupervisorPrompt } from './prompts.js';
import { createListProjectsTool } from './tools/listProjects.js';
import { createCrossProjectStatsTool } from './tools/crossProjectStats.js';
import { createProactiveCheckTool } from './tools/proactiveCheck.js';
import { createDelegateToAgentTool } from './tools/delegateToAgent.js';
import { createSupervisorReadTools } from './tools/projectReadTools.js';
import { createSkillManagementTools } from './tools/skillTools.js';
import { createReadFileContentTool, createWriteFileContentTool } from './tools/fileTools.js';
import { createRunScriptTool } from './tools/scriptTool.js';
import { createFetchWebTool } from './tools/webTool.js';

const MAX_RECURSION = 40;

export function createSupervisorAgent(deps) {
  const {
    appRoot,
    getSandboxRoot,
    getWorkspaceDirs,
    getWorkspaceDirOrThrow,
    syncStructureJson,
    readState,
    toolContext,
    getAutonomousMode,
  } = deps;

  const toolDeps = {
    appRoot,
    getWorkspaceDirs,
    getWorkspaceDirOrThrow,
    syncStructureJson,
    readState,
    getAutonomousMode,
  };

  const skillDeps = {
    getSandboxRoot: getSandboxRoot || (() => path.join(appRoot, 'sandbox')),
    getAppRoot: () => appRoot,
    getWorkspaceDirs,
    getAutonomousMode,
  };

  const sandboxDeps = { getSandboxRoot: getSandboxRoot || (() => path.join(appRoot, 'sandbox')) };

  const tools = [
    createListProjectsTool(toolDeps),
    createCrossProjectStatsTool(toolDeps),
    createProactiveCheckTool(toolDeps),
    createDelegateToAgentTool(toolDeps),
    ...createSupervisorReadTools(toolDeps),
    // High-privilege direct tools (workspace-aware)
    createReadFileContentTool({ getWorkspaceDirs }),
    createWriteFileContentTool({ getWorkspaceDirs }),
    createRunScriptTool(sandboxDeps),
    createFetchWebTool(),
    // Skill management tools
    ...createSkillManagementTools(skillDeps),
  ];

  const model = createChatModel();
  const prompt = buildSupervisorPrompt();
  const checkpointer = new MemorySaver();

  const agent = createReactAgent({
    llm: model,
    tools,
    prompt,
    checkpointer,
  });

  return { agent, checkpointer, recursionLimit: MAX_RECURSION };
}
